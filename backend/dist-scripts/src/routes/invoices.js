"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const billingSettings_1 = require("./billingSettings");
const learnerIdentity_1 = require("../utils/learnerIdentity");
const billingSettingsEngine_1 = require("../utils/billingSettingsEngine");
const billingLedgerRelink_1 = require("../services/billingLedgerRelink");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const router = (0, express_1.Router)();
router.get("/", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        const invoices = (0, billingLedgerStore_1.listInvoices)(schoolId).map((entry) => ({
            id: entry.id,
            learnerId: entry.learnerId,
            accountNo: entry.accountNo,
            invoiceNumber: entry.reference,
            description: entry.description,
            amount: entry.amount,
            invoiceDate: entry.date,
            date: entry.date,
            dueDate: entry.dueDate,
            type: entry.type,
            reference: entry.reference,
            createdAt: entry.createdAt,
            runId: entry.runId,
        }));
        return res.json({ success: true, invoices });
    }
    catch (error) {
        console.error("[invoices] GET / failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const schoolId = String(body.schoolId || "").trim();
        const learnerId = String(body.learnerId || body.id || "").trim();
        const accountNo = String(body.accountNo || "").trim();
        const amount = (0, billingLedgerStore_1.normaliseAmount)(body.amount);
        if (!schoolId || !learnerId || !amount) {
            return res.status(400).json({ success: false, error: "Missing schoolId, learnerId, or amount" });
        }
        const settings = await (0, billingSettings_1.loadSchoolBillingSettings)(schoolId);
        const invoiceDate = (0, billingSettingsEngine_1.normaliseIsoDate)(body.date || body.invoiceDate) || new Date().toISOString().slice(0, 10);
        const dueDate = (0, billingSettingsEngine_1.computeInvoiceDueDate)(invoiceDate, settings, (0, billingSettingsEngine_1.normaliseIsoDate)(body.dueDate) || undefined);
        const existingInvoices = (0, billingLedgerStore_1.listInvoices)(schoolId);
        const fallbackRef = String(body.reference || body.invoiceNumber || `INV-${Date.now()}`).trim();
        const reference = (0, billingSettingsEngine_1.buildInvoiceReference)(settings, invoiceDate, existingInvoices.length + 1, fallbackRef);
        const description = String(body.description || "").trim() ||
            (0, billingSettingsEngine_1.resolveInvoiceMessage)(settings) ||
            "Invoice";
        const entry = {
            id: String(body.id || `invoice-${Date.now()}`),
            schoolId,
            learnerId,
            accountNo: accountNo || (0, learnerIdentity_1.resolveLearnerAccountNo)(body),
            type: "invoice",
            amount,
            date: invoiceDate,
            dueDate,
            reference,
            description,
            runId: body.runId ? String(body.runId) : undefined,
            createdAt: new Date().toISOString(),
        };
        (0, billingLedgerStore_1.appendSchoolEntry)(schoolId, entry);
        return res.json({ success: true, invoice: entry });
    }
    catch (error) {
        console.error("[invoices] POST / failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.get("/ledger", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        if (!schoolId) {
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        }
        await (0, billingLedgerRelink_1.relinkSchoolBillingLedger)(schoolId);
        return res.json({ success: true, entries: (0, billingLedgerStore_1.readSchoolLedger)(schoolId) });
    }
    catch (error) {
        console.error("[invoices] GET /ledger failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
exports.default = router;
