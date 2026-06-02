import { Router } from "express";

import {
  buildBillingSummaryValidationReport,
  calculateBillingSummary,
} from "../services/billingSummary";
import { buildAndGenerateStatementPdf } from "../services/statementPdfData";
import { buildAccountsFromAgeAnalysisSnapshots } from "../services/statementAccounts";
import {
  filterHistoryForAccount,
  readSchoolKidesysHistory,
} from "../utils/kidesysTransactionHistoryStore";
import { normalizeStatementPeriod } from "../utils/statementPeriod";

const router = Router();

function sendPdfAttachment(res: import("express").Response, buffer: Buffer, filename: string) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Length", String(buffer.length));
  return res.send(buffer);
}

// GET /api/statements/pdf?schoolId=&learnerId=&accountNo=&period=
router.get("/pdf", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId).trim() : "";
    const learnerId = typeof req.query?.learnerId === "string" ? String(req.query.learnerId).trim() : "";
    const accountNo = typeof req.query?.accountNo === "string" ? String(req.query.accountNo).trim() : "";
    const period = normalizeStatementPeriod(
      typeof req.query?.period === "string" ? String(req.query.period).trim() : undefined
    );
    const statementNote =
      typeof req.query?.statementNote === "string" ? String(req.query.statementNote) : undefined;

    if (!schoolId || (!learnerId && !accountNo)) {
      return res.status(400).json({ success: false, error: "Missing schoolId and learnerId or accountNo" });
    }

    console.log("[PDF] generating", accountNo || learnerId, { schoolId, period });

    const { buffer, filename } = await buildAndGenerateStatementPdf({
      schoolId,
      learnerId: learnerId || "",
      accountNo: accountNo || undefined,
      period,
      statementNote,
    });

    return sendPdfAttachment(res, buffer, filename);
  } catch (error) {
    console.error("[statements] GET /pdf failed:", error);
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(500).json({ success: false, error: message });
  }
});

// GET /api/statements/summary-validation?schoolId=
router.get("/summary-validation", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
    const summary = calculateBillingSummary(accounts);
    const report = buildBillingSummaryValidationReport(schoolId, accounts);
    return res.json({ success: true, summary, report });
  } catch (error) {
    console.error("[statements] GET /summary-validation failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/statements?schoolId=...
router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
    return res.json({ success: true, statements: accounts, accounts });
  } catch (error) {
    console.error("[statements] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/statements/kidesys-history?schoolId=&accountNo=
router.get("/kidesys-history", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    const accountNo =
      typeof req.query?.accountNo === "string" ? String(req.query.accountNo).trim() : "";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const all = readSchoolKidesysHistory(schoolId);
    const entries = accountNo ? filterHistoryForAccount(all, accountNo) : all;
    return res.json({ success: true, entries, count: entries.length });
  } catch (error) {
    console.error("[statements] GET /kidesys-history failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

// GET /api/statements/accounts?schoolId=&accountNo=&includeKidesysHistory=
router.get("/accounts", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    const accountNo =
      typeof req.query?.accountNo === "string" ? String(req.query.accountNo).trim() : "";
    const includeKidesysHistory =
      req.query?.includeKidesysHistory === "true" || req.query?.includeKidesysHistory === "1";
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);

    if (!includeKidesysHistory) {
      return res.json({ success: true, accounts });
    }

    const all = readSchoolKidesysHistory(schoolId);
    const kidesysHistoryEntries = accountNo ? filterHistoryForAccount(all, accountNo) : all;
    return res.json({
      success: true,
      accounts,
      entries: kidesysHistoryEntries,
      kidesysHistoryEntries,
      count: kidesysHistoryEntries.length,
    });
  } catch (error) {
    console.error("[statements] GET /accounts failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
