/**
 * OA-04C.1 — staff read promoted-field exposure + tenant safety (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/staffAdmissionsRead.oa04c1.integration.test.ts
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
  listStaffApplications,
  StaffAdmissionsError,
} from "./staffAdmissionsReadService";
import {
  acceptAdmissionApplication,
  startApplicationReview,
  type StaffWorkflowActor,
} from "./staffAdmissionsWorkflowService";
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
  const school = await prisma.school.create({ data: { name: `OA04C1 ${suffix}` } });
  const slug = `oa04c1-${suffix}-${Date.now().toString(36)}`;
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
      email: `oa04c1-admin-${suffix}-${Date.now()}@example.com`,
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
    await prisma.parentLearnerLink.deleteMany({ where: { learnerId: { in: learnerIds } } });
    await prisma.learnerBillingPlanLine.deleteMany({ where: { learnerId: { in: learnerIds } } });
    await prisma.learner.deleteMany({ where: { id: { in: learnerIds } } });
  }
  await prisma.parent.deleteMany({ where: { schoolId } });
  await prisma.familyAccount.deleteMany({ where: { schoolId } });
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oa04c1-" } } });
  await prisma.school.delete({ where: { id: schoolId } });
}

async function acceptReadyApp(slug: string, schoolId: string, adminId: string) {
  const draft = await createDraftApplication(prisma, slug, {});
  await updateDraftApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken, {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
    learner: {
      firstName: "Neo",
      lastName: "Verify",
      birthDate: "2018-03-12",
      homeAddress: "9 Verify Rd",
    },
    guardians: [
      {
        firstName: "Parent",
        surname: "Verify",
        cellNo: `084${String(Date.now()).slice(-7)}`,
        email: `parent-verify-${Date.now().toString(36)}@example.com`,
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "9 Verify Rd",
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
    assert.strictEqual(accepted.promotedLearnerId, null);

    const beforeList = await listStaffApplications(prisma, a.school.id, {
      status: "ACCEPTED",
      page: 1,
      pageSize: 20,
    });
    const beforeRow = beforeList.items.find((i) => i.id === accepted.id);
    assert.ok(beforeRow);
    assert.strictEqual(beforeRow!.promotedLearnerId, null);
    assert.strictEqual(beforeRow!.promotedFamilyAccountId, null);

    const beforeDetail = await getStaffApplicationDetail(prisma, a.school.id, accepted.id);
    assert.strictEqual(beforeDetail.promotedLearnerId, null);
    assert.strictEqual(beforeDetail.promotedLearner, null);
    assertNoSensitiveAdmissionsFields(beforeDetail);

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
    assert.ok(result.learnerId);

    const afterList = await listStaffApplications(prisma, a.school.id, {
      status: "ACCEPTED",
      page: 1,
      pageSize: 20,
    });
    const afterRow = afterList.items.find((i) => i.id === accepted.id);
    assert.ok(afterRow);
    assert.strictEqual(afterRow!.promotedLearnerId, result.learnerId);
    assert.strictEqual(afterRow!.promotedFamilyAccountId, result.familyAccountId);
    assertNoSensitiveAdmissionsFields(afterList);

    const afterDetail = await getStaffApplicationDetail(prisma, a.school.id, accepted.id);
    assert.strictEqual(afterDetail.promotedLearnerId, result.learnerId);
    assert.strictEqual(afterDetail.promotedFamilyAccountId, result.familyAccountId);
    assert.ok(afterDetail.promotedLearner);
    assert.strictEqual(afterDetail.promotedLearner!.id, result.learnerId);
    assert.strictEqual(afterDetail.promotedLearner!.firstName, "Neo");
    assert.strictEqual(afterDetail.promotedLearner!.lastName, "Verify");
    assert.ok(afterDetail.promotedLearner!.admissionNo);
    assert.strictEqual(afterDetail.promotedLearner!.grade, "Grade 1");
    assert.ok(!("idNumber" in (afterDetail.promotedLearner as object)));
    assert.ok(!("allergies" in (afterDetail.promotedLearner as object)));
    assertNoSensitiveAdmissionsFields(afterDetail);

    await assert.rejects(
      () => getStaffApplicationDetail(prisma, b.school.id, accepted.id),
      (e: unknown) => e instanceof StaffAdmissionsError && e.statusCode === 404
    );
    const listB = await listStaffApplications(prisma, b.school.id, {});
    assert.ok(!listB.items.some((i) => i.id === accepted.id));
    assert.ok(!listB.items.some((i) => i.promotedLearnerId === result.learnerId));

    console.log("OA-04C.1 staffAdmissionsRead integration tests passed");
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
