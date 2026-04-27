import { Router } from "express";
import { prisma } from "../prisma";
import { sendSchoolEmail } from "../email/schoolEmailSender";

const router = Router();

function asString(v: unknown) {
  return String(v ?? "").trim();
}

function asInt(v: unknown, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function asBool(v: unknown, fallback = false) {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return v.trim().toLowerCase() === "true";
  return fallback;
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function maskPass(pass: string | null | undefined) {
  return pass ? "********" : "";
}

router.get("/:schoolId", async (req, res) => {
  try {
    const schoolId = asString(req.params.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const settings = await prisma.schoolEmailSettings.findUnique({
      where: { schoolId },
    });

    if (!settings) {
      return res.json({ ok: true, settings: null });
    }

    return res.json({
      ok: true,
      settings: {
        id: settings.id,
        schoolId: settings.schoolId,
        provider: settings.provider ?? null,
        smtpHost: settings.smtpHost,
        smtpPort: settings.smtpPort,
        smtpSecure: settings.smtpSecure,
        smtpUser: settings.smtpUser,
        smtpPass: maskPass(settings.smtpPass),
        smtpFrom: settings.smtpFrom ?? null,
        replyTo: settings.replyTo ?? null,
        createdAt: settings.createdAt,
        updatedAt: settings.updatedAt,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to load school email settings" });
  }
});

router.post("/:schoolId", async (req, res) => {
  try {
    const schoolId = asString(req.params.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const school = await prisma.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) return res.status(404).json({ ok: false, error: "School not found" });

    const body = req.body ?? {};

    const provider = asString(body.provider) || null;
    const smtpHost = asString(body.smtpHost);
    const smtpPort = asInt(body.smtpPort, 587);
    const smtpSecure = asBool(body.smtpSecure, false);
    const smtpUser = asString(body.smtpUser);
    const smtpPassRaw = asString(body.smtpPass);
    const smtpFrom = asString(body.smtpFrom) || null;
    const replyTo = asString(body.replyTo) || null;

    if (!smtpHost) return res.status(400).json({ ok: false, error: "smtpHost is required" });
    if (!(smtpPort > 0 && smtpPort <= 65535)) return res.status(400).json({ ok: false, error: "smtpPort must be 1-65535" });
    if (!smtpUser) return res.status(400).json({ ok: false, error: "smtpUser is required" });

    const existing = await prisma.schoolEmailSettings.findUnique({ where: { schoolId } });

    const shouldUpdatePass =
      Boolean(smtpPassRaw) && smtpPassRaw !== "********";

    if (!existing && !shouldUpdatePass) {
      return res.status(400).json({ ok: false, error: "smtpPass is required for initial setup" });
    }

    const updated = await prisma.schoolEmailSettings.upsert({
      where: { schoolId },
      create: {
        schoolId,
        provider,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUser,
        smtpPass: smtpPassRaw,
        smtpFrom,
        replyTo,
      },
      update: {
        provider,
        smtpHost,
        smtpPort,
        smtpSecure,
        smtpUser,
        ...(shouldUpdatePass ? { smtpPass: smtpPassRaw } : {}),
        smtpFrom,
        replyTo,
      },
    });

    return res.json({
      ok: true,
      settings: {
        id: updated.id,
        schoolId: updated.schoolId,
        provider: updated.provider ?? null,
        smtpHost: updated.smtpHost,
        smtpPort: updated.smtpPort,
        smtpSecure: updated.smtpSecure,
        smtpUser: updated.smtpUser,
        smtpPass: maskPass(updated.smtpPass),
        smtpFrom: updated.smtpFrom ?? null,
        replyTo: updated.replyTo ?? null,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e?.message || "Failed to save school email settings" });
  }
});

router.post("/:schoolId/test", async (req, res) => {
  try {
    const schoolId = asString(req.params.schoolId);
    if (!schoolId) return res.status(400).json({ ok: false, error: "schoolId is required" });

    const body = req.body ?? {};
    const toEmail = asString(body.toEmail || body.email || body.to);
    if (!toEmail || !isEmail(toEmail)) {
      return res.status(400).json({ ok: false, error: "A valid toEmail is required" });
    }

    await sendSchoolEmail(schoolId, {
      to: toEmail,
      subject: "EduClear — Test Email",
      text: "This is a test email from EduClear. If you received this, your outgoing email settings are working.",
      html: `<div style="font-family: Arial, Helvetica, sans-serif; line-height:1.55;">
        <h2 style="margin:0 0 10px;">EduClear Test Email</h2>
        <div>This is a test email from EduClear.</div>
        <div style="margin-top:10px;">If you received this, your outgoing email settings are working.</div>
      </div>`,
    });

    return res.json({ ok: true, message: `Test email sent to ${toEmail}` });
  } catch (e: any) {
    const msg = String(e?.message || "Failed to send test email");
    const code = String((e as any)?.code || "");
    const status = code === "EMAIL_NOT_CONFIGURED" ? 503 : 500;
    return res.status(status).json({ ok: false, error: msg });
  }
});

export default router;

