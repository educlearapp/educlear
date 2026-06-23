import nodemailer from "nodemailer";
import type { SchoolEmailSettings } from "@prisma/client";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { prisma } from "../prisma";
import { isProductionRuntime } from "./runtime";
import {
  EDUCLEAR_RELAY_FROM_EMAIL,
  resolveSchoolReplyToEmail,
  smtpSenderFromPublic,
} from "../communication/schoolSender";

export type EmailProviderType = "platform" | "gmail" | "outlook" | "icloud" | "yahoo" | "custom";

export type SchoolEmailSettingsInput = {
  provider?: string;
  schoolEmail?: string;
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
  schoolEmail: string;
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
  platform: {
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    hint: "EduClear sends through the central platform mail service. Schools do not configure SMTP.",
  },
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
const RESEND_EMAIL_API_URL = "https://api.resend.com/emails";
const SMTP_TRANSPORT_TIMEOUT_MS = 12_000;
const SMTP_SEND_DEADLINE_MS = 20_000;
const SETUP_REQUIRED_MESSAGE =
  "School email address is missing. Add the school's email address before sending email.";

const RENDER_SMTP_BLOCKED_HINT =
  "EduClear's central email service could not connect to its configured mail provider. Check the platform email provider settings.";

function platformFromEmail() {
  return (
    process.env.EDUCLEAR_MAIL_FROM_EMAIL?.trim() ||
    process.env.EDUCLEAR_SMTP_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    process.env.SMTP_USER?.trim() ||
    EDUCLEAR_RELAY_FROM_EMAIL
  );
}

function resendApiKey() {
  return process.env.RESEND_API_KEY?.trim() || "";
}

function hasResendProvider() {
  return Boolean(resendApiKey());
}

function platformSmtpOptions(): SMTPTransport.Options | null {
  const host = process.env.EDUCLEAR_SMTP_HOST?.trim() || process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(process.env.EDUCLEAR_SMTP_PORT || process.env.SMTP_PORT || "587");
  const secure =
    process.env.EDUCLEAR_SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "true" ||
    port === 465;
  const user = process.env.EDUCLEAR_SMTP_USER?.trim() || process.env.SMTP_USER?.trim();
  const pass = process.env.EDUCLEAR_SMTP_PASS || process.env.SMTP_PASS;
  return {
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    ...(user && pass ? { auth: { user, pass } } : {}),
    connectionTimeout: SMTP_TRANSPORT_TIMEOUT_MS,
    greetingTimeout: SMTP_TRANSPORT_TIMEOUT_MS,
    socketTimeout: SMTP_TRANSPORT_TIMEOUT_MS,
    tls: {
      minVersion: "TLSv1.2",
    },
  };
}

function createPlatformTransport() {
  const options = platformSmtpOptions();
  if (!options) {
    throw new Error("EduClear central email service is not configured. Set platform SMTP settings on the server.");
  }
  return nodemailer.createTransport(options);
}

function isLikelySmtpNetworkFailure(code: string, message: string): boolean {
  const normalized = `${code} ${message}`.toUpperCase();
  return (
    normalized.includes("ETIMEDOUT") ||
    normalized.includes("ECONNREFUSED") ||
    normalized.includes("ECONNRESET") ||
    normalized.includes("ESOCKET") ||
    normalized.includes("ETIMEOUT") ||
    normalized.includes("CONNECTION TIMED OUT") ||
    normalized.includes("CONNECTION TIMEOUT")
  );
}

export function formatSmtpError(e: unknown): string {
  if (!e) return "SMTP error";
  if (e instanceof Error) {
    const err = e as Error & { code?: string; response?: string; responseCode?: number };
    const parts = [err.message].filter(Boolean);
    if (err.code) parts.push(`(${err.code})`);
    if (err.responseCode) parts.push(`SMTP ${err.responseCode}`);
    const response = String(err.response || "").trim();
    if (response) parts.push(response.slice(0, 240));
    if (isLikelySmtpNetworkFailure(String(err.code || ""), err.message) && isProductionRuntime()) {
      parts.push(RENDER_SMTP_BLOCKED_HINT);
    }
    return parts.join(" — ");
  }
  return String(e);
}

function withSendDeadline<T>(promise: Promise<T>, label: string, deadlineMs = SMTP_SEND_DEADLINE_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `${label} timed out after ${Math.round(deadlineMs / 1000)}s. Check SMTP host, port, TLS mode, and credentials.`
        )
      );
    }, deadlineMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function normalizeResendRecipient(to: SendSchoolEmailInput["to"]): string[] {
  return Array.isArray(to) ? to.map(String).filter(Boolean) : [String(to || "").trim()].filter(Boolean);
}

function attachmentContentToBase64(content: Buffer | string) {
  if (Buffer.isBuffer(content)) return content.toString("base64");
  return Buffer.from(String(content), "utf8").toString("base64");
}

function formatResendError(status: number, body: string) {
  const trimmed = body.trim();
  if (!trimmed) return `Resend email send failed with HTTP ${status}`;
  try {
    const parsed = JSON.parse(trimmed) as { message?: string; name?: string; error?: string };
    return parsed.message || parsed.error || `${parsed.name || "Resend error"} (HTTP ${status})`;
  } catch {
    return `Resend email send failed with HTTP ${status}: ${trimmed.slice(0, 240)}`;
  }
}

async function sendWithResend(input: {
  from: string;
  to: SendSchoolEmailInput["to"];
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: SendSchoolEmailInput["attachments"];
}) {
  const apiKey = resendApiKey();
  if (!apiKey) {
    throw new Error("Resend is not configured. Set RESEND_API_KEY on the server.");
  }

  const response = await withSendDeadline(
    fetch(RESEND_EMAIL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from,
        to: normalizeResendRecipient(input.to),
        subject: input.subject,
        html: input.html,
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
        ...(input.attachments?.length
          ? {
              attachments: input.attachments.map((attachment) => ({
                filename: attachment.filename,
                content: attachmentContentToBase64(attachment.content),
                ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
              })),
            }
          : {}),
      }),
    }),
    "EduClear Resend email send"
  );

  const body = await response.text();
  if (!response.ok) {
    throw new Error(formatResendError(response.status, body));
  }
  const parsed = body ? (JSON.parse(body) as { id?: string }) : {};
  return { messageId: parsed.id || "" };
}

export function normalizeProvider(raw: string): EmailProviderType | null {
  const p = String(raw || "")
    .trim()
    .toLowerCase();
  if (!p || p === "platform" || p === "educlear") return "platform";
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
  if (provider === "platform") {
    return {
      provider,
      smtpHost: "",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "",
      smtpPass: "",
      fromEmail: platformFromEmail(),
      fromName: String(input.fromName || "").trim(),
      replyTo: String(input.replyTo || input.schoolEmail || "").trim(),
    };
  }
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
  if (resolved.provider === "platform") {
    if (resolved.replyTo && !isValidEmail(resolved.replyTo)) {
      errors.push("Reply-to must be a valid email address when provided.");
    }
    return errors;
  }
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
  const hasSchoolEmail = isValidEmail(schoolEmail);
  return {
    ...settings,
    provider: "platform",
    schoolEmail,
    fromEmail: platformFromEmail(),
    fromName: String(settings.fromName || "").trim() || branding.schoolName.trim() || "School",
    replyTo: String(settings.replyTo || "").trim() || schoolEmail,
    configured: hasSchoolEmail,
    ready: hasSchoolEmail,
  };
}

export function isSmtpRowConfigured(row: SchoolEmailSettings | null | undefined) {
  return Boolean(row?.smtpHost && row?.smtpUser && row?.smtpPass && row?.fromEmail);
}

/** Legacy SMTP readiness. School-facing email readiness is based on registered school email. */
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
      schoolEmail: "",
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
    schoolEmail: "",
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
  await seedSchoolEmailDefaults(schoolId);
  const [row, branding] = await Promise.all([
    getSchoolEmailSettingsRow(schoolId),
    loadSchoolEmailBranding(schoolId),
  ]);
  const base = applySchoolSenderDefaults(toPublicSettings(row, schoolId), branding);
  return base;
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
  const branding = await loadSchoolEmailBranding(schoolId);
  return isValidEmail(branding.schoolEmail);
}

export async function isSchoolEmailReady(schoolId: string) {
  return isSchoolEmailConfigured(schoolId);
}

/** Persist registration email as default sender metadata for the platform mail service. */
export async function seedSchoolEmailDefaults(schoolId: string) {
  const branding = await loadSchoolEmailBranding(schoolId);
  if (!branding.schoolEmail) return;
  const existing = await getSchoolEmailSettingsRow(schoolId);
  if (existing) return;
  await prisma.schoolEmailSettings.create({
    data: {
      schoolId,
      provider: "platform",
      smtpHost: "",
      smtpPort: 587,
      smtpSecure: false,
      smtpUser: "",
      smtpPass: "",
      fromEmail: platformFromEmail(),
      fromName: branding.schoolName,
      replyTo: branding.schoolEmail,
    },
  });
}

export async function saveSchoolEmailSettings(schoolId: string, input: SchoolEmailSettingsInput) {
  const branding = await loadSchoolEmailBranding(schoolId);
  const existing = await getSchoolEmailSettingsRow(schoolId);
  const schoolEmail = String(input.schoolEmail || input.replyTo || branding.schoolEmail || "").trim();
  const fromName = String(input.fromName || branding.schoolName || "").trim() || "School";
  const replyTo = String(input.replyTo || schoolEmail).trim();
  const errors: string[] = [];
  if (schoolEmail && !isValidEmail(schoolEmail)) errors.push("School email address must be a valid email address.");
  if (replyTo && !isValidEmail(replyTo)) errors.push("Reply-to must be a valid email address.");
  if (errors.length) return { ok: false as const, errors };

  const data = {
    provider: "platform",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPass: "",
    fromEmail: platformFromEmail(),
    fromName,
    replyTo: replyTo || null,
  };

  if (schoolEmail && schoolEmail !== branding.schoolEmail) {
    await prisma.school.update({
      where: { id: schoolId },
      data: { email: schoolEmail },
    });
  }

  const row = await prisma.schoolEmailSettings.upsert({
    where: { schoolId },
    create: { schoolId, ...data },
    update: data,
  });

  const updatedBranding = await loadSchoolEmailBranding(schoolId);
  const saved = applySchoolSenderDefaults(toPublicSettings(row, schoolId), updatedBranding);
  return {
    ok: true as const,
    settings: saved,
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
  const transportOptions: SMTPTransport.Options = {
    host: row.smtpHost,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: {
      user: row.smtpUser,
      pass: row.smtpPass,
    },
    connectionTimeout: SMTP_TRANSPORT_TIMEOUT_MS,
    greetingTimeout: SMTP_TRANSPORT_TIMEOUT_MS,
    socketTimeout: SMTP_TRANSPORT_TIMEOUT_MS,
    tls: {
      minVersion: "TLSv1.2",
    },
  };
  return nodemailer.createTransport(transportOptions);
}

export async function sendMailWithSettings(
  _row: SchoolEmailSettings,
  mail: Parameters<ReturnType<typeof nodemailer.createTransport>["sendMail"]>[0]
) {
  if (hasResendProvider()) {
    return sendWithResend({
      from: String(mail.from || platformFromEmail()),
      to: String(mail.to || ""),
      subject: String(mail.subject || ""),
      html: String(mail.html || ""),
      replyTo: mail.replyTo ? String(mail.replyTo) : undefined,
      attachments: Array.isArray(mail.attachments)
        ? mail.attachments.map((attachment) => ({
            filename: String(attachment.filename || "attachment"),
            content:
              typeof attachment.content === "string" || Buffer.isBuffer(attachment.content)
                ? attachment.content
                : Buffer.from(String(attachment.content || "")),
            contentType: attachment.contentType,
          }))
        : [],
    });
  }

  const transporter = createPlatformTransport();
  try {
    return await withSendDeadline(transporter.sendMail(mail), "EduClear email send");
  } finally {
    transporter.close();
  }
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
  /** Ignored — reply-to is resolved server-side per school (saved replyTo → registered school email). */
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
  await seedSchoolEmailDefaults(schoolId);
  const [row, branding] = await Promise.all([
    getSchoolEmailSettingsRow(schoolId),
    loadSchoolEmailBranding(schoolId),
  ]);
  if (!isValidEmail(branding.schoolEmail)) {
    const err = new Error(SETUP_REQUIRED_MESSAGE) as Error & { setupRequired?: boolean };
    err.setupRequired = true;
    throw err;
  }

  const fromName = String(branding.schoolName || "School").trim() || "School";
  const from = formatFromAddress(fromName, platformFromEmail());
  const replyTo = await resolveReplyToForSchoolSend(schoolId);
  if (hasResendProvider()) {
    return sendWithResend({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo,
      attachments: input.attachments || [],
    });
  }

  const transporter = createPlatformTransport();

  try {
    return await withSendDeadline(
      transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        replyTo,
        attachments: input.attachments || [],
      }),
      "EduClear email send"
    );
  } finally {
    transporter.close();
  }
}

export async function testSchoolEmailConnection(schoolId: string, testTo?: string) {
  await seedSchoolEmailDefaults(schoolId);
  const [, branding] = await Promise.all([
    getSchoolEmailSettingsRow(schoolId),
    loadSchoolEmailBranding(schoolId),
  ]);
  if (!isValidEmail(branding.schoolEmail)) {
    return { ok: false as const, error: SETUP_REQUIRED_MESSAGE, setupRequired: true };
  }

  const to = String(testTo || branding.schoolEmail).trim();
  if (!to || !isValidEmail(to)) {
    return { ok: false as const, error: "A valid test recipient email is required." };
  }

  try {
    console.info(`[school-email] sending platform test email schoolId=${schoolId} to=${to}`);
    const result = await sendSchoolEmail(schoolId, {
      to,
      subject: "EduClear — Test Email",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.5">
        <p>This is a test message from EduClear.</p>
        <p>If you received this email, EduClear's central email service is working for ${branding.schoolName}.</p>
      </div>`,
    });
    console.info(`[school-email] test email sent schoolId=${schoolId} messageId=${result.messageId || "n/a"}`);
    const passedAt = new Date();
    const updated = await prisma.schoolEmailSettings.upsert({
      where: { schoolId },
      create: {
        schoolId,
        provider: "platform",
        smtpHost: "",
        smtpPort: 587,
        smtpSecure: false,
        smtpUser: "",
        smtpPass: "",
        fromEmail: platformFromEmail(),
        fromName: branding.schoolName,
        replyTo: branding.schoolEmail,
        testEmailPassedAt: passedAt,
      },
      update: { testEmailPassedAt: passedAt },
    });
    let settings = applySchoolSenderDefaults(toPublicSettings(updated, schoolId), branding);
    return {
      ok: true as const,
      messageId: result.messageId,
      sentTo: to,
      settings,
      lastTestedAt: passedAt.toISOString(),
    };
  } catch (e: unknown) {
    const message = formatSmtpError(e);
    console.error(`[school-email] test failed schoolId=${schoolId} to=${to}:`, e);
    return { ok: false as const, error: message };
  }
}
