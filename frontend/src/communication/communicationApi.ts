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
  status: "Draft" | "Sent" | "Failed";
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
};

export type SchoolSmtpSender = {
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  configured?: boolean;
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
  replyToEmail?: string;
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

export type SendSmsResponse = {
  success: boolean;
  sms: SmsRecord;
  smsCredits: number;
  simulated: false;
  creditBalance?: number;
  warning?: string;
  error?: string;
};

export async function sendSms(schoolId: string, id: string): Promise<SendSmsResponse> {
  const res = await fetch(`${BASE}/sms/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ schoolId }),
  });
  const data = (await res.json().catch(() => ({}))) as SendSmsResponse & { error?: string };
  if (!res.ok || !data.success) {
    const err = new Error(String(data.error || `Request failed (${res.status})`)) as Error & {
      sms?: SmsRecord;
      creditBalance?: number;
      simulated?: false;
    };
    if (data.sms) err.sms = data.sms;
    if (data.creditBalance != null) err.creditBalance = data.creditBalance;
    err.simulated = false;
    throw err;
  }
  return data;
}

export function newContactId() {
  return `c-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export const FALLBACK_SENDER_EMAIL = "no-reply@educlear.co.za";
export const EDUCLEAR_RELAY_FROM_EMAIL = "billing@educlear.co.za";

export const COMMUNICATION_SETTINGS_UPDATED = "educlear-communication-settings-updated";

export type SchoolSenderContext = {
  schoolName?: string;
  schoolEmail?: string;
};

export function smtpSenderFromSettings(settings: {
  configured: boolean;
  fromEmail: string;
  fromName: string;
  replyTo: string;
}): SchoolSmtpSender {
  return {
    configured: settings.configured,
    fromEmail: settings.fromEmail,
    fromName: settings.fromName,
    replyTo: settings.replyTo,
  };
}

export function resolveSchoolDisplayName(
  school?: SchoolSenderContext | null,
  smtp?: SchoolSmtpSender | null
): string {
  if (smtp?.configured) {
    const smtpName = String(smtp.fromName || "").trim();
    if (smtpName) return smtpName;
  }
  return String(school?.schoolName || "School").trim() || "School";
}

/** SMTP from → school registration email → administration email; sendViaEduClearDomain always uses EDUCLEAR_RELAY_FROM_EMAIL. */
export function resolveSchoolSenderEmail(
  settings?: Partial<CommunicationSettings> | null,
  school?: SchoolSenderContext | null,
  smtp?: SchoolSmtpSender | null
): string {
  if (settings?.sendViaEduClearDomain) {
    return EDUCLEAR_RELAY_FROM_EMAIL;
  }
  if (smtp?.configured) {
    const smtpFrom = String(smtp.fromEmail || "").trim();
    if (smtpFrom) return smtpFrom;
  }
  const schoolEmail = String(school?.schoolEmail || "").trim();
  if (schoolEmail) return schoolEmail;
  const administration = String(settings?.administrationEmail || "").trim();
  if (administration) return administration;
  return "";
}

/** Parents reply here: SMTP replyTo → school registration email → SMTP from → no-reply only if no school email. */
export function resolveSchoolReplyToEmail(
  _settings?: Partial<CommunicationSettings> | null,
  school?: SchoolSenderContext | null,
  smtp?: SchoolSmtpSender | null
): string {
  if (smtp?.configured) {
    const replyTo = String(smtp.replyTo || "").trim();
    if (replyTo) return replyTo;
  }
  const schoolEmail = String(school?.schoolEmail || "").trim();
  if (schoolEmail) return schoolEmail;
  if (smtp?.configured) {
    const fromEmail = String(smtp.fromEmail || "").trim();
    if (fromEmail) return fromEmail;
  }
  return FALLBACK_SENDER_EMAIL;
}

/** e.g. "Rustenburg High School billing@rhs.co.za" */
export function formatComposeSenderLabel(
  settings?: Partial<CommunicationSettings> | null,
  school?: SchoolSenderContext | null,
  smtp?: SchoolSmtpSender | null
): string {
  const name = resolveSchoolDisplayName(school, smtp);
  const email = resolveSchoolSenderEmail(settings, school, smtp);
  if (!email) return name;
  return `${name} ${email}`;
}

const LEGACY_SIGNATURE_RE = /EduClear School Finance/i;

export function resolveEmailSignature(
  signature: string | undefined | null,
  schoolName: string
): string {
  const name = String(schoolName || "School").trim() || "School";
  let sig = String(signature || "").trim();
  if (!sig) return `Kind regards,\n${name}`;
  sig = sig.replace(/\[school_name\]/g, name);
  if (LEGACY_SIGNATURE_RE.test(sig)) {
    return `Kind regards,\n${name}`;
  }
  return sig;
}

export function applyEmailTemplateTokens(
  template: string,
  opts: {
    schoolName: string;
    settings?: Partial<CommunicationSettings> | null;
  }
): string {
  const schoolName = opts.schoolName;
  const signature = resolveEmailSignature(opts.settings?.signature, schoolName);
  return String(template || "")
    .replace(/\[school_name\]/g, schoolName)
    .replace(/\[signature\]/g, signature);
}

export function notifyCommunicationSettingsUpdated(
  schoolId: string,
  settings: CommunicationSettings,
  school?: SchoolSenderContext,
  smtp?: SchoolSmtpSender | null
) {
  window.dispatchEvent(
    new CustomEvent(COMMUNICATION_SETTINGS_UPDATED, {
      detail: { schoolId, settings, school, smtp },
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
