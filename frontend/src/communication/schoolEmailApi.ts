import { API_URL } from "../api";

const BASE = `${API_URL}/api/school-email-settings`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(String((data as { error?: string; errors?: string[] })?.error || (data as any)?.errors?.join?.(", ") || `Request failed (${res.status})`));
    (err as any).setupRequired = Boolean((data as { setupRequired?: boolean }).setupRequired);
    (err as any).errors = (data as { errors?: string[] }).errors;
    throw err;
  }
  return data as T;
}

export type EmailProviderType = "gmail" | "outlook" | "icloud" | "yahoo" | "custom";

export type SchoolEmailSettings = {
  schoolId: string;
  provider: EmailProviderType;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  smtpPassSet: boolean;
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
  }>("/test", {
    method: "POST",
    body: JSON.stringify({ schoolId, testTo }),
  });
}

/**
 * Persisted SMTP readiness from the API — requires configured SMTP, a passed test, ready flag, and lastTestedAt.
 */
export function isSchoolEmailReadyForUi(settings: SchoolEmailSettings | null | undefined): boolean {
  if (!settings) return false;
  const lastTestedAt = settings.lastTestedAt ?? null;
  const configured = Boolean(settings.configured);
  const tested = Boolean(settings.testEmailPassed || settings.tested || lastTestedAt);
  return Boolean(settings.ready && configured && tested && lastTestedAt);
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
    ready: Boolean(settings.ready),
  };
  return { ...merged, ready: isSchoolEmailReadyForUi(merged) };
}

export const PROVIDER_LABELS: Record<EmailProviderType, string> = {
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
  const email = String(schoolEmail || "").trim();
  if (!email) return settings;
  const name = String(schoolName || "").trim() || "School";
  return {
    ...settings,
    fromEmail: String(settings.fromEmail || "").trim() || email,
    fromName: String(settings.fromName || "").trim() || name,
    replyTo: String(settings.replyTo || "").trim() || email,
  };
}
