/**
 * OA-04E — post-enrolment checklist read model (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa04e.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { uploadApplicantDocument } from "./admissionsDocumentService";
import {
  convertAcceptedApplicationToLearner,
  type ConversionActor,
  type ConversionDecisionDto,
} from "./admissionsConversionService";
import {
  createDraftApplication,
  updateDraftApplication,
} from "./draftApplicationService";
import { submitApplication } from "./submitApplicationService";
import {
  assertNoSensitiveAdmissionsFields,
  getStaffApplicationDetail,
} from "./staffAdmissionsReadService";
import {
  acceptAdmissionApplication,
  startApplicationReview,
  type StaffWorkflowActor,
} from "./staffAdmissionsWorkflowService";
import { upsertLearnerBillingPlanToDb } from "../learnerBillingPlanDbStore";
import {
  invalidateFamilyAccountAgeAnalysisFileCache,
} from "../../utils/familyAccountAgeAnalysisStore";

const prisma = new PrismaClient();
const AGE_ANALYSIS_PATH = path.join(process.cwd(), "data", "family-account-age-analysis.json");

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = (raw.match(/@([^:/?]+)/) || [])[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${host}`);
  }
}

function snapshotAgeAnalysisFile(): string | null {
  try {
    return fs.readFileSync(AGE_ANALYSIS_PATH, "utf8");
  } catch {
    return null;
  }
}

function restoreAgeAnalysisFile(snapshot: string | null) {
  if (snapshot === null) {
    if (fs.existsSync(AGE_ANALYSIS_PATH)) fs.unlinkSync(AGE_ANALYSIS_PATH);
  } else {
    fs.mkdirSync(path.dirname(AGE_ANALYSIS_PATH), { recursive: true });
    fs.writeFileSync(AGE_ANALYSIS_PATH, snapshot, "utf8");
  }
  invalidateFamilyAccountAgeAnalysisFileCache();
}

function minimalPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
}

async function makeSchool(suffix: string) {
  const school = await prisma.school.create({ data: { name: `OA04E ${suffix}` } });
  const slug = `oa04e-${suffix}-${Date.now().toString(36)}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: false,
      currency: "ZAR",
      requirePaymentVerifiedBeforeAccept: false,
      requiredDocuments: [
        { key: "birth_certificate", label: "Birth certificate", required: true },
      ],
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
    },
  });
  const admin = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `oa04e-admin-${suffix}-${Date.now()}@example.com`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      isActive: true,
    },
  });
  return { school, slug, admin };
}

async function cleanupSchool(schoolId: string) {
  const apps = await prisma.admissionApplication.findMany({
    where: { schoolId },
    select: { id: true },
  });
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await prisma.admissionApplication.updateMany({
      where: { id: { in: ids } },
      data: { promotedLearnerId: null, promotedFamilyAccountId: null },
    });
    await prisma.admissionFeeRecord.updateMany({
      where: { applicationId: { in: ids } },
      data: { latestProofDocumentId: null },
    });
    await prisma.admissionDocument.updateMany({
      where: { applicationId: { in: ids } },
      data: { replacedByDocumentId: null },
    });
    await prisma.admissionDocument.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStaffNote.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  }
  const learners = await prisma.learner.findMany({ where: { schoolId }, select: { id: true } });
  const learnerIds = learners.map((l) => l.id);
  if (learnerIds.length) {
    await prisma.learnerBillingPlanLine.deleteMany({ where: { learnerId: { in: learnerIds } } });
    await prisma.parentLearnerLink.deleteMany({ where: { learnerId: { in: learnerIds } } });
    await prisma.learnerBillingPlanLine.deleteMany({ where: { schoolId } });
    await prisma.learner.deleteMany({ where: { id: { in: learnerIds } } });
  }
  await prisma.parentOnboarding.deleteMany({ where: { schoolId } });
  await prisma.parent.deleteMany({ where: { schoolId } });
  await prisma.familyAccount.deleteMany({ where: { schoolId } });
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oa04e-" } } });
  await prisma.school.delete({ where: { id: schoolId } });
}

async function acceptReadyApp(slug: string, schoolId: string, adminId: string) {
  const draft = await createDraftApplication(prisma, slug, {});
  await updateDraftApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken, {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
    learner: {
      firstName: "Checklist",
      lastName: "Learner",
      birthDate: "2018-04-01",
      homeAddress: "1 Checklist Rd",
    },
    guardians: [
      {
        firstName: "Portal",
        surname: "Ready",
        cellNo: `085${String(Date.now()).slice(-7)}`,
        email: `portal-ready-${Date.now().toString(36)}@example.com`,
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "1 Checklist Rd",
      },
      {
        firstName: "Needs",
        surname: "Onboard",
        cellNo: `086${String(Date.now()).slice(-7)}`,
        email: `needs-onboard-${Date.now().toString(36)}@example.com`,
        isPrimary: false,
        isPayingPerson: false,
        homeAddress: "1 Checklist Rd",
      },
    ],
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why?", valueJson: "Test" }],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
  });
  await submitApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken);
  await uploadApplicantDocument(prisma, slug, draft.application.publicAccessId, draft.accessToken, {
    documentType: "birth_certificate",
    buffer: minimalPdf(),
    originalFileName: "birth.pdf",
    claimedMime: "application/pdf",
  });
  const row = await prisma.admissionApplication.findFirstOrThrow({
    where: { publicAccessId: draft.application.publicAccessId },
    include: { guardians: true },
  });
  const actor: StaffWorkflowActor = {
    userId: adminId,
    schoolId,
    appRole: "Admin",
    hasAdmissionsEdit: true,
    hasAdmissionsManage: true,
  };
  await startApplicationReview(prisma, actor, row.id);
  await acceptAdmissionApplication(prisma, actor, row.id);
  return prisma.admissionApplication.findUniqueOrThrow({
    where: { id: row.id },
    include: { guardians: true },
  });
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];
  const ageSnapshot = snapshotAgeAnalysisFile();

  try {
    const a = await makeSchool("a");
    const b = await makeSchool("b");
    schoolIds.push(a.school.id, b.school.id);

    const accepted = await acceptReadyApp(a.slug, a.school.id, a.admin.id);
    const before = await getStaffApplicationDetail(prisma, a.school.id, accepted.id);
    assert.strictEqual(before.postEnrolment, null);

    const conv: ConversionActor = {
      userId: a.admin.id,
      schoolId: a.school.id,
      appRole: "Admin",
      hasAdmissionsManage: true,
      hasLearnersCreate: true,
    };
    const dto: ConversionDecisionDto = {
      family: { mode: "CREATE_NEW" },
      guardians: accepted.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW",
      })),
      placement: { grade: "Grade 1", className: null },
    };
    const result = await convertAcceptedApplicationToLearner(prisma, conv, accepted.id, dto);

    const after = await getStaffApplicationDetail(prisma, a.school.id, accepted.id);
    assert.ok(after.postEnrolment);
    assertNoSensitiveAdmissionsFields(after);
    assert.ok(!JSON.stringify(after.postEnrolment).includes("accessTokenHash"));
    assert.ok(!JSON.stringify(after.postEnrolment).includes("password"));

    const pe = after.postEnrolment!;
    assert.strictEqual(pe.learner.id, result.learnerId);
    assert.strictEqual(pe.learner.grade, "Grade 1");
    assert.strictEqual(pe.learner.className, null);
    assert.strictEqual(pe.placement.status, "ACTION_RECOMMENDED");
    assert.ok(pe.family);
    assert.strictEqual(pe.family!.mode, "created");
    assert.strictEqual(pe.billingPlan.status, "REQUIRED");
    assert.strictEqual(pe.invoicing.status, "WAITING_FOR_BILLING_PLAN");
    assert.match(pe.admissionFee.note, /does not mean paid on the FamilyAccount/i);
    assert.ok(pe.guardians.length >= 2);
    assert.ok(pe.guardians.every((g) => g.portalStatus === "ONBOARDING_REQUIRED"));

    // Mark one parent portal-ready via existing onboarding table (test-only setup)
    const readyParent = pe.guardians[0];
    await prisma.parentOnboarding.create({
      data: {
        schoolId: a.school.id,
        parentId: readyParent.parentId,
        status: "REGISTERED",
        registeredAt: new Date(),
      },
    });
    const afterPortal = await getStaffApplicationDetail(prisma, a.school.id, accepted.id);
    const statuses = afterPortal.postEnrolment!.guardians.map((g) => g.portalStatus).sort();
    assert.deepStrictEqual(statuses, ["ONBOARDING_REQUIRED", "READY"].sort());

    await upsertLearnerBillingPlanToDb(a.school.id, result.learnerId, [
      { feeDescription: "Tuition", amount: 1000 },
    ]);
    await prisma.learner.update({
      where: { id: result.learnerId },
      data: { className: "Grade 1A" },
    });
    const afterPlan = await getStaffApplicationDetail(prisma, a.school.id, accepted.id);
    assert.strictEqual(afterPlan.postEnrolment!.billingPlan.status, "ASSIGNED");
    assert.strictEqual(afterPlan.postEnrolment!.placement.status, "COMPLETE");
    assert.strictEqual(
      afterPlan.postEnrolment!.invoicing.status,
      "READY_FOR_FUTURE_INVOICE_RUN"
    );
    assert.ok(!/invoice (has been|was) generated/i.test(afterPlan.postEnrolment!.invoicing.note));

    // Cross-school blocked
    await assert.rejects(() => getStaffApplicationDetail(prisma, b.school.id, accepted.id));

    // Read has no mutations — re-fetch identical promoted ids
    const again = await getStaffApplicationDetail(prisma, a.school.id, accepted.id);
    assert.strictEqual(again.promotedLearnerId, result.learnerId);
    assert.strictEqual(again.postEnrolment!.billingPlan.lineCount, 1);

    console.log("OA-04E post-enrolment integration tests passed");
  } finally {
    for (const id of schoolIds) {
      await cleanupSchool(id);
    }
    restoreAgeAnalysisFile(ageSnapshot);
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
