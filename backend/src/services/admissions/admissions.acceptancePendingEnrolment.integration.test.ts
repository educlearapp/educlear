/**
 * Accept with PROOF_UPLOADED, then enrol (conversion) or reactivate — no financial side effects.
 * Local educlear DB only; isolated fixture schools; restores the local age-analysis file.
 * Run: npx tsx src/services/admissions/admissions.acceptancePendingEnrolment.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { registerLearner, updateLearnerEnrollmentStatus } from "../learnerRegistrationService";
import {
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
} from "../../utils/familyAccountAgeAnalysisStore";
import {
  convertAcceptedApplicationToLearner,
  getConversionPreflight,
  type ConversionActor,
} from "./admissionsConversionService";
import { resolveAdmissionsStorageRoot, uploadApplicantDocument, uploadProofOfPayment } from "./admissionsDocumentService";
import {
  getReactivationPreflight,
  reactivateHistoricalLearnerForApplication,
} from "./admissionsHistoricalReactivationService";
import { createDraftApplication, updateDraftApplication } from "./draftApplicationService";
import { getStaffApplicationDetail } from "./staffAdmissionsReadService";
import { submitApplication } from "./submitApplicationService";
import {
  acceptAdmissionApplication,
  startApplicationReview,
  type StaffWorkflowActor,
} from "./staffAdmissionsWorkflowService";

const prisma = new PrismaClient();
const DATA_DIR = path.join(process.cwd(), "data");
const AGE_ANALYSIS_PATH = path.join(DATA_DIR, "family-account-age-analysis.json");
const FINANCIAL_FILES = [
  "billing-ledger.json",
  "payment-allocations.json",
  "learner-billing-plans.json",
  "kidesys-transaction-history.json",
  "banking-imports.json",
];

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = (raw.match(/@([^:/?]+)/) || [])[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${host}`);
  }
}

function fileHash(name: string): string {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return "absent";
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function financialFileHashes(): Record<string, string> {
  return Object.fromEntries(FINANCIAL_FILES.map((f) => [f, fileHash(f)]));
}

function minimalPdf(): Buffer {
  return Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n", "utf8");
}

function staff(schoolId: string, userId: string): StaffWorkflowActor {
  return { userId, schoolId, appRole: "Admin", hasAdmissionsEdit: true, hasAdmissionsManage: true };
}

function converter(schoolId: string, userId: string): ConversionActor {
  return { userId, schoolId, appRole: "Admin", hasAdmissionsManage: true, hasLearnersCreate: true };
}

async function makeSchool(suffix: string) {
  const stamp = Date.now().toString(36);
  const school = await prisma.school.create({ data: { name: `OAPENDENROL ${suffix} ${stamp}` } });
  const slug = `oapendenrol-${suffix}-${stamp}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: true,
      defaultAdmissionFeeAmount: "1600.00" as any,
      currency: "ZAR",
      requirePaymentVerifiedBeforeAccept: true,
      requiredDocuments: [{ key: "birth_certificate", label: "Birth certificate", required: true }],
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
      bankName: "Test Bank",
      accountHolder: "School",
      accountNumber: "123456789",
      branchCode: "250655",
    },
  });
  const admin = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `oapendenrol-admin-${suffix}-${stamp}@example.com`,
      passwordHash: "x",
      role: "SCHOOL_ADMIN",
      isActive: true,
      fullName: "Fixture Admin",
    },
  });
  return { school, slug, admin };
}

async function cleanupSchool(schoolId: string) {
  const apps = await prisma.admissionApplication.findMany({ where: { schoolId }, select: { id: true } });
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await prisma.admissionApplication.updateMany({
      where: { id: { in: ids } },
      data: { promotedLearnerId: null, promotedFamilyAccountId: null },
    });
    await prisma.admissionFeeRecord.updateMany({ where: { applicationId: { in: ids } }, data: { latestProofDocumentId: null } });
    await prisma.admissionDocument.updateMany({ where: { applicationId: { in: ids } }, data: { replacedByDocumentId: null } });
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
  await prisma.admissionAuditEvent.deleteMany({ where: { schoolId } });
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.user.deleteMany({ where: { schoolId, email: { startsWith: "oapendenrol-" } } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  const dir = path.join(resolveAdmissionsStorageRoot(), schoolId);
  if (dir.includes(`${path.sep}admissions${path.sep}`) && schoolId.length > 10) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let seq = 0;

/** Submitted application with birth certificate and proof of payment, accepted with acknowledgement. */
async function acceptPendingApp(
  slug: string,
  schoolId: string,
  adminId: string,
  learner: { firstName: string; lastName: string; birthDate: string; idNumber: string | null }
) {
  seq += 1;
  const draft = await createDraftApplication(prisma, slug, {
    requestedGrade: "Grade 2",
    learner: { firstName: "", lastName: "" },
  });
  const accessId = draft.application.publicAccessId;
  await updateDraftApplication(prisma, slug, accessId, draft.accessToken, {
    requestedGrade: "Grade 2",
    intakeYear: 2027,
    learner: { ...learner, homeAddress: "3 Fixture St" },
    guardians: [
      {
        firstName: "Fixture",
        surname: `Guardian${seq}`,
        cellNo: `082${String(3000000 + seq).slice(-7)}`,
        email: `oapendenrol-g${seq}-${Date.now().toString(36)}@example.test`,
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "3 Fixture St",
      },
    ],
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why apply?", valueJson: "Fixture" }],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
  });
  await submitApplication(prisma, slug, accessId, draft.accessToken);
  await uploadApplicantDocument(prisma, slug, accessId, draft.accessToken, {
    documentType: "birth_certificate",
    buffer: minimalPdf(),
    originalFileName: "birth.pdf",
    claimedMime: "application/pdf",
  });
  await uploadProofOfPayment(prisma, slug, accessId, draft.accessToken, {
    buffer: minimalPdf(),
    originalFileName: "pop.pdf",
    claimedMime: "application/pdf",
  });
  const row = await prisma.admissionApplication.findFirstOrThrow({ where: { publicAccessId: accessId } });
  const actor = staff(schoolId, adminId);
  await startApplicationReview(prisma, actor, row.id);
  await acceptAdmissionApplication(prisma, actor, row.id, new Date(), { acknowledgePaymentPending: true });
  return prisma.admissionApplication.findUniqueOrThrow({
    where: { id: row.id },
    include: { guardians: { orderBy: { sortOrder: "asc" } } },
  });
}

async function feeSnapshot(applicationId: string) {
  const fee = await prisma.admissionFeeRecord.findUniqueOrThrow({ where: { applicationId } });
  return {
    paymentStatus: fee.paymentStatus,
    amount: fee.amount?.toString() ?? null,
    required: fee.required,
    paymentReference: fee.paymentReference,
    verifiedByUserId: fee.verifiedByUserId,
    verifiedAt: fee.verifiedAt,
    waivedAt: fee.waivedAt,
    rejectedAt: fee.rejectedAt,
    paymentHistoryCount: await prisma.admissionPaymentHistory.count({ where: { applicationId } }),
  };
}

async function schoolFinancialRowCounts(schoolId: string) {
  return {
    billingPlanLines: await prisma.learnerBillingPlanLine.count({ where: { schoolId } }),
    depositAllocations: await prisma.billingDepositAllocation.count({ where: { schoolId } }),
  };
}

function assertNoFinancialAuditEvents(events: Array<{ eventType: string }>) {
  const forbidden = events.filter((e) =>
    /PAYMENT_VERIFIED|PAYMENT_WAIVED|RECEIPT|LEDGER|ALLOCAT|INVOICE|SETTLE/i.test(e.eventType)
  );
  assert.deepStrictEqual(forbidden, [], "no payment/receipt/ledger audit events");
}

function bucketTotal(snapshot: unknown): number {
  const s = snapshot as { balance?: number; buckets?: Record<string, unknown> } | undefined;
  const buckets = Object.values(s?.buckets || {}).reduce<number>((sum, v) => sum + (Number(v) || 0), 0);
  return Math.abs(Number(s?.balance || 0)) + Math.abs(buckets);
}

async function assertPendingPreserved(appId: string, schoolId: string, adminId: string) {
  const detail = await getStaffApplicationDetail(prisma, schoolId, appId);
  assert.strictEqual(detail.status, "ACCEPTED");
  assert.strictEqual(detail.payment?.paymentStatus, "PROOF_UPLOADED");
  const accepted = detail.auditTimeline.filter((e) => e.eventType === "APPLICATION_ACCEPTED");
  assert.strictEqual(accepted.length, 1, "single acceptance decision");
  const meta = accepted[0].metadataJson as Record<string, unknown>;
  assert.strictEqual(meta.paymentVerificationPending, true);
  assert.strictEqual(meta.paymentPendingAcknowledged, true);
  assert.strictEqual(meta.paymentStatusAtAcceptance, "PROOF_UPLOADED");
  const appRow = await prisma.admissionApplication.findUniqueOrThrow({ where: { id: appId } });
  assert.strictEqual(appRow.acceptedByUserId, adminId);
  assert.ok(appRow.acceptedAt);
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];
  const ageSnapshot = fs.existsSync(AGE_ANALYSIS_PATH) ? fs.readFileSync(AGE_ANALYSIS_PATH, "utf8") : null;
  let passed = 0;
  const ok = (name: string) => {
    passed += 1;
    console.log(`  ok - ${name}`);
  };

  try {
    const s = await makeSchool("a");
    schoolIds.push(s.school.id);
    const conv = converter(s.school.id, s.admin.id);

    // Historical learner seeded first so its own finance baseline is outside the measured window.
    const histId = `9101${Date.now().toString().slice(-9)}`;
    const reg = await registerLearner({
      schoolId: s.school.id,
      learner: {
        firstName: "Returning",
        lastName: "Fixture",
        surname: "Fixture",
        birthDate: "2017-04-04",
        idNumber: histId,
        grade: "Grade 1",
        className: "1A",
      },
      registerFinanceBaseline: true,
    });
    await updateLearnerEnrollmentStatus({
      schoolId: s.school.id,
      learnerId: reg.learner!.id,
      enrollmentStatus: "HISTORICAL",
    });

    const filesBefore = financialFileHashes();
    const rowsBefore = await schoolFinancialRowCounts(s.school.id);
    const snapshotsBefore = Object.keys(readSchoolFamilyAccountAgeAnalysisSnapshots(s.school.id));

    // ---------- Conversion (new learner, new family) ----------
    const appNew = await acceptPendingApp(s.slug, s.school.id, s.admin.id, {
      firstName: "Newcomer",
      lastName: "Fixture",
      birthDate: "2019-02-02",
      idNumber: null,
    });
    const feeBeforeConvert = await feeSnapshot(appNew.id);
    assert.strictEqual(feeBeforeConvert.paymentStatus, "PROOF_UPLOADED");
    assert.strictEqual(feeBeforeConvert.amount, "1600");
    assert.strictEqual(feeBeforeConvert.verifiedAt, null);

    const convPre = await getConversionPreflight(prisma, conv, appNew.id);
    const feeWarn = convPre.warnings.find((w) => w.code === "ADMISSION_FEE_VERIFICATION_PENDING");
    assert.ok(feeWarn, "conversion preflight carries the unverified-payment warning");
    assert.ok(!(convPre.blockers || []).some((b: { code: string }) => /FEE|PAYMENT/.test(b.code)), "warning never blocks");
    ok("conversion preflight warns (never blocks) on unverified admission fee");

    const converted = await convertAcceptedApplicationToLearner(prisma, conv, appNew.id, {
      family: { mode: "CREATE_NEW" },
      guardians: appNew.guardians.map((g) => ({ admissionGuardianId: g.id, mode: "CREATE_NEW" as const })),
      placement: { grade: "Grade 2", className: null },
    });
    assert.strictEqual(converted.idempotent, false);
    assert.deepStrictEqual(await feeSnapshot(appNew.id), feeBeforeConvert, "fee record untouched by enrolment");
    await assertPendingPreserved(appNew.id, s.school.id, s.admin.id);
    const convAudit = await prisma.admissionAuditEvent.findMany({ where: { applicationId: appNew.id } });
    const convEvent = convAudit.filter((e) => e.eventType === "APPLICATION_CONVERTED");
    assert.strictEqual(convEvent.length, 1);
    assert.strictEqual(convEvent[0].actorUserId, s.admin.id);
    assertNoFinancialAuditEvents(convAudit);
    ok("enrolment keeps PROOF_UPLOADED, R1,600 unchanged, no verification/receipt events; decisions recorded");

    // Again after conversion: preflight still flags the fee for staff.
    const convPreAfter = await getConversionPreflight(prisma, conv, appNew.id);
    assert.strictEqual(convPreAfter.application.alreadyConverted, true);

    // ---------- Reactivation (historical learner) ----------
    const appReturn = await acceptPendingApp(s.slug, s.school.id, s.admin.id, {
      firstName: "Returning",
      lastName: "Fixture",
      birthDate: "2017-04-04",
      idNumber: histId,
    });
    const feeBeforeReact = await feeSnapshot(appReturn.id);
    const reactPre = await getReactivationPreflight(prisma, conv, appReturn.id);
    assert.strictEqual(reactPre.canReactivate, true);
    assert.ok(
      reactPre.warnings.some((w) => w.code === "ADMISSION_FEE_VERIFICATION_PENDING"),
      "reactivation preflight carries the unverified-payment warning"
    );
    ok("reactivation preflight warns (never blocks) on unverified admission fee");

    const reactivated = await reactivateHistoricalLearnerForApplication(prisma, conv, appReturn.id, {
      learnerId: reg.learner!.id,
      family: { mode: "KEEP_EXISTING" },
      guardians: appReturn.guardians.map((g) => ({ admissionGuardianId: g.id, mode: "CREATE_NEW" as const })),
      placement: { grade: "Grade 2", className: "2A" },
    });
    assert.strictEqual(reactivated.idempotent, false);
    assert.deepStrictEqual(await feeSnapshot(appReturn.id), feeBeforeReact, "fee record untouched by reactivation");
    await assertPendingPreserved(appReturn.id, s.school.id, s.admin.id);
    const reactAudit = await prisma.admissionAuditEvent.findMany({ where: { applicationId: appReturn.id } });
    const reactEvent = reactAudit.filter((e) => e.eventType === "APPLICATION_REACTIVATED_TO_LEARNER");
    assert.strictEqual(reactEvent.length, 1);
    assert.strictEqual(reactEvent[0].actorUserId, s.admin.id);
    assertNoFinancialAuditEvents(reactAudit);
    ok("reactivation keeps PROOF_UPLOADED, fee unchanged, no verification/receipt events; decisions recorded");

    // ---------- Financial stores ----------
    assert.deepStrictEqual(financialFileHashes(), filesBefore, "ledger/allocation/plan/history files byte-identical");
    assert.deepStrictEqual(await schoolFinancialRowCounts(s.school.id), rowsBefore, "no billing plan lines or deposit allocations");
    invalidateFamilyAccountAgeAnalysisFileCache();
    const snapshotsAfter = readSchoolFamilyAccountAgeAnalysisSnapshots(s.school.id);
    const newRefs = Object.keys(snapshotsAfter).filter((k) => !snapshotsBefore.includes(k));
    assert.deepStrictEqual(newRefs.map((k) => k.toUpperCase()), [String(converted.accountRef).toUpperCase()]);
    assert.strictEqual(bucketTotal(snapshotsAfter[newRefs[0]]), 0, "only a zero-balance account baseline is created");
    ok("billing ledger, allocations, plans and history unchanged; only zero-balance baseline for the new family");
  } finally {
    for (const id of schoolIds) await cleanupSchool(id).catch((e) => console.error("cleanup", id, e));
    if (ageSnapshot === null) {
      if (fs.existsSync(AGE_ANALYSIS_PATH)) fs.unlinkSync(AGE_ANALYSIS_PATH);
    } else {
      fs.writeFileSync(AGE_ANALYSIS_PATH, ageSnapshot, "utf8");
    }
    invalidateFamilyAccountAgeAnalysisFileCache();
    await prisma.$disconnect();
  }
  console.log(`\nadmissions.acceptancePendingEnrolment.integration: ${passed} passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
