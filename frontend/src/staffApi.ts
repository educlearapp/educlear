import { API_URL, apiFetch, authenticatedFetch, type ApiFetchOptions } from "./api";

export function getStaffToken() {
  return localStorage.getItem("token") || "";
}

/**
 * School staff JWT client for `/api/teacher-app` and secured teacher inbox.
 * apiFetch already injects staff Bearer by default; this remains the explicit staff entrypoint.
 */
export async function staffApiFetch(path: string, options: ApiFetchOptions = {}) {
  return apiFetch(path, options);
}

export async function staffFormPost(path: string, form: FormData) {
  const res = await authenticatedFetch(`${API_URL}${path}`, {
    method: "POST",
    body: form,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error?: string }).error)
        : typeof data === "string"
          ? data
          : `Request failed (${res.status})`;
    throw new Error(err);
  }
  return data as Record<string, unknown>;
}
