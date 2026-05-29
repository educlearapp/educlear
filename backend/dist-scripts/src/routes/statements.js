"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const statementPdfData_1 = require("../services/statementPdfData");
const statementAccounts_1 = require("../services/statementAccounts");
const kidesysTransactionHistoryStore_1 = require("../utils/kidesysTransactionHistoryStore");
const statementPeriod_1 = require("../utils/statementPeriod");
const router = (0, express_1.Router)();
function sendPdfAttachment(res, buffer, filename) {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(buffer.length));
    return res.send(buffer);
}
// GET /api/statements/pdf?schoolId=&learnerId=&period=
router.get("/pdf", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId).trim() : "";
        const learnerId = typeof req.query?.learnerId === "string" ? String(req.query.learnerId).trim() : "";
        const period = (0, statementPeriod_1.normalizeStatementPeriod)(typeof req.query?.period === "string" ? String(req.query.period).trim() : undefined);
        const statementNote = typeof req.query?.statementNote === "string" ? String(req.query.statementNote) : undefined;
        if (!schoolId || !learnerId) {
            return res.status(400).json({ success: false, error: "Missing schoolId or learnerId" });
        }
        console.log("[PDF] generating", learnerId, { schoolId, period });
        const { buffer, filename } = await (0, statementPdfData_1.buildAndGenerateStatementPdf)({
            schoolId,
            learnerId,
            period,
            statementNote,
        });
        return sendPdfAttachment(res, buffer, filename);
    }
    catch (error) {
        console.error("[statements] GET /pdf failed:", error);
        const message = error instanceof Error ? error.message : "Server error";
        return res.status(500).json({ success: false, error: message });
    }
});
// GET /api/statements?schoolId=...
router.get("/", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const accounts = await (0, statementAccounts_1.buildAccountsFromAgeAnalysisSnapshots)(schoolId);
        return res.json({ success: true, statements: accounts, accounts });
    }
    catch (error) {
        console.error("[statements] GET / failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// GET /api/statements/kidesys-history?schoolId=&accountNo=
router.get("/kidesys-history", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        const accountNo = typeof req.query?.accountNo === "string" ? String(req.query.accountNo).trim() : "";
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const all = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
        const entries = accountNo ? (0, kidesysTransactionHistoryStore_1.filterHistoryForAccount)(all, accountNo) : all;
        return res.json({ success: true, entries, count: entries.length });
    }
    catch (error) {
        console.error("[statements] GET /kidesys-history failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
// GET /api/statements/accounts?schoolId=&accountNo=&includeKidesysHistory=
router.get("/accounts", async (req, res) => {
    try {
        const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
        const accountNo = typeof req.query?.accountNo === "string" ? String(req.query.accountNo).trim() : "";
        const includeKidesysHistory = req.query?.includeKidesysHistory === "true" || req.query?.includeKidesysHistory === "1";
        if (!schoolId)
            return res.status(400).json({ success: false, error: "Missing schoolId" });
        const accounts = await (0, statementAccounts_1.buildAccountsFromAgeAnalysisSnapshots)(schoolId);
        if (!includeKidesysHistory) {
            return res.json({ success: true, accounts });
        }
        const all = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId);
        const kidesysHistoryEntries = accountNo ? (0, kidesysTransactionHistoryStore_1.filterHistoryForAccount)(all, accountNo) : all;
        return res.json({
            success: true,
            accounts,
            entries: kidesysHistoryEntries,
            kidesysHistoryEntries,
            count: kidesysHistoryEntries.length,
        });
    }
    catch (error) {
        console.error("[statements] GET /accounts failed:", error);
        return res.status(500).json({ success: false, error: "Server error" });
    }
});
exports.default = router;
