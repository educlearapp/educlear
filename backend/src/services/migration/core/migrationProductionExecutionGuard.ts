/**
 * Production / live-school execution guard for Universal Migration writes.
 * Blocks accidental Complete/Apply against protected live tenants and requires
 * an explicit production confirmation env when running on production hosts.
 *
 * On production, writes also require an exact authorised school ID match via
 * CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID (fail-closed; no wildcards).
 *
 * Does not change billing, invoice-run, or statement calculation logic.
 */

import { isProductionRuntime } from "../../runtime";

/** Da Silva Academy (production). */
export const PROTECTED_DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

/** Fly Eagle Primary (production). */
export const PROTECTED_FLY_EAGLE_SCHOOL_ID = "cmt1e8bjp0jo8lcjeketlynhl";

export const CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV = "CONFIRM_PRODUCTION_MIGRATION_WRITE";
/** Exact database school id authorised for production migration writes (no wildcards). */
export const CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV =
  "CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID";
export const ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV = "ALLOW_PROTECTED_SCHOOL_MIGRATION";

export const MIGRATION_PRODUCTION_GUARD_BLOCKED = "MIGRATION_PRODUCTION_GUARD_BLOCKED" as const;
export const MIGRATION_PROTECTED_SCHOOL_BLOCKED = "MIGRATION_PROTECTED_SCHOOL_BLOCKED" as const;
export const MIGRATION_SCHOOL_ID_GUARD_BLOCKED = "MIGRATION_SCHOOL_ID_GUARD_BLOCKED" as const;

const PROTECTED_SCHOOLS: ReadonlyArray<{ id: string; name: string }> = [
  { id: PROTECTED_DA_SILVA_SCHOOL_ID, name: "Da Silva Academy" },
  { id: PROTECTED_FLY_EAGLE_SCHOOL_ID, name: "Fly Eagle Primary School" },
];

export function isProtectedLiveMigrationSchool(schoolId: string): boolean {
  const sid = String(schoolId || "").trim();
  return PROTECTED_SCHOOLS.some((s) => s.id === sid);
}

export function protectedLiveMigrationSchoolName(schoolId: string): string | null {
  const sid = String(schoolId || "").trim();
  return PROTECTED_SCHOOLS.find((s) => s.id === sid)?.name ?? null;
}

/** True if configured authorised id is missing, empty, or contains wildcard characters. */
export function isInvalidAuthorisedMigrationSchoolIdConfig(raw: string | undefined): boolean {
  const v = String(raw ?? "").trim();
  if (!v) return true;
  if (v.includes("*") || v.includes("?") || v.includes(",")) return true;
  return false;
}

export function readConfiguredAuthorisedMigrationSchoolId(): string | null {
  const raw = process.env[CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV];
  if (isInvalidAuthorisedMigrationSchoolIdConfig(raw)) return null;
  return String(raw).trim();
}

export type MigrationProductionGuardResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | typeof MIGRATION_PRODUCTION_GUARD_BLOCKED
        | typeof MIGRATION_PROTECTED_SCHOOL_BLOCKED
        | typeof MIGRATION_SCHOOL_ID_GUARD_BLOCKED;
      message: string;
    };

/**
 * Gate Complete / Apply (and any school-mutating migration write).
 * Local disposable schools: pass (non-production).
 * Protected live schools: require ALLOW_PROTECTED_SCHOOL_MIGRATION=true (explicit).
 * Production runtime: require BOTH
 *   CONFIRM_PRODUCTION_MIGRATION_WRITE=true AND
 *   CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID === targetSchoolId (exact).
 */
export function assertMigrationWriteAllowed(input: {
  targetSchoolId: string;
  operation: string;
}): MigrationProductionGuardResult {
  const targetSchoolId = String(input.targetSchoolId || "").trim();
  if (!targetSchoolId) {
    return {
      ok: false,
      code: MIGRATION_PRODUCTION_GUARD_BLOCKED,
      message: `${input.operation}: target school id is required.`,
    };
  }

  if (isProtectedLiveMigrationSchool(targetSchoolId)) {
    const allowProtected =
      String(process.env[ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV] || "")
        .trim()
        .toLowerCase() === "true";
    const name = protectedLiveMigrationSchoolName(targetSchoolId) || targetSchoolId;
    if (!allowProtected) {
      return {
        ok: false,
        code: MIGRATION_PROTECTED_SCHOOL_BLOCKED,
        message:
          `${MIGRATION_PROTECTED_SCHOOL_BLOCKED}: ${input.operation} refused for protected live school ` +
          `"${name}" (${targetSchoolId}). Existing records must remain untouched. ` +
          `Set ${ALLOW_PROTECTED_SCHOOL_MIGRATION_ENV}=true only for an explicitly approved migration.`,
      };
    }
  }

  if (isProductionRuntime()) {
    const confirm =
      String(process.env[CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV] || "")
        .trim()
        .toLowerCase() === "true";
    if (!confirm) {
      return {
        ok: false,
        code: MIGRATION_PRODUCTION_GUARD_BLOCKED,
        message:
          `${MIGRATION_PRODUCTION_GUARD_BLOCKED}: ${input.operation} refused on production without ` +
          `${CONFIRM_PRODUCTION_MIGRATION_WRITE_ENV}=true. No school writes occurred.`,
      };
    }

    const authorisedSchoolId = readConfiguredAuthorisedMigrationSchoolId();
    if (!authorisedSchoolId) {
      return {
        ok: false,
        code: MIGRATION_SCHOOL_ID_GUARD_BLOCKED,
        message:
          `${MIGRATION_SCHOOL_ID_GUARD_BLOCKED}: ${input.operation} refused on production without a valid exact ` +
          `${CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV} (missing, empty, or wildcard). No school writes occurred.`,
      };
    }

    if (authorisedSchoolId !== targetSchoolId) {
      return {
        ok: false,
        code: MIGRATION_SCHOOL_ID_GUARD_BLOCKED,
        message:
          `${MIGRATION_SCHOOL_ID_GUARD_BLOCKED}: ${input.operation} refused — destination school ` +
          `"${targetSchoolId}" does not match authorised ${CONFIRM_PRODUCTION_MIGRATION_SCHOOL_ID_ENV}. ` +
          `No school writes occurred.`,
      };
    }
  }

  return { ok: true };
}

export function requireMigrationWriteAllowed(input: {
  targetSchoolId: string;
  operation: string;
}): void {
  const result = assertMigrationWriteAllowed(input);
  if (!result.ok) {
    throw new Error(result.message);
  }
}
