import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../prisma";
import { getPublicSchoolEmailSettings } from "../services/schoolEmailService";
import { sendSchoolEmail } from "../services/schoolEmailService";
import {
  loadCommunicationRecipients,
  type CommunicationRecipientChannel,
  type CommunicationRecipientKind,
} from "../services/communicationRecipientService";
import {
  applyEmailTemplateTokens,
  formatComposeSenderLabel,
  resolveEmailSignature,
  resolveSchoolReplyToEmail,
  resolveSchoolSenderEmail,
  smtpSenderFromPublic,
} from "../communication/schoolSender";

import { normalizeSaPhone } from "../services/parentPortalService";
import {
  checkSchoolSmsCreditBalance,
  isSchoolSmsReady,
  sendSchoolSms,
  testSchoolSmsConnection,
} from "../services/schoolSmsService";
import { WinSmsApiError } from "../services/winSmsClient";

const router = Router();
const DATA_FILE = path.join(process.cwd(), "data", "communication-store.json");

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
};

type EmailContact = {
  id: string;
  contactName: string;
  relationship: string;
  email: string;
  attachments: string[];
  status: string;
};

type EmailRecord = {
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

type SmsContact = {
  id: string;
  contactName: string;
  relationship: string;
  cellNo: string;
  status: string;
};

type SmsRecord = {
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

type SchoolStore = {
  settings: CommunicationSettings;
  emailBalance: number;
  smsCredits: number;
  winSmsCredits: number;
  emails: EmailRecord[];
  sms: SmsRecord[];
};

type Store = {
  schools: Record<string, SchoolStore>;
};

function defaultSettings(): CommunicationSettings {
  return {
    sendViaEduClearDomain: false,
    administrationEmail: "",
    administrationCcSelf: false,
    billingEmail: "",
    billingCcSelf: false,
    signature: "Kind regards,\n[school_name]",
    standardEmailSubject: "[school_name] — [document_type] [document_no]",
    standardEmailMessage:
      "Dear [contact_name],\n\nPlease find your [document_type] ([document_no]) attached.\n\n[school_name]\n\n[signature]",
    standardSmsMessage:
      "Dear [contact_name], your [document_type] [document_no] from [school_name] is ready. Contact the school for details.",
    smsProvider: "WinSMS",
    winSmsUsername: "",
    winSmsPassword: "",
  };
}

function defaultSchoolStore(): SchoolStore {
  return {
    settings: defaultSettings(),
    emailBalance: 5000,
    smsCredits: 1200,
    winSmsCredits: 800,
    emails: [],
    sms: [],
  };
}

function ensureStore(): Store {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial: Store = { schools: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.schools ? parsed : { schools: {} };
  } catch {
    return { schools: {} };
  }
}

function writeStore(store: Store) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function getSchoolStore(store: Store, schoolId: string): SchoolStore {
  if (!store.schools[schoolId]) {
    store.schools[schoolId] = defaultSchoolStore();
    writeStore(store);
  }
  return store.schools[schoolId];
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function maskPassword(password: string) {
  if (!password) return "";
  return "********";
}

function settingsForClient(settings: CommunicationSettings) {
  return {
    ...settings,
    winSmsPassword: maskPassword(settings.winSmsPassword),
    winSmsPasswordSet: Boolean(settings.winSmsPassword),
  };
}

function mergeSettings(
  current: CommunicationSettings,
  incoming: Partial<CommunicationSettings> & { winSmsPassword?: string }
): CommunicationSettings {
  const next = { ...current, ...incoming };
  if (incoming.winSmsPassword === undefined || incoming.winSmsPassword === "********") {
    next.winSmsPassword = current.winSmsPassword;
  }
  return next;
}

async function loadSchoolBranding(schoolId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, email: true },
  });
  if (!school) return null;
  return {
    schoolId: school.id,
    schoolName: school.name || "School",
    schoolEmail: school.email || "",
  };
}

router.get("/settings", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const schoolStore = getSchoolStore(store, schoolId);
    const [branding, smtpPublic] = await Promise.all([
      loadSchoolBranding(schoolId),
      getPublicSchoolEmailSettings(schoolId).catch(() => null),
    ]);
    const schoolName = branding?.schoolName || "School";
    const schoolEmail = branding?.schoolEmail || "";
    const schoolCtx = { schoolName, schoolEmail };
    const smtp = smtpPublic ? smtpSenderFromPublic(smtpPublic) : null;
    const clientSettings = settingsForClient(schoolStore.settings);
    const senderEmail = resolveSchoolSenderEmail(schoolStore.settings, schoolCtx, smtp);
    const replyToEmail = resolveSchoolReplyToEmail(schoolStore.settings, schoolCtx, smtp);
    const senderLabel = formatComposeSenderLabel(schoolStore.settings, schoolCtx, smtp);
    return res.json({
      success: true,
      settings: {
        ...clientSettings,
        signature: resolveEmailSignature(clientSettings.signature, schoolName),
      },
      emailBalance: schoolStore.emailBalance,
      smsCredits: schoolStore.smsCredits,
      winSmsCredits: schoolStore.winSmsCredits,
      schoolName,
      schoolEmail,
      senderEmail,
      senderLabel,
      replyToEmail,
    });
  } catch (error) {
    console.error("[communication] GET settings failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const schoolStore = getSchoolStore(store, schoolId);
    schoolStore.settings = mergeSettings(schoolStore.settings, req.body?.settings || {});
    writeStore(store);
    const [branding, smtpPublic] = await Promise.all([
      loadSchoolBranding(schoolId),
      getPublicSchoolEmailSettings(schoolId).catch(() => null),
    ]);
    const schoolName = branding?.schoolName || "School";
    const schoolEmail = branding?.schoolEmail || "";
    const schoolCtx = { schoolName, schoolEmail };
    const smtp = smtpPublic ? smtpSenderFromPublic(smtpPublic) : null;
    const clientSettings = settingsForClient(schoolStore.settings);
    const senderEmail = resolveSchoolSenderEmail(schoolStore.settings, schoolCtx, smtp);
    const replyToEmail = resolveSchoolReplyToEmail(schoolStore.settings, schoolCtx, smtp);
    const senderLabel = formatComposeSenderLabel(schoolStore.settings, schoolCtx, smtp);
    return res.json({
      success: true,
      settings: {
        ...clientSettings,
        signature: resolveEmailSignature(clientSettings.signature, schoolName),
      },
      emailBalance: schoolStore.emailBalance,
      smsCredits: schoolStore.smsCredits,
      winSmsCredits: schoolStore.winSmsCredits,
      schoolName,
      schoolEmail,
      senderEmail,
      senderLabel,
      replyToEmail,
    });
  } catch (error) {
    console.error("[communication] PUT settings failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/settings/test-sms", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const apiKey = String(req.body?.apiKey || req.body?.winSmsApiKey || "").trim();
    const result = await testSchoolSmsConnection(schoolId, apiKey || undefined);
    if (!result.ok) {
      return res.status(400).json({
        success: false,
        ok: false,
        error: result.error,
        settings: result.settings,
      });
    }

    return res.json({
      success: true,
      ok: true,
      message: result.message,
      creditBalance: result.creditBalance,
      provider: "WinSMS",
      settings: result.settings,
    });
  } catch (error) {
    console.error("[communication] test-sms failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/contacts", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const channel = String(req.query.channel || "email").trim() as CommunicationRecipientChannel;
    const kind = String(req.query.kind || "parents").trim() as CommunicationRecipientKind;
    const className = String(req.query.className || "").trim();
    const result = await loadCommunicationRecipients({
      schoolId,
      channel: channel === "sms" ? "sms" : "email",
      kind,
      className,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[communication] GET contacts failed:", error);
    return res.status(500).json({ success: false, error: "Failed to load contacts" });
  }
});

router.get("/emails", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const emails = [...school.emails].sort((a, b) => b.date.localeCompare(a.date));
    return res.json({
      success: true,
      emails,
      emailBalance: school.emailBalance,
    });
  } catch (error) {
    console.error("[communication] GET emails failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/emails/:id", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const email = school.emails.find((e) => e.id === id);
    if (!email) return res.status(404).json({ success: false, error: "Email not found" });
    return res.json({ success: true, email });
  } catch (error) {
    console.error("[communication] GET email failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/emails", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const [branding, smtpPublic] = await Promise.all([
      loadSchoolBranding(schoolId),
      getPublicSchoolEmailSettings(schoolId).catch(() => null),
    ]);
    const schoolCtx = {
      schoolName: branding?.schoolName || "School",
      schoolEmail: branding?.schoolEmail || "",
    };
    const smtp = smtpPublic ? smtpSenderFromPublic(smtpPublic) : null;
    const defaultFromLabel = formatComposeSenderLabel(school.settings, schoolCtx, smtp);
    const now = new Date().toISOString();
    const record: EmailRecord = {
      id: newId("email"),
      schoolId,
      date: now.slice(0, 10),
      description: String(req.body?.description || "New email").trim(),
      from: String(req.body?.from || defaultFromLabel).trim(),
      subject: String(req.body?.subject || "").trim(),
      message: String(req.body?.message || "").trim(),
      contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : [],
      status: "Draft",
      createdAt: now,
      updatedAt: now,
    };
    school.emails.unshift(record);
    writeStore(store);
    return res.status(201).json({ success: true, email: record });
  } catch (error) {
    console.error("[communication] POST email failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.put("/emails/:id", (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const idx = school.emails.findIndex((e) => e.id === id);
    if (idx < 0) return res.status(404).json({ success: false, error: "Email not found" });
    const current = school.emails[idx];
    const updated: EmailRecord = {
      ...current,
      description: req.body?.description !== undefined ? String(req.body.description) : current.description,
      from: req.body?.from !== undefined ? String(req.body.from) : current.from,
      subject: req.body?.subject !== undefined ? String(req.body.subject) : current.subject,
      message: req.body?.message !== undefined ? String(req.body.message) : current.message,
      contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : current.contacts,
      updatedAt: new Date().toISOString(),
    };
    school.emails[idx] = updated;
    writeStore(store);
    return res.json({ success: true, email: updated });
  } catch (error) {
    console.error("[communication] PUT email failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.delete("/emails/:id", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    if (!id) return res.status(400).json({ success: false, error: "Missing email id" });
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const before = school.emails.length;
    school.emails = school.emails.filter((e) => e.id !== id);
    if (school.emails.length === before) {
      return res.status(404).json({ success: false, error: "Email not found" });
    }
    writeStore(store);
    return res.json({ success: true });
  } catch (error) {
    console.error("[communication] DELETE email failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

function emailBodyToHtml(body: string) {
  return `<div style="font-family:Arial,sans-serif;line-height:1.5">${String(body || "")
    .split("\n")
    .map((line) => `<p style="margin:0 0 8px">${line}</p>`)
    .join("")}</div>`;
}

router.post("/emails/:id/send", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const idx = school.emails.findIndex((e) => e.id === id);
    if (idx < 0) return res.status(404).json({ success: false, error: "Email not found" });
    const record = school.emails[idx];
    if (!record.contacts.length) {
      return res.status(400).json({ success: false, error: "Add at least one contact before sending" });
    }
    const sentAt = new Date().toISOString();
    const html = emailBodyToHtml(record.message);
    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];
    const contacts = [];
    for (const contact of record.contacts) {
      const recipient = String(contact.email || "").trim();
      if (!recipient) {
        failedCount += 1;
        contacts.push({ ...contact, status: "Failed" });
        errors.push(`${contact.contactName || "Contact"} has no email address.`);
        continue;
      }
      try {
        await sendSchoolEmail(schoolId, {
          to: recipient,
          subject: record.subject || "Message from your school",
          html,
        });
        sentCount += 1;
        contacts.push({ ...contact, status: "Sent" });
      } catch (error) {
        failedCount += 1;
        contacts.push({ ...contact, status: "Failed" });
        errors.push(error instanceof Error ? error.message : `Could not send to ${recipient}`);
      }
    }
    record.contacts = contacts;
    record.status = sentCount > 0 ? "Sent" : "Draft";
    record.sentAt = sentCount > 0 ? sentAt : undefined;
    record.updatedAt = sentAt;
    school.emails[idx] = record;
    school.emailBalance = Math.max(0, school.emailBalance - sentCount);
    writeStore(store);
    if (sentCount === 0) {
      return res.status(400).json({
        success: false,
        error: errors[0] || "Email send failed for all recipients.",
        email: record,
        emailBalance: school.emailBalance,
        simulated: false,
      });
    }
    return res.json({
      success: true,
      email: record,
      emailBalance: school.emailBalance,
      simulated: false,
      ...(failedCount > 0 ? { warning: `${failedCount} recipient(s) could not be sent.` } : {}),
    });
  } catch (error) {
    console.error("[communication] send email failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/sms", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const messages = [...school.sms].sort((a, b) => b.date.localeCompare(a.date));
    return res.json({
      success: true,
      sms: messages,
      smsCredits: school.smsCredits,
      winSmsCredits: school.winSmsCredits,
    });
  } catch (error) {
    console.error("[communication] GET sms failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/sms/:id", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const sms = school.sms.find((e) => e.id === id);
    if (!sms) return res.status(404).json({ success: false, error: "SMS not found" });
    return res.json({ success: true, sms });
  } catch (error) {
    console.error("[communication] GET sms item failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/sms", (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const now = new Date().toISOString();
    const record: SmsRecord = {
      id: newId("sms"),
      schoolId,
      date: now.slice(0, 10),
      description: String(req.body?.description || "New SMS").trim(),
      message: String(req.body?.message || "").trim(),
      contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : [],
      status: "Draft",
      createdAt: now,
      updatedAt: now,
    };
    school.sms.unshift(record);
    writeStore(store);
    return res.status(201).json({ success: true, sms: record });
  } catch (error) {
    console.error("[communication] POST sms failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.put("/sms/:id", (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const idx = school.sms.findIndex((e) => e.id === id);
    if (idx < 0) return res.status(404).json({ success: false, error: "SMS not found" });
    const current = school.sms[idx];
    const updated: SmsRecord = {
      ...current,
      description: req.body?.description !== undefined ? String(req.body.description) : current.description,
      message: req.body?.message !== undefined ? String(req.body.message) : current.message,
      contacts: Array.isArray(req.body?.contacts) ? req.body.contacts : current.contacts,
      updatedAt: new Date().toISOString(),
    };
    school.sms[idx] = updated;
    writeStore(store);
    return res.json({ success: true, sms: updated });
  } catch (error) {
    console.error("[communication] PUT sms failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.delete("/sms/:id", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    if (!id) return res.status(400).json({ success: false, error: "Missing SMS id" });
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const before = school.sms.length;
    school.sms = school.sms.filter((e) => e.id !== id);
    if (school.sms.length === before) {
      return res.status(404).json({ success: false, error: "SMS not found" });
    }
    writeStore(store);
    return res.json({ success: true });
  } catch (error) {
    console.error("[communication] DELETE sms failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/sms/:id/send", async (req, res) => {
  const schoolId = String(req.body?.schoolId || "").trim();
  const id = String(req.params.id || "").trim();

  try {
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId", simulated: false });
    }

    const ready = await isSchoolSmsReady(schoolId);
    if (!ready) {
      return res.status(409).json({
        success: false,
        simulated: false,
        error:
          "WinSMS is not configured or not connected. Open Communication → Settings → SMS, connect your account, and test the connection.",
      });
    }

    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const idx = school.sms.findIndex((e) => e.id === id);
    if (idx < 0) return res.status(404).json({ success: false, error: "SMS not found", simulated: false });

    const record = { ...school.sms[idx], contacts: [...school.sms[idx].contacts] };
    if (!record.contacts.length) {
      return res.status(400).json({
        success: false,
        error: "Add at least one contact before sending",
        simulated: false,
      });
    }

    const message = String(record.message || "").trim();
    if (!message) {
      return res.status(400).json({
        success: false,
        error: "SMS message is required before sending",
        simulated: false,
      });
    }

    const segments = Math.max(1, Math.ceil(message.length / 160));
    const now = new Date().toISOString();
    const invalidContactIds = new Set<string>();
    const prepared: { contact: SmsContact; mobileNumber: string }[] = [];

    for (const contact of record.contacts) {
      const { plainInternational } = normalizeSaPhone(contact.cellNo);
      if (plainInternational.length < 10) {
        invalidContactIds.add(contact.id);
        continue;
      }
      prepared.push({ contact, mobileNumber: plainInternational });
    }

    console.info("[communication] sms send start", {
      schoolId,
      messageId: id,
      recipientCount: prepared.length,
      invalidRecipientCount: invalidContactIds.size,
    });

    let winSmsAccepted = false;
    let winSmsError = prepared.length ? "" : "No valid mobile numbers on the selected contacts.";

    if (prepared.length > 0) {
      try {
        await sendSchoolSms(schoolId, {
          message,
          recipients: prepared.map((entry) => ({
            mobileNumber: entry.mobileNumber,
            clientMessageId: `${id}-${entry.contact.id}`,
          })),
          maxSegments: segments,
          clientMessageIdPrefix: id,
        });
        winSmsAccepted = true;
        console.info("[communication] sms send winSms result", {
          schoolId,
          messageId: id,
          recipientCount: prepared.length,
          result: "accepted",
        });
      } catch (error) {
        winSmsError =
          error instanceof WinSmsApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : "WinSMS send failed";
        console.error("[communication] sms send winSms result", {
          schoolId,
          messageId: id,
          recipientCount: prepared.length,
          result: "failed",
          error: winSmsError,
        });
      }
    } else {
      console.error("[communication] sms send winSms result", {
        schoolId,
        messageId: id,
        recipientCount: 0,
        result: "failed",
        error: winSmsError,
      });
    }

    record.contacts = record.contacts.map((contact) => {
      if (invalidContactIds.has(contact.id)) {
        return { ...contact, status: "Failed" };
      }
      if (winSmsAccepted) {
        return { ...contact, status: "Sent" };
      }
      return { ...contact, status: "Failed" };
    });

    const sentCount = record.contacts.filter((contact) => contact.status === "Sent").length;
    const failedCount = record.contacts.filter((contact) => contact.status === "Failed").length;

    if (sentCount > 0) {
      record.status = "Sent";
      record.sentAt = now;
    } else {
      record.status = "Failed";
      record.sentAt = undefined;
    }
    record.updatedAt = now;
    school.sms[idx] = record;
    writeStore(store);

    let creditBalance: number | undefined;
    if (winSmsAccepted) {
      const balanceResult = await checkSchoolSmsCreditBalance(schoolId);
      if (balanceResult.ok) {
        creditBalance = balanceResult.creditBalance;
      }
    }

    const responseBody = {
      sms: record,
      smsCredits: school.smsCredits,
      simulated: false as const,
      ...(creditBalance !== undefined ? { creditBalance } : {}),
      ...(failedCount > 0 && sentCount > 0
        ? { warning: `${failedCount} recipient(s) could not be sent.` }
        : {}),
    };

    if (sentCount === 0) {
      return res.status(400).json({
        success: false,
        error: winSmsError || "SMS send failed for all recipients.",
        ...responseBody,
      });
    }

    return res.json({
      success: true,
      ...responseBody,
    });
  } catch (error) {
    console.error("[communication] send sms failed", {
      schoolId,
      messageId: id,
      error: error instanceof Error ? error.message : "Server error",
    });
    return res.status(500).json({ success: false, error: "Server error", simulated: false });
  }
});

export default router;
