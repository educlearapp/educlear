const RAW_API_BASE = import.meta.env.VITE_API_BASE as string | undefined;

function normalizeApiBase(raw: string | undefined): string {
  const v = String(raw ?? "").trim();
  if (!v) return "http://localhost:3000";
  // If a relative base like "/api" is provided, it’s meant for a dev proxy.
  // Our callers already include "/api/..." in the path, so we keep the origin-only base.
  if (v.startsWith("/")) return window.location.origin;
  return v.replace(/\/+$/, "");
}

const API_BASE = normalizeApiBase(RAW_API_BASE);

/** Same base URL as apiFetch; use for direct fetch() calls (e.g. Teacher Performance). */
export const API_URL = API_BASE;

export async function apiFetch(path: string, options: RequestInit = {}) {
  const url = `${API_BASE}${path}`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  const text = await res.text();

  let data: any = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(
      typeof data === "string"
        ? data
        : data?.error || `Request failed with status ${res.status}`
    );
  }

  return data;
}
