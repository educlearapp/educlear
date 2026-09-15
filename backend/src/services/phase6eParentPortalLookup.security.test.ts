/**
 * Phase 6E — Parent Portal lookup tenant isolation + CORE gate.
 * SAFE TARGET: localhost PostgreSQL only.
 *
 * Run: npx tsx src/services/phase6eParentPortalLookup.security.test.ts
 */
import assert from "assert";
import { PrismaClient, ProductModule } from "@prisma/client";

import {
  PARENT_PORTAL_LOOKUP_NOT_FOUND,
  lookupParentPortalBySchool,
} from "./parentPortalLookup";
import {
  ensureSchoolModuleEntitlements,
  updateSchoolModuleEntitlements,
} from "./schoolModuleEntitlements";
import { findParentByCredentials } from "./parentPortalService";

const prisma = new PrismaClient();
const PREFIX = "phase6e-pp-";

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
    `Refusing Phase 6E security tests against non-local host: ${host || "(unknown)"}`
  );
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    await prisma.parentLearnerLink.deleteMany({ where: { schoolId: s.id } });
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } });
    await prisma.userRbacMeta.deleteMany({
      where: { user: { schoolId: s.id } },
    }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { schoolId: s.id } });
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function createSchoolTenant(label: string, cellNo: string) {
  const id = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: {
      id,
      name: `Phase6E ${label}`,
      email: `${id}@phase6e.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(school.id);

  const learner = await prisma.learner.create({
    data: {
      id: `${id}-learner`,
      schoolId: school.id,
      firstName: `Learner${label}`,
      lastName: "Test",
      grade: "1",
      className: "A",
      admissionNo: `${label}-ADM`,
    },
  });

  const parent = await prisma.parent.create({
    data: {
      id: `${id}-parent`,
      schoolId: school.id,
      firstName: `Parent${label}`,
      surname: "Test",
      cellNo,
      email: `parent-${id}@phase6e.test`,
      idNumber: `${label}9001015800080`.slice(0, 13),
    },
  });

  await prisma.parentLearnerLink.create({
    data: {
      id: `${id}-link`,
      schoolId: school.id,
      parentId: parent.id,
      learnerId: learner.id,
      relation: "Mother",
      isPrimary: true,
    },
  });

  return { school, parent, learner, cellNo };
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const cellA = "0821111001";
  const cellB = "0822222002";
  const sharedCell = "0823333003";

  const tenantA = await createSchoolTenant("A", cellA);
  const tenantB = await createSchoolTenant("B", cellB);

  // Duplicate phone across two schools
  const sharedA = await createSchoolTenant("SharedA", sharedCell);
  const sharedB = await createSchoolTenant("SharedB", sharedCell);

  // School A + Cell A → only A
  const hitA = await lookupParentPortalBySchool({
    schoolId: tenantA.school.id,
    cellNo: cellA,
  });
  assert.strictEqual(hitA.ok, true);
  if (hitA.ok) {
    assert.strictEqual(hitA.parent.id, tenantA.parent.id);
    assert.strictEqual(hitA.parent.school?.id, tenantA.school.id);
    assert.ok(hitA.learners.every((l) => l.learner.id === tenantA.learner.id));
    assert.ok(!hitA.learners.some((l) => l.learner.id === tenantB.learner.id));
  }
  console.log("✓ School A + Cell A returns only School A");

  // School B + Cell B → only B
  const hitB = await lookupParentPortalBySchool({
    schoolId: tenantB.school.id,
    cellNo: cellB,
  });
  assert.strictEqual(hitB.ok, true);
  if (hitB.ok) {
    assert.strictEqual(hitB.parent.id, tenantB.parent.id);
  }
  console.log("✓ School B + Cell B returns only School B");

  // Cross-tenant: School A + Cell B → not found (no Parent B leak)
  const crossAB = await lookupParentPortalBySchool({
    schoolId: tenantA.school.id,
    cellNo: cellB,
  });
  assert.strictEqual(crossAB.ok, false);
  if (!crossAB.ok) {
    assert.strictEqual(crossAB.status, 404);
    assert.strictEqual(crossAB.error, PARENT_PORTAL_LOOKUP_NOT_FOUND);
  }
  console.log("✓ School A + Cell B denied (generic not-found)");

  const crossBA = await lookupParentPortalBySchool({
    schoolId: tenantB.school.id,
    cellNo: cellA,
  });
  assert.strictEqual(crossBA.ok, false);
  if (!crossBA.ok) {
    assert.strictEqual(crossBA.status, 404);
    assert.strictEqual(crossBA.error, PARENT_PORTAL_LOOKUP_NOT_FOUND);
  }
  console.log("✓ School B + Cell A denied (generic not-found)");

  // Unknown cell
  const unknown = await lookupParentPortalBySchool({
    schoolId: tenantA.school.id,
    cellNo: "0829999999",
  });
  assert.strictEqual(unknown.ok, false);
  if (!unknown.ok) {
    assert.strictEqual(unknown.status, 404);
    assert.strictEqual(unknown.error, PARENT_PORTAL_LOOKUP_NOT_FOUND);
  }
  console.log("✓ Unknown cell → generic not-found");

  // Duplicate cell: each school resolves only its own parent
  const dupA = await lookupParentPortalBySchool({
    schoolId: sharedA.school.id,
    cellNo: sharedCell,
  });
  const dupB = await lookupParentPortalBySchool({
    schoolId: sharedB.school.id,
    cellNo: sharedCell,
  });
  assert.strictEqual(dupA.ok, true);
  assert.strictEqual(dupB.ok, true);
  if (dupA.ok && dupB.ok) {
    assert.strictEqual(dupA.parent.id, sharedA.parent.id);
    assert.strictEqual(dupB.parent.id, sharedB.parent.id);
    assert.notStrictEqual(dupA.parent.id, dupB.parent.id);
  }
  console.log("✓ Duplicate cell across schools stays tenant-scoped");

  // Explicit CORE=false → denied
  await updateSchoolModuleEntitlements({
    schoolId: tenantA.school.id,
    core: false,
    accounting: true,
    payroll: false,
    actor: { userId: "phase6e-test", email: "phase6e@test.local" },
  });
  const coreOff = await lookupParentPortalBySchool({
    schoolId: tenantA.school.id,
    cellNo: cellA,
  });
  assert.strictEqual(coreOff.ok, false);
  if (!coreOff.ok) {
    assert.strictEqual(coreOff.status, 403);
    assert.ok(coreOff.code === "MODULE_NOT_ENTITLED" || /CORE/i.test(coreOff.error));
  }
  console.log("✓ Explicit CORE=false → lookup denied");

  // Restore CORE=true → works again
  await updateSchoolModuleEntitlements({
    schoolId: tenantA.school.id,
    core: true,
    accounting: true,
    payroll: true,
    actor: { userId: "phase6e-test", email: "phase6e@test.local" },
  });
  const coreOn = await lookupParentPortalBySchool({
    schoolId: tenantA.school.id,
    cellNo: cellA,
  });
  assert.strictEqual(coreOn.ok, true);
  console.log("✓ CORE=true → legitimate lookup works");

  // Missing entitlement rows → fail-open Full (lookup works)
  await prisma.schoolModuleEntitlement.deleteMany({
    where: { schoolId: tenantB.school.id },
  });
  const missingRows = await lookupParentPortalBySchool({
    schoolId: tenantB.school.id,
    cellNo: cellB,
  });
  assert.strictEqual(missingRows.ok, true);
  console.log("✓ Missing entitlement rows → fail-open lookup works");

  // findParentByCredentials must refuse missing schoolId (no cross-tenant)
  const noSchool = await findParentByCredentials({
    schoolId: "",
    cellNo: cellA,
  } as { schoolId: string; cellNo: string });
  assert.strictEqual(noSchool, null);
  console.log("✓ findParentByCredentials without schoolId returns null");

  // Malformed/unknown schoolId
  const badSchool = await lookupParentPortalBySchool({
    schoolId: `${PREFIX}does-not-exist`,
    cellNo: cellA,
  });
  assert.strictEqual(badSchool.ok, false);
  if (!badSchool.ok) {
    assert.strictEqual(badSchool.status, 404);
  }
  console.log("✓ Unknown schoolId → generic not-found (no cross-tenant)");

  await cleanup();
  console.log("\nAll phase6eParentPortalLookup security tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup().catch(() => undefined);
    await prisma.$disconnect();
  });
