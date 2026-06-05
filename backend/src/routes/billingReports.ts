import { Router } from "express";

import {
  buildTransactionExport,
  type TransactionListTypeFilter,
} from "../services/billingTransactionExport";
import { relinkSchoolBillingLedger } from "../services/billingLedgerRelink";
import {
  parseCalendarIsoDate,
  resolveTransactionListDateRange,
  type TransactionListDateSelection,
} from "../utils/billingReportDateRange";

const router = Router();

const TYPE_FILTERS: TransactionListTypeFilter[] = [
  "All",
  "Payments",
  "Invoices",
  "Credits",
  "Penalties",
];

const DATE_SELECTIONS: TransactionListDateSelection[] = [
  "Today",
  "This Month",
  "Last Month",
  "Custom Dates",
];

function parseTypeFilter(raw: string): TransactionListTypeFilter {
  const value = String(raw || "All").trim();
  return TYPE_FILTERS.includes(value as TransactionListTypeFilter)
    ? (value as TransactionListTypeFilter)
    : "All";
}

router.get("/transactions", async (req, res) => {
  try {
    const schoolId =
      typeof req.query?.schoolId === "string" ? String(req.query.schoolId).trim() : "";
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const type = parseTypeFilter(String(req.query?.type || "All"));
    const dateSelectionRaw = String(req.query?.dateSelection || "").trim();
    const fromDateRaw = parseCalendarIsoDate(String(req.query?.fromDate || ""));
    const toDateRaw = parseCalendarIsoDate(String(req.query?.toDate || ""));
    const hideCorrections =
      String(req.query?.hideCorrections || "").toLowerCase() === "true";

    let fromDate = fromDateRaw || "";
    let toDate = toDateRaw || "";

    if (!fromDate || !toDate) {
      const selection = DATE_SELECTIONS.includes(dateSelectionRaw as TransactionListDateSelection)
        ? (dateSelectionRaw as TransactionListDateSelection)
        : fromDateRaw && toDateRaw
          ? "Custom Dates"
          : "This Month";

      if (selection === "Custom Dates" && (!fromDateRaw || !toDateRaw)) {
        return res.status(400).json({
          success: false,
          error: "Custom Dates requires fromDate and toDate (YYYY-MM-DD)",
        });
      }

      const resolved = resolveTransactionListDateRange(
        selection,
        fromDateRaw || undefined,
        toDateRaw || undefined
      );

      if (!resolved.fromDate || !resolved.toDate) {
        return res.status(400).json({
          success: false,
          error: "Could not resolve date range. Provide dateSelection or fromDate/toDate.",
        });
      }

      fromDate = resolved.fromDate;
      toDate = resolved.toDate;
    }

    if (fromDate > toDate) {
      return res.status(400).json({
        success: false,
        error: "fromDate must be on or before toDate",
      });
    }

    await relinkSchoolBillingLedger(schoolId);

    const result = await buildTransactionExport(schoolId, {
      type,
      fromDate,
      toDate,
      hideCorrections,
    });

    return res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      ...result,
    });
  } catch (error) {
    console.error("[billingReports] GET /transactions failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
