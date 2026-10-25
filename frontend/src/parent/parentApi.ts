import { API_URL, ApiError, apiFetch } from "../api";

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

/** True when a parent API failure means the stored JWT must be discarded. */
export function isParentSessionUnauthorized(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const status = (error as { status?: number }).status;
  if (status === 401) return true;
  const msg = String((error as { message?: string }).message || "");
  return (
    msg.includes("Invalid or expired parent session") ||
    msg === "Parent authentication required"
  );
}

export async function parentApiFetch(path: string, options: RequestInit = {}) {
  const token = getParentToken();
  // skipAuth: never inject staff JWT; parent portal uses its own Bearer only.
  try {
    return await apiFetch(path, {
      ...options,
      skipAuth: true,
      headers: {
        ...(options.headers || {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch (error) {
    // Drop zombie sessions: cached parent/learner JSON must not survive a 401 JWT failure.
    if (error instanceof ApiError && error.status === 401) {
      clearParentSession();
    } else if (isParentSessionUnauthorized(error)) {
      clearParentSession();
    }
    throw error;
  }
}

export const PARENT_PORTAL_URL = `${
  typeof window !== "undefined" && window.location?.origin
    ? window.location.origin
    : ""
}/parent`;
