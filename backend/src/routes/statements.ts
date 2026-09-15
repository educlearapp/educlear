import { Router } from "express";

import {
  buildBillingSummaryValidationReport,
  calculateBillingSummary,
} from "../services/billingSummary";
import { buildAccountStatementTransactions } from "../services/statementAccountTransactions";
import { buildAndGenerateStatementPdf } from "../services/statementPdfData";
import { buildAccountsFromAgeAnalysisSnapshots } from "../services/statementAccounts";
import {
  previewStatementSms,
  sendStatementSms,
} from "../services/statementSmsService";
import {
  requireStatementSendAuth,
  type StatementSendAuthRequest,
} from "../middleware/requireStatementSendAuth";
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

// GET /api/statements/transactions?schoolId=&accountNo=&learnerId=&period=&showCorrections=
router.get("/transactions", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId).trim() : "";
    const accountNo =
      typeof req.query?.accountNo === "string" ? String(req.query.accountNo).trim() : "";
    const learnerId =
      typeof req.query?.learnerId === "string" ? String(req.query.learnerId).trim() : "";
    const period = normalizeStatementPeriod(
      typeof req.query?.period === "string" ? String(req.query.period).trim() : undefined
    );
    const showCorrections =
      req.query?.showCorrections === "true" ||
      req.query?.showCorrections === "1" ||
      req.query?.showCorrectionsAudit === "true" ||
      req.query?.showCorrectionsAudit === "1";

    if (!schoolId || (!accountNo && !learnerId)) {
      return res.status(400).json({
        success: false,
        error: "Missing schoolId and accountNo or learnerId",
      });
    }

    const result = await buildAccountStatementTransactions({
      schoolId,
      accountNo: accountNo || undefined,
      learnerId: learnerId || undefined,
      period,
      showCorrectionsAudit: showCorrections,
    });

    if (!result) {
      return res.status(404).json({ success: false, error: "Account not found" });
    }

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("[statements] GET /transactions failed:", error);
    const message = error instanceof Error ? error.message : "Server error";
    return res.status(500).json({ success: false, error: message });
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

// GET /api/statements/sms-preview — eligible contacts + default message (statements.send)
router.get("/sms-preview", requireStatementSendAuth, async (req: StatementSendAuthRequest, res) => {
  try {
    const auth = req.statementSendAuth!;
    const schoolId = auth.authorizedSchoolId;
    const familyAccountId =
      typeof req.query?.familyAccountId === "string" ? String(req.query.familyAccountId).trim() : "";
    const accountRef =
      typeof req.query?.accountRef === "string" ? String(req.query.accountRef).trim() : "";
    const accountNo =
      typeof req.query?.accountNo === "string" ? String(req.query.accountNo).trim() : "";
    const learnerId =
      typeof req.query?.learnerId === "string" ? String(req.query.learnerId).trim() : "";

    if (!familyAccountId && !accountRef && !accountNo && !learnerId) {
      return res.status(400).json({
        success: false,
        error: "Missing familyAccountId, accountRef, accountNo, or learnerId",
        simulated: false,
      });
    }

    const preview = await previewStatementSms({
      schoolId,
      familyAccountId: familyAccountId || undefined,
      accountRef: accountRef || undefined,
      accountNo: accountNo || undefined,
      learnerId: learnerId || undefined,
    });

    if (!preview.ok) {
      return res.status(preview.status).json({
        success: false,
        error: preview.error,
        code: preview.code,
        simulated: false,
      });
    }

    return res.json({
      success: true,
      simulated: false,
      ...preview,
    });
  } catch (error) {
    console.error("[statements] GET /sms-preview failed:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      simulated: false,
    });
  }
});

// POST /api/statements/send-sms — send statement SMS via WinSMS (statements.send)
router.post("/send-sms", requireStatementSendAuth, async (req: StatementSendAuthRequest, res) => {
  try {
    const auth = req.statementSendAuth!;
    const schoolId = auth.authorizedSchoolId;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const selectionModeRaw = String(body.selectionMode || "").trim().toLowerCase();
    const selectionMode =
      selectionModeRaw === "all" || selectionModeRaw === "alleligible" ? "all" : "parentIds";
    const parentIds = Array.isArray(body.parentIds)
      ? body.parentIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];

    const result = await sendStatementSms({
      schoolId,
      familyAccountId: typeof body.familyAccountId === "string" ? body.familyAccountId : undefined,
      accountRef: typeof body.accountRef === "string" ? body.accountRef : undefined,
      accountNo: typeof body.accountNo === "string" ? body.accountNo : undefined,
      learnerId: typeof body.learnerId === "string" ? body.learnerId : undefined,
      selectionMode,
      parentIds,
      message: typeof body.message === "string" ? body.message : "",
      mobileNumbers: body.mobileNumbers,
      cellNo: body.cellNo,
      phone: body.phone,
    });

    return res.status(result.status).json({
      success: Boolean(result.ok),
      ...result,
    });
  } catch (error) {
    console.error("[statements] POST /send-sms failed:", error);
    return res.status(500).json({
      success: false,
      error: "Server error",
      simulated: false,
    });
  }
});

export default router;
