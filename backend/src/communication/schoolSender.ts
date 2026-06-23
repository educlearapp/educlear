export const FALLBACK_SENDER_EMAIL = "no-reply@educlear.co.za";
export const EDUCLEAR_RELAY_FROM_EMAIL = "billing@educlear.co.za";

export type CommunicationSenderSettings = {
  sendViaEduClearDomain?: boolean;
  administrationEmail?: string;
  billingEmail?: string;
  signature?: string;
};

export type SchoolBranding = {
  schoolName?: string;
  schoolEmail?: string;
};

export type SchoolSmtpSender = {
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  configured?: boolean;
};

export function resolveSchoolDisplayName(
  school?: SchoolBranding | null,
  smtp?: SchoolSmtpSender | null
): string {
  if (smtp?.configured) {
    const smtpName = String(smtp.fromName || "").trim();
    if (smtpName) return smtpName;
  }
  return String(school?.schoolName || "School").trim() || "School";
}

/** Outbound mail always uses EduClear's verified sending address. School email is Reply-To only. */
export function resolveSchoolSenderEmail(
  _settings: Partial<CommunicationSenderSettings> | null | undefined,
  _school?: SchoolBranding | null,
  _smtp?: SchoolSmtpSender | null
): string {
  return EDUCLEAR_RELAY_FROM_EMAIL;
}

/** Parents reply here: SMTP replyTo → school registration email → SMTP from → no-reply only if no school email. */
export function resolveSchoolReplyToEmail(
  _settings: Partial<CommunicationSenderSettings> | null | undefined,
  school?: SchoolBranding | null,
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

export function formatComposeSenderLabel(
  settings: Partial<CommunicationSenderSettings> | null | undefined,
  school?: SchoolBranding | null,
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
    settings?: Partial<CommunicationSenderSettings> | null;
  }
): string {
  const schoolName = opts.schoolName;
  const signature = resolveEmailSignature(opts.settings?.signature, schoolName);
  return String(template || "")
    .replace(/\[school_name\]/g, schoolName)
    .replace(/\[signature\]/g, signature);
}

export function smtpSenderFromPublic(settings: {
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
