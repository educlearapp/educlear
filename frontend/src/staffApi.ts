import { API_URL, apiFetch } from "./api";

export function getStaffToken() {
  return localStorage.getItem("token") || "";
}

/** School staff JWT — adds Authorization for `/api/teacher-app` and secured teacher inbox. */
export async function staffApiFetch(path: string, options: RequestInit = {}) {
  const token = getStaffToken();
  return apiFetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export async function staffFormPost(path: string, form: FormData) {
  const token = getStaffToken();
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
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
