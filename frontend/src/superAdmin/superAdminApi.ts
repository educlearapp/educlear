import { apiFetch, API_URL } from "../api";

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Authenticated API calls for super-admin routes (migration, etc.). */
export async function superAdminApiFetch(path: string, options: RequestInit = {}) {
  const { headers: incomingHeaders, ...rest } = options;
  return apiFetch(path, {
    ...rest,
    headers: {
      ...authHeaders(),
      ...(incomingHeaders || {}),
    },
  });
}

export function superAdminAuthHeaders(): Record<string, string> {
  return authHeaders();
}

export { API_URL };
