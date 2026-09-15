/**
 * Phase 6E — subscription status authorization + read-only resolve.
 * SAFE TARGET: localhost PostgreSQL only.
 *
 * Run: npx tsx src/services/phase6eSubscriptionStatus.security.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";
import jwt from "jsonwebtoken";

import { authorizeSchoolSubscriptionStatusAccess } from "./subscriptionStatusAuth";
import { resolveSchoolCommercialPackageReadOnly } from "./resolveSchoolCommercialPackage";
import {
  ensureSchoolModuleEntitlements,
  getSchoolModuleEntitlementsReadOnly,
  updateSchoolModuleEntitlements,
} from "./schoolModuleEntitlements";
import { hashAuthPassword } from "./authCredentials";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { PLATFORM_SUPER_ADMIN_EMAIL } from "../utils/superAdmin";

const prisma = new PrismaClient();
const PREFIX = "phase6e-sub-";

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

function bearerFor(user: { id: string; schoolId: string; email: string; role: string }) {
  const token = jwt.sign(
    {
      userId: user.id,
      schoolId: user.schoolId,
      email: user.email,
      role: user.role,
    },
    STAFF_JWT_SECRET,
    { expiresIn: "1h" }
  );
  return `Bearer ${token}`;
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolSubscription.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.userRbacMeta.deleteMany({ where: { user: { schoolId: s.id } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { schoolId: s.id } });
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function createSchoolWithOwner(label: string, email?: string) {
  const id = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const school = await prisma.school.create({
    data: {
      id,
      name: `Phase6E Sub ${label}`,
      email: `${id}@phase6e.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(school.id);
  const passwordHash = await hashAuthPassword("Phase6ETest!123");
  const user = await prisma.user.create({
    data: {
      id: `${id}-owner`,
      schoolId: school.id,
      email: email || `owner-${id}@phase6e.test`,
      fullName: `Owner ${label}`,
      role: "SCHOOL_ADMIN",
      isActive: true,
      passwordHash,
    },
  });
  return { school, user };
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const a = await createSchoolWithOwner("A");
  const b = await createSchoolWithOwner("B");
  const sa = await createSchoolWithOwner("SA", PLATFORM_SUPER_ADMIN_EMAIL);

  // School A authorized → may retrieve School A
  const allowA = await authorizeSchoolSubscriptionStatusAccess({
    authHeader: bearerFor(a.user),
    requestSchoolId: a.school.id,
  });
  assert.strictEqual(allowA.allowed, true);
  console.log("✓ School A user may retrieve School A status");

  // School A requesting School B → denied
  const denyCross = await authorizeSchoolSubscriptionStatusAccess({
    authHeader: bearerFor(a.user),
    requestSchoolId: b.school.id,
  });
  assert.strictEqual(denyCross.allowed, false);
  if (!denyCross.allowed) {
    assert.strictEqual(denyCross.status, 403);
    assert.strictEqual(denyCross.code, "SCHOOL_MISMATCH");
  }
  console.log("✓ School A requesting School B → denied");

  // Unauthenticated → denied
  const unauth = await authorizeSchoolSubscriptionStatusAccess({
    authHeader: undefined,
    requestSchoolId: a.school.id,
  });
  assert.strictEqual(unauth.allowed, false);
  if (!unauth.allowed) {
    assert.strictEqual(unauth.status, 401);
    assert.strictEqual(unauth.code, "AUTH_REQUIRED");
  }
  console.log("✓ Unauthenticated status → denied");

  // Super Admin → allowed for other school
  const saAccess = await authorizeSchoolSubscriptionStatusAccess({
    authHeader: bearerFor(sa.user),
    requestSchoolId: b.school.id,
  });
  assert.strictEqual(saAccess.allowed, true);
  if (saAccess.allowed) {
    assert.strictEqual(saAccess.isSuperAdmin, true);
  }
  console.log("✓ Super Admin may retrieve other school status");

  // Explicit false entitlements returned via read-only resolve
  await updateSchoolModuleEntitlements({
    schoolId: a.school.id,
    core: true,
    accounting: false,
    payroll: false,
    actor: { userId: a.user.id, email: a.user.email },
  });
  const resolved = await resolveSchoolCommercialPackageReadOnly(a.school.id);
  assert.strictEqual(resolved.moduleEntitlements.CORE, true);
  assert.strictEqual(resolved.moduleEntitlements.ACCOUNTING, false);
  assert.strictEqual(resolved.moduleEntitlements.PAYROLL, false);
  assert.strictEqual(resolved.commercialPackage?.code, "CORE");
  console.log("✓ Explicit module false values returned correctly (read-only)");

  // Missing rows → fail-open Full without creating rows
  await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: b.school.id } });
  const beforeCount = await prisma.schoolModuleEntitlement.count({
    where: { schoolId: b.school.id },
  });
  assert.strictEqual(beforeCount, 0);
  const missing = await getSchoolModuleEntitlementsReadOnly(b.school.id);
  assert.deepStrictEqual(missing, { CORE: true, ACCOUNTING: true, PAYROLL: true });
  const afterCount = await prisma.schoolModuleEntitlement.count({
    where: { schoolId: b.school.id },
  });
  assert.strictEqual(afterCount, 0);
  console.log("✓ Missing entitlement rows → fail-open Full; no GET-side write");

  await cleanup();
  console.log("\nAll phase6eSubscriptionStatus security tests passed.");
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
