/**
 * OA-05B integration — historical learner reactivation (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa05b.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { uploadApplicantDocument } from "./admissionsDocumentService";
import {
  type ConversionActor,
} from "./admissionsConversionService";
import {
  getReactivationPreflight,
  reactivateHistoricalLearnerForApplication,
} from "./admissionsHistoricalReactivationService";
import {
  createDraftApplication,
  updateDraftApplication,
} from "./draftApplicationService";
import { PublicAdmissionsError } from "./resolvePublicAdmissions";
import { submitApplication } from "./submitApplicationService";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";
import {
  acceptAdmissionApplication,
  startApplicationReview,
  type StaffWorkflowActor,
} from "./staffAdmissionsWorkflowService";
import { registerLearner, updateLearnerEnrollmentStatus } from "../learnerRegistrationService";
import { saveParentLinks } from "../parentLinkService";
import {
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../../utils/familyAccountAgeAnalysisStore";

const prisma = new PrismaClient();

const AGE_ANALYSIS_PATH = path.join(process.cwd(), "data", "family-account-age-analysis.json");

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

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = (raw.match(/@([^:/?]+)/) || [])[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${host}`);
  }
}

function minimalPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
}

function staff(schoolId: string, userId: string): StaffWorkflowActor {
  return {
    userId,
    schoolId,
    appRole: "Admin",
    hasAdmissionsEdit: true,
    hasAdmissionsManage: true,
  };
}

function converter(
  schoolId: string,
  userId: string,
  overrides: Partial<ConversionActor> = {}
): ConversionActor {
  return {
    userId,
    schoolId,
    appRole: "Admin",
    hasAdmissionsManage: true,
    hasLearnersCreate: true,
    ...overrides,
  };
}

async function makeSchool(suffix: string, opts?: { requiredDocuments?: unknown[] }) {
  const school = await prisma.school.create({ data: { name: `OA05B ${suffix}` } });
  const slug = `oa05b-${suffix}-${Date.now().toString(36)}`;
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
      requiredDocuments:
        opts?.requiredDocuments ??
        [{ key: "birth_certificate", label: "Birth certificate", required: true }],
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
    },
  });
  const admin = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `oa05b-admin-${suffix}-${Date.now()}@example.com`,
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
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oa05b-" } } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

let appSeq = 0;

async function acceptReadyApp(
  slug: string,
  schoolId: string,
  adminId: string,
  opts?: {
    learnerIdNumber?: string | null;
    learnerFirstName?: string;
    learnerLastName?: string;
    birthDate?: string;
    guardianIdNumber?: string;
    secondGuardian?: boolean;
  }
) {
  appSeq += 1;
  const draft = await createDraftApplication(prisma, slug, {
    requestedGrade: "Grade 2",
    learner: { firstName: "", lastName: "" },
  });
  const uniq = `${appSeq}${Date.now().toString(36)}`;
  const day = String((appSeq % 27) + 1).padStart(2, "0");
  const guardians: any[] = [
    {
      firstName: "Nomsa",
      surname: "Dlamini",
      cellNo: `082${String(2000000 + appSeq).slice(-7)}`,
      email: `nomsa-${uniq}@example.com`,
      idNumber: opts?.guardianIdNumber || null,
      isPrimary: true,
      isPayingPerson: true,
      homeAddress: "2 Test St",
    },
  ];
  if (opts?.secondGuardian) {
    guardians.push({
      firstName: "Bongani",
      surname: "Dlamini",
      cellNo: `083${String(2000000 + appSeq).slice(-7)}`,
      email: `bongani-${uniq}@example.com`,
      isPrimary: false,
      isPayingPerson: false,
    });
  }
  await updateDraftApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken, {
    requestedGrade: "Grade 2",
    intakeYear: 2027,
    learner: {
      firstName: opts?.learnerFirstName || `Anele${appSeq}`,
      lastName: opts?.learnerLastName || `Dlamini${appSeq}`,
      birthDate: opts?.birthDate || `2017-03-${day}`,
      homeAddress: "2 Test St",
      idNumber: opts?.learnerIdNumber ?? null,
    },
    guardians,
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why apply?", valueJson: "Return" }],
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
  const actor = staff(schoolId, adminId);
  await startApplicationReview(prisma, actor, row.id);
  await acceptAdmissionApplication(prisma, actor, row.id);
  return prisma.admissionApplication.findUniqueOrThrow({
    where: { id: row.id },
    include: { guardians: { orderBy: { sortOrder: "asc" } }, learnerCandidate: true },
  });
}

async function prepareConditionalDocumentApp(input: {
  slug: string;
  schoolId: string;
  adminId: string;
  citizenship: string | null;
}) {
  appSeq += 1;
  const draft = await createDraftApplication(prisma, input.slug, {
    requestedGrade: "Grade 1",
    learner: { firstName: "", lastName: "" },
  });
  await updateDraftApplication(
    prisma,
    input.slug,
    draft.application.publicAccessId,
    draft.accessToken,
    {
      requestedGrade: "Grade 1",
      intakeYear: 2027,
      learner: {
        firstName: `Conditional${appSeq}`,
        lastName: "Learner",
        birthDate: "2018-05-01",
        citizenship: input.citizenship,
        homeAddress: "1 Test St",
      },
      guardians: [
        {
          firstName: "Parent",
          surname: "Learner",
          cellNo: "0821111111",
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
      answers: [
        {
          questionKey: "why",
          questionLabelSnapshot: "Why apply?",
          valueJson: "Test",
        },
      ],
      privacyAccepted: true,
      declarationsAccepted: true,
      privacyNoticeVersion: "v1",
    }
  );
  return {
    draft,
    actor: staff(input.schoolId, input.adminId),
  };
}

async function seedHistoricalLearner(input: {
  schoolId: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  idNumber?: string | null;
  grade?: string;
  withBillingPlan?: boolean;
  withExistingParent?: boolean;
}) {
  const reg = await registerLearner({
    schoolId: input.schoolId,
    learner: {
      firstName: input.firstName,
      lastName: input.lastName,
      surname: input.lastName,
      birthDate: input.birthDate,
      idNumber: input.idNumber || null,
      grade: input.grade || "Grade 1",
      className: "1A",
    },
    registerFinanceBaseline: true,
  });
  const learner = reg.learner!;
  const admissionNoBefore = learner.admissionNo;
  if (input.withExistingParent) {
    await saveParentLinks({
      schoolId: input.schoolId,
      learnerId: learner.id,
      familyAccountId: reg.familyAccount.id,
      parents: [
        {
          firstName: "Historic",
          surname: "Guardian",
          cellNo: `084${String(Date.now()).slice(-7)}`,
          email: `hist-g-${Date.now()}@example.com`,
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
      trustedIsOwnerAdmin: true,
    });
  }
  if (input.withBillingPlan) {
    await prisma.learnerBillingPlanLine.create({
      data: {
        schoolId: input.schoolId,
        learnerId: learner.id,
        feeDescription: "Legacy tuition",
        amount: 1500,
        sortOrder: 0,
      },
    });
  }
  await updateLearnerEnrollmentStatus({
    schoolId: input.schoolId,
    learnerId: learner.id,
    enrollmentStatus: "HISTORICAL",
  });
  const historical = await prisma.learner.findUniqueOrThrow({
    where: { id: learner.id },
    include: { familyAccount: true, links: true },
  });
  assert.strictEqual(historical.enrollmentStatus, "HISTORICAL");
  assert.strictEqual(historical.admissionNo, admissionNoBefore);
  return { learner: historical, familyAccount: reg.familyAccount, admissionNo: admissionNoBefore };
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];
  const ageSnapshot = snapshotAgeAnalysisFile();

  try {
    const a = await makeSchool("a");
    const b = await makeSchool("b");
    const conditional = await makeSchool("conditional", {
      requiredDocuments: [
        { key: "birth_certificate", label: "Birth certificate", required: true },
        {
          key: "permanent_residence_permit",
          label: "Permanent residence permit",
          required: true,
          condition: { type: "learner_citizenship_not_south_african" },
        },
      ],
    });
    schoolIds.push(a.school.id, b.school.id, conditional.school.id);
    const convA = converter(a.school.id, a.admin.id);

    // Auth
    await assert.rejects(
      () =>
        getReactivationPreflight(
          prisma,
          converter(a.school.id, a.admin.id, { appRole: "Finance" }),
          "x"
        ),
      (e: unknown) => e instanceof StaffAdmissionsError && e.code === "ADMISSIONS_DECISION_FORBIDDEN"
    );

    const nonSouthAfrican = await prepareConditionalDocumentApp({
      slug: conditional.slug,
      schoolId: conditional.school.id,
      adminId: conditional.admin.id,
      citizenship: "Zimbabwean",
    });
    await uploadApplicantDocument(
      prisma,
      conditional.slug,
      nonSouthAfrican.draft.application.publicAccessId,
      nonSouthAfrican.draft.accessToken,
      {
        documentType: "birth_certificate",
        buffer: minimalPdf(),
        originalFileName: "birth.pdf",
        claimedMime: "application/pdf",
      }
    );
    await submitApplication(
      prisma,
      conditional.slug,
      nonSouthAfrican.draft.application.publicAccessId,
      nonSouthAfrican.draft.accessToken
    );
    const nonSouthAfricanRow = await prisma.admissionApplication.findFirstOrThrow({
      where: { publicAccessId: nonSouthAfrican.draft.application.publicAccessId },
    });
    await startApplicationReview(
      prisma,
      nonSouthAfrican.actor,
      nonSouthAfricanRow.id
    );
    await assert.rejects(
      () =>
        acceptAdmissionApplication(
          prisma,
          nonSouthAfrican.actor,
          nonSouthAfricanRow.id
        ),
      (error: unknown) =>
        error instanceof StaffAdmissionsError && error.code === "DOCUMENTS_INCOMPLETE"
    );
    await uploadApplicantDocument(
      prisma,
      conditional.slug,
      nonSouthAfrican.draft.application.publicAccessId,
      nonSouthAfrican.draft.accessToken,
      {
        documentType: "permanent_residence_permit",
        buffer: minimalPdf(),
        originalFileName: "permit.pdf",
        claimedMime: "application/pdf",
      }
    );
    await acceptAdmissionApplication(
      prisma,
      nonSouthAfrican.actor,
      nonSouthAfricanRow.id
    );

    const southAfrican = await prepareConditionalDocumentApp({
      slug: conditional.slug,
      schoolId: conditional.school.id,
      adminId: conditional.admin.id,
      citizenship: "South African",
    });
    await uploadApplicantDocument(
      prisma,
      conditional.slug,
      southAfrican.draft.application.publicAccessId,
      southAfrican.draft.accessToken,
      {
        documentType: "birth_certificate",
        buffer: minimalPdf(),
        originalFileName: "birth.pdf",
        claimedMime: "application/pdf",
      }
    );
    await submitApplication(
      prisma,
      conditional.slug,
      southAfrican.draft.application.publicAccessId,
      southAfrican.draft.accessToken
    );
    const southAfricanRow = await prisma.admissionApplication.findFirstOrThrow({
      where: { publicAccessId: southAfrican.draft.application.publicAccessId },
    });
    await startApplicationReview(prisma, southAfrican.actor, southAfricanRow.id);
    await acceptAdmissionApplication(prisma, southAfrican.actor, southAfricanRow.id);

    const unresolvedCitizenship = await prepareConditionalDocumentApp({
      slug: conditional.slug,
      schoolId: conditional.school.id,
      adminId: conditional.admin.id,
      citizenship: null,
    });
    await assert.rejects(
      () =>
        submitApplication(
          prisma,
          conditional.slug,
          unresolvedCitizenship.draft.application.publicAccessId,
          unresolvedCitizenship.draft.accessToken
        ),
      (error: unknown) =>
        error instanceof PublicAdmissionsError &&
        error.code === "VALIDATION_FAILED" &&
        Boolean(error.details?.some((detail) => detail.field === "learner.citizenship"))
    );

    // 1 Exact-ID historical preflight + successful reactivation
    const idNumber = `9001${Date.now().toString().slice(-9)}`;
    const histExact = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "ExactId",
      lastName: "Learner",
      birthDate: "2017-03-05",
      idNumber,
      withBillingPlan: true,
      withExistingParent: true,
    });
    const existingLinkCount = histExact.learner.links.length;
    assert.ok(existingLinkCount >= 1);

    const appExact = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: idNumber,
      learnerFirstName: "ExactId",
      learnerLastName: "Learner",
      birthDate: "2017-03-05",
      secondGuardian: true,
    });
    const preExact = await getReactivationPreflight(prisma, convA, appExact.id);
    assert.strictEqual(preExact.canReactivate, true);
    assert.ok(preExact.historicalLearner);
    assert.strictEqual(preExact.historicalLearner!.id, histExact.learner.id);
    assert.strictEqual(preExact.match?.matchReason, "idNumber");
    assert.strictEqual(preExact.family.defaultMode, "KEEP_EXISTING");
    assert.strictEqual(preExact.family.createNewSupported, false);
    assert.ok(preExact.billingPlan.requiresAcknowledgeExistingBillingPlan);
    assert.ok(
      preExact.warnings.some((w) => w.code === "STALE_BILLING_PLAN_REVIEW_REQUIRED")
    );
    assert.strictEqual(
      preExact.preserveExistingParentLinksWarning.code,
      "EXISTING_GUARDIAN_LINKS_PRESERVED"
    );

    await assert.rejects(
      () =>
        reactivateHistoricalLearnerForApplication(prisma, convA, appExact.id, {
          learnerId: histExact.learner.id,
          family: { mode: "KEEP_EXISTING" },
          guardians: appExact.guardians.map((g) => ({
            admissionGuardianId: g.id,
            mode: "CREATE_NEW" as const,
          })),
          placement: { grade: "Grade 2" },
        }),
      (e: unknown) => e instanceof StaffAdmissionsError && e.code === "BILLING_PLAN_ACK_REQUIRED"
    );

    await assert.rejects(
      () =>
        reactivateHistoricalLearnerForApplication(prisma, convA, appExact.id, {
          learnerId: histExact.learner.id,
          family: { mode: "CREATE_NEW" },
          guardians: appExact.guardians.map((g) => ({
            admissionGuardianId: g.id,
            mode: "CREATE_NEW" as const,
          })),
          placement: { grade: "Grade 2" },
          acknowledgeExistingBillingPlan: true,
        }),
      (e: unknown) =>
        e instanceof StaffAdmissionsError && e.code === "CREATE_NEW_FAMILY_NOT_SUPPORTED"
    );

    const resultExact = await reactivateHistoricalLearnerForApplication(prisma, convA, appExact.id, {
      learnerId: histExact.learner.id,
      family: { mode: "KEEP_EXISTING" },
      guardians: appExact.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW" as const,
      })),
      placement: { grade: "Grade 2", className: "2B" },
      acknowledgeExistingBillingPlan: true,
    });
    assert.strictEqual(resultExact.idempotent, false);
    assert.strictEqual(resultExact.learnerId, histExact.learner.id);
    assert.strictEqual(resultExact.admissionNo, histExact.admissionNo);
    assert.strictEqual(resultExact.familyMode, "kept");
    assert.strictEqual(resultExact.grade, "Grade 2");
    assert.strictEqual(resultExact.className, "2B");

    const reactivated = await prisma.learner.findUniqueOrThrow({
      where: { id: histExact.learner.id },
      include: { familyAccount: true },
    });
    assert.strictEqual(reactivated.enrollmentStatus, "ACTIVE");
    assert.strictEqual(reactivated.admissionNo, histExact.admissionNo);
    assert.strictEqual(reactivated.grade, "Grade 2");
    assert.strictEqual(reactivated.className, "2B");
    assert.strictEqual(reactivated.firstName, "ExactId");
    assert.strictEqual(reactivated.idNumber, idNumber);

    const linkedApp = await prisma.admissionApplication.findUniqueOrThrow({
      where: { id: appExact.id },
    });
    assert.strictEqual(linkedApp.status, "ACCEPTED");
    assert.strictEqual(linkedApp.promotedLearnerId, histExact.learner.id);
    assert.strictEqual(linkedApp.promotedFamilyAccountId, histExact.familyAccount.id);

    const linksAfter = await prisma.parentLearnerLink.findMany({
      where: { learnerId: histExact.learner.id },
    });
    assert.ok(linksAfter.length >= existingLinkCount);

    const audit = await prisma.admissionAuditEvent.findMany({
      where: { applicationId: appExact.id, eventType: "APPLICATION_REACTIVATED_TO_LEARNER" },
    });
    assert.strictEqual(audit.length, 1);
    assert.ok(!JSON.stringify(audit[0].metadataJson).includes(idNumber));

    assert.strictEqual(
      await prisma.learnerBillingPlanLine.count({ where: { learnerId: histExact.learner.id } }),
      1
    );

    // Idempotent repeat
    const again = await reactivateHistoricalLearnerForApplication(prisma, convA, appExact.id, {
      learnerId: histExact.learner.id,
      family: { mode: "KEEP_EXISTING" },
      guardians: appExact.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW" as const,
      })),
      placement: { grade: "Grade 3" },
      acknowledgeExistingBillingPlan: true,
    });
    assert.strictEqual(again.idempotent, true);
    assert.strictEqual(again.learnerId, histExact.learner.id);
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: appExact.id, eventType: "APPLICATION_REACTIVATED_TO_LEARNER" },
      }),
      1
    );
    const stillGrade = await prisma.learner.findUniqueOrThrow({ where: { id: histExact.learner.id } });
    assert.strictEqual(stillGrade.grade, "Grade 2");

    // 2 Name+DOB historical preflight
    const histName = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "NameDob",
      lastName: "Match",
      birthDate: "2016-08-12",
      idNumber: null,
    });
    const appName = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerFirstName: "NameDob",
      learnerLastName: "Match",
      birthDate: "2016-08-12",
      learnerIdNumber: null,
    });
    const preName = await getReactivationPreflight(prisma, convA, appName.id);
    assert.strictEqual(preName.canReactivate, true);
    assert.strictEqual(preName.match?.matchReason, "name+dob");
    assert.strictEqual(preName.match?.caution, "NAME_DOB");
    assert.ok(preName.warnings.some((w) => w.code === "NAME_DOB_MATCH_CAUTION"));

    await reactivateHistoricalLearnerForApplication(prisma, convA, appName.id, {
      learnerId: histName.learner.id,
      family: { mode: "KEEP_EXISTING" },
      guardians: appName.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW" as const,
      })),
      placement: { grade: "Grade 2" },
    });

    // 3 Active learner does not offer reactivation
    const activeId = `9101${Date.now().toString().slice(-9)}`;
    await registerLearner({
      schoolId: a.school.id,
      learner: {
        firstName: "Active",
        lastName: "Conflict",
        surname: "Conflict",
        birthDate: "2015-01-01",
        idNumber: activeId,
        grade: "Grade 1",
      },
      registerFinanceBaseline: false,
    });
    const appActive = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: activeId,
      learnerFirstName: "Active",
      learnerLastName: "Conflict",
      birthDate: "2015-01-01",
    });
    const preActive = await getReactivationPreflight(prisma, convA, appActive.id);
    assert.strictEqual(preActive.canReactivate, false);
    assert.ok(preActive.blockers.some((b) => b.code === "LEARNER_IDENTITY_CONFLICT"));

    // 4 Ambiguous multiple historical candidates
    // registerLearner blocks name+DOB duplicates, so seed second twin via direct Prisma create.
    const ambDob = "2014-04-04";
    const amb1 = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "Ambiguous",
      lastName: "Twin",
      birthDate: ambDob,
      idNumber: null,
    });
    const ambFa2 = await prisma.familyAccount.create({
      data: {
        schoolId: a.school.id,
        accountRef: `AMB${Date.now().toString(36).toUpperCase()}`,
        familyName: "Twin2",
      },
    });
    await prisma.learner.create({
      data: {
        schoolId: a.school.id,
        familyAccountId: ambFa2.id,
        firstName: "Ambiguous",
        lastName: "Twin",
        birthDate: new Date(ambDob),
        grade: "Grade 1",
        className: "1B",
        enrollmentStatus: "HISTORICAL",
        admissionNo: `AMB${Date.now().toString(36).toUpperCase()}`,
      },
    });
    void amb1;
    const appAmb = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerFirstName: "Ambiguous",
      learnerLastName: "Twin",
      birthDate: ambDob,
      learnerIdNumber: null,
    });
    const preAmb = await getReactivationPreflight(prisma, convA, appAmb.id);
    assert.strictEqual(preAmb.canReactivate, false);
    assert.ok(preAmb.blockers.some((b) => b.code === "AMBIGUOUS_HISTORICAL_LEARNER_MATCH"));

    // 5 Cross-school historical blocked (tenant isolation)
    const crossId = `9201${Date.now().toString().slice(-9)}`;
    await seedHistoricalLearner({
      schoolId: b.school.id,
      firstName: "Cross",
      lastName: "Tenant",
      birthDate: "2013-02-02",
      idNumber: crossId,
    });
    const appCross = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: crossId,
      learnerFirstName: "Cross",
      learnerLastName: "Tenant",
      birthDate: "2013-02-02",
    });
    const preCross = await getReactivationPreflight(prisma, convA, appCross.id);
    assert.strictEqual(preCross.canReactivate, false);
    assert.ok(
      preCross.blockers.some(
        (b) =>
          b.code === "NO_HISTORICAL_LEARNER_MATCH" || b.code === "CROSS_SCHOOL_LEARNER_BLOCKED"
      )
    );

    // 6 Non-ACCEPTED blocked
    const draftOnly = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "X", lastName: "Y" },
    });
    const draftRow = await prisma.admissionApplication.findFirstOrThrow({
      where: { publicAccessId: draftOnly.application.publicAccessId },
    });
    const preDraft = await getReactivationPreflight(prisma, convA, draftRow.id);
    assert.ok(preDraft.blockers.some((b) => b.code === "APPLICATION_NOT_ACCEPTED"));

    // 10 USE_EXISTING same-school + ack; 11 cross-school family rejected
    const switchTarget = await registerLearner({
      schoolId: a.school.id,
      learner: {
        firstName: "Sibling",
        lastName: "Account",
        surname: "Account",
        birthDate: "2010-01-01",
        grade: "Grade 5",
      },
      registerFinanceBaseline: false,
    });
    const switchId = `9301${Date.now().toString().slice(-9)}`;
    const histSwitch = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "Switch",
      lastName: "Family",
      birthDate: "2017-07-07",
      idNumber: switchId,
    });
    const appSwitch = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: switchId,
      learnerFirstName: "Switch",
      learnerLastName: "Family",
      birthDate: "2017-07-07",
    });
    await assert.rejects(
      () =>
        reactivateHistoricalLearnerForApplication(prisma, convA, appSwitch.id, {
          learnerId: histSwitch.learner.id,
          family: {
            mode: "USE_EXISTING",
            familyAccountId: switchTarget.familyAccount.id,
          },
          guardians: appSwitch.guardians.map((g) => ({
            admissionGuardianId: g.id,
            mode: "CREATE_NEW" as const,
          })),
          placement: { grade: "Grade 2" },
        }),
      (e: unknown) =>
        e instanceof StaffAdmissionsError && e.code === "HISTORICAL_FAMILY_CHANGE_ACK_REQUIRED"
    );
    const otherSchoolFa = await prisma.familyAccount.findFirst({
      where: { schoolId: b.school.id },
    });
    if (otherSchoolFa) {
      await assert.rejects(
        () =>
          reactivateHistoricalLearnerForApplication(prisma, convA, appSwitch.id, {
            learnerId: histSwitch.learner.id,
            family: {
              mode: "USE_EXISTING",
              familyAccountId: otherSchoolFa.id,
              acknowledgeHistoricalFamilyChange: true,
            },
            guardians: appSwitch.guardians.map((g) => ({
              admissionGuardianId: g.id,
              mode: "CREATE_NEW" as const,
            })),
            placement: { grade: "Grade 2" },
          }),
        (e: unknown) =>
          e instanceof StaffAdmissionsError && e.code === "FAMILY_ACCOUNT_NOT_FOUND"
      );
    }
    const switched = await reactivateHistoricalLearnerForApplication(prisma, convA, appSwitch.id, {
      learnerId: histSwitch.learner.id,
      family: {
        mode: "USE_EXISTING",
        familyAccountId: switchTarget.familyAccount.id,
        acknowledgeHistoricalFamilyChange: true,
      },
      guardians: appSwitch.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW" as const,
      })),
      placement: { grade: "Grade 2" },
    });
    assert.strictEqual(switched.familyMode, "switched");
    assert.strictEqual(switched.familyAccountId, switchTarget.familyAccount.id);

    // Untouched historical guardian must NOT have Parent.familyAccountId silently moved
    const untouchedId = `9351${Date.now().toString().slice(-9)}`;
    const histUntouched = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "Untouched",
      lastName: "Guardian",
      birthDate: "2011-06-06",
      idNumber: untouchedId,
      withExistingParent: true,
    });
    const oldGuardianLink = await prisma.parentLearnerLink.findFirstOrThrow({
      where: { learnerId: histUntouched.learner.id },
      include: { parent: true },
    });
    const oldGuardianFamilyId = oldGuardianLink.parent.familyAccountId;
    assert.ok(oldGuardianFamilyId);
    assert.strictEqual(oldGuardianFamilyId, histUntouched.familyAccount.id);
    const altFamily = await registerLearner({
      schoolId: a.school.id,
      learner: {
        firstName: "Alt",
        lastName: "Family",
        surname: "Family",
        birthDate: "2009-09-09",
        grade: "Grade 4",
      },
      registerFinanceBaseline: false,
    });
    const appUntouched = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: untouchedId,
      learnerFirstName: "Untouched",
      learnerLastName: "Guardian",
      birthDate: "2011-06-06",
    });
    // Application guardians are Nomsa/Dlamini — not the historical "Historic Guardian"
    await reactivateHistoricalLearnerForApplication(prisma, convA, appUntouched.id, {
      learnerId: histUntouched.learner.id,
      family: {
        mode: "USE_EXISTING",
        familyAccountId: altFamily.familyAccount.id,
        acknowledgeHistoricalFamilyChange: true,
      },
      guardians: appUntouched.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW" as const,
      })),
      placement: { grade: "Grade 2" },
    });
    const oldGuardianAfter = await prisma.parent.findUniqueOrThrow({
      where: { id: oldGuardianLink.parentId },
    });
    assert.strictEqual(
      oldGuardianAfter.familyAccountId,
      oldGuardianFamilyId,
      "untouched historical guardian Parent.familyAccountId must not be silently moved"
    );
    const oldLinkStill = await prisma.parentLearnerLink.findFirst({
      where: { learnerId: histUntouched.learner.id, parentId: oldGuardianLink.parentId },
    });
    assert.ok(oldLinkStill, "historical parent link must remain");
    const learnerAfterSwitch = await prisma.learner.findUniqueOrThrow({
      where: { id: histUntouched.learner.id },
    });
    assert.strictEqual(learnerAfterSwitch.familyAccountId, altFamily.familyAccount.id);

    // 33 Two different apps same historical learner: first wins, second conflict
    const raceId = `9401${Date.now().toString().slice(-9)}`;
    const histRace = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "Race",
      lastName: "Learner",
      birthDate: "2018-09-09",
      idNumber: raceId,
    });
    const appRace1 = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: raceId,
      learnerFirstName: "Race",
      learnerLastName: "Learner",
      birthDate: "2018-09-09",
    });
    const appRace2 = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: raceId,
      learnerFirstName: "Race",
      learnerLastName: "Learner",
      birthDate: "2018-09-09",
    });
    const raceDto = (app: typeof appRace1) => ({
      learnerId: histRace.learner.id,
      family: { mode: "KEEP_EXISTING" as const },
      guardians: app.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW" as const,
      })),
      placement: { grade: "Grade 2" },
    });
    const firstRace = await reactivateHistoricalLearnerForApplication(
      prisma,
      convA,
      appRace1.id,
      raceDto(appRace1)
    );
    assert.strictEqual(firstRace.idempotent, false);
    await assert.rejects(
      () =>
        reactivateHistoricalLearnerForApplication(prisma, convA, appRace2.id, raceDto(appRace2)),
      (e: unknown) =>
        e instanceof StaffAdmissionsError &&
        (e.code === "HISTORICAL_LEARNER_ALREADY_REACTIVATED" ||
          e.code === "LEARNER_IDENTITY_CONFLICT")
    );
    const race2 = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: appRace2.id } });
    assert.strictEqual(race2.promotedLearnerId, null);

    // 26-28 Rollback leaves HISTORICAL + null promoted when guardian fails
    const rollId = `9501${Date.now().toString().slice(-9)}`;
    const histRoll = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "Rollback",
      lastName: "Case",
      birthDate: "2019-11-11",
      idNumber: rollId,
      withExistingParent: true,
    });
    const strongParent = await prisma.parent.create({
      data: {
        schoolId: a.school.id,
        familyAccountId: histRoll.familyAccount.id,
        firstName: "Strong",
        surname: "Parent",
        cellNo: `085${String(Date.now()).slice(-7)}`,
        email: `strong-${Date.now()}@example.com`,
        idNumber: `8${Date.now().toString().slice(-12)}`,
      },
    });
    const appRoll = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: rollId,
      learnerFirstName: "Rollback",
      learnerLastName: "Case",
      birthDate: "2019-11-11",
      guardianIdNumber: strongParent.idNumber || undefined,
    });
    // Force guardian CREATE_NEW despite strong ID match → should fail PARENT_MUST_LINK_EXISTING
    await assert.rejects(
      () =>
        reactivateHistoricalLearnerForApplication(prisma, convA, appRoll.id, {
          learnerId: histRoll.learner.id,
          family: { mode: "KEEP_EXISTING" },
          guardians: appRoll.guardians.map((g) => ({
            admissionGuardianId: g.id,
            mode: "CREATE_NEW" as const,
          })),
          placement: { grade: "Grade 2" },
        }),
      (e: unknown) =>
        e instanceof StaffAdmissionsError && e.code === "PARENT_MUST_LINK_EXISTING"
    );
    const rollLearner = await prisma.learner.findUniqueOrThrow({ where: { id: histRoll.learner.id } });
    assert.strictEqual(rollLearner.enrollmentStatus, "HISTORICAL");
    const rollApp = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: appRoll.id } });
    assert.strictEqual(rollApp.promotedLearnerId, null);

    // Concurrent same-app: both succeed logically (one write + one idempotent)
    const concId = `9601${Date.now().toString().slice(-9)}`;
    const histConc = await seedHistoricalLearner({
      schoolId: a.school.id,
      firstName: "Concurrent",
      lastName: "Same",
      birthDate: "2012-12-12",
      idNumber: concId,
    });
    const appConc = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: concId,
      learnerFirstName: "Concurrent",
      learnerLastName: "Same",
      birthDate: "2012-12-12",
    });
    const concDto = {
      learnerId: histConc.learner.id,
      family: { mode: "KEEP_EXISTING" as const },
      guardians: appConc.guardians.map((g) => ({
        admissionGuardianId: g.id,
        mode: "CREATE_NEW" as const,
      })),
      placement: { grade: "Grade 2" },
    };
    const [c1, c2] = await Promise.all([
      reactivateHistoricalLearnerForApplication(prisma, convA, appConc.id, concDto),
      reactivateHistoricalLearnerForApplication(prisma, convA, appConc.id, concDto),
    ]);
    assert.ok([c1, c2].some((r) => r.idempotent === false));
    assert.ok([c1, c2].every((r) => r.learnerId === histConc.learner.id));
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: appConc.id, eventType: "APPLICATION_REACTIVATED_TO_LEARNER" },
      }),
      1
    );

    // Grade required / historical not silently reused without confirmation covered above.
    // Baseline presence for successful path
    const snaps = readSchoolFamilyAccountAgeAnalysisSnapshots(a.school.id);
    assert.ok(Object.keys(snaps).length >= 1);

    console.log("OA-05B integration tests passed");
  } finally {
    restoreAgeAnalysisFile(ageSnapshot);
    for (const id of schoolIds) {
      await cleanupSchool(id);
    }
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
