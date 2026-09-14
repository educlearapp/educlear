import { ProductModule, type SchoolModuleEntitlement } from "@prisma/client";

import { prisma } from "../prisma";

export const PRODUCT_MODULES = [
  ProductModule.CORE,
  ProductModule.ACCOUNTING,
  ProductModule.PAYROLL,
] as const;

export type ProductModuleKey = (typeof PRODUCT_MODULES)[number];

export type SchoolModuleEntitlementsMap = {
  CORE: boolean;
  ACCOUNTING: boolean;
  PAYROLL: boolean;
};

export type SchoolModuleEntitlementActor = {
  userId: string;
  email: string;
};

export class SchoolModuleEntitlementError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "SchoolModuleEntitlementError";
    this.statusCode = statusCode;
  }
}

/** All three commercial modules may be toggled by Super Admin. */
const TOGGLEABLE_MODULES = new Set<ProductModule>([
  ProductModule.CORE,
  ProductModule.ACCOUNTING,
  ProductModule.PAYROLL,
]);

function emptyEntitlementsMap(allEnabled = true): SchoolModuleEntitlementsMap {
  return {
    CORE: allEnabled,
    ACCOUNTING: allEnabled,
    PAYROLL: allEnabled,
  };
}

function rowsToMap(
  rows: Pick<SchoolModuleEntitlement, "module" | "enabled">[]
): SchoolModuleEntitlementsMap {
  // Fail-open: missing rows count as enabled so phased rollout cannot silently strip modules.
  const map = emptyEntitlementsMap(true);
  for (const row of rows) {
    if (row.module === ProductModule.CORE) map.CORE = row.enabled;
    else if (row.module === ProductModule.ACCOUNTING) map.ACCOUNTING = row.enabled;
    else if (row.module === ProductModule.PAYROLL) map.PAYROLL = row.enabled;
  }
  return map;
}

export function hasAnyCommercialModule(map: SchoolModuleEntitlementsMap): boolean {
  return map.CORE === true || map.ACCOUNTING === true || map.PAYROLL === true;
}

/**
 * Deterministic commercial package label from entitlement flags.
 * 000 → "Invalid / No modules"
 */
export function describeModulePackageLabel(map: SchoolModuleEntitlementsMap): string {
  const c = map.CORE === true;
  const a = map.ACCOUNTING === true;
  const p = map.PAYROLL === true;
  if (c && a && p) return "Full";
  if (!c && a && p) return "Accounting + Payroll";
  if (c && a && !p) return "Core + Accounting";
  if (c && !a && p) return "Core + Payroll";
  if (c && !a && !p) return "Core";
  if (!c && a && !p) return "Accounting";
  if (!c && !a && p) return "Payroll";
  return "Invalid / No modules";
}

/** Ensure CORE/ACCOUNTING/PAYROLL rows exist. Missing → enabled=true. Existing rows unchanged. */
export async function ensureSchoolModuleEntitlements(schoolId: string): Promise<void> {
  const id = String(schoolId || "").trim();
  if (!id) throw new SchoolModuleEntitlementError("Missing schoolId", 400);

  try {
    const existing = await prisma.schoolModuleEntitlement.findMany({
      where: { schoolId: id },
      select: { module: true },
    });
    const have = new Set(existing.map((row) => row.module));
    const missing = PRODUCT_MODULES.filter((module) => !have.has(module));
    if (!missing.length) return;

    await prisma.schoolModuleEntitlement.createMany({
      data: missing.map((module) => ({
        schoolId: id,
        module,
        enabled: true,
      })),
      skipDuplicates: true,
    });
  } catch (error) {
    console.warn(
      "[schoolModuleEntitlements] ensureSchoolModuleEntitlements skipped after error:",
      error instanceof Error ? error.message : error
    );
  }
}

/** Read entitlements for a school. Ensures default all-on rows if any are missing. */
export async function getSchoolModuleEntitlements(
  schoolId: string
): Promise<SchoolModuleEntitlementsMap> {
  const id = String(schoolId || "").trim();
  if (!id) throw new SchoolModuleEntitlementError("Missing schoolId", 400);

  await ensureSchoolModuleEntitlements(id);

  const rows = await prisma.schoolModuleEntitlement.findMany({
    where: { schoolId: id },
    select: { module: true, enabled: true },
  });
  return rowsToMap(rows);
}

/** Whether a product module is enabled for the school. Missing row = enabled (fail-open). */
export async function isSchoolModuleEnabled(
  schoolId: string,
  module: ProductModule | ProductModuleKey | string
): Promise<boolean> {
  const id = String(schoolId || "").trim();
  if (!id) throw new SchoolModuleEntitlementError("Missing schoolId", 400);

  const moduleKey = String(module || "").trim().toUpperCase() as ProductModule;
  if (!PRODUCT_MODULES.includes(moduleKey as ProductModuleKey)) {
    throw new SchoolModuleEntitlementError(`Unknown product module: ${module}`, 400);
  }

  try {
    const row = await prisma.schoolModuleEntitlement.findUnique({
      where: {
        schoolId_module: { schoolId: id, module: moduleKey },
      },
      select: { enabled: true },
    });

    if (!row) return true;
    return row.enabled === true;
  } catch (error) {
    // Pre-migration / missing table: fail-open so Core Billing and employee CRUD stay available.
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code || "")
        : "";
    if (code !== "P2021") {
      console.warn(
        "[schoolModuleEntitlements] isSchoolModuleEnabled fail-open after read error:",
        error instanceof Error ? error.message : error
      );
    }
    return true;
  }
}

export type UpdateSchoolModuleEntitlementsInput = {
  schoolId: string;
  /** Optional partial patch. Resulting state after merge must not be 000. */
  core?: boolean;
  accounting?: boolean;
  payroll?: boolean;
  actor: SchoolModuleEntitlementActor | null | undefined;
};

function assertActor(
  actor: SchoolModuleEntitlementActor | null | undefined
): SchoolModuleEntitlementActor {
  const userId = String(actor?.userId || "").trim();
  const email = String(actor?.email || "").trim().toLowerCase();
  if (!userId || !email) {
    throw new SchoolModuleEntitlementError(
      "Super admin actor required to update module entitlements",
      403
    );
  }
  return { userId, email };
}

/**
 * Super Admin update for CORE / ACCOUNTING / PAYROLL.
 * Partial patches merge onto current state; resulting 000 is rejected.
 *
 * Architecture note:
 * ACCOUNTING covers bookkeeping/GL/suppliers/expenses.
 * School-fee Billing remains CORE (surface gating is a later phase).
 */
export async function updateSchoolModuleEntitlements(
  input: UpdateSchoolModuleEntitlementsInput
): Promise<SchoolModuleEntitlementsMap> {
  const actor = assertActor(input.actor);
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new SchoolModuleEntitlementError("Missing schoolId", 400);

  const hasCore = Object.prototype.hasOwnProperty.call(input, "core");
  const hasAccounting = Object.prototype.hasOwnProperty.call(input, "accounting");
  const hasPayroll = Object.prototype.hasOwnProperty.call(input, "payroll");
  if (!hasCore && !hasAccounting && !hasPayroll) {
    throw new SchoolModuleEntitlementError("No module entitlement changes provided", 400);
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });
  if (!school) throw new SchoolModuleEntitlementError("School not found", 404);

  await ensureSchoolModuleEntitlements(schoolId);
  const current = await getSchoolModuleEntitlements(schoolId);

  const patches: Array<{ module: ProductModule; enabled: boolean }> = [];
  if (hasCore) {
    if (typeof input.core !== "boolean") {
      throw new SchoolModuleEntitlementError("core must be a boolean", 400);
    }
    patches.push({ module: ProductModule.CORE, enabled: input.core });
  }
  if (hasAccounting) {
    if (typeof input.accounting !== "boolean") {
      throw new SchoolModuleEntitlementError("accounting must be a boolean", 400);
    }
    patches.push({ module: ProductModule.ACCOUNTING, enabled: input.accounting });
  }
  if (hasPayroll) {
    if (typeof input.payroll !== "boolean") {
      throw new SchoolModuleEntitlementError("payroll must be a boolean", 400);
    }
    patches.push({ module: ProductModule.PAYROLL, enabled: input.payroll });
  }

  for (const patch of patches) {
    if (!TOGGLEABLE_MODULES.has(patch.module)) {
      throw new SchoolModuleEntitlementError(
        `${patch.module} cannot be changed through the normal Super Admin entitlement controls`,
        400
      );
    }
  }

  const resulting: SchoolModuleEntitlementsMap = { ...current };
  for (const patch of patches) {
    if (patch.module === ProductModule.CORE) resulting.CORE = patch.enabled;
    else if (patch.module === ProductModule.ACCOUNTING) resulting.ACCOUNTING = patch.enabled;
    else if (patch.module === ProductModule.PAYROLL) resulting.PAYROLL = patch.enabled;
  }

  if (!hasAnyCommercialModule(resulting)) {
    throw new SchoolModuleEntitlementError(
      "At least one commercial module (CORE, ACCOUNTING, or PAYROLL) must remain enabled.",
      400
    );
  }

  await prisma.$transaction(
    patches.map((patch) =>
      prisma.schoolModuleEntitlement.upsert({
        where: {
          schoolId_module: { schoolId, module: patch.module },
        },
        create: {
          schoolId,
          module: patch.module,
          enabled: patch.enabled,
          updatedByUserId: actor.userId,
          updatedByEmail: actor.email,
        },
        update: {
          enabled: patch.enabled,
          updatedByUserId: actor.userId,
          updatedByEmail: actor.email,
        },
      })
    )
  );

  return getSchoolModuleEntitlements(schoolId);
}

/** Map many schools' entitlement rows without per-school round trips (list endpoint). */
export function mapEntitlementRowsBySchool(
  rows: Array<{ schoolId: string; module: ProductModule; enabled: boolean }>
): Map<string, SchoolModuleEntitlementsMap> {
  const bySchool = new Map<string, SchoolModuleEntitlementsMap>();
  for (const row of rows) {
    let map = bySchool.get(row.schoolId);
    if (!map) {
      map = emptyEntitlementsMap(true);
      bySchool.set(row.schoolId, map);
    }
    if (row.module === ProductModule.CORE) map.CORE = row.enabled;
    else if (row.module === ProductModule.ACCOUNTING) map.ACCOUNTING = row.enabled;
    else if (row.module === ProductModule.PAYROLL) map.PAYROLL = row.enabled;
  }
  return bySchool;
}

export function defaultAllEnabledEntitlements(): SchoolModuleEntitlementsMap {
  return emptyEntitlementsMap(true);
}

/**
 * Reject invalid Super Admin module entitlement payload shapes.
 * Allows CORE=false. Rejects FINANCE (not a product module).
 * All-off (000) is validated against resulting state in updateSchoolModuleEntitlements.
 */
export function assertModuleEntitlementPatchBody(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const record = body as Record<string, unknown>;

  const nested = record.moduleEntitlements;
  if (nested && typeof nested === "object") {
    const mods = nested as Record<string, unknown>;
    if (
      Object.prototype.hasOwnProperty.call(mods, "FINANCE") ||
      Object.prototype.hasOwnProperty.call(mods, "finance")
    ) {
      throw new SchoolModuleEntitlementError(
        "FINANCE is not a product module. Use ACCOUNTING for optional bookkeeping; Billing remains part of CORE.",
        400
      );
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(record, "finance") ||
    Object.prototype.hasOwnProperty.call(record, "FINANCE")
  ) {
    throw new SchoolModuleEntitlementError(
      "FINANCE is not a product module. Use ACCOUNTING for optional bookkeeping; Billing remains part of CORE.",
      400
    );
  }
}

/** @deprecated Use assertModuleEntitlementPatchBody — CORE may now be disabled when another module remains on. */
export function assertCoreNotDisabledInPatchBody(body: unknown): void {
  assertModuleEntitlementPatchBody(body);
}
