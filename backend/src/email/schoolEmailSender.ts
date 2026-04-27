import nodemailer from "nodemailer";
import type { Transporter, SendMailOptions } from "nodemailer";
import { prisma } from "../prisma";

export type SchoolEmailSettingsPublic = {
  id: string;
  schoolId: string;
  provider: string | null;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string; // masked (********) when returned from API
  smtpFrom: string | null;
  replyTo: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type ResolvedSmtpConfig =
  | {
      source: "school";
      host: string;
      port: number;
      secure: boolean;
      user: string | null;
      pass: string | null;
      from: string;
      replyTo?: string | null;
    }
  | {
      source: "env";
      host: string;
      port: number;
      secure: boolean;
      user: string | null;
      pass: string | null;
      from: string;
      replyTo?: string | null;
    };

function asTrimmedString(v: unknown): string {
  return String(v ?? "").trim();
}

function envTransportConfig(): ResolvedSmtpConfig | null {
  const host = asTrimmedString(process.env.SMTP_HOST);
  if (!host) return null;

  const port = Number(process.env.SMTP_PORT || "587");
  const secure = process.env.SMTP_SECURE === "true" || port === 465;
  const user = asTrimmedString(process.env.SMTP_USER) || null;
  const pass = process.env.SMTP_PASS ? String(process.env.SMTP_PASS) : null;

  const from =
    asTrimmedString(process.env.SMTP_FROM) ||
    user ||
    "noreply@educlear";

  const replyTo = asTrimmedString(process.env.SMTP_REPLY_TO) || null;

  return { source: "env", host, port, secure, user, pass, from, replyTo };
}

async function schoolTransportConfig(schoolId: string): Promise<ResolvedSmtpConfig | null> {
  const settings = await prisma.schoolEmailSettings.findUnique({
    where: { schoolId },
  });
  if (!settings) return null;

  const host = asTrimmedString(settings.smtpHost);
  const port = Number(settings.smtpPort || 587);
  const secure = Boolean(settings.smtpSecure);
  const user = asTrimmedString(settings.smtpUser) || null;
  const pass = settings.smtpPass ? String(settings.smtpPass) : null;

  const from =
    asTrimmedString(settings.smtpFrom) ||
    user ||
    "noreply@educlear";

  const replyTo = asTrimmedString(settings.replyTo) || null;

  return { source: "school", host, port, secure, user, pass, from, replyTo };
}

export async function resolveSmtpConfigForSchoolOrThrow(schoolId: string): Promise<ResolvedSmtpConfig> {
  const schoolCfg = await schoolTransportConfig(schoolId);
  if (schoolCfg) return schoolCfg;

  const envCfg = envTransportConfig();
  if (envCfg) return envCfg;

  const err = new Error(
    "Email is not configured for this school. Configure School Email Settings, or set SMTP_HOST (and SMTP_USER / SMTP_PASS if required) on the server."
  );
  (err as any).code = "EMAIL_NOT_CONFIGURED";
  throw err;
}

export async function createSchoolMailer(schoolId: string): Promise<{
  transporter: Transporter;
  from: string;
  replyTo?: string | null;
  source: "school" | "env";
}> {
  const cfg = await resolveSmtpConfigForSchoolOrThrow(schoolId);
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user && cfg.pass ? { user: cfg.user, pass: String(cfg.pass) } : undefined,
  });
  return { transporter, from: cfg.from, replyTo: cfg.replyTo ?? null, source: cfg.source };
}

export async function sendSchoolEmail(
  schoolId: string,
  options: Omit<SendMailOptions, "from"> & { from?: string }
): Promise<{ messageId: string | undefined; source: "school" | "env" }> {
  const { transporter, from, replyTo, source } = await createSchoolMailer(schoolId);
  const result = await transporter.sendMail({
    ...options,
    from: options.from || from,
    ...(replyTo ? { replyTo } : {}),
  });
  return { messageId: (result as any)?.messageId, source };
}

