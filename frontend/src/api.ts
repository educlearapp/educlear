const PRODUCTION_API_URL = "https://educlear-backend.onrender.com";
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {};

export const API_URL =
  viteEnv.VITE_API_URL ||
  (viteEnv.PROD ? PRODUCTION_API_URL : "http://localhost:3000");

/** Extends RequestInit with an explicit opt-out of default staff JWT injection. */
export type ApiFetchOptions = RequestInit & {
  /**
   * When true, do not attach localStorage staff `token`.
   * Use for login/register, parent portal, super-admin, and public routes.
   */
  skipAuth?: boolean;
};

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [key, value] of headers) out[key] = value;
    return out;
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value != null) out[key] = String(value);
  }
  return out;
}

function headerHasAuthorization(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === "authorization");
}

function readStaffToken(): string {
  try {
    if (typeof localStorage === "undefined") return "";
    return String(localStorage.getItem("token") || "").trim();
  } catch {
    return "";
  }
}

/**
 * Build request headers for EduClear API calls.
 * - JSON Content-Type by default (skipped for FormData so the browser sets multipart boundary)
 * - Preserves caller headers
 * - Injects staff Bearer from localStorage.token unless skipAuth or Authorization already set
 */
export function mergeApiHeaders(options: {
  headers?: HeadersInit;
  body?: BodyInit | null;
  skipAuth?: boolean;
}): Record<string, string> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const merged: Record<string, string> = {
    ...(isFormData ? {} : { "Content-Type": "application/json" }),
    ...headersToRecord(options.headers),
  };

  if (!options.skipAuth && !headerHasAuthorization(merged)) {
    const token = readStaffToken();
    if (token) merged.Authorization = `Bearer ${token}`;
  }

  return merged;
}

/**
 * Low-level fetch that applies the same auth/header rules as apiFetch.
 * Accepts absolute URLs or paths; use when callers need the raw Response (status/409).
 */
export async function authenticatedFetch(
  input: string,
  options: ApiFetchOptions = {}
): Promise<Response> {
  const { skipAuth, headers: incomingHeaders, body, ...restOptions } = options;
  const url = input.startsWith("http://") || input.startsWith("https://") ? input : `${API_URL}${input}`;
  return fetch(url, {
    ...restOptions,
    body,
    headers: mergeApiHeaders({ headers: incomingHeaders, body, skipAuth }),
  });
}

export async function apiFetch(path: string, options: ApiFetchOptions = {}) {
  const { skipAuth, headers: incomingHeaders, body, ...restOptions } = options;
  const url = `${API_URL}${path}`;

  const res = await fetch(url, {
    ...restOptions,
    body,
    headers: mergeApiHeaders({ headers: incomingHeaders, body, skipAuth }),
  });

  const text = await res.text();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      typeof data === "string"
        ? data
        : data?.error || data?.message || `Request failed with status ${res.status}`;
    throw new ApiError(String(message), res.status, data);
  }

  return data;
}
