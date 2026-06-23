import { API_URL } from "../api";

const BASE = `${API_URL}/api/school-email-settings`;

function normalizeFetchError(error: unknown, context: string): Error {
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new Error(
        `${context} timed out while contacting the EduClear email service. Please retry.`
      );
    }
    const msg = String(error.message || "").trim();
    if (
      !msg ||
      msg === "Load failed" ||
      msg === "Failed to fetch" ||
      msg === "NetworkError when attempting to fetch resource." ||
      msg === "Network request failed"
    ) {
      return new Error(
          `${context} could not reach the EduClear server (${API_URL}). Check your connection and retry.`
      );
    }
    return error;
  }
  return new Error(`${context} failed`);
}

async function request<T>(
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
    throw normalizeFetchError(e, "Email request");
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
        throw new Error(
          text.trim().slice(0, 300) || `Request failed (${res.status})`
        );
      }
    }
  }
  if (!res.ok) {
    const err = new Error(
      String(
        data.error ||
          (Array.isArray(data.errors) ? data.errors.join(", ") : "") ||
          `Request failed (${res.status})`
      )
    );
    (err as { setupRequired?: boolean }).setupRequired = Boolean(data.setupRequired);
    (err as { errors?: string[] }).errors = Array.isArray(data.errors)
      ? (data.errors as string[])
      : undefined;
    throw err;
  }
  return data as T;
}

export type EmailProviderType = "platform" | "gmail" | "outlook" | "icloud" | "yahoo" | "custom";

export type SchoolEmailSettings = {
  schoolId: string;
  provider: EmailProviderType;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpPassSet: boolean;
  schoolEmail: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  configured: boolean;
  tested: boolean;
  testEmailPassed: boolean;
  lastTestedAt: string | null;
  ready: boolean;
};

export const SCHOOL_EMAIL_READINESS_UPDATED = "educlear:school-email-readiness-updated";

export function notifySchoolEmailReadinessUpdated(schoolId: string, settings: SchoolEmailSettings) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SCHOOL_EMAIL_READINESS_UPDATED, {
      detail: { schoolId, settings },
    })
  );
}

export type EmailProviderPreset = {
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  hint?: string;
};

export async function fetchSchoolEmailSettings(schoolId: string) {
  const q = new URLSearchParams({ schoolId });
  return request<{ success: boolean; settings: SchoolEmailSettings }>(`/?${q.toString()}`);
}

export async function fetchEmailProviderPresets() {
  return request<{ success: boolean; presets: Record<EmailProviderType, EmailProviderPreset> }>("/presets");
}

export async function saveSchoolEmailSettings(payload: {
  schoolId: string;
  schoolEmail?: string;
  provider: EmailProviderType;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass?: string;
  fromEmail: string;
  fromName: string;
  replyTo?: string;
}) {
  return request<{ success: boolean; settings: SchoolEmailSettings }>("/", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function testSchoolEmailConnection(schoolId: string, testTo?: string) {
  return request<{
    success: boolean;
    message: string;
    sentTo?: string;
    lastTestedAt?: string | null;
    settings: SchoolEmailSettings;
  }>(
    "/test",
    {
      method: "POST",
      body: JSON.stringify({ schoolId, testTo }),
    },
    30_000
  );
}

/**
 * School email readiness only requires a school email address; EduClear owns the sending provider.
 */
export function isSchoolEmailReadyForUi(settings: SchoolEmailSettings | null | undefined): boolean {
  if (!settings) return false;
  return Boolean(settings.ready && settings.configured && String(settings.schoolEmail || settings.replyTo || "").trim());
}

/** Normalize API settings to persisted readiness fields (does not weaken backend ready state). */
export function normalizeSchoolEmailSettings(settings: SchoolEmailSettings): SchoolEmailSettings {
  const lastTestedAt = settings.lastTestedAt ?? null;
  const configured = Boolean(settings.configured);
  const tested = Boolean(settings.testEmailPassed || settings.tested || lastTestedAt);
  const merged: SchoolEmailSettings = {
    ...settings,
    tested,
    testEmailPassed: tested,
    configured,
    lastTestedAt,
    ready: Boolean(settings.ready && configured),
  };
  return { ...merged, ready: isSchoolEmailReadyForUi(merged) };
}

export const PROVIDER_LABELS: Record<EmailProviderType, string> = {
  platform: "EduClear Platform Email",
  gmail: "Gmail (App Password)",
  outlook: "Outlook / Office 365",
  icloud: "iCloud (App-Specific Password)",
  yahoo: "Yahoo Mail",
  custom: "Custom Domain SMTP",
};

/** Pre-fill From/Reply-To from school registration when sender fields are empty. */
export function applySchoolSenderDefaults(
  settings: SchoolEmailSettings,
  schoolName: string,
  schoolEmail: string
): SchoolEmailSettings {
  const email = String(settings.schoolEmail || schoolEmail || "").trim();
  if (!email) return settings;
  const name = String(schoolName || "").trim() || "School";
  return {
    ...settings,
    schoolEmail: email,
    fromEmail: String(settings.fromEmail || "").trim() || email,
    fromName: String(settings.fromName || "").trim() || name,
    replyTo: String(settings.replyTo || "").trim() || email,
  };
}
