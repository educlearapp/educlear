/**
 * OA-04B integration tests — ACCEPTED → canonical conversion (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa04b.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { uploadApplicantDocument } from "./admissionsDocumentService";
import {
  convertAcceptedApplicationToLearner,
  getConversionPreflight,
  type ConversionActor,
  type ConversionDecisionDto,
} from "./admissionsConversionService";
import {
  createDraftApplication,
  updateDraftApplication,
} from "./draftApplicationService";
import { submitApplication } from "./submitApplicationService";
import { StaffAdmissionsError } from "./staffAdmissionsReadService";
import {
  acceptAdmissionApplication,
  startApplicationReview,
  type StaffWorkflowActor,
} from "./staffAdmissionsWorkflowService";
import { registerLearner, updateLearnerEnrollmentStatus } from "../learnerRegistrationService";
import { saveParentLinks } from "../parentLinkService";
import { readSchoolFamilyAccountAgeAnalysisSnapshots, invalidateFamilyAccountAgeAnalysisFileCache } from "../../utils/familyAccountAgeAnalysisStore";

const prisma = new PrismaClient();

const AGE_ANALYSIS_PATH = path.join(
  process.cwd(),
  "data",
  "family-account-age-analysis.json"
);

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

async function makeSchool(suffix: string) {
  const school = await prisma.school.create({ data: { name: `OA04B ${suffix}` } });
  const slug = `oa04b-${suffix}-${Date.now().toString(36)}`;
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
      email: `oa04b-admin-${suffix}-${Date.now()}@example.com`,
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
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oa04b-" } } });
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
    sibling?: boolean;
    siblingAdmissionNo?: string;
    secondGuardian?: boolean;
    guardianIdNumber?: string;
  }
) {
  appSeq += 1;
  const draft = await createDraftApplication(prisma, slug, {
    requestedGrade: "Grade 1",
    learner: { firstName: "", lastName: "" },
  });
  const uniq = `${appSeq}${Date.now().toString(36)}`;
  const day = String((appSeq % 27) + 1).padStart(2, "0");
  const guardians: any[] = [
    {
      firstName: "Lerato",
      surname: "Molefe",
      cellNo: `082${String(1000000 + appSeq).slice(-7)}`,
      email: `lerato-${uniq}@example.com`,
      idNumber: opts?.guardianIdNumber || null,
      isPrimary: true,
      isPayingPerson: true,
      homeAddress: "1 Test St",
    },
  ];
  if (opts?.secondGuardian) {
    guardians.push({
      firstName: "Thabo",
      surname: "Molefe",
      cellNo: `083${String(1000000 + appSeq).slice(-7)}`,
      email: `thabo-g-${uniq}@example.com`,
      isPrimary: false,
      isPayingPerson: false,
    });
  }
  await updateDraftApplication(prisma, slug, draft.application.publicAccessId, draft.accessToken, {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
    learner: {
      firstName: opts?.learnerFirstName || `Sipho${appSeq}`,
      lastName: opts?.learnerLastName || `Molefe${appSeq}`,
      birthDate: opts?.birthDate || `2018-05-${day}`,
      homeAddress: "1 Test St",
      idNumber: opts?.learnerIdNumber ?? null,
    },
    guardians,
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why apply?", valueJson: "Great school" }],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
    declaredExistingSibling: Boolean(opts?.sibling),
    declaredExistingFamily: Boolean(opts?.sibling),
    declaredSiblingAdmissionNo: opts?.siblingAdmissionNo || null,
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
  const accepted = await prisma.admissionApplication.findUniqueOrThrow({
    where: { id: row.id },
    include: { guardians: { orderBy: { sortOrder: "asc" } }, learnerCandidate: true },
  });
  assert.strictEqual(accepted.status, "ACCEPTED");
  assert.strictEqual(accepted.promotedLearnerId, null);
  return accepted;
}

function createNewFamilyDto(
  app: { guardians: Array<{ id: string }>; declaredExistingSibling?: boolean; declaredExistingFamily?: boolean },
  grade = "Grade 1"
): ConversionDecisionDto {
  return {
    family: {
      mode: "CREATE_NEW",
      acknowledgeCreateNewFamilyDespiteSiblingDeclaration:
        app.declaredExistingSibling || app.declaredExistingFamily ? true : undefined,
    },
    guardians: app.guardians.map((g) => ({
      admissionGuardianId: g.id,
      mode: "CREATE_NEW" as const,
    })),
    placement: { grade, className: null },
  };
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];
  const ageSnapshot = snapshotAgeAnalysisFile();

  try {
    const a = await makeSchool("a");
    const b = await makeSchool("b");
    schoolIds.push(a.school.id, b.school.id);
    const convA = converter(a.school.id, a.admin.id);

    // Auth denials
    await assert.rejects(
      () => getConversionPreflight(prisma, converter(a.school.id, a.admin.id, { hasAdmissionsManage: false }), "x"),
      (e: unknown) => e instanceof StaffAdmissionsError && e.code === "ADMISSIONS_FORBIDDEN"
    );
    await assert.rejects(
      () => getConversionPreflight(prisma, converter(a.school.id, a.admin.id, { hasLearnersCreate: false }), "x"),
      (e: unknown) => e instanceof StaffAdmissionsError && e.code === "LEARNERS_CREATE_FORBIDDEN"
    );
    await assert.rejects(
      () => getConversionPreflight(prisma, converter(a.school.id, a.admin.id, { appRole: "Finance" }), "x"),
      (e: unknown) => e instanceof StaffAdmissionsError && e.code === "ADMISSIONS_DECISION_FORBIDDEN"
    );

    // Non-accepted cannot convert
    const draftOnly = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "X", lastName: "Y" },
    });
    const draftRow = await prisma.admissionApplication.findFirstOrThrow({
      where: { publicAccessId: draftOnly.application.publicAccessId },
    });
    const draftPre = await getConversionPreflight(prisma, convA, draftRow.id);
    assert.strictEqual(draftPre.canConvert, false);
    assert.ok(draftPre.blockers.some((b) => b.code === "APPLICATION_NOT_ACCEPTED"));

    // NEW FAMILY happy path
    const app1 = await acceptReadyApp(a.slug, a.school.id, a.admin.id);
    const pre1 = await getConversionPreflight(prisma, convA, app1.id);
    assert.strictEqual(pre1.application.status, "ACCEPTED");
    assert.strictEqual(pre1.canConvert, true);
    assert.strictEqual(pre1.placement.proposedGrade, "Grade 1");
    assert.ok(pre1.guardians.length >= 1);

    const result1 = await convertAcceptedApplicationToLearner(
      prisma,
      convA,
      app1.id,
      createNewFamilyDto(app1)
    );
    assert.strictEqual(result1.idempotent, false);
    assert.strictEqual(result1.familyMode, "created");
    assert.strictEqual(result1.financeBaselineRegistered, true);
    assert.ok(!result1.financeBaselineWarning);
    assert.ok(result1.learnerId);
    assert.ok(result1.familyAccountId);
    assert.ok(result1.admissionNo);
    assert.ok(result1.accountRef);
    const baselineAfter = readSchoolFamilyAccountAgeAnalysisSnapshots(a.school.id);
    assert.ok(baselineAfter[String(result1.accountRef).toUpperCase()]);

    const linked = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: app1.id } });
    assert.strictEqual(linked.status, "ACCEPTED");
    assert.strictEqual(linked.promotedLearnerId, result1.learnerId);
    assert.strictEqual(linked.promotedFamilyAccountId, result1.familyAccountId);

    const learner = await prisma.learner.findUniqueOrThrow({ where: { id: result1.learnerId } });
    assert.strictEqual(learner.grade, "Grade 1");
    assert.strictEqual(learner.schoolId, a.school.id);
    assert.strictEqual(learner.familyAccountId, result1.familyAccountId);

    const parents = await prisma.parent.findMany({ where: { schoolId: a.school.id } });
    assert.ok(parents.length >= 1);
    const links = await prisma.parentLearnerLink.findMany({ where: { learnerId: learner.id } });
    assert.ok(links.some((l) => l.isPrimary));
    assert.ok(links.some((l) => l.isPayingPerson));

    const audit = await prisma.admissionAuditEvent.findMany({
      where: { applicationId: app1.id, eventType: "APPLICATION_CONVERTED" },
    });
    assert.strictEqual(audit.length, 1);
    const meta = audit[0].metadataJson as Record<string, unknown>;
    assert.strictEqual(meta.learnerId, result1.learnerId);
    assert.ok(!JSON.stringify(meta).includes(String(app1.learnerCandidate?.idNumber || "___none___")));

    assert.strictEqual(
      await prisma.learnerBillingPlanLine.count({ where: { learnerId: learner.id } }),
      0
    );
    assert.strictEqual(await prisma.parentOnboarding.count({ where: { parentId: { in: parents.map((p) => p.id) } } }), 0);

    // Idempotent
    const again = await convertAcceptedApplicationToLearner(
      prisma,
      convA,
      app1.id,
      createNewFamilyDto(app1)
    );
    assert.strictEqual(again.idempotent, true);
    assert.strictEqual(again.learnerId, result1.learnerId);
    assert.strictEqual(again.financeBaselineRegistered, true);
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: app1.id, eventType: "APPLICATION_CONVERTED" },
      }),
      1
    );
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: a.school.id } }), 1);

    // Preflight already converted
    const preDone = await getConversionPreflight(prisma, convA, app1.id);
    assert.strictEqual(preDone.application.alreadyConverted, true);

    // EXISTING FAMILY + sibling admissionNo
    const siblingApp = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      sibling: true,
      siblingAdmissionNo: result1.admissionNo || undefined,
    });
    const preSib = await getConversionPreflight(prisma, convA, siblingApp.id);
    assert.ok(preSib.family.requiresAckForCreateNewDespiteSiblingDeclaration);
    assert.ok(
      preSib.family.candidates.some((c) => c.familyAccountId === result1.familyAccountId) ||
        preSib.warnings.some((w) => w.code.includes("SIBLING") || w.code.includes("FAMILY"))
    );

    await assert.rejects(
      () =>
        convertAcceptedApplicationToLearner(prisma, convA, siblingApp.id, {
          family: { mode: "CREATE_NEW" },
          guardians: siblingApp.guardians.map((g) => ({
            admissionGuardianId: g.id,
            mode: "CREATE_NEW" as const,
          })),
          placement: { grade: "Grade 1" },
        }),
      (e: unknown) =>
        e instanceof StaffAdmissionsError && e.code === "SIBLING_DECLARATION_ACK_REQUIRED"
    );

    // Create existing parent to LINK for sibling path — use first guardian's details after creating parent on same FA
    const existingParent = await prisma.parent.create({
      data: {
        schoolId: a.school.id,
        familyAccountId: result1.familyAccountId,
        firstName: siblingApp.guardians[0].firstName,
        surname: siblingApp.guardians[0].surname,
        cellNo: siblingApp.guardians[0].cellNo || "0820000000",
        email: siblingApp.guardians[0].email,
        idNumber: `9${Date.now().toString().slice(-12)}`,
      },
    });

    const sibResult = await convertAcceptedApplicationToLearner(prisma, convA, siblingApp.id, {
      family: { mode: "USE_EXISTING", existingFamilyAccountId: result1.familyAccountId },
      guardians: [
        {
          admissionGuardianId: siblingApp.guardians[0].id,
          mode: "LINK_EXISTING",
          existingParentId: existingParent.id,
        },
      ],
      placement: { grade: "Grade 1" },
    });
    assert.strictEqual(sibResult.familyMode, "reused");
    assert.strictEqual(sibResult.familyAccountId, result1.familyAccountId);
    assert.notStrictEqual(sibResult.learnerId, result1.learnerId);
    assert.ok(String(sibResult.admissionNo || "").includes("-") || sibResult.admissionNo !== result1.admissionNo);
    const faAfterSibling = await prisma.learner.findUniqueOrThrow({
      where: { id: sibResult.learnerId },
      select: { familyAccountId: true },
    });
    assert.strictEqual(faAfterSibling.familyAccountId, result1.familyAccountId);

    // MIXED guardians
    const mixedApp = await acceptReadyApp(a.slug, a.school.id, a.admin.id, { secondGuardian: true });
    assert.ok(mixedApp.guardians.length >= 2);
    const linkParent = await prisma.parent.create({
      data: {
        schoolId: a.school.id,
        familyAccountId: result1.familyAccountId,
        firstName: mixedApp.guardians[0].firstName,
        surname: mixedApp.guardians[0].surname,
        cellNo: mixedApp.guardians[0].cellNo || "0821111111",
        email: `mix-link-${Date.now()}@example.com`,
        idNumber: `8${Date.now().toString().slice(-12)}`,
      },
    });
    const mixed = await convertAcceptedApplicationToLearner(prisma, convA, mixedApp.id, {
      family: { mode: "USE_EXISTING", existingFamilyAccountId: result1.familyAccountId },
      guardians: [
        {
          admissionGuardianId: mixedApp.guardians[0].id,
          mode: "LINK_EXISTING",
          existingParentId: linkParent.id,
        },
        {
          admissionGuardianId: mixedApp.guardians[1].id,
          mode: "CREATE_NEW",
        },
      ],
      placement: { grade: "Grade 2" },
    });
    assert.strictEqual(mixed.grade, "Grade 2");
    const mixedLinks = await prisma.parentLearnerLink.findMany({ where: { learnerId: mixed.learnerId } });
    assert.strictEqual(mixedLinks.length, 2);
    assert.ok(mixedLinks.some((l) => l.parentId === linkParent.id));

    // Foreign FA / Parent rejected
    const otherApp = await acceptReadyApp(a.slug, a.school.id, a.admin.id);
    const foreignFa = await prisma.familyAccount.create({
      data: {
        schoolId: b.school.id,
        accountRef: `ZZZ${Date.now().toString().slice(-3)}`,
        accountNo: `ZZZ${Date.now().toString().slice(-3)}`,
        familyName: "Foreign",
      },
    });
    await assert.rejects(
      () =>
        convertAcceptedApplicationToLearner(prisma, convA, otherApp.id, {
          family: { mode: "USE_EXISTING", existingFamilyAccountId: foreignFa.id },
          guardians: otherApp.guardians.map((g) => ({
            admissionGuardianId: g.id,
            mode: "CREATE_NEW" as const,
          })),
          placement: { grade: "Grade 1" },
        }),
      (e: unknown) =>
        e instanceof StaffAdmissionsError && e.code === "FAMILY_ACCOUNT_NOT_FOUND"
    );

    const foreignParent = await prisma.parent.create({
      data: {
        schoolId: b.school.id,
        firstName: "Foreign",
        surname: "Parent",
        cellNo: "0829999999",
        idNumber: `7${Date.now().toString().slice(-12)}`,
      },
    });
    await assert.rejects(
      () =>
        convertAcceptedApplicationToLearner(prisma, convA, otherApp.id, {
          family: { mode: "CREATE_NEW" },
          guardians: [
            {
              admissionGuardianId: otherApp.guardians[0].id,
              mode: "LINK_EXISTING",
              existingParentId: foreignParent.id,
            },
          ],
          placement: { grade: "Grade 1" },
        }),
      (e: unknown) => e instanceof StaffAdmissionsError && e.code === "PARENT_NOT_FOUND"
    );

    // Unknown / missing guardian decisions
    await assert.rejects(
      () =>
        convertAcceptedApplicationToLearner(prisma, convA, otherApp.id, {
          family: { mode: "CREATE_NEW" },
          guardians: [{ admissionGuardianId: "not-a-real-id", mode: "CREATE_NEW" }],
          placement: { grade: "Grade 1" },
        }),
      (e: unknown) =>
        e instanceof StaffAdmissionsError &&
        (e.code === "UNKNOWN_GUARDIAN_ID" || e.code === "GUARDIAN_DECISIONS_INCOMPLETE")
    );

    // Strong learner duplicate
    const dupId = `550101${String(Date.now()).slice(-7)}`;
    const dupSeed = await registerLearner({
      schoolId: a.school.id,
      learner: {
        firstName: "Dup",
        lastName: "Kid",
        birthDate: "2017-01-01",
        idNumber: dupId,
        grade: "Grade 1",
      },
    });
    await saveParentLinks({
      schoolId: a.school.id,
      learnerId: dupSeed.learner!.id,
      familyAccountId: dupSeed.familyAccount.id,
      parents: [
        {
          firstName: "Dup",
          surname: "Parent",
          cellNo: "0822222222",
          isPrimary: true,
          isPayingPerson: true,
        },
      ],
      trustedIsOwnerAdmin: true,
    });
    const dupApp = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: dupId,
      learnerFirstName: "Dup",
      learnerLastName: "Kid",
      birthDate: "2017-01-01",
    });
    const dupPre = await getConversionPreflight(prisma, convA, dupApp.id);
    assert.ok(dupPre.blockers.some((b) => b.code === "LEARNER_IDENTITY_CONFLICT"));
    await assert.rejects(
      () => convertAcceptedApplicationToLearner(prisma, convA, dupApp.id, createNewFamilyDto(dupApp)),
      (e: unknown) => e instanceof StaffAdmissionsError && e.code === "LEARNER_IDENTITY_CONFLICT"
    );

    // HISTORICAL blocker
    const histId = `560202${String(Date.now()).slice(-7)}`;
    const histSeed = await registerLearner({
      schoolId: a.school.id,
      learner: {
        firstName: "Hist",
        lastName: "Kid",
        birthDate: "2016-02-02",
        idNumber: histId,
        grade: "Grade 1",
      },
    });
    await updateLearnerEnrollmentStatus({
      schoolId: a.school.id,
      learnerId: histSeed.learner!.id,
      enrollmentStatus: "HISTORICAL",
    });
    const histApp = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: histId,
      learnerFirstName: "Hist",
      learnerLastName: "Kid",
      birthDate: "2016-02-02",
    });
    const histPre = await getConversionPreflight(prisma, convA, histApp.id);
    assert.ok(histPre.blockers.some((b) => b.code === "HISTORICAL_LEARNER_REQUIRES_REACTIVATION"));
    await assert.rejects(
      () => convertAcceptedApplicationToLearner(prisma, convA, histApp.id, createNewFamilyDto(histApp)),
      (e: unknown) =>
        e instanceof StaffAdmissionsError && e.code === "HISTORICAL_LEARNER_REQUIRES_REACTIVATION"
    );

    // Rollback: CREATE_NEW when strong parent ID match exists → fail after learner path, txn rolls back
    const rollbackId = `570303${String(Date.now()).slice(-7)}`;
    const sharedParentId = `610101${String(Date.now()).slice(-7)}`;
    await prisma.parent.create({
      data: {
        schoolId: a.school.id,
        firstName: "Shared",
        surname: "Guardian",
        cellNo: "0823333333",
        idNumber: sharedParentId,
      },
    });
    const rbApp = await acceptReadyApp(a.slug, a.school.id, a.admin.id, {
      learnerIdNumber: rollbackId,
      learnerFirstName: "Rollback",
      learnerLastName: "Child",
      birthDate: "2019-03-03",
    });
    await prisma.admissionGuardian.update({
      where: { id: rbApp.guardians[0].id },
      data: {
        firstName: "Shared",
        surname: "Guardian",
        idNumber: sharedParentId,
        cellNo: "0823333333",
      },
    });
    const refreshed = await prisma.admissionApplication.findUniqueOrThrow({
      where: { id: rbApp.id },
      include: { guardians: true },
    });
    const learnersBefore = await prisma.learner.count({ where: { schoolId: a.school.id } });
    const parentsBefore = await prisma.parent.count({ where: { schoolId: a.school.id } });
    const faBefore = await prisma.familyAccount.count({ where: { schoolId: a.school.id } });
    const ageBeforeRollback = snapshotAgeAnalysisFile();
    await assert.rejects(
      () =>
        convertAcceptedApplicationToLearner(prisma, convA, refreshed.id, {
          family: { mode: "CREATE_NEW" },
          guardians: refreshed.guardians.map((g) => ({
            admissionGuardianId: g.id,
            mode: "CREATE_NEW" as const,
          })),
          placement: { grade: "Grade 1" },
        }),
      (e: unknown) =>
        e instanceof StaffAdmissionsError &&
        (e.code === "PARENT_MUST_LINK_EXISTING" ||
          e.code === "PARENT_LINK_FAILED" ||
          e.code === "PARENT_ID_ALREADY_EXISTS")
    );
    const rbRow = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: refreshed.id } });
    assert.strictEqual(rbRow.promotedLearnerId, null);
    assert.strictEqual(rbRow.promotedFamilyAccountId, null);
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: a.school.id } }), learnersBefore);
    assert.strictEqual(await prisma.parent.count({ where: { schoolId: a.school.id } }), parentsBefore);
    assert.strictEqual(await prisma.familyAccount.count({ where: { schoolId: a.school.id } }), faBefore);
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: refreshed.id, eventType: "APPLICATION_CONVERTED" },
      }),
      0
    );
    assert.strictEqual(
      snapshotAgeAnalysisFile(),
      ageBeforeRollback,
      "finance baseline file must not change when DB conversion rolls back"
    );

    // Concurrency same app
    const concApp = await acceptReadyApp(a.slug, a.school.id, a.admin.id);
    const dto = createNewFamilyDto(concApp);
    const outcomes = await Promise.allSettled([
      convertAcceptedApplicationToLearner(prisma, convA, concApp.id, dto),
      convertAcceptedApplicationToLearner(prisma, convA, concApp.id, dto),
    ]);
    const ok = outcomes.filter((o) => o.status === "fulfilled") as PromiseFulfilledResult<any>[];
    assert.ok(ok.length >= 1);
    const learnerIds = new Set(ok.map((o) => o.value.learnerId));
    assert.strictEqual(learnerIds.size, 1);
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: concApp.id, eventType: "APPLICATION_CONVERTED" },
      }),
      1
    );

    // Cross-school staff cannot convert
    const convB = converter(b.school.id, b.admin.id);
    await assert.rejects(
      () => getConversionPreflight(prisma, convB, app1.id),
      (e: unknown) => e instanceof StaffAdmissionsError && e.statusCode === 404
    );

    // Accept still creates no learner by itself — already proven; ensure status ACCEPTED without promoted on fresh accept
    const acceptOnly = await acceptReadyApp(a.slug, a.school.id, a.admin.id);
    assert.strictEqual(acceptOnly.promotedLearnerId, null);

    console.log("OA-04B integration tests passed");
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
