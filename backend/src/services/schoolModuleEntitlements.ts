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

const TOGGLEABLE_MODULES = new Set<ProductModule>([
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

/** Ensure CORE/ACCOUNTING/PAYROLL rows exist (all enabled). Never disables existing rows. */
export async function ensureSchoolModuleEntitlements(schoolId: string): Promise<void> {
  const id = String(schoolId || "").trim();
  if (!id) throw new SchoolModuleEntitlementError("Missing schoolId", 400);

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

  const row = await prisma.schoolModuleEntitlement.findUnique({
    where: {
      schoolId_module: { schoolId: id, module: moduleKey },
    },
    select: { enabled: true },
  });

  if (!row) return true;
  return row.enabled === true;
}

export type UpdateSchoolModuleEntitlementsInput = {
  schoolId: string;
  /** Only ACCOUNTING and PAYROLL may be changed. CORE cannot be disabled via this API. */
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
 * Super Admin update for ACCOUNTING / PAYROLL only.
 * Rejects any attempt to disable CORE (CORE stays enabled for EduClear schools).
 *
 * Architecture note (Phase 1 — not gated yet):
 * ACCOUNTING entitlement covers bookkeeping/GL/suppliers/expenses surfaces.
 * School-fee Billing (including bank import used to identify/match/post fee payments)
 * remains CORE and must not be designed as dependent on ACCOUNTING being enabled.
 */
export async function updateSchoolModuleEntitlements(
  input: UpdateSchoolModuleEntitlementsInput
): Promise<SchoolModuleEntitlementsMap> {
  const actor = assertActor(input.actor);
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) throw new SchoolModuleEntitlementError("Missing schoolId", 400);

  const hasAccounting = Object.prototype.hasOwnProperty.call(input, "accounting");
  const hasPayroll = Object.prototype.hasOwnProperty.call(input, "payroll");
  if (!hasAccounting && !hasPayroll) {
    throw new SchoolModuleEntitlementError("No module entitlement changes provided", 400);
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true },
  });
  if (!school) throw new SchoolModuleEntitlementError("School not found", 404);

  await ensureSchoolModuleEntitlements(schoolId);

  const patches: Array<{ module: ProductModule; enabled: boolean }> = [];
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

  // Explicit CORE protection: never write CORE.enabled=false from this path.
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

  // Re-assert CORE remains enabled after any entitlement write.
  await prisma.schoolModuleEntitlement.upsert({
    where: {
      schoolId_module: { schoolId, module: ProductModule.CORE },
    },
    create: {
      schoolId,
      module: ProductModule.CORE,
      enabled: true,
      updatedByUserId: actor.userId,
      updatedByEmail: actor.email,
    },
    update: {
      enabled: true,
      updatedByUserId: actor.userId,
      updatedByEmail: actor.email,
    },
  });

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
 * Reject body attempts to disable CORE via Super Admin PATCH.
 * Also reject any legacy FINANCE entitlement payload — FINANCE is not a product module.
 */
export function assertCoreNotDisabledInPatchBody(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const record = body as Record<string, unknown>;

  if (record.core === false || record.CORE === false) {
    throw new SchoolModuleEntitlementError(
      "CORE cannot be disabled. EduClear Core remains enabled for schools.",
      400
    );
  }

  const nested = record.moduleEntitlements;
  if (nested && typeof nested === "object") {
    const mods = nested as Record<string, unknown>;
    if (mods.CORE === false || mods.core === false) {
      throw new SchoolModuleEntitlementError(
        "CORE cannot be disabled. EduClear Core remains enabled for schools.",
        400
      );
    }
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
