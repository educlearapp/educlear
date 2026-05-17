import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../prisma";

const router = Router();
const FALLBACK_SENDER_EMAIL = "no-reply@educlear.co.za";
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
  status: "Draft" | "Sent";
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

function resolveSchoolSenderEmail(
  settings: CommunicationSettings,
  schoolEmail?: string | null
) {
  if (settings.sendViaEduClearDomain) {
    return FALLBACK_SENDER_EMAIL;
  }
  const billing = String(settings.billingEmail || "").trim();
  if (billing) return billing;
  const administration = String(settings.administrationEmail || "").trim();
  if (administration) return administration;
  const email = String(schoolEmail || "").trim();
  if (email) return email;
  return FALLBACK_SENDER_EMAIL;
}

function formatComposeSenderLabel(
  schoolName: string,
  settings: CommunicationSettings,
  schoolEmail?: string | null
) {
  const name = String(schoolName || "School").trim() || "School";
  const email = resolveSchoolSenderEmail(settings, schoolEmail);
  return `${name} ${email}`;
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
    const branding = await loadSchoolBranding(schoolId);
    const schoolName = branding?.schoolName || "School";
    const schoolEmail = branding?.schoolEmail || "";
    const senderEmail = resolveSchoolSenderEmail(schoolStore.settings, schoolEmail);
    const senderLabel = formatComposeSenderLabel(schoolName, schoolStore.settings, schoolEmail);
    return res.json({
      success: true,
      settings: settingsForClient(schoolStore.settings),
      emailBalance: schoolStore.emailBalance,
      smsCredits: schoolStore.smsCredits,
      winSmsCredits: schoolStore.winSmsCredits,
      schoolName,
      schoolEmail,
      senderEmail,
      senderLabel,
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
    const branding = await loadSchoolBranding(schoolId);
    const schoolName = branding?.schoolName || "School";
    const schoolEmail = branding?.schoolEmail || "";
    const senderEmail = resolveSchoolSenderEmail(schoolStore.settings, schoolEmail);
    const senderLabel = formatComposeSenderLabel(schoolName, schoolStore.settings, schoolEmail);
    return res.json({
      success: true,
      settings: settingsForClient(schoolStore.settings),
      emailBalance: schoolStore.emailBalance,
      smsCredits: schoolStore.smsCredits,
      winSmsCredits: schoolStore.winSmsCredits,
      schoolName,
      schoolEmail,
      senderEmail,
      senderLabel,
    });
  } catch (error) {
    console.error("[communication] PUT settings failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/settings/test-sms", (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const username = String(req.body?.winSmsUsername || school.settings.winSmsUsername || "").trim();
    if (!username) {
      return res.status(400).json({ success: false, error: "WinSMS username is required" });
    }
    return res.json({
      success: true,
      ok: true,
      message: "Credentials validated (simulated). Live SMS delivery is not enabled yet.",
      provider: school.settings.smsProvider,
    });
  } catch (error) {
    console.error("[communication] test-sms failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
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
    const branding = await loadSchoolBranding(schoolId);
    const defaultFromLabel = formatComposeSenderLabel(
      branding?.schoolName || "School",
      school.settings,
      branding?.schoolEmail
    );
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

router.post("/emails/:id/send", (req, res) => {
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
    record.contacts = record.contacts.map((c) => ({ ...c, status: "Sent" }));
    record.status = "Sent";
    record.sentAt = sentAt;
    record.updatedAt = sentAt;
    school.emails[idx] = record;
    school.emailBalance = Math.max(0, school.emailBalance - record.contacts.length);
    writeStore(store);
    return res.json({
      success: true,
      email: record,
      emailBalance: school.emailBalance,
      simulated: true,
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

router.post("/sms/:id/send", (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    const store = ensureStore();
    const school = getSchoolStore(store, schoolId);
    const idx = school.sms.findIndex((e) => e.id === id);
    if (idx < 0) return res.status(404).json({ success: false, error: "SMS not found" });
    const record = school.sms[idx];
    if (!record.contacts.length) {
      return res.status(400).json({ success: false, error: "Add at least one contact before sending" });
    }
    const segments = Math.max(1, Math.ceil(record.message.length / 160));
    const cost = record.contacts.length * segments;
    const sentAt = new Date().toISOString();
    record.contacts = record.contacts.map((c) => ({ ...c, status: "Sent" }));
    record.status = "Sent";
    record.sentAt = sentAt;
    record.updatedAt = sentAt;
    school.sms[idx] = record;
    school.smsCredits = Math.max(0, school.smsCredits - cost);
    school.winSmsCredits = Math.max(0, school.winSmsCredits - cost);
    writeStore(store);
    return res.json({
      success: true,
      sms: record,
      smsCredits: school.smsCredits,
      winSmsCredits: school.winSmsCredits,
      simulated: true,
    });
  } catch (error) {
    console.error("[communication] send sms failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
