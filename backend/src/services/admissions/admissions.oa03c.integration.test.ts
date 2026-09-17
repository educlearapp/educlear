/**
 * OA-03C integration tests — draft PATCH + submit (local educlear only).
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03c.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import {
  createDraftApplication,
  getApplicationForApplicant,
  updateDraftApplication,
} from "./draftApplicationService";
import { PublicAdmissionsError } from "./publicAdmissionsConfig";
import { submitApplication } from "./submitApplicationService";

const prisma = new PrismaClient();

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const host = (raw.match(/@([^:/?]+)/) || [])[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing non-local host: ${host}`);
  }
}

async function makeSchool(suffix: string, opts?: { fee?: boolean; feeAmount?: string }) {
  const school = await prisma.school.create({ data: { name: `OA03C ${suffix}` } });
  const slug = `oa03c-${suffix}-${Date.now().toString(36)}`;
  await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: Boolean(opts?.fee),
      defaultAdmissionFeeAmount: opts?.fee ? (opts.feeAmount as any) || "1600.00" : null,
      currency: "ZAR",
      applicationQuestions: [{ key: "why", label: "Why apply?", required: true }],
      bankName: opts?.fee ? "Test Bank" : null,
      accountHolder: opts?.fee ? "School" : null,
      accountNumber: opts?.fee ? "123456789" : null,
      branchCode: opts?.fee ? "250655" : null,
    },
  });
  return { school, slug };
}

async function cleanupSchool(schoolId: string) {
  const apps = await prisma.admissionApplication.findMany({
    where: { schoolId },
    select: { id: true },
  });
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
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
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

async function completeDraft(
  slug: string,
  publicAccessId: string,
  token: string,
  grade = "Grade 1"
) {
  return updateDraftApplication(prisma, slug, publicAccessId, token, {
    requestedGrade: grade,
    intakeYear: 2027,
    learner: {
      firstName: "Thabo",
      lastName: "Molefe",
      birthDate: "2018-05-01",
      homeAddress: "1 Test St",
    },
    guardians: [
      {
        firstName: "Lerato",
        surname: "Molefe",
        cellNo: "0821111111",
        email: "lerato@example.com",
        isPrimary: true,
        isPayingPerson: true,
        homeAddress: "1 Test St",
      },
    ],
    answers: [{ questionKey: "why", questionLabelSnapshot: "Why apply?", valueJson: "Great school" }],
    privacyAccepted: true,
    declarationsAccepted: true,
    privacyNoticeVersion: "v1",
  });
}

async function main() {
  assertLocal();
  const schoolIds: string[] = [];

  try {
    const a = await makeSchool("a", { fee: true, feeAmount: "1600.00" });
    const b = await makeSchool("b");
    schoolIds.push(a.school.id, b.school.id);

    const created = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "", lastName: "" },
    });
    const accessId = created.application.publicAccessId;
    const token = created.accessToken;
    assert.strictEqual(created.application.applicationNumber, null);

    // Save learner / guardian / answers
    const saved = await completeDraft(a.slug, accessId, token);
    assert.strictEqual(saved.learner?.firstName, "Thabo");
    assert.strictEqual(saved.guardians.length, 1);
    assert.strictEqual(saved.guardians[0].surname, "Molefe");
    assert.strictEqual(saved.answers[0]?.questionKey, "why");
    assert.ok(saved.privacyAcceptedAt);
    assert.ok(saved.declarationsAcceptedAt);

    // Retrieve saved draft
    const loaded = await getApplicationForApplicant(prisma, a.slug, accessId, token);
    assert.strictEqual(loaded.learner?.lastName, "Molefe");
    assert.strictEqual(loaded.guardians[0].cellNo, "0821111111");

    // Unauthorized mutation
    let unauth = false;
    try {
      await updateDraftApplication(prisma, a.slug, accessId, "bad-token", {
        learner: { firstName: "X", lastName: "Y" },
      });
    } catch (err) {
      unauth = err instanceof PublicAdmissionsError && err.statusCode === 404;
    }
    assert.ok(unauth);

    // Cross-school mutation
    let cross = false;
    try {
      await updateDraftApplication(prisma, b.slug, accessId, token, {
        learner: { firstName: "X", lastName: "Y" },
      });
    } catch (err) {
      cross = err instanceof PublicAdmissionsError && err.statusCode === 404;
    }
    assert.ok(cross);

    // Protected fields rejected
    let protectedField = false;
    try {
      await updateDraftApplication(prisma, a.slug, accessId, token, {
        status: "ACCEPTED",
      } as any);
    } catch (err) {
      protectedField =
        err instanceof PublicAdmissionsError && err.code === "PROTECTED_FIELD";
    }
    assert.ok(protectedField);

    let protectedNumber = false;
    try {
      await updateDraftApplication(prisma, a.slug, accessId, token, {
        applicationNumber: "APP-2027-999999",
      } as any);
    } catch (err) {
      protectedNumber =
        err instanceof PublicAdmissionsError && err.code === "PROTECTED_FIELD";
    }
    assert.ok(protectedNumber);

    // Incomplete submission
    const incomplete = await createDraftApplication(prisma, a.slug, {
      learner: { firstName: "Only", lastName: "Name" },
    });
    let incompleteRejected = false;
    try {
      await submitApplication(
        prisma,
        a.slug,
        incomplete.application.publicAccessId,
        incomplete.accessToken
      );
    } catch (err) {
      incompleteRejected =
        err instanceof PublicAdmissionsError && err.code === "VALIDATION_FAILED";
    }
    assert.ok(incompleteRejected);

    // Invalid grade
    let badGrade = false;
    try {
      await updateDraftApplication(prisma, a.slug, accessId, token, {
        requestedGrade: "Grade 99",
      });
    } catch (err) {
      badGrade = err instanceof PublicAdmissionsError && err.code === "GRADE_NOT_ACCEPTED";
    }
    assert.ok(badGrade);

    // Successful submit
    const submitted = await submitApplication(prisma, a.slug, accessId, token);
    assert.strictEqual(submitted.application.status, "SUBMITTED");
    assert.ok(submitted.application.applicationNumber);
    assert.match(submitted.application.applicationNumber!, /^APP-2027-\d{6}$/);
    assert.strictEqual(submitted.application.feeRequired, true);
    assert.strictEqual(submitted.application.feeAmount, "1600.00");
    assert.strictEqual(submitted.application.feeRecord?.paymentStatus, "AWAITING_PAYMENT");
    assert.strictEqual(
      submitted.application.feeRecord?.paymentReference,
      submitted.application.applicationNumber
    );
    assert.ok(submitted.application.submittedAt);
    assert.strictEqual(submitted.paymentInstructionsAvailable, true);

    // Number only on submission (draft had null)
    assert.notStrictEqual(created.application.applicationNumber, submitted.application.applicationNumber);

    // Repeat submit idempotent — same number
    const again = await submitApplication(prisma, a.slug, accessId, token);
    assert.strictEqual(again.application.applicationNumber, submitted.application.applicationNumber);
    assert.strictEqual(again.application.status, "SUBMITTED");
    const feeCount = await prisma.admissionFeeRecord.count({
      where: { applicationId: (await prisma.admissionApplication.findFirst({
        where: { publicAccessId: accessId },
      }))!.id },
    });
    assert.strictEqual(feeCount, 1);

    // Submitted cannot be freely edited
    let locked = false;
    try {
      await updateDraftApplication(prisma, a.slug, accessId, token, {
        learner: { firstName: "Changed", lastName: "Name", birthDate: "2018-05-01" },
      });
    } catch (err) {
      locked = err instanceof PublicAdmissionsError && err.code === "APPLICATION_NOT_EDITABLE";
    }
    assert.ok(locked);

    // Concurrent submit does not allocate multiple numbers
    const c = await makeSchool("conc", { fee: false });
    schoolIds.push(c.school.id);
    const d = await createDraftApplication(prisma, c.slug, {});
    await completeDraft(c.slug, d.application.publicAccessId, d.accessToken);
    const concurrent = await Promise.all(
      Array.from({ length: 5 }, () =>
        submitApplication(prisma, c.slug, d.application.publicAccessId, d.accessToken)
      )
    );
    const numbers = new Set(concurrent.map((r) => r.application.applicationNumber));
    assert.strictEqual(numbers.size, 1);
    assert.ok([...numbers][0]);

    // Fee settings change does not rewrite existing snapshot
    await prisma.schoolAdmissionsSettings.update({
      where: { schoolId: a.school.id },
      data: { defaultAdmissionFeeAmount: "1800.00" },
    });
    const afterFeeChange = await getApplicationForApplicant(prisma, a.slug, accessId, token);
    assert.strictEqual(afterFeeChange.feeAmount, "1600.00");

    // No canonical side effects
    assert.strictEqual(await prisma.learner.count({ where: { schoolId: a.school.id } }), 0);
    assert.strictEqual(await prisma.parent.count({ where: { schoolId: a.school.id } }), 0);
    assert.strictEqual(await prisma.familyAccount.count({ where: { schoolId: a.school.id } }), 0);

    console.log("✓ OA-03C admissions integration tests passed");
  } finally {
    for (const id of schoolIds) await cleanupSchool(id);
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
