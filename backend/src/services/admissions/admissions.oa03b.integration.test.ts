/**
 * OA-03B integration tests against local Postgres (localhost/educlear).
 * Creates temporary schools; cleans up. No seed of production data.
 *
 * Run: npx ts-node --transpile-only src/services/admissions/admissions.oa03b.integration.test.ts
 */
import "dotenv/config";
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import { allocateApplicationNumber } from "./allocateApplicationNumber";
import {
  createDraftApplication,
  getApplicationForApplicant,
} from "./draftApplicationService";
import { getPublicAdmissionsConfig, PublicAdmissionsError } from "./publicAdmissionsConfig";
import { hashApplicantAccessToken } from "./applicantAccessToken";

const prisma = new PrismaClient();

function assertLocal() {
  const raw = process.env.DATABASE_URL || "";
  const hostMatch = raw.match(/@([^:/?]+)/);
  const host = hostMatch?.[1] || "";
  if (host !== "localhost" && host !== "127.0.0.1") {
    throw new Error(`Refusing integration test on non-local host: ${host}`);
  }
}

async function makeSchool(suffix: string) {
  const school = await prisma.school.create({
    data: { name: `OA03B Test ${suffix}` },
  });
  const slug = `oa03b-${suffix}-${Date.now().toString(36)}`;
  const settings = await prisma.schoolAdmissionsSettings.create({
    data: {
      schoolId: school.id,
      enabled: true,
      publicSlug: slug,
      intakeYear: 2027,
      acceptedGrades: ["Grade 1", "Grade 2"],
      admissionFeeRequired: false,
      currency: "ZAR",
    },
  });
  return { school, settings, slug };
}

async function cleanupSchool(schoolId: string) {
  // Delete admissions children first where Restrict applies
  const apps = await prisma.admissionApplication.findMany({
    where: { schoolId },
    select: { id: true },
  });
  const ids = apps.map((a) => a.id);
  if (ids.length) {
    await prisma.admissionAuditEvent.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStatusHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionPaymentHistory.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionStaffNote.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionFeeRecord.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionDocument.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionAnswer.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionGuardian.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionLearnerCandidate.deleteMany({ where: { applicationId: { in: ids } } });
    await prisma.admissionApplication.deleteMany({ where: { id: { in: ids } } });
  }
  await prisma.admissionApplicationCounter.deleteMany({ where: { schoolId } });
  await prisma.admissionAuditEvent.deleteMany({ where: { schoolId, applicationId: null } });
  await prisma.schoolAdmissionsSettings.deleteMany({ where: { schoolId } });
  await prisma.school.delete({ where: { id: schoolId } }).catch(() => undefined);
}

async function main() {
  assertLocal();
  const createdSchoolIds: string[] = [];

  try {
    const a = await makeSchool("a");
    const b = await makeSchool("b");
    createdSchoolIds.push(a.school.id, b.school.id);

    // Sequential numbers same school/year
    const n1 = await prisma.$transaction((tx) =>
      allocateApplicationNumber(tx, a.school.id, 2027)
    );
    const n2 = await prisma.$transaction((tx) =>
      allocateApplicationNumber(tx, a.school.id, 2027)
    );
    assert.strictEqual(n1, "APP-2027-000001");
    assert.strictEqual(n2, "APP-2027-000002");

    // Separate counter per school
    const b1 = await prisma.$transaction((tx) =>
      allocateApplicationNumber(tx, b.school.id, 2027)
    );
    assert.strictEqual(b1, "APP-2027-000001");

    // Year rollover — independent sequence
    const y2028 = await prisma.$transaction((tx) =>
      allocateApplicationNumber(tx, a.school.id, 2028)
    );
    assert.strictEqual(y2028, "APP-2028-000001");

    // Concurrent allocation safety
    const concurrent = await Promise.all(
      Array.from({ length: 8 }, () =>
        prisma.$transaction((tx) => allocateApplicationNumber(tx, a.school.id, 2029))
      )
    );
    const unique = new Set(concurrent);
    assert.strictEqual(unique.size, 8, `expected 8 unique numbers, got ${[...unique].join(",")}`);
    assert.ok([...unique].every((n) => /^APP-2029-\d{6}$/.test(n)));

    // Public config enabled
    const cfg = await getPublicAdmissionsConfig(prisma, a.slug);
    assert.strictEqual(cfg.acceptingApplications, true);
    assert.ok(!("schoolId" in cfg));
    assert.ok(!("accountNumber" in cfg));

    // Disabled blocks create
    await prisma.schoolAdmissionsSettings.update({
      where: { schoolId: a.school.id },
      data: { enabled: false },
    });
    const closedCfg = await getPublicAdmissionsConfig(prisma, a.slug);
    assert.strictEqual(closedCfg.acceptingApplications, false);

    let createBlocked = false;
    try {
      await createDraftApplication(prisma, a.slug, {
        requestedGrade: "Grade 1",
        learner: { firstName: "A", lastName: "B" },
      });
    } catch (err) {
      createBlocked = err instanceof PublicAdmissionsError && err.code === "ADMISSIONS_CLOSED";
    }
    assert.ok(createBlocked, "disabled admissions must block draft create");

    await prisma.schoolAdmissionsSettings.update({
      where: { schoolId: a.school.id },
      data: { enabled: true },
    });

    // Draft create + token retrieve
    const draft = await createDraftApplication(prisma, a.slug, {
      requestedGrade: "Grade 1",
      learner: { firstName: "Thabo", lastName: "Molefe" },
      guardians: [
        {
          firstName: "Parent",
          surname: "Molefe",
          cellNo: "0820000000",
          isPrimary: true,
        },
      ],
    });
    assert.strictEqual(draft.application.status, "DRAFT");
    assert.strictEqual(draft.application.applicationNumber, null);
    assert.ok(draft.accessToken);
    assert.strictEqual(draft.application.learner?.firstName, "Thabo");

    // Token hash only in DB
    const row = await prisma.admissionApplication.findFirst({
      where: { publicAccessId: draft.application.publicAccessId },
    });
    assert.ok(row);
    assert.notStrictEqual(row!.accessTokenHash, draft.accessToken);
    assert.strictEqual(row!.accessTokenHash, hashApplicantAccessToken(draft.accessToken));
    assert.strictEqual(row!.schoolId, a.school.id);

    // No canonical side effects
    const learnerCount = await prisma.learner.count({ where: { schoolId: a.school.id } });
    const parentCount = await prisma.parent.count({ where: { schoolId: a.school.id } });
    const faCount = await prisma.familyAccount.count({ where: { schoolId: a.school.id } });
    assert.strictEqual(learnerCount, 0);
    assert.strictEqual(parentCount, 0);
    assert.strictEqual(faCount, 0);

    const loaded = await getApplicationForApplicant(
      prisma,
      a.slug,
      draft.application.publicAccessId,
      draft.accessToken
    );
    assert.strictEqual(loaded.publicAccessId, draft.application.publicAccessId);
    assert.strictEqual(loaded.learner?.lastName, "Molefe");

    // Invalid token
    let badToken = false;
    try {
      await getApplicationForApplicant(
        prisma,
        a.slug,
        draft.application.publicAccessId,
        "not-the-token"
      );
    } catch (err) {
      badToken = err instanceof PublicAdmissionsError && err.statusCode === 404;
    }
    assert.ok(badToken);

    // Expired token
    await prisma.admissionApplication.update({
      where: { id: row!.id },
      data: { accessTokenExpiresAt: new Date(Date.now() - 60_000) },
    });
    let expired = false;
    try {
      await getApplicationForApplicant(
        prisma,
        a.slug,
        draft.application.publicAccessId,
        draft.accessToken
      );
    } catch (err) {
      expired = err instanceof PublicAdmissionsError && err.statusCode === 404;
    }
    assert.ok(expired);

    // Restore expiry for cross-school test
    await prisma.admissionApplication.update({
      where: { id: row!.id },
      data: { accessTokenExpiresAt: new Date(Date.now() + 86_400_000) },
    });

    // Cross-school: school B slug cannot load school A application even with valid token
    let cross = false;
    try {
      await getApplicationForApplicant(
        prisma,
        b.slug,
        draft.application.publicAccessId,
        draft.accessToken
      );
    } catch (err) {
      cross = err instanceof PublicAdmissionsError && err.statusCode === 404;
    }
    assert.ok(cross, "cross-school access must fail");

    // Client schoolId rejected
    let spoof = false;
    try {
      await createDraftApplication(prisma, a.slug, {
        schoolId: b.school.id,
        requestedGrade: "Grade 1",
      });
    } catch (err) {
      spoof = err instanceof PublicAdmissionsError && err.code === "SCHOOL_ID_NOT_ALLOWED";
    }
    assert.ok(spoof);

    // Unknown slug
    let unknown = false;
    try {
      await getPublicAdmissionsConfig(prisma, "no-such-slug-oa03b");
    } catch (err) {
      unknown = err instanceof PublicAdmissionsError && err.statusCode === 404;
    }
    assert.ok(unknown);

    console.log("✓ OA-03B admissions integration tests passed");
  } finally {
    for (const id of createdSchoolIds) {
      await cleanupSchool(id);
    }
    await prisma.$disconnect();
  }
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
