import { API_URL } from "../api";

const BASE = `${API_URL}/api/school-sms-settings`;

export class SchoolSmsRequestError extends Error {
  readonly settings: SchoolSmsSettings;

  constructor(message: string, settings: SchoolSmsSettings) {
    super(message);
    this.name = "SchoolSmsRequestError";
    this.settings = settings;
  }
}

function isSchoolSmsSettings(value: unknown): value is SchoolSmsSettings {
  return (
    typeof value === "object" &&
    value !== null &&
    "schoolId" in value &&
    "connectionStatus" in value
  );
}

async function request<T>(path: string, options: RequestInit = {}, timeoutMs = 60_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Request failed";
    throw new Error(message === "AbortError" ? "SMS request timed out" : message);
  } finally {
    window.clearTimeout(timer);
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        throw new Error(text.trim().slice(0, 300) || `Request failed (${res.status})`);
      }
    }
  }

  if (!res.ok) {
    throw new Error(
      String(
        data.error ||
          (Array.isArray(data.errors) ? data.errors.join(", ") : "") ||
          `Request failed (${res.status})`
      )
    );
  }

  return data as T;
}

async function requestWithSettingsOnError<T extends { settings: SchoolSmsSettings }>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 60_000
): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Request failed";
    throw new Error(message === "AbortError" ? "SMS request timed out" : message);
  } finally {
    window.clearTimeout(timer);
  }

  const text = await res.text();
  let data: Record<string, unknown> = {};
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      if (!res.ok) {
        throw new Error(text.trim().slice(0, 300) || `Request failed (${res.status})`);
      }
    }
  }

  if (!res.ok) {
    const errorMessage = String(
      data.error ||
        (Array.isArray(data.errors) ? data.errors.join(", ") : "") ||
        `Request failed (${res.status})`
    );
    if (isSchoolSmsSettings(data.settings)) {
      throw new SchoolSmsRequestError(errorMessage, data.settings);
    }
    throw new Error(errorMessage);
  }

  return data as T;
}

export type SmsConnectionStatus = "not_configured" | "connected" | "failed";

export type SchoolSmsSettings = {
  schoolId: string;
  provider: string;
  apiKeySet: boolean;
  configured: boolean;
  connectionStatus: SmsConnectionStatus;
  creditBalance: number | null;
  creditBalanceCheckedAt: string | null;
  connectionTestedAt: string | null;
  lastConnectionError: string | null;
  ready: boolean;
};

export const SCHOOL_SMS_READINESS_UPDATED = "educlear:school-sms-readiness-updated";

export function notifySchoolSmsReadinessUpdated(schoolId: string, settings: SchoolSmsSettings) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SCHOOL_SMS_READINESS_UPDATED, {
      detail: { schoolId, settings },
    })
  );
}

export function isSchoolSmsReadyForUi(settings: SchoolSmsSettings | null | undefined) {
  return Boolean(settings?.ready);
}

export async function fetchSchoolSmsSettings(schoolId: string) {
  const q = new URLSearchParams({ schoolId });
  return request<{ success: boolean; settings: SchoolSmsSettings }>(`/?${q.toString()}`);
}

export async function saveSchoolSmsSettings(payload: {
  schoolId: string;
  provider?: string;
  apiKey?: string;
}) {
  return request<{ success: boolean; settings: SchoolSmsSettings }>("/", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function testSchoolSmsConnection(schoolId: string, apiKey?: string) {
  return requestWithSettingsOnError<{
    success: boolean;
    message: string;
    creditBalance: number;
    settings: SchoolSmsSettings;
  }>("/test", {
    method: "POST",
    body: JSON.stringify({ schoolId, ...(apiKey ? { apiKey } : {}) }),
  });
}

export async function checkSchoolSmsCreditBalance(schoolId: string) {
  const q = new URLSearchParams({ schoolId });
  return requestWithSettingsOnError<{
    success: boolean;
    creditBalance: number;
    settings: SchoolSmsSettings;
  }>(`/balance?${q.toString()}`);
}
