import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";
import {
  StaffAdmissionsApiError,
  type ConversionDecisionDto,
  type ConversionPreflight,
  type ConversionResult,
  type ListStaffApplicationsQuery,
  type ListStaffApplicationsResult,
  type StaffApplicationDetail,
} from "./staffAdmissionsTypes";

type ApiEnvelope = {
  success?: boolean;
  error?: string;
  code?: string;
};

function buildQuery(params: ListStaffApplicationsQuery): string {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.paymentStatus) search.set("paymentStatus", params.paymentStatus);
  if (params.requestedGrade) search.set("requestedGrade", params.requestedGrade);
  if (params.intakeYear != null) search.set("intakeYear", String(params.intakeYear));
  if (params.q) search.set("q", params.q);
  if (params.submittedFrom) search.set("submittedFrom", params.submittedFrom);
  if (params.submittedTo) search.set("submittedTo", params.submittedTo);
  if (params.includeDrafts) search.set("includeDrafts", "true");
  if (params.page != null) search.set("page", String(params.page));
  if (params.pageSize != null) search.set("pageSize", String(params.pageSize));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function parseJson(res: Response): Promise<ApiEnvelope & Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as ApiEnvelope & Record<string, unknown>;
}

function throwApiError(data: ApiEnvelope, fallback: string, status: number): never {
  throw new StaffAdmissionsApiError(
    String(data.error || `${fallback} (${status})`),
    data.code
  );
}

async function staffRequest<T>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...staffAuthHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throwApiError(data, "Admissions request failed", res.status);
  }
  return data as T;
}

/** Tenant comes from JWT — do not pass schoolId. */
export async function listApplications(
  query: ListStaffApplicationsQuery = {}
): Promise<ListStaffApplicationsResult> {
  const data = await staffRequest<
    ApiEnvelope & {
      items?: ListStaffApplicationsResult["items"];
      total?: number;
      page?: number;
      pageSize?: number;
    }
  >("GET", `/api/admissions/applications${buildQuery(query)}`);
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total) || 0,
    page: Number(data.page) || 1,
    pageSize: Number(data.pageSize) || 20,
  };
}

export async function getApplication(applicationId: string): Promise<StaffApplicationDetail> {
  const data = await staffRequest<ApiEnvelope & { application?: StaffApplicationDetail }>(
    "GET",
    `/api/admissions/applications/${encodeURIComponent(applicationId)}`
  );
  if (!data.application) {
    throw new Error("Missing application in response");
  }
  return data.application;
}

export async function getConversionPreflight(applicationId: string): Promise<ConversionPreflight> {
  const data = await staffRequest<ApiEnvelope & { preflight?: ConversionPreflight }>(
    "GET",
    `/api/admissions/applications/${encodeURIComponent(applicationId)}/conversion-preflight`
  );
  if (!data.preflight) {
    throw new Error("Missing conversion preflight in response");
  }
  return data.preflight;
}

export async function convertToLearner(
  applicationId: string,
  dto: ConversionDecisionDto
): Promise<ConversionResult> {
  const data = await staffRequest<ApiEnvelope & ConversionResult>(
    "POST",
    `/api/admissions/applications/${encodeURIComponent(applicationId)}/convert-to-learner`,
    dto as unknown as Record<string, unknown>
  );
  if (!data.learnerId) {
    throw new Error("Missing conversion result");
  }
  return data as ConversionResult;
}

async function workflowPost(
  applicationId: string,
  action: string,
  body?: Record<string, unknown>
): Promise<{ idempotent?: boolean; application?: { status?: string } }> {
  return staffRequest(
    "POST",
    `/api/admissions/applications/${encodeURIComponent(applicationId)}/${action}`,
    body
  );
}

export function startReview(applicationId: string) {
  return workflowPost(applicationId, "start-review");
}

export function requestInfo(
  applicationId: string,
  payload: { message?: string; internalNote?: string } = {}
) {
  return workflowPost(applicationId, "request-info", payload);
}

export function resumeReview(applicationId: string) {
  return workflowPost(applicationId, "resume-review");
}

export function acceptApplication(applicationId: string) {
  return workflowPost(applicationId, "accept");
}

export function rejectApplication(applicationId: string, payload: { reason?: string } = {}) {
  return workflowPost(applicationId, "reject", payload);
}
