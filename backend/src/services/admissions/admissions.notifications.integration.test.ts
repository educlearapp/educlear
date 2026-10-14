/**
 * Submission notifications + autosave/draft visibility integration tests (local educlear only).
 * Uses a mocked sender — no real email is sent.
 * Run: npx tsx src/services/admissions/admissions.notifications.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import { createDraftApplication, updateDraftApplication } from "./draftApplicationService";
import { submitApplication } from "./submitApplicationService";
import { listStaffApplications } from "./staffAdmissionsReadService";
import {
  ADMISSION_NOTIFICATION_ATTEMPT_FAILED,
  ADMISSION_NOTIFICATION_FAILED,
  ADMISSION_NOTIFICATION_SENT,
  ADMISSION_NOTIFICATION_SKIPPED,
  buildParentConfirmationEmail,
  notifyApplicationSubmitted,
  recipientKeyFor,
  type AdmissionNotificationSender,
} from "./admissionsSubmissionNotificationService";
import { ResendHttpError, ResendNetworkUnavailableError } from "../resendClient";
import type { SendSchoolEmailInput } from "../schoolEmailService";

const prisma = new PrismaClient();

const LEARNER_FIRST = "Notifylearnerfirst";
const GUARDIAN_SURNAME = "Notifyguardiansurname";
const LEARNER_ID = "1801015800085";
const BANK_ACCOUNT = "99887766554";

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = (raw.match(/@([^:/?]+)/) || [])[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${host}`);
  }
}

type Sent = { schoolId: string; input: SendSchoolEmailInput };

function recordingSender(plan?: (call: number, input: SendSchoolEmailInput) => void) {
  const sent: Sent[] = [];
  let calls = 0;
  const send: AdmissionNotificationSender = async (schoolId, input) => {
    calls += 1;
    plan?.(calls, input);
    sent.push({ schoolId, input });
    return { id: `mock-${calls}` };
  };
  return { send, sent, calls: () => calls };
}

const noSleep = async () => undefined;

async function makeSchool(suffix: string) {
  const school = await prisma.school.create({ data: { name: `NOTIFY TEST ${suffix}` } });
  const other = await prisma.school.create({ data: { name: `NOTIFY OTHER ${suffix}` } });
  const stamp = Date.now().toString(36);
  const staff = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `notify-staff-${stamp}@example.invalid`,
      passwordHash: "x",
    },
  });
  const inactive = await prisma.user.create({
    data: {
      schoolId: school.id,
      email: `notify-inactive-${stamp}@example.invalid`,
      passwordHash: "x",
      isActive: false,
    },
  });
  const foreign = await prisma.user.create({
    data: {
      schoolId: other.id,
      email: `notify-foreign-${stamp}@example.invalid`,
      passwordHash: "x",
    },
  });
  const slug = `notify-${suffix}-${stamp}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1"],
      admissionFeeRequired: true,
      defaultAdmissionFeeAmount: "1600.00" as any,
      currency: "ZAR",
      bankName: "Test Bank",
      accountHolder: "School",
      accountNumber: BANK_ACCOUNT,
      branchCode: "250655",
      admissionContactEmail: `Admissions-${stamp}@Example.invalid`,
      notificationRecipientUserIds: [staff.id, inactive.id, foreign.id],
    },
  });
  return { school, other, slug, staff, stamp };
}

async function cleanup(schoolIds: string[]) {
  for (const schoolId of schoolIds) {
    const apps = await prisma.admissionApplication.findMany({ where: { schoolId }, select: { id: true } });
    const ids = apps.map((a) => a.id);
    await prisma.admissionAuditEvent.deleteMany({ where: { schoolId } });
    if (ids.length) {
      await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
      await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
      await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
      await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
      await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
      await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
      await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
    await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
    await prisma.user.deleteMany({ where: { schoolId } });
    await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
  }
}

async function submittedApplication(slug: string, opts?: { parentEmail?: string | null }) {
  const created = await createDraftApplication(prisma, slug, {});
  const accessId = created.application.publicAccessId;
  const token = created.accessToken;
  // Autosave-style partial PATCHes (no required-field validation on drafts)
  await updateDraftApplication(prisma, slug, accessId, token, {
    learner: { firstName: LEARNER_FIRST, lastName: "" },
  });
  await updateDraftApplication(prisma, slug, accessId, token, {
    requestedGrade: "Grade 1",
    intakeYear: 2027,
    learner: {
      firstName: LEARNER_FIRST,
      lastName: "Learner",
      birthDate: "2020-01-01",
      idNumber: LEARNER_ID,
    },
    guardians: [
      {
        firstName: "Guardian",
        surname: GUARDIAN_SURNAME,
        cellNo: "0820000000",
        email: opts?.parentEmail === undefined ? "Parent.Notify@Example.invalid" : opts.parentEmail,
        isPrimary: true,
        isPayingPerson: true,
      },
    ],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
  });
  const first = await submitApplication(prisma, slug, accessId, token);
  return { created, accessId, token, first };
}

async function events(applicationId: string, eventType: string) {
  return prisma.admissionAuditEvent.findMany({
    where: { applicationId, eventType },
    select: { metadataJson: true },
  });
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];
  try {
    const s = await makeSchool("a");
    schoolIds.push(s.school.id, s.other.id);
    const contactEmail = `admissions-${s.stamp}@example.invalid`;

    // --- Drafts + autosave never notify ---------------------------------------------------
    const draft = await createDraftApplication(prisma, s.slug, {});
    await updateDraftApplication(prisma, s.slug, draft.application.publicAccessId, draft.accessToken, {
      learner: { firstName: "Partial", lastName: "" },
    });
    const draftRow = await prisma.admissionApplication.findUniqueOrThrow({
      where: { publicAccessId: draft.application.publicAccessId },
      select: { id: true, status: true },
    });
    assert.strictEqual(draftRow.status, "DRAFT", "partial autosave keeps DRAFT");
    const draftSender = recordingSender();
    const draftNotify = await notifyApplicationSubmitted(
      { prisma, send: draftSender.send, sleep: noSleep, isEmailDisabled: () => false },
      { schoolId: s.school.id, applicationId: draftRow.id }
    );
    assert.deepStrictEqual(draftNotify.skippedReasons, ["NOT_SUBMITTED"]);
    assert.strictEqual(draftSender.calls(), 0, "no email for drafts");
    assert.strictEqual(
      await prisma.admissionAuditEvent.count({
        where: { applicationId: draftRow.id, eventType: { startsWith: "ADMISSION_NOTIFICATION" } },
      }),
      0,
      "no notification events for draft create/autosave"
    );

    // --- Submit transition flag: once only, also under concurrency -------------------------
    const one = await submittedApplication(s.slug);
    assert.ok(one.first.newlySubmitted, "first submit reports the transition");
    const again = await submitApplication(prisma, s.slug, one.accessId, one.token);
    assert.strictEqual(again.newlySubmitted, null, "repeat submit does not re-trigger");
    assert.strictEqual(again.application.applicationNumber, one.first.application.applicationNumber);

    const racing = await createDraftApplication(prisma, s.slug, {});
    await updateDraftApplication(prisma, s.slug, racing.application.publicAccessId, racing.accessToken, {
      requestedGrade: "Grade 1",
      intakeYear: 2027,
      learner: { firstName: "Race", lastName: "Learner", birthDate: "2020-02-02" },
      guardians: [
        { firstName: "Race", surname: "Guardian", cellNo: "0821111111", isPrimary: true, isPayingPerson: true },
      ],
      privacyAccepted: true,
      declarationsAccepted: true,
    });
    const raced = await Promise.all(
      Array.from({ length: 4 }, () =>
        submitApplication(prisma, s.slug, racing.application.publicAccessId, racing.accessToken)
      )
    );
    assert.strictEqual(
      raced.filter((r) => r.newlySubmitted).length,
      1,
      "concurrent submits trigger notifications exactly once"
    );

    // --- Successful notification: recipients, content, audit ------------------------------
    const appId = one.first.newlySubmitted!.applicationId;
    const ok = recordingSender();
    const res = await notifyApplicationSubmitted(
      { prisma, send: ok.send, sleep: noSleep, isEmailDisabled: () => false },
      one.first.newlySubmitted!
    );
    const to = ok.sent.map((x) => x.input.to).sort();
    assert.deepStrictEqual(
      to,
      [contactEmail, `notify-staff-${s.stamp}@example.invalid`, "parent.notify@example.invalid"].sort(),
      "school contact + active same-school recipient + primary guardian only"
    );
    assert.ok(ok.sent.every((x) => x.schoolId === s.school.id));
    assert.strictEqual(new Set(ok.sent.map((x) => x.input.idempotencyKey)).size, 3, "unique keys");
    for (const { input } of ok.sent) {
      assert.ok(input.html.includes(one.first.application.applicationNumber!), "reference included");
      assert.ok(!input.html.includes(LEARNER_FIRST), "no learner name");
      assert.ok(!input.html.includes(GUARDIAN_SURNAME), "no guardian name");
      assert.ok(!input.html.includes(LEARNER_ID), "no ID number");
      assert.ok(!input.html.includes(BANK_ACCOUNT), "no bank details");
      assert.ok(!input.attachments?.length, "no attachments");
    }
    assert.ok(res.outcomes.every((o) => o.result === "SENT" && o.attempts === 1));
    const sentEvents = await events(appId, ADMISSION_NOTIFICATION_SENT);
    assert.strictEqual(sentEvents.length, 3);
    assert.ok(
      sentEvents.every((e) => !JSON.stringify(e.metadataJson).includes("@")),
      "audit metadata holds no email addresses"
    );
    assert.ok(
      sentEvents.some(
        (e) => (e.metadataJson as any).recipientKey === recipientKeyFor("parent.notify@example.invalid")
      )
    );

    // --- Re-run (retry / duplicate trigger) sends nothing new ------------------------------
    const dup = recordingSender();
    const dupRes = await notifyApplicationSubmitted(
      { prisma, send: dup.send, sleep: noSleep, isEmailDisabled: () => false },
      one.first.newlySubmitted!
    );
    assert.strictEqual(dup.calls(), 0, "no duplicate emails");
    assert.ok(dupRes.outcomes.every((o) => o.result === "SKIPPED_ALREADY_SENT"));

    // --- Transient failures retried with a bounded number of attempts -----------------------
    const two = await submittedApplication(s.slug);
    const perRecipientCalls = new Map<string, number>();
    const flaky = recordingSender((_call, input) => {
      const n = (perRecipientCalls.get(input.to) || 0) + 1;
      perRecipientCalls.set(input.to, n);
      if (n <= 2) {
        throw new ResendNetworkUnavailableError({ code: "ECONNRESET", timedOut: false, attempts: 1 });
      }
    });
    const flakyRes = await notifyApplicationSubmitted(
      { prisma, send: flaky.send, sleep: noSleep, retryDelaysMs: [0, 1, 1], isEmailDisabled: () => false },
      two.first.newlySubmitted!
    );
    assert.ok(flakyRes.outcomes.every((o) => o.result === "SENT" && o.attempts === 3));
    const twoId = two.first.newlySubmitted!.applicationId;
    assert.strictEqual((await events(twoId, ADMISSION_NOTIFICATION_ATTEMPT_FAILED)).length, 6);
    assert.strictEqual((await events(twoId, ADMISSION_NOTIFICATION_SENT)).length, 3);

    // --- Permanent failure never affects the accepted application ---------------------------
    const three = await submittedApplication(s.slug);
    const before = await prisma.admissionApplication.findUniqueOrThrow({
      where: { id: three.first.newlySubmitted!.applicationId },
      select: { status: true, applicationNumber: true, submittedAt: true },
    });
    let failCalls = 0;
    const failing: AdmissionNotificationSender = async () => {
      failCalls += 1;
      throw new ResendHttpError(500, JSON.stringify({ name: "internal_server_error", message: "x" }));
    };
    const failRes = await notifyApplicationSubmitted(
      { prisma, send: failing, sleep: noSleep, retryDelaysMs: [0, 1, 1], isEmailDisabled: () => false },
      three.first.newlySubmitted!
    );
    assert.strictEqual(failCalls, 9, "3 recipients × 3 bounded attempts");
    assert.ok(failRes.outcomes.every((o) => o.result === "FAILED" && o.errorCode === "PROVIDER_HTTP_500"));
    const after = await prisma.admissionApplication.findUniqueOrThrow({
      where: { id: three.first.newlySubmitted!.applicationId },
      select: { status: true, applicationNumber: true, submittedAt: true },
    });
    assert.deepStrictEqual(after, before, "application unchanged by email failure");
    assert.strictEqual((await events(three.first.newlySubmitted!.applicationId, ADMISSION_NOTIFICATION_FAILED)).length, 3);

    // Thrown sender errors never escape
    const four = await submittedApplication(s.slug);
    let setupCalls = 0;
    const setupMissing: AdmissionNotificationSender = async () => {
      setupCalls += 1;
      throw Object.assign(new Error("setup"), { setupRequired: true });
    };
    const setupRes = await notifyApplicationSubmitted(
      { prisma, send: setupMissing, sleep: noSleep, retryDelaysMs: [0, 1, 1], isEmailDisabled: () => false },
      four.first.newlySubmitted!
    );
    assert.strictEqual(setupCalls, 3, "configuration errors are not retried");
    assert.ok(setupRes.outcomes.every((o) => o.errorCode === "SCHOOL_EMAIL_SETUP_REQUIRED"));

    // --- Kill switch --------------------------------------------------------------------------
    const five = await submittedApplication(s.slug);
    const killed = recordingSender();
    const killedRes = await notifyApplicationSubmitted(
      { prisma, send: killed.send, sleep: noSleep, isEmailDisabled: () => true },
      five.first.newlySubmitted!
    );
    assert.strictEqual(killed.calls(), 0, "DISABLE_OUTBOUND_EMAIL respected");
    assert.ok(killedRes.outcomes.every((o) => o.result === "SKIPPED_DISABLED"));

    // --- Missing parent email is recorded, school still notified ------------------------------
    const six = await submittedApplication(s.slug, { parentEmail: null });
    const noParent = recordingSender();
    const noParentRes = await notifyApplicationSubmitted(
      { prisma, send: noParent.send, sleep: noSleep, isEmailDisabled: () => false },
      six.first.newlySubmitted!
    );
    assert.ok(noParentRes.skippedReasons.includes("NO_PARENT_EMAIL"));
    assert.strictEqual(noParent.calls(), 2);
    assert.strictEqual(
      (await events(six.first.newlySubmitted!.applicationId, ADMISSION_NOTIFICATION_SKIPPED)).length,
      1
    );

    // --- Parent message wording ---------------------------------------------------------------
    const parentMsg = buildParentConfirmationEmail({
      schoolName: "School <b>",
      applicationNumber: "APP-2027-000001",
      intakeYear: 2027,
      requestedGrade: "Grade 1",
      feeRequired: true,
    });
    assert.ok(parentMsg.html.includes("School &lt;b&gt;"), "HTML escaped");
    assert.ok(/payment reference/.test(parentMsg.html));

    // --- Staff draft visibility -----------------------------------------------------------------
    const untouched = await createDraftApplication(prisma, s.slug, {});
    const drafts = await listStaffApplications(prisma, s.school.id, { status: "DRAFT", pageSize: 50 });
    assert.ok(drafts.items.every((i) => i.status === "DRAFT"), "drafts filter returns drafts only");
    const savedDraft = drafts.items.find((i) => i.id === draftRow.id);
    assert.ok(savedDraft?.lastSavedAt, "last saved date for autosaved draft");
    const untouchedRow = drafts.items.find(
      (i) => i.id !== draftRow.id && i.lastSavedAt == null
    );
    assert.ok(untouchedRow, "draft never saved has null lastSavedAt");
    assert.ok(untouched.application.publicAccessId);
    const pipeline = await listStaffApplications(prisma, s.school.id, {
      status: "SUBMITTED,UNDER_REVIEW,INFO_REQUESTED,ACCEPTED,DECLINED,WITHDRAWN,CANCELLED",
      pageSize: 50,
    });
    assert.ok(pipeline.items.every((i) => i.status !== "DRAFT"), "drafts never counted as admissions");
    assert.strictEqual(pipeline.total, 7, "submitted applications only");
    const foreignDrafts = await listStaffApplications(prisma, s.other.id, { status: "DRAFT" });
    assert.strictEqual(foreignDrafts.total, 0, "school scoping preserved");

    // --- No canonical side effects ----------------------------------------------------------------
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: s.school.id } }), 0);
    assert.strictEqual(await prisma.familyAccount.count({ where: { schoolId: s.school.id } }), 0);

    console.log("✓ admissions notifications + draft visibility integration tests passed");
  } finally {
    await cleanup(schoolIds);
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
