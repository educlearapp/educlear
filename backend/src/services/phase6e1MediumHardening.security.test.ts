/**
 * Phase 6E.1 — Medium-finding security hardening tests.
 * SAFE TARGET: localhost PostgreSQL only.
 *
 * Run: npx tsx src/services/phase6e1MediumHardening.security.test.ts
 */
import assert from "assert";
import { PrismaClient } from "@prisma/client";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import parentsRoutes from "../routes/parents";
import subscriptionsRoutes from "../routes/subscriptions";
import payfastRoutes from "../routes/payfast";
import { requireSchoolModule } from "../middleware/requireSchoolModule";
import {
  ensureSchoolModuleEntitlements,
  updateSchoolModuleEntitlements,
  describeModulePackageLabel,
} from "./schoolModuleEntitlements";
import {
  sanitizeEmployeeForModule,
  assertNoPayrollMutationWhenDisabled,
  findDisallowedEmployeeMutationFields,
} from "./employeeModuleFieldPolicy";
import { findCommercialPackageByCode } from "./educlearCommercialPackages";
import { hashAuthPassword } from "./authCredentials";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";

const prisma = new PrismaClient();
const PREFIX = "phase6e1-";

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
    `Refusing Phase 6E.1 tests against non-local host: ${host || "(unknown)"}`
  );
}

function bearer(user: { id: string; schoolId: string; email: string; role?: string }) {
  return `Bearer ${jwt.sign(
    {
      userId: user.id,
      schoolId: user.schoolId,
      email: user.email,
      role: user.role || "SCHOOL_ADMIN",
    },
    STAFF_JWT_SECRET,
    { expiresIn: "1h" }
  )}`;
}

async function cleanup() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    await prisma.parent.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } });
    await prisma.userRbacMeta.deleteMany({ where: { user: { schoolId: s.id } } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { schoolId: s.id } });
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
}

async function createTenant(label: string, opts?: { viewer?: boolean }) {
  const id = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const school = await prisma.school.create({
    data: {
      id,
      name: `Phase6E1 ${label}`,
      email: `${id}@phase6e1.test`,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(school.id);
  const passwordHash = await hashAuthPassword("Phase6E1Test!123");
  const owner = await prisma.user.create({
    data: {
      id: `${id}-owner`,
      schoolId: school.id,
      email: `owner-${id}@phase6e1.test`,
      fullName: `Owner ${label}`,
      role: "SCHOOL_ADMIN",
      isActive: true,
      passwordHash,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: owner.id },
    create: {
      userId: owner.id,
      schoolId: school.id,
      appRole: "Owner",
      permissions: {},
    },
    update: { appRole: "Owner" },
  });

  let viewer = null as null | typeof owner;
  if (opts?.viewer) {
    viewer = await prisma.user.create({
      data: {
        id: `${id}-viewer`,
        schoolId: school.id,
        email: `viewer-${id}@phase6e1.test`,
        fullName: `Viewer ${label}`,
        role: "STAFF",
        isActive: true,
        passwordHash,
      },
    });
    await prisma.userRbacMeta.upsert({
      where: { userId: viewer.id },
      create: {
        userId: viewer.id,
        schoolId: school.id,
        appRole: "Viewer",
        permissions: {
          parents: { view: false, create: false, edit: false, delete: false },
        },
      },
      update: {
        appRole: "Viewer",
        permissions: {
          parents: { view: false, create: false, edit: false, delete: false },
        },
      },
    });
  }

  const parent = await prisma.parent.create({
    data: {
      id: `${id}-parent`,
      schoolId: school.id,
      firstName: `P${label}`,
      surname: "Test",
      cellNo: `082${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`,
      email: `p-${id}@phase6e1.test`,
    },
  });

  return { school, owner, viewer, parent };
}

async function jsonFetch(
  base: string,
  path: string,
  opts?: { method?: string; headers?: Record<string, string>; body?: unknown }
) {
  const res = await fetch(`${base}${path}`, {
    method: opts?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts?.headers || {}),
    },
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data: data as Record<string, unknown> };
}

async function main() {
  assertLocalDatabase();
  await cleanup();

  const a = await createTenant("A", { viewer: true });
  const b = await createTenant("B");

  const app = express();
  app.use(express.json());
  app.use("/api/parents", requireSchoolModule("CORE"), parentsRoutes);
  app.use("/api/subscriptions", subscriptionsRoutes);
  app.use("/api/payfast", payfastRoutes);

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = `http://127.0.0.1:${addr.port}`;

  // --- /api/parents ---
  const unauth = await jsonFetch(base, `/api/parents?schoolId=${encodeURIComponent(a.school.id)}`);
  assert.ok(unauth.status === 401 || unauth.status === 403);
  console.log("✓ unauthenticated GET /api/parents denied");

  const listA = await jsonFetch(base, `/api/parents?schoolId=${encodeURIComponent(a.school.id)}`, {
    headers: { Authorization: bearer(a.owner) },
  });
  assert.strictEqual(listA.status, 200);
  const parentsA = Array.isArray(listA.data.parents) ? listA.data.parents : [];
  assert.ok(parentsA.some((p: any) => p.id === a.parent.id));
  assert.ok(!parentsA.some((p: any) => p.id === b.parent.id));
  console.log("✓ School A authorized list returns only School A parents");

  const cross = await jsonFetch(base, `/api/parents?schoolId=${encodeURIComponent(b.school.id)}`, {
    headers: { Authorization: bearer(a.owner) },
  });
  assert.ok(cross.status === 403);
  const crossParents = Array.isArray(cross.data?.parents) ? cross.data.parents : [];
  assert.strictEqual(crossParents.length, 0);
  console.log("✓ School A cannot retrieve School B parents");

  const listB = await jsonFetch(base, `/api/parents?schoolId=${encodeURIComponent(b.school.id)}`, {
    headers: { Authorization: bearer(b.owner) },
  });
  assert.strictEqual(listB.status, 200);
  const parentsB = Array.isArray(listB.data.parents) ? listB.data.parents : [];
  assert.ok(parentsB.some((p: any) => p.id === b.parent.id));
  assert.ok(!parentsB.some((p: any) => p.id === a.parent.id));
  console.log("✓ School B list returns only School B parents");

  await updateSchoolModuleEntitlements({
    schoolId: a.school.id,
    core: false,
    accounting: true,
    payroll: false,
    actor: { userId: a.owner.id, email: a.owner.email },
  });
  const coreOff = await jsonFetch(base, `/api/parents?schoolId=${encodeURIComponent(a.school.id)}`, {
    headers: { Authorization: bearer(a.owner) },
  });
  assert.strictEqual(coreOff.status, 403);
  console.log("✓ CORE=false parent list denied");

  await updateSchoolModuleEntitlements({
    schoolId: a.school.id,
    core: true,
    accounting: true,
    payroll: true,
    actor: { userId: a.owner.id, email: a.owner.email },
  });

  await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: b.school.id } });
  const missing = await jsonFetch(base, `/api/parents?schoolId=${encodeURIComponent(b.school.id)}`, {
    headers: { Authorization: bearer(b.owner) },
  });
  assert.strictEqual(missing.status, 200);
  console.log("✓ Missing entitlement rows fail-open for parent list");

  assert.ok(a.viewer);
  const noPerm = await jsonFetch(base, `/api/parents?schoolId=${encodeURIComponent(a.school.id)}`, {
    headers: { Authorization: bearer(a.viewer!) },
  });
  assert.strictEqual(noPerm.status, 403);
  console.log("✓ User lacking parents.view denied");

  // --- PayFast config disclosure ---
  const cfg = await jsonFetch(base, "/api/subscriptions/config");
  assert.strictEqual(cfg.status, 200);
  assert.ok(!("missingPayFastEnv" in (cfg.data || {})));
  const cfgText = JSON.stringify(cfg.data || {});
  assert.ok(!/PAYFAST_/i.test(cfgText));
  assert.ok("payfastConfigured" in (cfg.data || {}) || "paymentsConfigured" in (cfg.data || {}));
  assert.ok("modularCheckoutAvailable" in (cfg.data || {}));
  assert.strictEqual((cfg.data as { modularCheckoutAvailable?: boolean }).modularCheckoutAvailable, false);
  console.log("✓ school config API does not expose PAYFAST_* env names");

  // --- Legacy checkout initiation blocked; ITN route still mounted ---
  const checkout = await jsonFetch(base, "/api/payfast/create-checkout", {
    method: "POST",
    body: {
      checkoutType: "SUBSCRIPTION",
      schoolId: a.school.id,
      packageCode: "STARTER",
    },
  });
  assert.strictEqual(checkout.status, 403);
  assert.strictEqual(checkout.data.code, "LEGACY_CAPACITY_CHECKOUT_DISABLED");
  console.log("✓ legacy STARTER checkout initiation blocked");

  // --- Business label ---
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: true, PAYROLL: true }),
    "Business"
  );
  const biz = findCommercialPackageByCode("BUSINESS");
  assert.strictEqual(biz?.name, "EduClear Business");
  assert.strictEqual(biz?.shortLabel, "Business");
  assert.strictEqual(biz?.monthlyPriceZar, 1250);
  console.log("✓ 011 package identity is EduClear Business");

  // --- Employee fail-closed ---
  const coreOnly = sanitizeEmployeeForModule(
    {
      id: "e1",
      schoolId: a.school.id,
      firstName: "Ada",
      lastName: "Lovelace",
      basicSalary: 12000,
      taxNumber: "TAX",
      bankAccountNumber: "999",
      syntheticFuturePayrollField: "SECRET",
      jobTitle: "Teacher",
    },
    false
  );
  assert.strictEqual(coreOnly.basicSalary, undefined);
  assert.strictEqual(coreOnly.taxNumber, undefined);
  assert.strictEqual(coreOnly.bankAccountNumber, undefined);
  assert.strictEqual((coreOnly as any).syntheticFuturePayrollField, undefined);
  assert.strictEqual(coreOnly.firstName, "Ada");
  assert.strictEqual(coreOnly.jobTitle, "Teacher");

  const payrollOn = sanitizeEmployeeForModule(
    {
      id: "e1",
      firstName: "Ada",
      basicSalary: 12000,
      syntheticFuturePayrollField: "SECRET",
    },
    true
  );
  assert.strictEqual(payrollOn.basicSalary, 12000);
  assert.strictEqual((payrollOn as any).syntheticFuturePayrollField, undefined);

  const writeDeny = assertNoPayrollMutationWhenDisabled(
    { firstName: "A", basicSalary: 1, syntheticFuturePayrollField: "x" },
    false
  );
  assert.ok(writeDeny);
  assert.ok(writeDeny!.fields.includes("basicSalary"));
  assert.ok(writeDeny!.fields.includes("syntheticFuturePayrollField"));
  assert.ok(
    findDisallowedEmployeeMutationFields({ syntheticFuturePayrollField: "x" }, true).includes(
      "syntheticFuturePayrollField"
    )
  );
  console.log("✓ Employee sanitizer fail-closed for unknown + payroll fields");

  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
  await cleanup();
  console.log("\nAll phase6e1MediumHardening security tests passed.");
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
