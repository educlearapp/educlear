import nodemailer from "nodemailer";
import type { SchoolEmailSettings } from "@prisma/client";
import { prisma } from "../prisma";
import {
  resolveSchoolReplyToEmail,
  smtpSenderFromPublic,
} from "../communication/schoolSender";
import {
  applyDevTestSchoolEmailPrefill,
  ensureDevTestSchoolEmailConfigured,
  isDevTestSchool,
  mergeDevTestSchoolSaveInput,
  devTestSchoolSmtpTemplate,
} from "../dev/devTestSchoolEmail";

export type EmailProviderType = "gmail" | "outlook" | "icloud" | "yahoo" | "custom";

export type SchoolEmailSettingsInput = {
  provider?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
};

export type SchoolEmailSettingsPublic = {
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
  /** Alias for testEmailPassed — SMTP test completed successfully. */
  tested: boolean;
  testEmailPassed: boolean;
  lastTestedAt: string | null;
  ready: boolean;
};

export const EMAIL_PROVIDER_PRESETS: Record<
  EmailProviderType,
  { smtpHost: string; smtpPort: number; smtpSecure: boolean; hint?: string }
> = {
  gmail: {
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Use a Google App Password (2-Step Verification required).",
  },
  outlook: {
    smtpHost: "smtp.office365.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Office 365 / Outlook SMTP with STARTTLS on port 587.",
  },
  icloud: {
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Use an app-specific password from Apple ID settings.",
  },
  yahoo: {
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Use a Yahoo app password when 2FA is enabled.",
  },
  custom: {
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    hint: "Enter your domain host, port, and TLS/SSL mode manually.",
  },
};

const MASKED_PASSWORD = "********";
const SETUP_REQUIRED_MESSAGE =
  "Email is not configured for this school. Open Communication → Email (SMTP), save your provider settings, then use Send Test Email.";

export function normalizeProvider(raw: string): EmailProviderType | null {
  const p = String(raw || "")
    .trim()
    .toLowerCase();
  if (p === "gmail" || p === "google") return "gmail";
  if (p === "outlook" || p === "office365" || p === "office_365" || p === "microsoft") return "outlook";
  if (p === "icloud" || p === "apple") return "icloud";
  if (p === "yahoo") return "yahoo";
  if (p === "custom" || p === "other" || p === "smtp") return "custom";
  return null;
}

export function applyProviderDefaults(
  provider: EmailProviderType,
  input: SchoolEmailSettingsInput
): {
  provider: EmailProviderType;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
} {
  const preset = EMAIL_PROVIDER_PRESETS[provider];
  const smtpHost =
    provider === "custom"
      ? String(input.smtpHost || "").trim()
      : String(input.smtpHost || "").trim() || preset.smtpHost;
  const smtpPort =
    input.smtpPort != null && !Number.isNaN(Number(input.smtpPort))
      ? Number(input.smtpPort)
      : preset.smtpPort;
  const smtpSecure =
    input.smtpSecure === true || (input.smtpSecure !== false && smtpPort === 465);
  return {
    provider,
    smtpHost,
    smtpPort,
    smtpSecure,
    smtpUser: String(input.smtpUser || "").trim(),
    smtpPass: String(input.smtpPass || ""),
    fromEmail: String(input.fromEmail || "").trim(),
    fromName: String(input.fromName || "").trim(),
    replyTo: String(input.replyTo || "").trim(),
  };
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function validateSchoolEmailSettings(
  resolved: ReturnType<typeof applyProviderDefaults>,
  opts: { requirePassword: boolean; existingPass?: string }
): string[] {
  const errors: string[] = [];
  if (!resolved.smtpHost) errors.push("SMTP host is required.");
  if (!resolved.smtpPort || resolved.smtpPort < 1 || resolved.smtpPort > 65535) {
    errors.push("SMTP port must be between 1 and 65535.");
  }
  if (!resolved.smtpUser) errors.push("SMTP username is required.");
  if (opts.requirePassword && !resolved.smtpPass && !opts.existingPass) {
    errors.push("SMTP password or app password is required.");
  }
  if (!resolved.fromEmail) errors.push("From email is required.");
  else if (!isValidEmail(resolved.fromEmail)) errors.push("From email must be a valid email address.");
  if (resolved.replyTo && !isValidEmail(resolved.replyTo)) {
    errors.push("Reply-to must be a valid email address when provided.");
  }
  return errors;
}

export function maskPassword(password: string) {
  if (!password) return "";
  return MASKED_PASSWORD;
}

export type SchoolEmailBranding = {
  schoolName: string;
  schoolEmail: string;
};

export async function loadSchoolEmailBranding(schoolId: string): Promise<SchoolEmailBranding> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true, email: true },
  });
  return {
    schoolName: String(school?.name || "").trim() || "School",
    schoolEmail: String(school?.email || "").trim(),
  };
}

/** Pre-fill sender fields from School registration when SMTP row is missing or sender fields are empty. */
export function applySchoolSenderDefaults(
  settings: SchoolEmailSettingsPublic,
  branding: SchoolEmailBranding
): SchoolEmailSettingsPublic {
  const schoolEmail = branding.schoolEmail.trim();
  if (!schoolEmail) return settings;
  return {
    ...settings,
    fromEmail: String(settings.fromEmail || "").trim() || schoolEmail,
    fromName: String(settings.fromName || "").trim() || branding.schoolName.trim() || "School",
    replyTo: String(settings.replyTo || "").trim() || schoolEmail,
  };
}

export function isSmtpRowConfigured(row: SchoolEmailSettings | null | undefined) {
  return Boolean(row?.smtpHost && row?.smtpUser && row?.smtpPass && row?.fromEmail);
}

/** Persisted readiness: SMTP configured and a successful test timestamp on file. */
export function isSchoolEmailReadyFromRow(row: SchoolEmailSettings | null | undefined) {
  if (!isSmtpRowConfigured(row)) return false;
  return Boolean(row?.testEmailPassedAt);
}

export function computeSchoolEmailReadinessFlags(row: SchoolEmailSettings | null | undefined) {
  const configured = isSmtpRowConfigured(row);
  const lastTestedAt = row?.testEmailPassedAt ? row.testEmailPassedAt.toISOString() : null;
  const tested = Boolean(lastTestedAt);
  const ready = configured && tested && Boolean(lastTestedAt);
  return { configured, tested, testEmailPassed: tested, lastTestedAt, ready };
}

export function toPublicSettings(row: SchoolEmailSettings | null, schoolId: string): SchoolEmailSettingsPublic {
  if (!row) {
    return {
      schoolId,
      provider: "gmail",
      smtpHost: EMAIL_PROVIDER_PRESETS.gmail.smtpHost,
      smtpPort: EMAIL_PROVIDER_PRESETS.gmail.smtpPort,
      smtpSecure: EMAIL_PROVIDER_PRESETS.gmail.smtpSecure,
      smtpUser: "",
      smtpPass: "",
      smtpPassSet: false,
      fromEmail: "",
      fromName: "",
      replyTo: "",
      configured: false,
      tested: false,
      testEmailPassed: false,
      lastTestedAt: null,
      ready: false,
    };
  }
  const provider = normalizeProvider(row.provider) || "custom";
  const { configured, tested, testEmailPassed, lastTestedAt, ready } = computeSchoolEmailReadinessFlags(row);
  return {
    schoolId: row.schoolId,
    provider,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    smtpUser: row.smtpUser,
    smtpPass: maskPassword(row.smtpPass),
    smtpPassSet: Boolean(row.smtpPass),
    fromEmail: row.fromEmail,
    fromName: row.fromName || "",
    replyTo: row.replyTo || "",
    configured,
    tested,
    testEmailPassed,
    lastTestedAt,
    ready,
  };
}

/** Build public SMTP settings from DB — does not mutate rows (avoids clearing test status on read). */
export async function buildPublicSchoolEmailSettings(schoolId: string): Promise<SchoolEmailSettingsPublic> {
  const [row, branding] = await Promise.all([
    getSchoolEmailSettingsRow(schoolId),
    loadSchoolEmailBranding(schoolId),
  ]);
  const base = applySchoolSenderDefaults(toPublicSettings(row, schoolId), branding);
  return applyDevTestSchoolEmailPrefill(schoolId, base);
}

export async function getPublicSchoolEmailSettings(schoolId: string): Promise<SchoolEmailSettingsPublic> {
  return buildPublicSchoolEmailSettings(schoolId);
}

export function buildSetupRequiredPayload() {
  return {
    error: SETUP_REQUIRED_MESSAGE,
    setupRequired: true as const,
  };
}

export async function getSchoolEmailSettingsRow(schoolId: string) {
  return prisma.schoolEmailSettings.findUnique({ where: { schoolId } });
}

export async function isSchoolEmailConfigured(schoolId: string) {
  const row = await getSchoolEmailSettingsRow(schoolId);
  return isSmtpRowConfigured(row);
}

export async function isSchoolEmailReady(schoolId: string) {
  const row = await getSchoolEmailSettingsRow(schoolId);
  return isSchoolEmailReadyFromRow(row);
}

/** Persist registration email as default From/Reply-To before SMTP credentials are saved. */
export async function seedSchoolEmailDefaults(schoolId: string) {
  if (await isDevTestSchool(schoolId)) {
    await ensureDevTestSchoolEmailConfigured(schoolId);
    return;
  }
  const branding = await loadSchoolEmailBranding(schoolId);
  if (!branding.schoolEmail) return;
  const existing = await getSchoolEmailSettingsRow(schoolId);
  if (existing) return;
  const preset = EMAIL_PROVIDER_PRESETS.gmail;
  await prisma.schoolEmailSettings.create({
    data: {
      schoolId,
      provider: "gmail",
      smtpHost: preset.smtpHost,
      smtpPort: preset.smtpPort,
      smtpSecure: preset.smtpSecure,
      smtpUser: "",
      smtpPass: "",
      fromEmail: branding.schoolEmail,
      fromName: branding.schoolName,
      replyTo: branding.schoolEmail,
    },
  });
}

function smtpCredentialsChanged(existing: SchoolEmailSettings, resolved: ReturnType<typeof applyProviderDefaults>) {
  return (
    existing.smtpHost !== resolved.smtpHost ||
    existing.smtpUser !== resolved.smtpUser ||
    existing.smtpPass !== resolved.smtpPass ||
    existing.fromEmail !== resolved.fromEmail
  );
}

export async function saveSchoolEmailSettings(schoolId: string, input: SchoolEmailSettingsInput) {
  const mergedDevInput = await mergeDevTestSchoolSaveInput(schoolId, input);
  const provider = normalizeProvider(String(mergedDevInput.provider || ""));
  if (!provider) {
    return { ok: false as const, errors: ["Provider must be gmail, outlook, icloud, yahoo, or custom."] };
  }

  const branding = await loadSchoolEmailBranding(schoolId);
  const existing = await getSchoolEmailSettingsRow(schoolId);
  const mergedInput: SchoolEmailSettingsInput = { ...mergedDevInput };
  if (await isDevTestSchool(schoolId)) {
    const devTemplate = devTestSchoolSmtpTemplate();
    if (!String(mergedInput.fromEmail || "").trim()) mergedInput.fromEmail = devTemplate.fromEmail;
    if (!String(mergedInput.fromName || "").trim()) mergedInput.fromName = devTemplate.fromName;
    if (!String(mergedInput.replyTo || "").trim()) mergedInput.replyTo = devTemplate.replyTo;
    if (!String(mergedInput.smtpUser || "").trim()) mergedInput.smtpUser = devTemplate.smtpUser;
  }
  if (branding.schoolEmail) {
    if (!String(mergedInput.fromEmail || "").trim()) mergedInput.fromEmail = branding.schoolEmail;
    if (!String(mergedInput.fromName || "").trim()) mergedInput.fromName = branding.schoolName;
    if (!String(mergedInput.replyTo || "").trim()) mergedInput.replyTo = branding.schoolEmail;
  }
  if (
    mergedInput.smtpPass === undefined ||
    mergedInput.smtpPass === MASKED_PASSWORD ||
    mergedInput.smtpPass === ""
  ) {
    mergedInput.smtpPass = existing?.smtpPass || "";
  }

  const resolved = applyProviderDefaults(provider, mergedInput);
  const errors = validateSchoolEmailSettings(resolved, {
    requirePassword: true,
    existingPass: existing?.smtpPass,
  });
  if (errors.length) return { ok: false as const, errors };

  const data = {
    provider,
    smtpHost: resolved.smtpHost,
    smtpPort: resolved.smtpPort,
    smtpSecure: resolved.smtpSecure,
    smtpUser: resolved.smtpUser,
    smtpPass: resolved.smtpPass,
    fromEmail: resolved.fromEmail,
    fromName: resolved.fromName,
    replyTo: resolved.replyTo || null,
    ...(existing && smtpCredentialsChanged(existing, resolved) ? { testEmailPassedAt: null } : {}),
  };

  const row = await prisma.schoolEmailSettings.upsert({
    where: { schoolId },
    create: { schoolId, ...data },
    update: data,
  });

  const saved = applySchoolSenderDefaults(toPublicSettings(row, schoolId), branding);
  return {
    ok: true as const,
    settings: await applyDevTestSchoolEmailPrefill(schoolId, saved),
  };
}

function formatFromAddress(fromName: string, fromEmail: string) {
  const email = fromEmail.trim();
  const name = fromName.trim();
  if (!name) return email;
  return `"${name.replace(/"/g, '\\"')}" <${email}>`;
}

export function createTransportFromSettings(row: SchoolEmailSettings) {
  const port = row.smtpPort;
  const secure = row.smtpSecure || port === 465;
  return nodemailer.createTransport({
    host: row.smtpHost,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: {
      user: row.smtpUser,
      pass: row.smtpPass,
    },
  });
}

export type SendSchoolEmailInput = {
  to: string;
  subject: string;
  html: string;
  attachments?: {
    filename: string;
    content: Buffer | string;
    contentType?: string;
  }[];
  /** Ignored — reply-to is resolved server-side per school (SMTP replyTo → registered school email). */
  replyTo?: string;
};

/** Resolve Reply-To for outbound mail (ignores client-supplied values). */
export async function resolveReplyToForSchoolSend(schoolId: string): Promise<string> {
  const [row, branding] = await Promise.all([
    getSchoolEmailSettingsRow(schoolId),
    loadSchoolEmailBranding(schoolId),
  ]);
  const publicSmtp = applySchoolSenderDefaults(toPublicSettings(row, schoolId), branding);
  const smtp = row ? smtpSenderFromPublic(publicSmtp) : null;
  return resolveSchoolReplyToEmail(null, branding, smtp);
}

export async function sendSchoolEmail(schoolId: string, input: SendSchoolEmailInput) {
  const row = await getSchoolEmailSettingsRow(schoolId);
  if (!row || !(await isSchoolEmailConfigured(schoolId))) {
    const err = new Error(SETUP_REQUIRED_MESSAGE) as Error & { setupRequired?: boolean };
    err.setupRequired = true;
    throw err;
  }

  const transporter = createTransportFromSettings(row);
  const from = formatFromAddress(row.fromName, row.fromEmail);
  const replyTo = await resolveReplyToForSchoolSend(schoolId);

  return transporter.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    replyTo,
    attachments: input.attachments || [],
  });
}

export async function testSchoolEmailConnection(schoolId: string, testTo?: string) {
  const row = await getSchoolEmailSettingsRow(schoolId);
  if (!row || !(await isSchoolEmailConfigured(schoolId))) {
    return { ok: false as const, error: SETUP_REQUIRED_MESSAGE, setupRequired: true };
  }

  const to = String(testTo || row.fromEmail || row.smtpUser).trim();
  if (!to || !isValidEmail(to)) {
    return { ok: false as const, error: "A valid test recipient email is required." };
  }

  try {
    const result = await sendSchoolEmail(schoolId, {
      to,
      subject: "EduClear — Test Email",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5">
        <p>This is a test message from EduClear.</p>
        <p>If you received this email, your school's SMTP settings are working.</p>
      </div>`,
    });
    const passedAt = new Date();
    const updated = await prisma.schoolEmailSettings.update({
      where: { schoolId },
      data: { testEmailPassedAt: passedAt },
    });
    const branding = await loadSchoolEmailBranding(schoolId);
    let settings = applySchoolSenderDefaults(toPublicSettings(updated, schoolId), branding);
    settings = await applyDevTestSchoolEmailPrefill(schoolId, settings);
    return {
      ok: true as const,
      messageId: result.messageId,
      sentTo: to,
      settings,
      lastTestedAt: passedAt.toISOString(),
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false as const, error: message };
  }
}
