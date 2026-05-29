"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const billingLedgerRelink_1 = require("../services/billingLedgerRelink");
const statementAccounts_1 = require("../services/statementAccounts");
const billingLedgerStore_1 = require("../utils/billingLedgerStore");
const router = (0, express_1.Router)();
// GET /api/payments?schoolId=...
router.get("/", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const payments = (0, billingLedgerStore_1.listPayments)(schoolId).map((entry) => ({
            id: entry.id,
            learnerId: entry.learnerId,
            accountNo: entry.accountNo,
            amount: entry.amount,
            paymentDate: entry.date,
            date: entry.date,
            method: entry.method,
            reference: entry.reference,
            description: entry.description,
            type: entry.type,
            bankTransactionId: entry.bankTransactionId,
            bankImportId: entry.bankImportId,
            source: entry.source,
            createdAt: entry.createdAt,
        }));
        return res.json({ success: true, payments });
    }
    catch (error) {
        console.error("[payments] GET / failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// GET /api/payments/open-invoices?schoolId=&learnerId=&accountNo=
router.get("/open-invoices", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        const learnerId = typeof req.query?.learnerId === "string" ? String(req.query.learnerId) : "";
        const accountNo = typeof req.query?.accountNo === "string" ? String(req.query.accountNo) : "";
        if (!schoolId || (!learnerId && !accountNo)) {
            return res.status(400).json({
                success: false,
                error: "Missing schoolId and learnerId or accountNo",
            });
        }
        await (0, billingLedgerRelink_1.relinkSchoolBillingLedger)(schoolId);
        const ledger = (0, billingLedgerStore_1.readSchoolLedger)(schoolId);
        const openInvoices = (0, billingLedgerStore_1.computeOpenInvoiceLines)(ledger, learnerId, accountNo);
        const balance = (0, billingLedgerStore_1.calculateBalanceForAccount)(ledger, learnerId, accountNo);
        return res.json({ success: true, openInvoices, balance });
    }
    catch (error) {
        console.error("[payments] GET /open-invoices failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// GET /api/payments/accounts?schoolId=...
router.get("/accounts", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const accounts = await (0, statementAccounts_1.buildAccountsFromAgeAnalysisSnapshots)(schoolId);
        return res.json({ success: true, accounts });
    }
    catch (error) {
        console.error("[payments] GET /accounts failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
router.post("/", async (req, res) => {
    try {
        const body = (req.body ?? {});
        const schoolId = String(body.schoolId || "").trim();
        const learnerId = String(body.learnerId || body.parentId || body.accountId || "").trim();
        const accountNo = String(body.accountNo || "").trim();
        const amount = (0, billingLedgerStore_1.normaliseAmount)(body.amount);
        if (!schoolId || !amount) {
            return res.status(400).json({ success: false, error: "Missing schoolId or amount" });
        }
        const entry = {
            id: String(body.id || `pay-${Date.now()}`),
            schoolId,
            learnerId,
            accountNo,
            type: "payment",
            amount,
            date: String(body.date || body.paidAt || new Date().toISOString()).slice(0, 10),
            reference: String(body.reference || "").trim(),
            description: String(body.description || "Payment").trim(),
            method: String(body.method || body.type || "").trim() || undefined,
            createdAt: new Date().toISOString(),
        };
        (0, billingLedgerStore_1.appendSchoolEntry)(schoolId, entry);
        return res.json({ success: true, payment: entry });
    }
    catch (error) {
        console.error("[payments] POST / failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
exports.default = router;
