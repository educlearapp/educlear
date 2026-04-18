const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:3000";

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
