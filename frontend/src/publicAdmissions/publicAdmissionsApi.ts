import { API_URL } from "../api";
import type {
  PublicAdmissionsConfig,
  PublicAdmissionsConfigResponse,
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

/**
 * Fetch public admissions config for a school slug.
 * Must NOT send staff JWT / staffAuthHeaders.
 */
export async function fetchPublicAdmissionsConfig(
  publicSlug: string
): Promise<PublicAdmissionsConfig> {
  const slug = String(publicSlug || "")
    .trim()
    .toLowerCase();
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

  const payload = (await res.json().catch(() => ({}))) as PublicAdmissionsConfigResponse;

  if (!res.ok) {
    throw new PublicAdmissionsApiError(
      String(payload?.error || "Admissions unavailable"),
      res.status,
      payload?.code ? String(payload.code) : null
    );
  }

  if (!payload?.success || !payload.config) {
    throw new PublicAdmissionsApiError("Admissions unavailable", 500, "INVALID_RESPONSE");
  }

  return payload.config;
}
