export const SCHOOL_LIFECYCLE_STATUSES = ["ACTIVE", "TRIAL", "INACTIVE", "ARCHIVED"] as const;

export type SchoolLifecycleStatus = (typeof SCHOOL_LIFECYCLE_STATUSES)[number];

export type SchoolLifecycleFilter = "all" | SchoolLifecycleStatus;

export const DEFAULT_SCHOOL_LIFECYCLE_FILTER: SchoolLifecycleFilter = "ACTIVE";

export const PROTECTED_OPERATING_SCHOOL_IDS = [
  "cmpideqeq0000108xb6ouv9zi",
  "cmq4xjckq00at60gqg4eb956h",
  "cmt1e8bjp0jo8lcjeketlynhl",
] as const;

export const LITTLE_SCIENTISTS_SCHOOL_ID = "cmq9esjfr00lxompyvbsgdxke";

export function isSchoolLifecycleStatus(value: unknown): value is SchoolLifecycleStatus {
  return SCHOOL_LIFECYCLE_STATUSES.includes(String(value || "").trim().toUpperCase() as SchoolLifecycleStatus);
}

export function parseSchoolLifecycleStatus(value: unknown): SchoolLifecycleStatus {
  if (value == null || String(value).trim() === "") return "ACTIVE";
  const normalized = String(value).trim().toUpperCase();
  if (isSchoolLifecycleStatus(normalized)) return normalized;
  const title = String(value).trim();
  if (title === "Active") return "ACTIVE";
  if (title === "Trial") return "TRIAL";
  if (title === "Inactive") return "INACTIVE";
  if (title === "Archived") return "ARCHIVED";
  return "ACTIVE";
}

export function isProtectedOperatingSchoolId(schoolId: unknown): boolean {
  const id = String(schoolId || "").trim();
  return (PROTECTED_OPERATING_SCHOOL_IDS as readonly string[]).includes(id);
}

export function lifecycleBadgeLabel(status: SchoolLifecycleStatus): string {
  return status;
}

export function filterSchoolsByLifecycle<T extends { lifecycleStatus: SchoolLifecycleStatus }>(
  schools: T[],
  filter: SchoolLifecycleFilter
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

export function allowedLifecycleTargets(schoolId: string): SchoolLifecycleStatus[] {
  if (isProtectedOperatingSchoolId(schoolId)) return ["ACTIVE"];
  return [...SCHOOL_LIFECYCLE_STATUSES];
}
