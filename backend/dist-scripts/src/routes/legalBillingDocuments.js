"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../prisma");
const schoolLogo_1 = require("../utils/schoolLogo");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const router = (0, express_1.Router)();
const HISTORY_FILE = path_1.default.join(process.cwd(), "data", "legal-document-history.json");
function ensureHistoryStore() {
    const dir = path_1.default.dirname(HISTORY_FILE);
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
    if (!fs_1.default.existsSync(HISTORY_FILE))
        fs_1.default.writeFileSync(HISTORY_FILE, "[]", "utf8");
}
function readHistory() {
    ensureHistoryStore();
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(HISTORY_FILE, "utf8"));
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
function writeHistory(rows) {
    ensureHistoryStore();
    try {
        fs_1.default.writeFileSync(HISTORY_FILE, JSON.stringify(rows, null, 2), "utf8");
    }
    catch (err) {
        const message = String(err?.message || err || "Failed to write legal document history");
        throw new Error(message);
    }
}
function normalizeGenerateAccounts(body) {
    const raw = body.accounts ?? body.selectedAccounts ?? body.rows;
    if (!Array.isArray(raw))
        return [];
    return raw
        .map((item) => {
        if (!item || typeof item !== "object")
            return null;
        const row = item;
        return {
            learnerId: String(row.learnerId || row.id || "").trim(),
            accountNo: String(row.accountNo || "").trim(),
            learnerName: String(row.learnerName || "").trim(),
            parentName: String(row.parentName || "").trim(),
            parentEmail: String(row.parentEmail || row.email || "").trim(),
            parentPhone: String(row.parentPhone || row.phone || "").trim(),
            overdueBalance: row.overdueBalance,
            overdueInvoiceDates: Array.isArray(row.overdueInvoiceDates) ? row.overdueInvoiceDates : [],
            paymentDeadline: String(row.paymentDeadline || "").trim(),
        };
    })
        .filter(Boolean);
}
function currentIso() {
    return new Date().toISOString();
}
function currentDate() {
    return currentIso().slice(0, 10);
}
function addCalendarDays(fromDate, days) {
    const d = new Date(`${fromDate}T12:00:00`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}
function paymentDeadlineForType(documentType, generatedDate) {
    if (documentType === "final-demand")
        return addCalendarDays(generatedDate, 2);
    if (documentType === "letter-of-demand")
        return addCalendarDays(generatedDate, 7);
    return addCalendarDays(generatedDate, 14);
}
function documentTitle(documentType) {
    if (documentType === "section-41-notice")
        return "Section 41 Notice";
    if (documentType === "letter-of-demand")
        return "Letter of Demand";
    return "Final Demand";
}
function matchesStatusFilter(status, filter) {
    if (!filter || filter === "All Overdue")
        return true;
    if (filter === "Recently Owing")
        return status === "Recently Owing";
    if (filter === "Bad Debt")
        return status === "Bad Debt";
    return true;
}
function buildLegalCopy(documentType) {
    if (documentType === "section-41-notice") {
        return {
            intro: "We write to inform you that your school-fees account remains overdue despite previous reminders and attempts to engage with you as parent/guardian. In accordance with applicable school-fee recovery processes, including considerations under Section 41 of the Schools Act framework, you are required to settle the overdue amount urgently to avoid further administrative and recovery steps.",
            consequences: "If the overdue amount is not settled by the deadline below, the school may proceed with further lawful recovery steps, including additional notices, internal restrictions permitted under school policy and your signed enrolment agreement, and referral for collection assistance where appropriate.",
            urgency: "urgent settlement",
        };
    }
    if (documentType === "letter-of-demand") {
        return {
            intro: "This is a formal demand for payment of the overdue school-fees balance reflected below. Despite prior communication, the account remains in arrears.",
            consequences: "If payment is not received within 7 (seven) calendar days from the date of this letter, the school may proceed with further recovery action, including legal handover and administrative restrictions permitted by school policy and your signed agreement, without further notice where lawfully allowed.",
            urgency: "payment within 7 days",
        };
    }
    return {
        intro: "This is a final demand before handover for collection/legal recovery. Immediate payment is required in respect of the overdue balance below.",
        consequences: "Unless payment is received within 48 (forty-eight) hours from the date of this letter, the matter may be handed over for collection/legal recovery, and additional recovery costs may be added where legally permissible.",
        urgency: "payment within 48 hours",
    };
}
function historyDuplicate(history, schoolId, accountNo, documentType, generatedDate) {
    return history.some((h) => h.schoolId === schoolId &&
        h.accountNo === accountNo &&
        h.documentType === documentType &&
        h.generatedAt.slice(0, 10) === generatedDate);
}
function formatMoney(value) {
    return `R ${(0, billingLedgerStore_1.normaliseAmount)(value).toLocaleString("en-ZA", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
}
function parseRunDueDates(raw) {
    if (!raw || typeof raw !== "object")
        return {};
    const out = {};
    for (const [key, value] of Object.entries(raw)) {
        if (value !== null && value !== undefined && String(value).trim()) {
            out[String(key)] = String(value).trim();
        }
    }
    return out;
}
/** Prefer client unified ledger (same source as Statements); fall back to server file. */
function resolveLedgerForLegal(body, schoolId) {
    const runDueDates = parseRunDueDates(body.runDueDates);
    const clientRaw = Array.isArray(body.ledgerEntries) ? body.ledgerEntries : [];
    const serverLedger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
    const source = clientRaw.length
        ? clientRaw
        : serverLedger;
    return {
        ledger: (0, billingLedgerStore_1.prepareLedgerEntries)(source, runDueDates),
        runDueDates,
        ledgerSource: clientRaw.length ? "client" : "server",
    };
}
function buildDocumentHtml(payload) {
    const school = payload.school;
    const learner = payload.learner;
    const parent = payload.parent;
    const copy = payload.copy;
    const generatedAt = String(payload.generatedAt || currentIso());
    const generatedDate = generatedAt.slice(0, 10);
    const logoUrl = (0, schoolLogo_1.toAbsoluteSchoolLogoUrl)(String(school.logoUrl || "")) || "";
    const overdueDates = Array.isArray(payload.overdueInvoiceDates)
        ? payload.overdueInvoiceDates.join(", ")
        : "-";
    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${String(payload.title || "Legal Notice")}</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; color: #111827; margin: 32px; line-height: 1.55; }
  .header { display:flex; gap:16px; align-items:center; border-bottom:2px solid #d4af37; padding-bottom:14px; margin-bottom:20px; }
  .logo { width:72px; height:72px; object-fit:contain; border:1px solid #e5e7eb; border-radius:8px; }
  .school { font-weight:800; font-size:18px; }
  .meta { color:#64748b; font-size:13px; margin-top:4px; }
  .date { font-weight:800; margin: 12px 0 18px; }
  h1 { font-size:22px; margin:0 0 16px; }
  .box { border:1px solid #e5e7eb; border-radius:10px; padding:14px; margin:14px 0; background:#fafafa; }
  .sign { margin-top:36px; }
</style></head><body>
  <div class="header">
    ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="School logo"/>` : ""}
    <div>
      <div class="school">${String(school.name || "School")}</div>
      <div class="meta">${String(school.address || "")}</div>
      <div class="meta">${String(school.email || "")} · ${String(school.phone || "")}</div>
    </div>
  </div>
  <div class="date">Date: ${generatedDate}</div>
  <h1>${String(payload.title || "")}</h1>
  <p>Dear ${String(parent.name || "Parent/Guardian")},</p>
  <p>${copy.intro || ""}</p>
  <div class="box">
    <div><strong>Learner:</strong> ${String(learner.name || "")}</div>
    <div><strong>Grade / Class:</strong> ${String(learner.grade || "")} / ${String(learner.className || "")}</div>
    <div><strong>Account No:</strong> ${String(payload.accountNo || "")}</div>
    <div><strong>Overdue balance:</strong> ${formatMoney((0, billingLedgerStore_1.normaliseAmount)(payload.overdueBalance))}</div>
    <div><strong>Overdue invoice/fee dates:</strong> ${overdueDates}</div>
    <div><strong>Payment deadline:</strong> ${String(payload.paymentDeadline || "")}</div>
  </div>
  <p><strong>Payment instructions:</strong> Please pay the overdue amount by the deadline above using the school's approved payment channels and use account number <strong>${String(payload.accountNo || "")}</strong> as reference. Contact the school bursar/finance office immediately if you dispute any amount or require a payment arrangement in writing.</p>
  <p><strong>Consequences:</strong> ${copy.consequences || ""}</p>
  <p>We urge ${copy.urgency || "immediate payment"} to regularise this account.</p>
  <div class="sign">
    <p>Yours faithfully,</p>
    <p><strong>${String(school.name || "School")}</strong><br/>Finance / Bursar Office</p>
  </div>
</body></html>`;
}
async function loadSchool(schoolId) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true, email: true, phone: true, address: true, logoUrl: true },
    });
    if (!school)
        return null;
    return {
        id: school.id,
        name: school.name || "School",
        email: school.email || "",
        phone: school.phone || "",
        address: school.address || "",
        logoUrl: (0, schoolLogo_1.toAbsoluteSchoolLogoUrl)(school.logoUrl) || "",
    };
}
async function loadLearnersWithParents(schoolId) {
    return prisma_1.prisma.learner.findMany({
        where: { schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            grade: true,
            className: true,
            familyAccount: { select: { accountRef: true } },
            links: {
                include: {
                    parent: {
                        select: {
                            id: true,
                            firstName: true,
                            surname: true,
                            email: true,
                            cellNo: true,
                        },
                    },
                },
            },
        },
    });
}
function primaryParent(learner) {
    const link = learner.links.find((l) => l.isPrimary) || learner.links[0];
    if (!link?.parent) {
        return { name: "Parent/Guardian", email: "", phone: "" };
    }
    const p = link.parent;
    return {
        name: `${p.firstName || ""} ${p.surname || ""}`.trim() || "Parent/Guardian",
        email: String(p.email || "").trim(),
        phone: String(p.cellNo || "").trim(),
    };
}
router.get("/history", async (req, res) => {
    try {
        const schoolId = String(req.query?.schoolId || "").trim();
        const documentType = String(req.query?.documentType || "").trim();
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        let rows = readHistory().filter((h) => h.schoolId === schoolId);
        if (documentType)
            rows = rows.filter((h) => h.documentType === documentType);
        rows.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
        return res.json({ success: true, history: rows });
    }
    catch (error) {
        console.error("[legal-billing-documents] GET /history failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/preview", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const schoolId = String(body.schoolId || "").trim();
        const documentType = String(body.documentType || "").trim();
        const statusFilter = String(body.statusFilter || "All Overdue");
        const minBalance = (0, billingLedgerStore_1.normaliseAmount)(body.minBalance ?? 0);
        const gradeFilter = String(body.gradeFilter || "").trim();
        const classFilter = String(body.classFilter || "").trim();
        const learnerId = String(body.learnerId || "").trim();
        const learnerIds = Array.isArray(body.learnerIds)
            ? body.learnerIds.map((v) => String(v).trim()).filter(Boolean)
            : [];
        const confirmDuplicates = Boolean(body.confirmDuplicates);
        if (!schoolId || !documentType) {
            return res.status(400).json({ success: false, error: "Missing schoolId or documentType" });
        }
        const generatedAt = currentIso();
        const generatedDate = generatedAt.slice(0, 10);
        const school = await loadSchool(schoolId);
        if (!school)
            return res.status(404).json({ success: false, error: "School not found" });
        const { ledger, runDueDates, ledgerSource } = resolveLedgerForLegal(body, schoolId);
        const history = readHistory();
        const learners = await loadLearnersWithParents(schoolId);
        const copy = buildLegalCopy(documentType);
        const paymentDeadline = paymentDeadlineForType(documentType, generatedDate);
        const rows = learners
            .map((learner) => {
            if (learnerId && learner.id !== learnerId)
                return null;
            if (learnerIds.length && !learnerIds.includes(learner.id))
                return null;
            const accountNo = (0, learnerIdentity_1.resolveLearnerAccountNo)(learner);
            if (!accountNo)
                return null;
            if (gradeFilter && String(learner.grade || "") !== gradeFilter)
                return null;
            if (classFilter && String(learner.className || "") !== classFilter)
                return null;
            const snapshot = (0, billingLedgerStore_1.computeLegalOverdueSnapshot)(ledger, learner.id, accountNo, generatedDate, runDueDates);
            if (snapshot.balance <= 0 || snapshot.overdueBalance <= 0)
                return null;
            if (snapshot.overdueBalance < minBalance)
                return null;
            let status = "Recently Owing";
            if (snapshot.balance > 10000)
                status = "Bad Debt";
            if (!matchesStatusFilter(status, statusFilter))
                return null;
            const duplicate = historyDuplicate(history, schoolId, accountNo, documentType, generatedDate);
            if (duplicate && !confirmDuplicates) {
                return {
                    learnerId: learner.id,
                    accountNo,
                    learnerName: `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
                    grade: learner.grade || "",
                    className: learner.className || "",
                    balance: snapshot.balance,
                    overdueBalance: snapshot.overdueBalance,
                    overdueInvoiceDates: snapshot.overdueInvoices.map((i) => i.dueDate),
                    status,
                    duplicate: true,
                    skipReason: "Notice already generated today for this account",
                };
            }
            const parent = primaryParent(learner);
            const payload = {
                title: documentTitle(documentType),
                documentType,
                generatedAt,
                paymentDeadline,
                accountNo,
                overdueBalance: snapshot.overdueBalance,
                overdueInvoiceDates: snapshot.overdueInvoices.map((i) => i.dueDate),
                school,
                learner: {
                    name: `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
                    grade: learner.grade || "",
                    className: learner.className || "",
                },
                parent,
                copy,
            };
            return {
                learnerId: learner.id,
                accountNo,
                learnerName: payload.learner.name,
                grade: learner.grade || "",
                className: learner.className || "",
                balance: snapshot.balance,
                overdueBalance: snapshot.overdueBalance,
                overdueInvoiceDates: payload.overdueInvoiceDates,
                parentName: parent.name,
                parentEmail: parent.email,
                parentPhone: parent.phone,
                paymentDeadline,
                generatedAt,
                duplicate: false,
                documentHtml: buildDocumentHtml(payload),
                payload,
            };
        })
            .filter(Boolean);
        return res.json({
            success: true,
            generatedAt,
            documentType,
            title: documentTitle(documentType),
            rows,
            duplicates: rows.filter((r) => r.duplicate).length,
            ledgerSource,
            ledgerEntryCount: ledger.length,
        });
    }
    catch (error) {
        console.error("[legal-billing-documents] POST /preview failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/generate", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const schoolId = String(body.schoolId || "").trim();
        const documentType = String(body.documentType || "").trim();
        const accounts = normalizeGenerateAccounts(body);
        const confirmDuplicates = Boolean(body.confirmDuplicates);
        if (!schoolId || !documentType) {
            return res.status(400).json({ success: false, error: "Missing schoolId or documentType" });
        }
        if (!accounts.length) {
            return res.status(400).json({
                success: false,
                error: "Missing accounts array (expected accounts with learnerId and accountNo)",
            });
        }
        const generatedAt = typeof body.generatedAt === "string" && body.generatedAt.trim()
            ? body.generatedAt.trim()
            : currentIso();
        const generatedDate = generatedAt.slice(0, 10);
        const history = readHistory();
        const saved = [];
        const skipped = [];
        for (const row of accounts) {
            const accountNo = String(row.accountNo || "").trim();
            const learnerId = String(row.learnerId || "").trim();
            if (!learnerId) {
                skipped.push({ accountNo: accountNo || "-", learnerId, reason: "Missing learnerId" });
                continue;
            }
            if (!accountNo || accountNo === "-") {
                skipped.push({ accountNo: accountNo || "-", learnerId, reason: "Unassigned account number" });
                continue;
            }
            if (!confirmDuplicates &&
                historyDuplicate(history, schoolId, accountNo, documentType, generatedDate)) {
                skipped.push({ accountNo, learnerId, reason: "Duplicate notice for today" });
                continue;
            }
            const record = {
                id: `legal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                schoolId,
                documentType,
                generatedAt,
                status: "Ready",
                learnerId,
                learnerName: String(row.learnerName || ""),
                parentName: String(row.parentName || ""),
                parentEmail: String(row.parentEmail || ""),
                accountNo,
                overdueBalance: (0, billingLedgerStore_1.normaliseAmount)(row.overdueBalance),
                overdueInvoiceDates: Array.isArray(row.overdueInvoiceDates)
                    ? row.overdueInvoiceDates.map((d) => String(d).slice(0, 10))
                    : [],
                paymentDeadline: String(row.paymentDeadline || paymentDeadlineForType(documentType, generatedDate)),
            };
            history.push(record);
            saved.push(record);
        }
        if (!saved.length) {
            return res.status(400).json({
                success: false,
                error: skipped.length > 0
                    ? `No documents generated: ${skipped.map((s) => `${s.accountNo} (${s.reason})`).join("; ")}`
                    : "No documents generated for the selected accounts",
                skipped,
            });
        }
        writeHistory(history);
        return res.json({ success: true, generatedAt, saved, skipped });
    }
    catch (error) {
        console.error("[legal-billing-documents] POST /generate failed:", error);
        return res.status(500).json({
            success: false,
            error: String(error?.message || "Server error"),
        });
    }
});
router.post("/send", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const schoolId = String(body.schoolId || "").trim();
        const documentType = String(body.documentType || "").trim();
        const contacts = Array.isArray(body.contacts) ? body.contacts : [];
        const simulate = body.simulate !== false;
        const subject = String(body.subject || "").trim();
        const sentAt = currentIso();
        if (!schoolId || !documentType) {
            return res.status(400).json({ success: false, error: "Missing schoolId or documentType" });
        }
        const history = readHistory();
        const results = contacts.map((raw) => {
            const email = String(raw?.email || "").trim();
            const accountNo = String(raw?.accountNo || "").trim();
            const contactName = String(raw?.contactName || raw?.parentName || "").trim();
            const learnerName = String(raw?.learnerName || "").trim();
            const historyId = String(raw?.historyId || "").trim();
            if (!email) {
                return { contactName, email: "", accountNo, learnerName, status: "Failed", error: "Missing email" };
            }
            if (!accountNo || accountNo === "-") {
                return {
                    contactName,
                    email,
                    accountNo,
                    learnerName,
                    status: "Failed",
                    error: "Unassigned account number",
                };
            }
            const idx = history.findIndex((h) => (historyId ? h.id === historyId : false));
            const matchIdx = idx >= 0
                ? idx
                : history.findIndex((h) => h.schoolId === schoolId &&
                    h.accountNo === accountNo &&
                    h.documentType === documentType &&
                    h.status === "Ready");
            if (matchIdx >= 0) {
                history[matchIdx].status = simulate ? "Sent" : "Ready";
                history[matchIdx].sentAt = simulate ? sentAt : history[matchIdx].sentAt;
            }
            if (simulate) {
                return {
                    contactName,
                    email,
                    accountNo,
                    learnerName,
                    attachment: raw?.attachment || `${documentType}-${accountNo}.pdf`,
                    subject: subject || raw?.subject || "",
                    status: "Sent",
                    sentAt,
                };
            }
            return {
                contactName,
                email,
                accountNo,
                learnerName,
                status: "Ready",
            };
        });
        writeHistory(history);
        return res.json({ success: true, sentAt, results });
    }
    catch (error) {
        console.error("[legal-billing-documents] POST /send failed:", error);
        return res.status(500).json({
            success: false,
            error: String(error?.message || "Server error"),
        });
    }
});
exports.default = router;
