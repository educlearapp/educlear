import { API_URL, apiFetch } from "../api";

const TOKEN_KEY = "parentPortalToken";
const SESSION_KEY = "parentPortalSession";

export function getParentToken() {
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function setParentSession(token: string, session: Record<string, unknown>) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getParentSession(): {
  parent?: {
    id: string;
    firstName: string;
    surname: string;
    email?: string | null;
    school?: { id: string; name: string };
  };
  learners?: unknown[];
} | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearParentSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(SESSION_KEY);
}

export async function parentApiFetch(path: string, options: RequestInit = {}) {
  const token = getParentToken();
  return apiFetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
}

export const PARENT_PORTAL_URL = `${window.location.origin}/parent`;
