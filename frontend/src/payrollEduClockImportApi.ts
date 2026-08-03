/**
 * Owner-facing EduClock → Payroll import API client.
 * Backend remains authoritative for durations and hashes.
 */
import { API_URL } from "./api";
import { staffAuthHeaders } from "./auth/staffAuthHeaders";

export class PayrollEduClockApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = "PayrollEduClockApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type EduClockPreviewLine = {
  employeeId: string;
  employeeNumberSnapshot: string | null;
  employeeNameSnapshot: string;
  workedMinutes: number;
  ordinaryMinutes: null;
  overtimeMinutes: null;
  status: "READY" | "WARNING" | "BLOCKED";
  warningCodes: string[];
  warningDetails: unknown;
  sourcePairCount: number;
  existingManualOvertimeHoursSnapshot: number | null;
  pairs: Array<{
    pairKey: string;
    includedMinutes: number;
    crossesPeriodStart: boolean;
    crossesPeriodEnd: boolean;
  }>;
};

export type EduClockPreview = {
  payrollRunId: string | null;
  confirmable: boolean;
  payrollMonth: number;
  payrollYear: number;
  periodStartUtc: string;
  periodEndUtc: string;
  schoolTimezone: string;
  previewHash: string;
  calculationVersion: string;
  schoolId: string;
  totalEmployees: number;
  totalWorkedMinutes: number;
  totalWarningCount: number;
  lines: EduClockPreviewLine[];
  preflight: { codes: string[]; details: unknown[]; correctionIssues: unknown[] };
  configGaps: string[];
};

export type PayrollRunSummary = {
  id: string;
  payrollMonth: number;
  payrollYear: number;
  status: string;
  payDate: string;
  finalizedAt: string | null;
  employeeCount: number;
  createdAt: string;
};

export type ConfirmedImport = {
  id: string;
  schoolId: string;
  payrollRunId: string;
  payrollMonth: number;
  payrollYear: number;
  periodStartUtc: string;
  periodEndUtc: string;
  schoolTimezone: string;
  status: string;
  importedByUserId: string;
  confirmedAt: string;
  totalEmployees: number;
  totalWorkedMinutes: number;
  totalWarningCount: number;
  recalculateReason?: string | null;
  supersedesImportId?: string | null;
  lines?: unknown[];
};

function ownerFriendlyMessage(code: string, fallback: string): string {
  switch (code) {
    case "OWNER_REQUIRED":
    case "UNAUTHORIZED":
      return "You are not authorized to perform this payroll action.";
    case "PAYROLL_RUN_NOT_FOUND":
      return "No payroll run exists for this period.";
    case "PAYROLL_RUN_FINALIZED":
      return "This payroll run is finalized and cannot be changed.";
    case "STALE_PREVIEW":
      return "Your EduClock preview is out of date. Refresh the preview and try again.";
    case "IMPORT_ALREADY_CONFIRMED":
      return "EduClock hours are already imported for this payroll run. Use Recalculate if time records changed.";
    case "OUTDATED_IMPORT_ID":
      return "A newer EduClock import already exists. Refresh and try recalculating again.";
    case "PREVIEW_NOT_CONFIRMABLE":
      return "Select a payroll run and refresh the preview before confirming.";
    case "RECALC_REASON_REQUIRED":
    case "REOPEN_REASON_REQUIRED":
      return "A reason is required.";
    case "PAYROLL_IMPORT_BLOCKED_LINES":
    case "PAYROLL_IMPORT_UNLINKED":
      return fallback || "This payroll run cannot be finalized until EduClock warnings are resolved.";
    case "NO_CONFIRMED_IMPORT":
      return "There is no confirmed EduClock import for this payroll run yet.";
    case "DUPLICATE_PERIOD_RUNS":
      return "More than one payroll run exists for this period. Owner review is required.";
    case "PERIOD_REQUIRED":
      return "A valid payroll month and year are required.";
    case "NETWORK":
      return "The payroll service could not be reached. Please try again.";
    default:
      return fallback || "Something went wrong. Please try again.";
  }
}

async function payrollFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...staffAuthHeaders(),
        ...(options.headers || {}),
      },
    });
  } catch {
    throw new PayrollEduClockApiError(
      ownerFriendlyMessage("NETWORK", "The payroll service could not be reached. Please try again."),
      0,
      "NETWORK"
    );
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const code = String(data?.code || (res.status === 401 || res.status === 403 ? "OWNER_REQUIRED" : "REQUEST_FAILED"));
    const raw = String(data?.error || data?.message || "").trim();
    // Never surface raw DB / Prisma messages
    const safe =
      /prisma|sql|database|constraint|ECONN|P20\d{2}|PostgreSQL|relation |column /i.test(raw)
        ? "Something went wrong while talking to the server."
        : raw;
    throw new PayrollEduClockApiError(
      ownerFriendlyMessage(code, safe || `Request failed (${res.status})`),
      res.status,
      code,
      data?.details
    );
  }
  return data as T;
}

export async function listPayrollRuns(input?: {
  payrollMonth?: number;
  payrollYear?: number;
}): Promise<PayrollRunSummary[]> {
  const q = new URLSearchParams();
  if (input?.payrollMonth != null) q.set("payrollMonth", String(input.payrollMonth));
  if (input?.payrollYear != null) q.set("payrollYear", String(input.payrollYear));
  const qs = q.toString();
  const data = await payrollFetch<{ success: boolean; runs: PayrollRunSummary[] }>(
    `/api/payroll/runs${qs ? `?${qs}` : ""}`
  );
  return data.runs || [];
}

/** Creates or reuses a DB payroll run via /api/payroll/run (explicit owner action). Never used by Confirm Import. */
export async function createPayrollRun(input: {
  month: number;
  year: number;
}): Promise<{
  payrollRunId: string;
  status: string;
  created: boolean;
  reusedExisting: boolean;
  message?: string;
}> {
  const data = await payrollFetch<{
    success: boolean;
    payrollRunId: string;
    status?: string;
    created?: boolean;
    reusedExisting?: boolean;
    message?: string;
  }>("/api/payroll/run", {
    method: "POST",
    // schoolId is ignored by the backend; authenticated school is authoritative.
    body: JSON.stringify({
      month: input.month,
      year: input.year,
    }),
  });
  if (!data.payrollRunId) {
    throw new PayrollEduClockApiError(
      "No payroll run exists for this period.",
      500,
      "PAYROLL_RUN_ID_MISSING"
    );
  }
  return {
    payrollRunId: data.payrollRunId,
    status: data.status || "DRAFT",
    created: Boolean(data.created),
    reusedExisting: Boolean(data.reusedExisting),
    message: data.message,
  };
}

/** Pure guard: confirmation payload must never include create-run flags. */
export function assertConfirmDoesNotCreateRun(body: Record<string, unknown>): boolean {
  const keys = Object.keys(body || {});
  if (keys.includes("createRun") || keys.includes("createPayrollRun")) return false;
  if (!body.payrollRunId || !body.previewHash) return false;
  return true;
}

export async function previewEduClockImport(input: {
  payrollRunId?: string | null;
  payrollMonth?: number;
  payrollYear?: number;
}): Promise<EduClockPreview> {
  const data = await payrollFetch<{ success: boolean; preview: EduClockPreview }>(
    "/api/payroll/educlock-import/preview",
    {
      method: "POST",
      body: JSON.stringify({
        ...(input.payrollRunId ? { payrollRunId: input.payrollRunId } : {}),
        ...(input.payrollMonth != null ? { payrollMonth: input.payrollMonth } : {}),
        ...(input.payrollYear != null ? { payrollYear: input.payrollYear } : {}),
      }),
    }
  );
  return data.preview;
}

export async function confirmEduClockImport(input: {
  payrollRunId: string;
  previewHash: string;
}): Promise<{ import: ConfirmedImport; idempotent: boolean }> {
  return payrollFetch("/api/payroll/educlock-import/confirm", {
    method: "POST",
    body: JSON.stringify({
      payrollRunId: input.payrollRunId,
      previewHash: input.previewHash,
    }),
  });
}

export async function recalculateEduClockImport(input: {
  payrollRunId: string;
  previousConfirmedImportId: string;
  previewHash: string;
  reason: string;
}): Promise<{
  outcome: "NO_CHANGES" | "RECALCULATED";
  import: ConfirmedImport;
  supersededImportId?: string;
  idempotent?: boolean;
}> {
  return payrollFetch("/api/payroll/educlock-import/recalculate", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getCurrentEduClockImport(input: {
  payrollRunId?: string;
  payrollMonth?: number;
  payrollYear?: number;
}): Promise<ConfirmedImport | null> {
  const q = new URLSearchParams();
  if (input.payrollRunId) q.set("payrollRunId", input.payrollRunId);
  if (input.payrollMonth != null) q.set("payrollMonth", String(input.payrollMonth));
  if (input.payrollYear != null) q.set("payrollYear", String(input.payrollYear));
  const data = await payrollFetch<{ success: boolean; import: ConfirmedImport | null }>(
    `/api/payroll/educlock-import/current?${q.toString()}`
  );
  return data.import || null;
}

export async function finalizePayrollRun(input: {
  payrollRunId: string;
  note?: string;
}): Promise<{ payrollRun: { id: string; status: string; finalizedAt?: string | null } }> {
  return payrollFetch(`/api/payroll/run/${encodeURIComponent(input.payrollRunId)}/finalize`, {
    method: "POST",
    body: JSON.stringify({ note: input.note || undefined }),
  });
}

export async function reopenPayrollRun(input: {
  payrollRunId: string;
  reason: string;
}): Promise<{ payrollRun: { id: string; status: string } }> {
  return payrollFetch(`/api/payroll/run/${encodeURIComponent(input.payrollRunId)}/reopen`, {
    method: "POST",
    body: JSON.stringify({ reason: input.reason }),
  });
}

export function formatWorkedHours(minutes: number): string {
  const m = Math.max(0, Math.floor(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (rem === 0) return `${h}h`;
  return `${h}h ${rem}m`;
}

/** Owner-friendly warning text. Pure helper for UI + tests. */
export function explainWarningCode(code: string): string {
  switch (code) {
    case "PAYROLL_RUN_EMPLOYEE_MISSING":
      return "This employee has verified EduClock time but has not yet been added to this payroll run.";
    case "MISSING_CLOCK_OUT":
      return "A Clock In was found without a matching Clock Out. No time was assumed.";
    case "MISSING_CLOCK_IN":
      return "A Clock Out was found without a matching Clock In. No time was assumed.";
    case "MISSING_EMPLOYEE_NUMBER":
    case "EMPLOYEE_NUMBER_MISSING":
      return "The employee number is missing. The employee was still matched safely using the internal employee record.";
    case "OVERTIME_RULES_NOT_CONFIGURED":
      return "Verified hours were imported, but overtime was not calculated automatically.";
    case "DUPLICATE_EMPLOYEE_NUMBER":
      return "More than one employee shares this employee number. Please review staff records.";
    case "INACTIVE_EMPLOYEE":
      return "This employee is marked inactive but has EduClock history in the period.";
    case "NO_LINKED_USER":
      return "This employee is not linked to a login account. Historical clock events can still be used.";
    case "DUPLICATE_CLOCK_IN_SEQUENCE":
      return "Two Clock In records appear in a row. Please review the sequence.";
    case "DUPLICATE_CLOCK_OUT_SEQUENCE":
      return "Two Clock Out records appear without a matching Clock In. Please review the sequence.";
    case "INVALID_EVENT_SEQUENCE":
      return "An invalid clock sequence was found. No time was assumed for that pair.";
    case "CORRECTION_CYCLE":
    case "CORRECTION_CROSS_EMPLOYEE":
    case "CORRECTION_CROSS_SCHOOL":
    case "CORRECTION_INCOMPATIBLE_TYPE":
    case "CORRECTION_AMBIGUOUS_TERMINAL":
    case "CORRECTION_MISSING_ANCESTOR":
    case "CORRECTION_ACTOR_UNPROVEN":
    case "CORRECTION_BLOCKED":
    case "CORRECTION_CHAIN_INVALID":
      return "A corrected time record requires owner review before it can be used.";
    default:
      return "This item needs owner review before payroll is finalized.";
  }
}

export function summarizeLineWarnings(codes: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const code of codes || []) {
    const text = explainWarningCode(code);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}
