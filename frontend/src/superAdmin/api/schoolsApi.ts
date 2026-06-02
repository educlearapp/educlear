import { superAdminApiFetch } from "../superAdminApi";
import type { SchoolPackage, SchoolRecord, SchoolsSummary } from "../types/schools";

type ApiSchoolRow = {
  id?: string;
  schoolName?: string;
  ownerName?: string;
  ownerEmail?: string;
  email?: string;
  contactPhone?: string | null;
  package?: string;
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

const KNOWN_PACKAGES = new Set<string>(["Starter", "Growth", "Professional", "Unlimited"]);
const STATUS_VALUES = new Set<string>(["Active", "Trial", "Suspended"]);

function asPackage(value: unknown): SchoolPackage {
  const label = String(value || "").trim();
  if (!label || label === "—") return "—";
  if (KNOWN_PACKAGES.has(label)) return label as SchoolPackage;
  if (label.toLowerCase() === "unlimited") return "Unlimited";
  if (label.toLowerCase() === "starter") return "Starter";
  if (label.toLowerCase() === "growth") return "Growth";
  if (label.toLowerCase() === "professional") return "Professional";
  return label;
}

function asStatus(value: unknown): SchoolRecord["status"] {
  const label = String(value || "").trim();
  if (STATUS_VALUES.has(label)) return label as SchoolRecord["status"];
  return "Trial";
}

function mapSchoolRow(row: ApiSchoolRow, sessionSchoolId: string | null): SchoolRecord {
  const id = String(row.id || "").trim();
  const ownerEmail = String(row.ownerEmail || row.email || "").trim();
  const contactRaw = row.contactPhone != null ? String(row.contactPhone).trim() : "";
  return {
    id,
    schoolName: String(row.schoolName || "—").trim() || "—",
    ownerName: String(row.ownerName || ownerEmail || "—").trim() || "—",
    email: ownerEmail || "—",
    contactPhone: contactRaw || null,
    package: asPackage(row.package),
    status: asStatus(row.status),
    learnerCount: Number.isFinite(row.learnerCount) ? Number(row.learnerCount) : 0,
    parentCount: Number.isFinite(row.parentCount) ? Number(row.parentCount) : 0,
    registeredAt: row.registeredAt ? String(row.registeredAt) : null,
    lastLoginAt: row.lastLoginAt ? String(row.lastLoginAt) : null,
    isActive: row.isActive !== false,
    canOpenDashboard: Boolean(sessionSchoolId && id && sessionSchoolId === id),
  };
}

function emptySummary(): SchoolsSummary {
  return { total: 0, active: 0, suspended: 0, trial: 0 };
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
    active: Number(summaryRaw?.active ?? schools.filter((s) => s.status === "Active").length),
    suspended: Number(
      summaryRaw?.suspended ?? schools.filter((s) => s.status === "Suspended").length
    ),
    trial: Number(summaryRaw?.trial ?? schools.filter((s) => s.status === "Trial").length),
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

function computeSummaryFromSchools(schools: SchoolRecord[]): SchoolsSummary {
  if (!schools.length) return emptySummary();
  return {
    total: schools.length,
    active: schools.filter((s) => s.status === "Active").length,
    suspended: schools.filter((s) => s.status === "Suspended").length,
    trial: schools.filter((s) => s.status === "Trial").length,
  };
}
