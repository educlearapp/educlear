import { API_URL } from "../api";

const BASE = `${API_URL}/api/communication`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as any)?.error || `Request failed (${res.status})`));
  }
  return data as T;
}

export type CommunicationSettings = {
  sendViaEduClearDomain: boolean;
  administrationEmail: string;
  administrationCcSelf: boolean;
  billingEmail: string;
  billingCcSelf: boolean;
  signature: string;
  standardEmailSubject: string;
  standardEmailMessage: string;
  standardSmsMessage: string;
  smsProvider: "WinSMS" | "SMSPortal" | "Other";
  winSmsUsername: string;
  winSmsPassword: string;
  winSmsPasswordSet?: boolean;
};

export type EmailContact = {
  id: string;
  contactName: string;
  relationship: string;
  email: string;
  attachments: string[];
  status: string;
};

export type EmailRecord = {
  id: string;
  schoolId: string;
  date: string;
  description: string;
  from: string;
  subject: string;
  message: string;
  contacts: EmailContact[];
  status: "Draft" | "Sent";
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type SmsContact = {
  id: string;
  contactName: string;
  relationship: string;
  cellNo: string;
  status: string;
};

export type SmsRecord = {
  id: string;
  schoolId: string;
  date: string;
  description: string;
  message: string;
  contacts: SmsContact[];
  status: "Draft" | "Sent";
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type CommunicationSettingsResponse = {
  success: boolean;
  settings: CommunicationSettings;
  emailBalance: number;
  smsCredits: number;
  winSmsCredits: number;
  schoolName?: string;
  schoolEmail?: string;
  senderEmail?: string;
  senderLabel?: string;
};

export const fetchCommunicationSettings = (schoolId: string) =>
  request<CommunicationSettingsResponse>(`/settings?schoolId=${encodeURIComponent(schoolId)}`);

export const saveCommunicationSettings = (schoolId: string, settings: Partial<CommunicationSettings>) =>
  request<CommunicationSettingsResponse>("/settings", {
    method: "PUT",
    body: JSON.stringify({ schoolId, settings }),
  });

export const testSmsCredentials = (schoolId: string, winSmsUsername?: string) =>
  request<{ success: boolean; message: string }>("/settings/test-sms", {
    method: "POST",
    body: JSON.stringify({ schoolId, winSmsUsername }),
  });

export const fetchEmails = (schoolId: string) =>
  request<{ success: boolean; emails: EmailRecord[]; emailBalance: number }>(
    `/emails?schoolId=${encodeURIComponent(schoolId)}`
  );

export const fetchEmail = (schoolId: string, id: string) =>
  request<{ success: boolean; email: EmailRecord }>(
    `/emails/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(schoolId)}`
  );

export const createEmail = (payload: Record<string, unknown>) =>
  request<{ success: boolean; email: EmailRecord }>("/emails", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateEmail = (id: string, payload: Record<string, unknown>) =>
  request<{ success: boolean; email: EmailRecord }>(`/emails/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

export const deleteEmail = (schoolId: string, id: string) =>
  request<{ success: boolean }>(`/emails/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(schoolId)}`, {
    method: "DELETE",
  });

export const sendEmail = (schoolId: string, id: string) =>
  request<{ success: boolean; email: EmailRecord; emailBalance: number; simulated?: boolean }>(
    `/emails/${encodeURIComponent(id)}/send`,
    { method: "POST", body: JSON.stringify({ schoolId }) }
  );

export const fetchSmsList = (schoolId: string) =>
  request<{ success: boolean; sms: SmsRecord[]; smsCredits: number; winSmsCredits: number }>(
    `/sms?schoolId=${encodeURIComponent(schoolId)}`
  );

export const fetchSms = (schoolId: string, id: string) =>
  request<{ success: boolean; sms: SmsRecord }>(
    `/sms/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(schoolId)}`
  );

export const createSms = (payload: Record<string, unknown>) =>
  request<{ success: boolean; sms: SmsRecord }>("/sms", {
    method: "POST",
    body: JSON.stringify(payload),
  });

export const updateSms = (id: string, payload: Record<string, unknown>) =>
  request<{ success: boolean; sms: SmsRecord }>(`/sms/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });

export const deleteSms = (schoolId: string, id: string) =>
  request<{ success: boolean }>(`/sms/${encodeURIComponent(id)}?schoolId=${encodeURIComponent(schoolId)}`, {
    method: "DELETE",
  });

export const sendSms = (schoolId: string, id: string) =>
  request<{ success: boolean; sms: SmsRecord; smsCredits: number; winSmsCredits: number; simulated?: boolean }>(
    `/sms/${encodeURIComponent(id)}/send`,
    { method: "POST", body: JSON.stringify({ schoolId }) }
  );

export function newContactId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const FALLBACK_SENDER_EMAIL = "no-reply@educlear.co.za";

export const COMMUNICATION_SETTINGS_UPDATED = "educlear-communication-settings-updated";

export type SchoolSenderContext = {
  schoolName?: string;
  schoolEmail?: string;
};

/** billingEmail → administrationEmail → school.email → fallback */
export function resolveSchoolSenderEmail(
  settings?: Partial<CommunicationSettings> | null,
  school?: SchoolSenderContext | null
): string {
  if (settings?.sendViaEduClearDomain) {
    return FALLBACK_SENDER_EMAIL;
  }
  const billing = String(settings?.billingEmail || "").trim();
  if (billing) return billing;
  const administration = String(settings?.administrationEmail || "").trim();
  if (administration) return administration;
  const schoolEmail = String(school?.schoolEmail || "").trim();
  if (schoolEmail) return schoolEmail;
  return FALLBACK_SENDER_EMAIL;
}

/** e.g. "Rustenburg High School billing@rhs.co.za" */
export function formatComposeSenderLabel(
  settings?: Partial<CommunicationSettings> | null,
  school?: SchoolSenderContext | null
): string {
  const schoolName = String(school?.schoolName || "School").trim() || "School";
  const email = resolveSchoolSenderEmail(settings, school);
  return `${schoolName} ${email}`;
}

export function notifyCommunicationSettingsUpdated(
  schoolId: string,
  settings: CommunicationSettings,
  school?: SchoolSenderContext
) {
  window.dispatchEvent(
    new CustomEvent(COMMUNICATION_SETTINGS_UPDATED, {
      detail: { schoolId, settings, school },
    })
  );
}

/** @deprecated Use formatComposeSenderLabel */
export function defaultFromLabel(
  settings?: CommunicationSettings | null,
  school?: SchoolSenderContext | null
) {
  return formatComposeSenderLabel(settings, school);
}
