const PRODUCTION_API_URL = "https://educlear-backend.onrender.com";
const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {};

export const API_URL =
  viteEnv.VITE_API_URL ||
  (viteEnv.PROD ? PRODUCTION_API_URL : "http://localhost:3000");

export async function apiFetch(path: string, options: RequestInit = {}) {
  const url = `${API_URL}${path}`;
  const { headers: incomingHeaders, body, ...restOptions } = options;
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;

  const res = await fetch(url, {
    ...restOptions,
    body,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(incomingHeaders || {}),
    },
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
