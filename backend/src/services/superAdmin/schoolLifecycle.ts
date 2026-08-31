import { isPlatformSuperAdminEmail } from "../../utils/superAdmin";

export const SCHOOL_LIFECYCLE_STATUSES = ["ACTIVE", "TRIAL", "INACTIVE", "ARCHIVED"] as const;

export type SchoolLifecycleStatus = (typeof SCHOOL_LIFECYCLE_STATUSES)[number];

/** Operating production schools that must not be set INACTIVE or ARCHIVED (or TRIAL). */
export const PROTECTED_OPERATING_SCHOOL_IDS = [
  "cmpideqeq0000108xb6ouv9zi", // Da Silva Academy
  "cmq4xjckq00at60gqg4eb956h", // Magical Bright Beginnings Early Learning Centre
  "cmt1e8bjp0jo8lcjeketlynhl", // Fly Eagle Primary School
] as const;

export const LITTLE_SCIENTISTS_SCHOOL_ID = "cmq9esjfr00lxompyvbsgdxke";

export const PROTECTED_LIFECYCLE_BLOCKED: ReadonlySet<SchoolLifecycleStatus> = new Set([
  "TRIAL",
  "INACTIVE",
  "ARCHIVED",
]);

/** Only these School columns may be written by a lifecycle change. */
export const SCHOOL_LIFECYCLE_UPDATE_KEYS = [
  "lifecycleStatus",
  "lifecycleChangedAt",
  "lifecycleChangedByUserId",
  "lifecycleChangedByEmail",
] as const;

export class SchoolLifecycleError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "SchoolLifecycleError";
    this.statusCode = statusCode;
  }
}

export function isSchoolLifecycleStatus(value: unknown): value is SchoolLifecycleStatus {
  return SCHOOL_LIFECYCLE_STATUSES.includes(String(value || "").trim().toUpperCase() as SchoolLifecycleStatus);
}

/** Existing schools with a missing value default to ACTIVE. Do not infer from learners/subscription/login. */
export function parseSchoolLifecycleStatus(value: unknown): SchoolLifecycleStatus {
  if (value == null || String(value).trim() === "") return "ACTIVE";
  const normalized = String(value).trim().toUpperCase();
  if (isSchoolLifecycleStatus(normalized)) return normalized;
  throw new SchoolLifecycleError(`Invalid lifecycle status: ${String(value)}`, 400);
}

export function isProtectedOperatingSchoolId(schoolId: unknown): boolean {
  const id = String(schoolId || "").trim();
  return (PROTECTED_OPERATING_SCHOOL_IDS as readonly string[]).includes(id);
}

export function assertProtectedOperatingSchoolLifecycle(
  schoolId: string,
  next: SchoolLifecycleStatus
): void {
  if (!isProtectedOperatingSchoolId(schoolId)) return;
  if (PROTECTED_LIFECYCLE_BLOCKED.has(next)) {
    throw new SchoolLifecycleError(
      "This operating school is protected and cannot be set to TRIAL, INACTIVE, or ARCHIVED.",
      403
    );
  }
}

export function assertLifecycleActor(actor: { email?: string | null } | null | undefined): void {
  const email = String(actor?.email || "").trim();
  if (!email || !isPlatformSuperAdminEmail(email)) {
    throw new SchoolLifecycleError("Super admin access required", 403);
  }
}

/**
 * Target school is the URL param only. A mismatched body.schoolId is tenant spoofing.
 * Super Admin JWT schoolId is never used as the target (platform tenant must manage other schools).
 */
export function resolveLifecycleTargetSchoolId(paramsSchoolId: unknown, bodySchoolId: unknown): string {
  const fromParams = String(paramsSchoolId || "").trim();
  if (!fromParams) {
    throw new SchoolLifecycleError("Missing schoolId", 400);
  }
  if (bodySchoolId != null && String(bodySchoolId).trim() !== "") {
    const fromBody = String(bodySchoolId).trim();
    if (fromBody !== fromParams) {
      throw new SchoolLifecycleError("schoolId mismatch", 400);
    }
  }
  return fromParams;
}

export function defaultLifecycleStatus(): SchoolLifecycleStatus {
  return "ACTIVE";
}

export function filterSchoolsByLifecycle<T extends { lifecycleStatus: SchoolLifecycleStatus }>(
  schools: T[],
  filter: "all" | SchoolLifecycleStatus
): T[] {
  if (filter === "all") return schools.slice();
  return schools.filter((school) => school.lifecycleStatus === filter);
}

export function countSchoolsByLifecycle<T extends { lifecycleStatus: SchoolLifecycleStatus }>(
  schools: T[]
): {
  total: number;
  active: number;
  trial: number;
  inactive: number;
  archived: number;
} {
  return {
    total: schools.length,
    active: schools.filter((s) => s.lifecycleStatus === "ACTIVE").length,
    trial: schools.filter((s) => s.lifecycleStatus === "TRIAL").length,
    inactive: schools.filter((s) => s.lifecycleStatus === "INACTIVE").length,
    archived: schools.filter((s) => s.lifecycleStatus === "ARCHIVED").length,
  };
}

export function needsLifecycleConfirmation(
  from: SchoolLifecycleStatus,
  to: SchoolLifecycleStatus
): boolean {
  if (from === to) return false;
  if (to === "ARCHIVED") return true;
  if (from === "ARCHIVED") return true;
  return false;
}

export function buildLifecycleConfirmation(input: {
  schoolName: string;
  from: SchoolLifecycleStatus;
  to: SchoolLifecycleStatus;
}): { title: string; message: string; confirmLabel: string } {
  const name = String(input.schoolName || "").trim() || "this school";
  if (input.to === "ARCHIVED") {
    return {
      title: `Archive ${name}?`,
      message:
        `School: ${name}\n` +
        `Current status: ${input.from}\n` +
        `New status: ARCHIVED\n\n` +
        `The school's records will be preserved. No learners, invoices, payments or financial history will be deleted.`,
      confirmLabel: "Archive school",
    };
  }
  return {
    title: `Reactivate ${name}?`,
    message:
      `School: ${name}\n` +
      `Current status: ${input.from}\n` +
      `New status: ${input.to}\n\n` +
      `The school's records will remain preserved. No learners, invoices, payments or financial history will be deleted.`,
    confirmLabel: "Reactivate",
  };
}

export function buildLifecycleSchoolUpdateData(input: {
  lifecycleStatus: SchoolLifecycleStatus;
  actorUserId: string;
  actorEmail: string;
  changedAt?: Date;
}): Record<(typeof SCHOOL_LIFECYCLE_UPDATE_KEYS)[number], string | Date> {
  return {
    lifecycleStatus: input.lifecycleStatus,
    lifecycleChangedAt: input.changedAt ?? new Date(),
    lifecycleChangedByUserId: String(input.actorUserId || "").trim(),
    lifecycleChangedByEmail: String(input.actorEmail || "").trim(),
  };
}
