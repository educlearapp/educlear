/**
 * EduClear Core Phase 1 — school module entitlements (mocked DB).
 * Run: npx tsx src/services/schoolModuleEntitlements.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import { isAuthenticatedSuperAdminEmail, requireSuperAdmin } from "../middleware/requireSuperAdmin";
import superAdminSchoolsRoutes from "../routes/superAdminSchools";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { prisma } from "../prisma";
import {
  PRODUCT_MODULES,
  assertModuleEntitlementPatchBody,
  defaultAllEnabledEntitlements,
  describeModulePackageLabel,
  ensureSchoolModuleEntitlements,
  getSchoolModuleEntitlements,
  hasAnyCommercialModule,
  isSchoolModuleEnabled,
  mapEntitlementRowsBySchool,
  SchoolModuleEntitlementError,
  updateSchoolModuleEntitlements,
} from "./schoolModuleEntitlements";

type EntitlementRow = {
  id: string;
  schoolId: string;
  module: "CORE" | "ACCOUNTING" | "PAYROLL";
  enabled: boolean;
  updatedByUserId: string | null;
  updatedByEmail: string | null;
};

const SCHOOL_A = "school-entitlement-a";
const SCHOOL_B = "school-entitlement-b";
const SUPER_ADMIN_USER_ID = "user-super-admin";
const NON_ADMIN_USER_ID = "user-school-owner";

function mockEntitlementStore(initial: EntitlementRow[] = []) {
  const rows: EntitlementRow[] = initial.map((r) => ({ ...r }));
  let idSeq = 1;

  const store = {
    rows,
    school: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === SCHOOL_A || where.id === SCHOOL_B) return { id: where.id };
        return null;
      },
      findMany: async () => [],
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id === SUPER_ADMIN_USER_ID) {
          return {
            id: SUPER_ADMIN_USER_ID,
            schoolId: SCHOOL_A,
            email: "info@educlear.co.za",
            role: "SCHOOL_ADMIN",
            isActive: true,
          };
        }
        if (where.id === NON_ADMIN_USER_ID) {
          return {
            id: NON_ADMIN_USER_ID,
            schoolId: SCHOOL_A,
            email: "owner@school.example",
            role: "SCHOOL_ADMIN",
            isActive: true,
          };
        }
        return null;
      },
    },
    schoolModuleEntitlement: {
      findMany: async ({
        where,
        select,
      }: {
        where?: { schoolId?: string | { in: string[] } };
        select?: Record<string, boolean>;
      }) => {
        let matched = rows;
        if (where?.schoolId) {
          if (typeof where.schoolId === "string") {
            matched = rows.filter((r) => r.schoolId === where.schoolId);
          } else if (where.schoolId.in) {
            const set = new Set(where.schoolId.in);
            matched = rows.filter((r) => set.has(r.schoolId));
          }
        }
        if (!select) return matched.map((r) => ({ ...r }));
        return matched.map((r) => {
          const out: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) out[key] = (r as Record<string, unknown>)[key];
          }
          return out;
        });
      },
      findUnique: async ({
        where,
      }: {
        where: { schoolId_module: { schoolId: string; module: EntitlementRow["module"] } };
      }) => {
        const key = where.schoolId_module;
        return (
          rows.find((r) => r.schoolId === key.schoolId && r.module === key.module) || null
        );
      },
      createMany: async ({
        data,
        skipDuplicates,
      }: {
        data: Array<{ schoolId: string; module: EntitlementRow["module"]; enabled: boolean }>;
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const item of data) {
          const exists = rows.some(
            (r) => r.schoolId === item.schoolId && r.module === item.module
          );
          if (exists && skipDuplicates) continue;
          if (exists) throw new Error("duplicate entitlement");
          rows.push({
            id: `ent-${idSeq++}`,
            schoolId: item.schoolId,
            module: item.module,
            enabled: item.enabled,
            updatedByUserId: null,
            updatedByEmail: null,
          });
          count += 1;
        }
        return { count };
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { schoolId_module: { schoolId: string; module: EntitlementRow["module"] } };
        create: {
          schoolId: string;
          module: EntitlementRow["module"];
          enabled: boolean;
          updatedByUserId?: string | null;
          updatedByEmail?: string | null;
        };
        update: {
          enabled: boolean;
          updatedByUserId?: string | null;
          updatedByEmail?: string | null;
        };
      }) => {
        const key = where.schoolId_module;
        const existing = rows.find(
          (r) => r.schoolId === key.schoolId && r.module === key.module
        );
        if (existing) {
          existing.enabled = update.enabled;
          existing.updatedByUserId = update.updatedByUserId ?? null;
          existing.updatedByEmail = update.updatedByEmail ?? null;
          return { ...existing };
        }
        const created: EntitlementRow = {
          id: `ent-${idSeq++}`,
          schoolId: create.schoolId,
          module: create.module,
          enabled: create.enabled,
          updatedByUserId: create.updatedByUserId ?? null,
          updatedByEmail: create.updatedByEmail ?? null,
        };
        rows.push(created);
        return { ...created };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
    schoolSubscription: {
      findUnique: async () => null,
      upsert: async () => {
        throw new Error("subscription must not be rewritten by entitlement tests");
      },
    },
  };

  return store;
}

async function expectReject(fn: () => Promise<unknown>, status: number, messagePart: string) {
  try {
    await fn();
    throw new Error("expected rejection");
  } catch (error) {
    assert.ok(error instanceof SchoolModuleEntitlementError, String(error));
    assert.strictEqual(error.statusCode, status, error.message);
    assert.match(error.message, new RegExp(messagePart, "i"));
  }
}

async function startAuthServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/super-admin/schools", requireSuperAdmin, superAdminSchoolsRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    baseUrl: `http://127.0.0.1:${port}/api/super-admin/schools`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

function signToken(userId: string) {
  return jwt.sign({ userId, schoolId: SCHOOL_A, role: "SCHOOL_ADMIN" }, STAFF_JWT_SECRET);
}

async function main() {
  // --- ProductModule shape / no FINANCE entitlement ---
  assert.deepStrictEqual([...PRODUCT_MODULES], ["CORE", "ACCOUNTING", "PAYROLL"]);
  assert.ok(!PRODUCT_MODULES.includes("FINANCE" as never));

  const schemaPath = path.join(__dirname, "../../prisma/schema.prisma");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const productModuleBlock = schema.match(/enum ProductModule \{([\s\S]*?)\}/);
  assert.ok(productModuleBlock, "ProductModule enum missing from schema");
  const enumBody = productModuleBlock![1];
  assert.match(enumBody, /\bCORE\b/);
  assert.match(enumBody, /\bACCOUNTING\b/);
  assert.match(enumBody, /\bPAYROLL\b/);
  assert.ok(!/\bFINANCE\b/.test(enumBody), "ProductModule must not include FINANCE");

  const migrationPath = path.join(
    __dirname,
    "../../prisma/migrations/20260914130000_school_module_entitlements/migration.sql"
  );
  const migrationSql = fs.readFileSync(migrationPath, "utf8");
  assert.match(migrationSql, /CREATE TYPE "ProductModule" AS ENUM \('CORE', 'ACCOUNTING', 'PAYROLL'\)/);
  assert.match(migrationSql, /VALUES \('CORE'\), \('ACCOUNTING'\), \('PAYROLL'\)/);
  assert.match(migrationSql, /enabled[\s\S]*true/i);
  assert.ok(
    !/AS ENUM \([^)]*FINANCE/.test(migrationSql),
    "ProductModule enum must not include FINANCE"
  );
  assert.ok(!/VALUES \([^)]*'FINANCE'/.test(migrationSql), "backfill must not insert FINANCE");
  assert.match(migrationSql, /FROM "School" s/);
  assert.match(migrationSql, /ON CONFLICT \("schoolId", "module"\) DO NOTHING/);

  // --- missing-row fail-open / ensure all-on backfill behaviour ---
  const emptyStore = mockEntitlementStore([]);
  Object.assign(prisma, emptyStore);

  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "ACCOUNTING"), true);
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "PAYROLL"), true);
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "CORE"), true);

  await ensureSchoolModuleEntitlements(SCHOOL_A);
  assert.strictEqual(emptyStore.rows.length, 3);
  assert.deepStrictEqual(
    emptyStore.rows
      .filter((r) => r.schoolId === SCHOOL_A)
      .map((r) => [r.module, r.enabled])
      .sort(),
    [
      ["ACCOUNTING", true],
      ["CORE", true],
      ["PAYROLL", true],
    ]
  );

  const afterEnsure = await getSchoolModuleEntitlements(SCHOOL_A);
  assert.deepStrictEqual(afterEnsure, defaultAllEnabledEntitlements());

  // Explicit CORE=false vs missing CORE row
  const coreRow = emptyStore.rows.find((r) => r.schoolId === SCHOOL_A && r.module === "CORE");
  assert.ok(coreRow);
  coreRow!.enabled = false;
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "CORE"), false);
  const coreIdx = emptyStore.rows.findIndex((r) => r.schoolId === SCHOOL_A && r.module === "CORE");
  assert.ok(coreIdx >= 0);
  emptyStore.rows.splice(coreIdx, 1);
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "CORE"), true, "missing CORE row fail-opens");
  await ensureSchoolModuleEntitlements(SCHOOL_A);
  const restoredCore = emptyStore.rows.find((r) => r.schoolId === SCHOOL_A && r.module === "CORE");
  assert.ok(restoredCore);
  assert.strictEqual(restoredCore!.enabled, true, "ensure creates missing CORE enabled=true");
  // Do not flip existing false when other modules missing: set CORE false, delete PAYROLL, ensure
  restoredCore!.enabled = false;
  const payIdx = emptyStore.rows.findIndex((r) => r.schoolId === SCHOOL_A && r.module === "PAYROLL");
  assert.ok(payIdx >= 0);
  emptyStore.rows.splice(payIdx, 1);
  await ensureSchoolModuleEntitlements(SCHOOL_A);
  assert.strictEqual(
    emptyStore.rows.find((r) => r.schoolId === SCHOOL_A && r.module === "CORE")!.enabled,
    false,
    "ensure must not overwrite CORE=false when filling missing modules"
  );
  assert.strictEqual(
    emptyStore.rows.find((r) => r.schoolId === SCHOOL_A && r.module === "PAYROLL")!.enabled,
    true
  );
  // Restore Full for subsequent toggle tests
  for (const row of emptyStore.rows.filter((r) => r.schoolId === SCHOOL_A)) {
    row.enabled = true;
  }
  // --- Accounting / Payroll / CORE toggles + 000 rejection ---
  const toggled = await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    accounting: false,
    payroll: false,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.deepStrictEqual(toggled, {
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: false,
  });
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "CORE"), true);
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "ACCOUNTING"), false);
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "PAYROLL"), false);
  assert.strictEqual(describeModulePackageLabel(toggled), "Core");

  // ensure must NOT overwrite explicit CORE=false
  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    core: false,
    accounting: true,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "CORE"), false);
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "ACCOUNTING"), true);
  await ensureSchoolModuleEntitlements(SCHOOL_A);
  assert.strictEqual(await isSchoolModuleEnabled(SCHOOL_A, "CORE"), false, "ensure must preserve CORE=false");
  assert.deepStrictEqual(await getSchoolModuleEntitlements(SCHOOL_A), {
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  assert.strictEqual(
    describeModulePackageLabel(await getSchoolModuleEntitlements(SCHOOL_A)),
    "Accounting"
  );

  // Valid standalone / combo packages
  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    core: false,
    accounting: false,
    payroll: true,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.deepStrictEqual(await getSchoolModuleEntitlements(SCHOOL_A), {
    CORE: false,
    ACCOUNTING: false,
    PAYROLL: true,
  });
  assert.strictEqual(describeModulePackageLabel(await getSchoolModuleEntitlements(SCHOOL_A)), "Payroll");

  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    accounting: true,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.deepStrictEqual(await getSchoolModuleEntitlements(SCHOOL_A), {
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: true,
  });
  assert.strictEqual(
    describeModulePackageLabel(await getSchoolModuleEntitlements(SCHOOL_A)),
    "Accounting + Payroll"
  );

  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    core: true,
    accounting: true,
    payroll: false,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.strictEqual(describeModulePackageLabel(await getSchoolModuleEntitlements(SCHOOL_A)), "Core + Accounting");

  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    accounting: false,
    payroll: true,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.strictEqual(describeModulePackageLabel(await getSchoolModuleEntitlements(SCHOOL_A)), "Core + Payroll");

  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    accounting: true,
    payroll: true,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.strictEqual(describeModulePackageLabel(await getSchoolModuleEntitlements(SCHOOL_A)), "Full");

  // Exhaustive package labels (8 combinations)
  assert.strictEqual(
    describeModulePackageLabel({ CORE: true, ACCOUNTING: false, PAYROLL: false }),
    "Core"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: true, PAYROLL: false }),
    "Accounting"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: false, PAYROLL: true }),
    "Payroll"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: true, PAYROLL: true }),
    "Accounting + Payroll"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: true, ACCOUNTING: true, PAYROLL: false }),
    "Core + Accounting"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: true, ACCOUNTING: false, PAYROLL: true }),
    "Core + Payroll"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: true, ACCOUNTING: true, PAYROLL: true }),
    "Full"
  );
  assert.strictEqual(
    describeModulePackageLabel({ CORE: false, ACCOUNTING: false, PAYROLL: false }),
    "Invalid / No modules"
  );
  assert.strictEqual(hasAnyCommercialModule({ CORE: false, ACCOUNTING: false, PAYROLL: false }), false);

  // Core-only → CORE=false partial PATCH must reject (resulting 000)
  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    core: true,
    accounting: false,
    payroll: false,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  await expectReject(
    () =>
      updateSchoolModuleEntitlements({
        schoolId: SCHOOL_A,
        core: false,
        actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
      }),
    400,
    "at least one commercial module"
  );
  assert.deepStrictEqual(await getSchoolModuleEntitlements(SCHOOL_A), {
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: false,
  });

  // Explicit 000 rejected
  await expectReject(
    () =>
      updateSchoolModuleEntitlements({
        schoolId: SCHOOL_A,
        core: false,
        accounting: false,
        payroll: false,
        actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
      }),
    400,
    "at least one commercial module"
  );

  const reEnabled = await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    accounting: true,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  assert.strictEqual(reEnabled.ACCOUNTING, true);
  assert.strictEqual(reEnabled.PAYROLL, false);
  assert.strictEqual(reEnabled.CORE, true);

  await expectReject(
    () =>
      updateSchoolModuleEntitlements({
        schoolId: SCHOOL_A,
        actor: null,
        accounting: false,
      }),
    403,
    "actor required"
  );

  assert.doesNotThrow(() =>
    assertModuleEntitlementPatchBody({ moduleEntitlements: { CORE: false } })
  );
  assert.throws(
    () => assertModuleEntitlementPatchBody({ moduleEntitlements: { FINANCE: false } }),
    (err: unknown) =>
      err instanceof SchoolModuleEntitlementError &&
      err.statusCode === 400 &&
      /FINANCE is not a product module/i.test(err.message)
  );

  // --- school isolation ---
  // Restore A to Core+Accounting for isolation assertions (HTTP section mutates further).
  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_A,
    core: true,
    accounting: true,
    payroll: false,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  await ensureSchoolModuleEntitlements(SCHOOL_B);
  await updateSchoolModuleEntitlements({
    schoolId: SCHOOL_B,
    accounting: false,
    payroll: true,
    actor: { userId: SUPER_ADMIN_USER_ID, email: "info@educlear.co.za" },
  });
  const a = await getSchoolModuleEntitlements(SCHOOL_A);
  const b = await getSchoolModuleEntitlements(SCHOOL_B);
  assert.strictEqual(a.ACCOUNTING, true);
  assert.strictEqual(a.PAYROLL, false);
  assert.strictEqual(b.ACCOUNTING, false);
  assert.strictEqual(b.PAYROLL, true);
  assert.strictEqual(a.CORE, true);
  assert.strictEqual(b.CORE, true);

  const mapped = mapEntitlementRowsBySchool(
    emptyStore.rows.map((r) => ({
      schoolId: r.schoolId,
      module: r.module as "CORE" | "ACCOUNTING" | "PAYROLL",
      enabled: r.enabled,
    }))
  );
  assert.deepStrictEqual(mapped.get(SCHOOL_A), a);
  assert.deepStrictEqual(mapped.get(SCHOOL_B), b);

  // --- HTTP: unauthorized rejection + Super Admin accepted mutation ---
  assert.strictEqual(isAuthenticatedSuperAdminEmail("info@educlear.co.za"), true);
  assert.strictEqual(isAuthenticatedSuperAdminEmail("owner@school.example"), false);

  const server = await startAuthServer();
  try {
    const unauth = await fetch(`${server.baseUrl}/${SCHOOL_A}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ moduleEntitlements: { ACCOUNTING: false } }),
    });
    assert.strictEqual(unauth.status, 401);

    const nonAdmin = await fetch(`${server.baseUrl}/${SCHOOL_A}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(NON_ADMIN_USER_ID)}`,
      },
      body: JSON.stringify({ moduleEntitlements: { ACCOUNTING: false } }),
    });
    assert.strictEqual(nonAdmin.status, 403);

    const financeReject = await fetch(`${server.baseUrl}/${SCHOOL_A}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(SUPER_ADMIN_USER_ID)}`,
      },
      body: JSON.stringify({ moduleEntitlements: { FINANCE: false } }),
    });
    assert.strictEqual(financeReject.status, 400);
    const financeBody = (await financeReject.json()) as { error?: string };
    assert.match(String(financeBody.error || ""), /FINANCE is not a product module/i);

    // CORE=false with ACCOUNTING still on → Accounting-only OK
    const coreOffAccOn = await fetch(`${server.baseUrl}/${SCHOOL_A}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(SUPER_ADMIN_USER_ID)}`,
      },
      body: JSON.stringify({ moduleEntitlements: { CORE: false } }),
    });
    assert.strictEqual(coreOffAccOn.status, 200);
    const coreOffBody = (await coreOffAccOn.json()) as {
      success?: boolean;
      moduleEntitlements?: { CORE: boolean; ACCOUNTING: boolean; PAYROLL: boolean };
    };
    assert.strictEqual(coreOffBody.success, true);
    assert.deepStrictEqual(coreOffBody.moduleEntitlements, {
      CORE: false,
      ACCOUNTING: true,
      PAYROLL: false,
    });

    // partial PATCH cannot produce 000 (Accounting-only → CORE stays false, ACC off)
    const zeroReject = await fetch(`${server.baseUrl}/${SCHOOL_A}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(SUPER_ADMIN_USER_ID)}`,
      },
      body: JSON.stringify({ moduleEntitlements: { ACCOUNTING: false } }),
    });
    assert.strictEqual(zeroReject.status, 400);
    const zeroBody = (await zeroReject.json()) as { error?: string };
    assert.match(String(zeroBody.error || ""), /at least one commercial module/i);
    assert.deepStrictEqual(await getSchoolModuleEntitlements(SCHOOL_A), {
      CORE: false,
      ACCOUNTING: true,
      PAYROLL: false,
    });

    const ok = await fetch(`${server.baseUrl}/${SCHOOL_A}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(SUPER_ADMIN_USER_ID)}`,
      },
      body: JSON.stringify({ moduleEntitlements: { CORE: true, ACCOUNTING: false, PAYROLL: true } }),
    });
    assert.strictEqual(ok.status, 200);
    const okBody = (await ok.json()) as {
      success?: boolean;
      moduleEntitlements?: { CORE: boolean; ACCOUNTING: boolean; PAYROLL: boolean };
    };
    assert.strictEqual(okBody.success, true);
    assert.deepStrictEqual(okBody.moduleEntitlements, {
      CORE: true,
      ACCOUNTING: false,
      PAYROLL: true,
    });

    // Package-only update still accepted (subscription path unchanged / not rewritten by entitlements).
    // With no package change needed here, ensure entitlement-only path does not require package.
    const payrollOnly = await fetch(`${server.baseUrl}/${SCHOOL_B}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${signToken(SUPER_ADMIN_USER_ID)}`,
      },
      body: JSON.stringify({ moduleEntitlements: { PAYROLL: false } }),
    });
    assert.strictEqual(payrollOnly.status, 200);
  } finally {
    await server.close();
  }

  console.log("✓ schoolModuleEntitlements.unit.test.ts passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
