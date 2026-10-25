/**
 * Parent Portal parentWithLearners school isolation + multi-child scope.
 * SAFE TARGET: localhost PostgreSQL only. Synthetic fixtures cleaned after run.
 *
 * Run: npx tsx src/routes/parentPortal.parentWithLearners.security.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";

import { parentWithLearners } from "./parentPortal";
import { ensureSchoolModuleEntitlements } from "../services/schoolModuleEntitlements";

const prisma = new PrismaClient();
const PREFIX = "pp20pwl-";

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  assert.ok(url, "DATABASE_URL required");
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    host = "";
  }
  assert.ok(
    host === "localhost" || host === "127.0.0.1",
    `Refusing parentWithLearners security tests against non-local host: ${host || "(unknown)"}`
  );
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    const parents = await prisma.parent.findMany({
      where: { schoolId: s.id },
      select: { id: true },
    });
    for (const p of parents) {
      await prisma.parentLearnerLink.deleteMany({ where: { parentId: p.id } });
      await prisma.parentOnboarding.deleteMany({ where: { parentId: p.id } }).catch(() => undefined);
    }
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
    await prisma.familyAccount.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

function learnerIds(parent: Awaited<ReturnType<typeof parentWithLearners>>): string[] {
  return (parent?.links || [])
    .map((l) => l.learner?.id)
    .filter((id): id is string => Boolean(id))
    .sort();
}

/** Vulnerable query shape (pre-fix) — used to prove the regression catches the gap. */
async function parentWithLearnersVulnerable(parentId: string, schoolId: string) {
  return prisma.parent.findFirst({
    where: { id: parentId, schoolId },
    include: {
      links: {
        include: {
          learner: {
            include: {
              familyAccount: { select: { id: true, accountRef: true, familyName: true } },
            },
          },
        },
      },
      school: { select: { id: true, name: true } },
      onboarding: true,
    },
  });
}

function resolveFamilyBillingLearnerIds(
  learners: Array<{
    id: string;
    familyAccountId?: string | null;
    familyAccount?: { id: string; accountRef: string } | null;
  }>,
  anchorLearnerId: string
) {
  const anchor =
    learners.find((l) => l.id === anchorLearnerId) || (learners.length === 1 ? learners[0] : null);
  if (!anchor) return [] as string[];
  const familyId = String(anchor.familyAccountId || anchor.familyAccount?.id || "").trim();
  const accountRef = String(anchor.familyAccount?.accountRef || "").trim();
  if (familyId) {
    return learners
      .filter((l) => String(l.familyAccountId || l.familyAccount?.id || "") === familyId)
      .map((l) => l.id)
      .sort();
  }
  if (accountRef) {
    return learners
      .filter((l) => String(l.familyAccount?.accountRef || "") === accountRef)
      .map((l) => l.id)
      .sort();
  }
  return [anchor.id];
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const schoolA = await prisma.school.create({
    data: {
      id: `${PREFIX}A-${Date.now()}`,
      name: "PP20 PWL School A",
      email: `${PREFIX}a@pp20pwl.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  const schoolB = await prisma.school.create({
    data: {
      id: `${PREFIX}B-${Date.now()}`,
      name: "PP20 PWL School B",
      email: `${PREFIX}b@pp20pwl.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(schoolA.id);
  await ensureSchoolModuleEntitlements(schoolB.id);

  const family = await prisma.familyAccount.create({
    data: {
      id: `${schoolA.id}-fa`,
      schoolId: schoolA.id,
      accountRef: "PP20PWL001",
      accountNo: "PP20PWL001",
      familyName: "PWL Fixture Family",
    },
  });

  const parent = await prisma.parent.create({
    data: {
      id: `${schoolA.id}-parent`,
      schoolId: schoolA.id,
      familyAccountId: family.id,
      firstName: "Portal",
      surname: "Fixture",
      cellNo: "0827000001",
      idNumber: `PWL${Date.now()}`.slice(0, 13),
      email: "pwl.fixture@pp20pwl.test",
    },
  });

  const kidsA = [];
  for (const tag of ["1", "2", "3", "4", "5"]) {
    const learner = await prisma.learner.create({
      data: {
        id: `${schoolA.id}-L${tag}`,
        schoolId: schoolA.id,
        familyAccountId: family.id,
        firstName: `Child${tag}`,
        lastName: "Fixture",
        grade: tag,
        className: "A",
        admissionNo: `PWL${tag}`,
      },
    });
    kidsA.push(learner);
    await prisma.parentLearnerLink.create({
      data: {
        schoolId: schoolA.id,
        parentId: parent.id,
        learnerId: learner.id,
        relation: "Mother",
        isPrimary: tag === "1",
      },
    });
  }

  const kidB = await prisma.learner.create({
    data: {
      id: `${schoolB.id}-LX`,
      schoolId: schoolB.id,
      firstName: "OtherSchool",
      lastName: "Child",
      grade: "1",
      className: "B",
      admissionNo: "OTHERX",
    },
  });
  // Deliberate forged link: link.schoolId matches A, learner belongs to B
  await prisma.parentLearnerLink.create({
    data: {
      schoolId: schoolA.id,
      parentId: parent.id,
      learnerId: kidB.id,
      relation: "Mother",
      isPrimary: false,
    },
  });

  const vulnerable = await parentWithLearnersVulnerable(parent.id, schoolA.id);
  const vulnerableIds = (vulnerable?.links || [])
    .map((l) => l.learner?.id)
    .filter(Boolean) as string[];
  assert.ok(
    vulnerableIds.includes(kidB.id),
    "sanity: vulnerable query still returns forged cross-school learner"
  );
  console.log("✓ Vulnerable baseline still exposes forged cross-school link");

  const fixed = await parentWithLearners(parent.id, schoolA.id);
  assert.ok(fixed, "parentWithLearners returns parent");
  const ids = learnerIds(fixed);
  assert.equal(ids.length, 5, "returns all 5 same-school children");
  assert.ok(!ids.includes(kidB.id), "excludes cross-school learner despite forged link.schoolId");
  for (const kid of kidsA) {
    assert.ok(ids.includes(kid.id), `includes legitimate child ${kid.id}`);
  }
  console.log("✓ Fixed query: 5 valid children; forged cross-school excluded");

  // 1 / 2 / 3 / 5 legitimate counts via progressive link sets on a second parent
  const parentCounts = await prisma.parent.create({
    data: {
      id: `${schoolA.id}-parent-counts`,
      schoolId: schoolA.id,
      firstName: "Counts",
      surname: "Fixture",
      cellNo: "0827000002",
      idNumber: `PWC${Date.now()}`.slice(0, 13),
    },
  });
  const countKids = [];
  for (const tag of ["A", "B", "C", "D", "E"]) {
    const learner = await prisma.learner.create({
      data: {
        id: `${schoolA.id}-C${tag}`,
        schoolId: schoolA.id,
        firstName: `Count${tag}`,
        lastName: "Fixture",
        grade: "1",
        className: "C",
        admissionNo: `C${tag}`,
      },
    });
    countKids.push(learner);
  }
  for (const n of [1, 2, 3, 5]) {
    await prisma.parentLearnerLink.deleteMany({ where: { parentId: parentCounts.id } });
    for (let i = 0; i < n; i++) {
      await prisma.parentLearnerLink.create({
        data: {
          schoolId: schoolA.id,
          parentId: parentCounts.id,
          learnerId: countKids[i].id,
          relation: "Father",
          isPrimary: i === 0,
        },
      });
    }
    const row = await parentWithLearners(parentCounts.id, schoolA.id);
    assert.equal(learnerIds(row).length, n, `parent with ${n} links returns ${n}`);
  }
  console.log("✓ Synthetic parents with 1, 2, 3 and 5 children");

  // JWT tenant isolation: school B token schoolId cannot load school A parent
  const crossTenant = await parentWithLearners(parent.id, schoolB.id);
  assert.equal(crossTenant, null, "wrong-school JWT schoolId yields null parent");
  console.log("✓ JWT schoolId tenant isolation on parent load");

  // Family billing scope when switching anchors among family-linked children
  const familyLearners = (fixed?.links || []).map((l) => l.learner!).filter(Boolean);
  const scope1 = resolveFamilyBillingLearnerIds(familyLearners, kidsA[0].id);
  const scope5 = resolveFamilyBillingLearnerIds(familyLearners, kidsA[4].id);
  assert.deepStrictEqual(scope1, scope5, "switching family sibling keeps same billing learner set");
  assert.equal(scope1.length, 5, "family scope includes all five family-account siblings");
  console.log("✓ Family billing scope stable across learner switch");

  // FamilyAccount payload preserved on included learners
  const withFa = fixed!.links.find((l) => l.learner.id === kidsA[0].id);
  assert.equal(withFa?.learner.familyAccount?.accountRef, "PP20PWL001");
  console.log("✓ Family account info preserved on scoped learners");

  await cleanup();
  console.log("\nparentPortal.parentWithLearners.security.test: PASS");
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
    await cleanup().catch(() => undefined);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
