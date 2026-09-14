import { API_URL } from "../api";
import type {
  ApplicantApplicationResponse,
  ApplicantApplicationView,
  CreateDraftApplicationBody,
  CreateDraftApplicationResponse,
  PublicAdmissionsConfig,
  PublicAdmissionsConfigResponse,
  UpdateDraftApplicationBody,
} from "./publicAdmissionsTypes";

export class PublicAdmissionsApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, status: number, code: string | null = null) {
    super(message);
    this.name = "PublicAdmissionsApiError";
    this.status = status;
    this.code = code;
  }
}

function normalizeSlug(publicSlug: string): string {
  return String(publicSlug || "")
    .trim()
    .toLowerCase();
}

function applicantAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Admissions-Access-Token": String(accessToken || "").trim(),
  };
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function throwFromPayload(res: Response, payload: Record<string, unknown>, fallback: string): never {
  throw new PublicAdmissionsApiError(
    String(payload.error || fallback),
    res.status,
    payload.code ? String(payload.code) : null
  );
}

/**
 * Fetch public admissions config for a school slug.
 * Must NOT send staff JWT / staffAuthHeaders.
 */
export async function fetchPublicAdmissionsConfig(
  publicSlug: string
): Promise<PublicAdmissionsConfig> {
  const slug = normalizeSlug(publicSlug);
  if (!slug) {
    throw new PublicAdmissionsApiError("Admissions not found", 404, "ADMISSIONS_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/config`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const payload = (await parseJson(res)) as PublicAdmissionsConfigResponse;

  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Admissions unavailable");
  }

  if (!payload?.success || !payload.config) {
    throw new PublicAdmissionsApiError("Admissions unavailable", 500, "INVALID_RESPONSE");
  }

  return payload.config;
}

/**
 * Create a DRAFT application. Call only after explicit applicant action.
 * Returns plaintext access token once — store locally for resume.
 */
export async function createPublicDraftApplication(
  publicSlug: string,
  body: CreateDraftApplicationBody = {}
): Promise<{
  application: ApplicantApplicationView;
  accessToken: string;
  accessTokenExpiresAt: string | null;
}> {
  const slug = normalizeSlug(publicSlug);
  if (!slug) {
    throw new PublicAdmissionsApiError("Admissions not found", 404, "ADMISSIONS_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/applications`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const payload = (await parseJson(res)) as CreateDraftApplicationResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not start application");
  }
  if (!payload.success || !payload.application || !payload.accessToken) {
    throw new PublicAdmissionsApiError("Could not start application", 500, "INVALID_RESPONSE");
  }

  return {
    application: payload.application,
    accessToken: String(payload.accessToken),
    accessTokenExpiresAt: payload.accessTokenExpiresAt
      ? String(payload.accessTokenExpiresAt)
      : null,
  };
}

export async function fetchPublicDraftApplication(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string
): Promise<ApplicantApplicationView> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/applications/${encodeURIComponent(accessId)}`,
    {
      method: "GET",
      headers: applicantAuthHeaders(token),
    }
  );

  const payload = (await parseJson(res)) as ApplicantApplicationResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Application not found");
  }
  if (!payload.success || !payload.application) {
    throw new PublicAdmissionsApiError("Application not found", 500, "INVALID_RESPONSE");
  }
  return payload.application;
}

export async function updatePublicDraftApplication(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string,
  body: UpdateDraftApplicationBody
): Promise<ApplicantApplicationView> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/applications/${encodeURIComponent(accessId)}`,
    {
      method: "PATCH",
      headers: applicantAuthHeaders(token),
      body: JSON.stringify(body),
    }
  );

  const payload = (await parseJson(res)) as ApplicantApplicationResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not save application");
  }
  if (!payload.success || !payload.application) {
    throw new PublicAdmissionsApiError("Could not save application", 500, "INVALID_RESPONSE");
  }
  return payload.application;
}
