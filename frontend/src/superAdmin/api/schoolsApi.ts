import { superAdminApiFetch } from "../superAdminApi";
import type { SchoolPackage, SchoolRecord, SchoolsSummary } from "../types/schools";
import { parseSchoolLifecycleStatus, type SchoolLifecycleStatus } from "../schoolLifecycle";

type ApiSchoolRow = {
  id?: string;
  schoolName?: string;
  ownerName?: string;
  ownerEmail?: string;
  email?: string;
  contactPhone?: string | null;
  package?: string;
  lifecycleStatus?: string;
  status?: string;
  learnerCount?: number;
  parentCount?: number;
  registeredAt?: string | null;
  lastLoginAt?: string | null;
  isActive?: boolean;
};

type ApiSchoolsResponse = {
  schools?: ApiSchoolRow[];
  summary?: Partial<SchoolsSummary>;
};

const KNOWN_PACKAGES = new Set<string>(["Starter", "Unlimited"]);

function asPackage(value: unknown): SchoolPackage {
  const label = String(value || "").trim();
  if (!label || label === "—") return "—";
  if (KNOWN_PACKAGES.has(label)) return label as SchoolPackage;
  if (label.toLowerCase() === "unlimited") return "Unlimited";
  if (label.toLowerCase() === "starter") return "Starter";
  return label;
}

function mapSchoolRow(row: ApiSchoolRow, sessionSchoolId: string | null): SchoolRecord {
  const id = String(row.id || "").trim();
  const ownerEmail = String(row.ownerEmail || row.email || "").trim();
  const contactRaw = row.contactPhone != null ? String(row.contactPhone).trim() : "";
  const lifecycleStatus = parseSchoolLifecycleStatus(row.lifecycleStatus ?? row.status);
  return {
    id,
    schoolName: String(row.schoolName || "—").trim() || "—",
    ownerName: String(row.ownerName || ownerEmail || "—").trim() || "—",
    email: ownerEmail || "—",
    contactPhone: contactRaw || null,
    package: asPackage(row.package),
    lifecycleStatus,
    status: lifecycleStatus,
    learnerCount: Number.isFinite(row.learnerCount) ? Number(row.learnerCount) : 0,
    parentCount: Number.isFinite(row.parentCount) ? Number(row.parentCount) : 0,
    registeredAt: row.registeredAt ? String(row.registeredAt) : null,
    lastLoginAt: row.lastLoginAt ? String(row.lastLoginAt) : null,
    isActive: row.isActive !== false,
    canOpenDashboard: Boolean(sessionSchoolId && id && sessionSchoolId === id),
  };
}

function emptySummary(): SchoolsSummary {
  return { total: 0, active: 0, trial: 0, inactive: 0, archived: 0 };
}

export async function fetchSuperAdminSchools(): Promise<{
  schools: SchoolRecord[];
  summary: SchoolsSummary;
}> {
  const sessionSchoolId = localStorage.getItem("schoolId");
  let data: ApiSchoolsResponse;
  try {
    data = (await superAdminApiFetch("/api/super-admin/schools")) as ApiSchoolsResponse;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Could not load registered schools.";
    if (/super admin access required/i.test(message)) {
      throw new Error(
        "Super admin access required. Sign in with a platform super admin account (e.g. info@educlear.co.za)."
      );
    }
    if (/authentication required|401/i.test(message)) {
      throw new Error("Your session expired. Sign in again as a platform super admin.");
    }
    throw new Error(message || "Could not load registered schools. Please try again.");
  }

  const rows = Array.isArray(data?.schools) ? data.schools : [];
  const schools = rows.map((row) => mapSchoolRow(row, sessionSchoolId));

  const summaryRaw = data?.summary;
  const summary: SchoolsSummary = {
    total: Number(summaryRaw?.total ?? schools.length),
    active: Number(summaryRaw?.active ?? schools.filter((s) => s.lifecycleStatus === "ACTIVE").length),
    trial: Number(summaryRaw?.trial ?? schools.filter((s) => s.lifecycleStatus === "TRIAL").length),
    inactive: Number(
      summaryRaw?.inactive ?? schools.filter((s) => s.lifecycleStatus === "INACTIVE").length
    ),
    archived: Number(
      summaryRaw?.archived ?? schools.filter((s) => s.lifecycleStatus === "ARCHIVED").length
    ),
  };

  if (!summaryRaw) {
    return { schools, summary: computeSummaryFromSchools(schools) };
  }

  return { schools, summary };
}

export async function updateSuperAdminSchool(
  schoolId: string,
  input: { status?: SchoolRecord["status"]; package?: SchoolPackage }
): Promise<void> {
  const id = String(schoolId || "").trim();
  if (!id) throw new Error("Missing schoolId");

  const payload: Record<string, unknown> = {};
  if (input.status) payload.status = input.status;

  const pkg = String(input.package || "").trim();
  if (pkg && pkg !== "—") payload.package = pkg;

  const res = (await superAdminApiFetch(`/api/super-admin/schools/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  })) as { success?: boolean; error?: string };

  if (res && res.success === false) {
    throw new Error(String(res.error || "Failed to update school"));
  }
}

export async function updateSchoolLifecycleStatus(
  schoolId: string,
  lifecycleStatus: SchoolLifecycleStatus
): Promise<void> {
  const id = String(schoolId || "").trim();
  if (!id) throw new Error("Missing schoolId");

  const res = (await superAdminApiFetch(`/api/super-admin/schools/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ lifecycleStatus }),
  })) as { success?: boolean; error?: string };

  if (res && res.success === false) {
    throw new Error(String(res.error || "Failed to update school lifecycle"));
  }
}

export async function resetSuperAdminSchoolPassword(
  schoolId: string,
  input: { newPassword: string; confirmPassword: string }
): Promise<{ schoolId: string; schoolName: string; ownerEmail: string; message: string }> {
  const id = String(schoolId || "").trim();
  if (!id) throw new Error("Missing schoolId");

  const newPassword = String(input.newPassword ?? "");
  const confirmPassword = String(input.confirmPassword ?? "");
  if (newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters");
  }
  if (newPassword !== confirmPassword) {
    throw new Error("Passwords do not match");
  }

  const res = (await superAdminApiFetch(
    `/api/super-admin/schools/${encodeURIComponent(id)}/reset-password`,
    {
      method: "POST",
      body: JSON.stringify({
        schoolId: id,
        newPassword,
        confirmPassword,
      }),
    }
  )) as {
    success?: boolean;
    error?: string;
    schoolId?: string;
    schoolName?: string;
    ownerEmail?: string;
    message?: string;
  };

  if (res && res.success === false) {
    throw new Error(String(res.error || "Failed to reset password"));
  }

  return {
    schoolId: String(res.schoolId || id),
    schoolName: String(res.schoolName || ""),
    ownerEmail: String(res.ownerEmail || ""),
    message: String(res.message || "Password reset successfully."),
  };
}

function computeSummaryFromSchools(schools: SchoolRecord[]): SchoolsSummary {
  if (!schools.length) return emptySummary();
  return {
    total: schools.length,
    active: schools.filter((s) => s.lifecycleStatus === "ACTIVE").length,
    trial: schools.filter((s) => s.lifecycleStatus === "TRIAL").length,
    inactive: schools.filter((s) => s.lifecycleStatus === "INACTIVE").length,
    archived: schools.filter((s) => s.lifecycleStatus === "ARCHIVED").length,
  };
}
