import { Router } from "express";

import { loadSchoolBillingSettings } from "./billingSettings";
import { buildBillingAccountPostResponse } from "../services/billingPostResponse";
import { relinkSchoolBillingLedger } from "../services/billingLedgerRelink";
import { buildInvoiceEntry } from "../services/invoiceEntryBuilder";
import {
  appendSchoolEntriesSafe,
  appendSchoolEntrySafe,
  listInvoices,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const router = Router();

type InvoiceInputBody = Record<string, unknown>;

router.get("/", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const invoices = listInvoices(schoolId).map((entry) => ({
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
      invoicePeriod: entry.invoicePeriod,
    }));

    return res.json({ success: true, invoices });
  } catch (error) {
    console.error("[invoices] GET / failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = (req.body ?? {}) as InvoiceInputBody;
    const schoolId = String(body.schoolId || "").trim();
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const settings = await loadSchoolBillingSettings(schoolId);
    const existingInvoices = listInvoices(schoolId);
    const built = await buildInvoiceEntry(schoolId, body, settings, existingInvoices.length);
    if (!built.entry) {
      return res.status(400).json({ success: false, error: built.error || "Invalid invoice" });
    }

    const appendResult = appendSchoolEntrySafe(schoolId, built.entry);
    const savedEntry = appendResult.entry;
    const accountRef = savedEntry.accountNo;

    const ledger = readSchoolLedger(schoolId);
    const post = await buildBillingAccountPostResponse(schoolId, accountRef, { ledger });

    return res.json({
      success: true,
      duplicate: !appendResult.created,
      duplicateReason: appendResult.duplicateReason,
      invoice: savedEntry,
      balance: post.balance,
      account: post.account,
      ledgerEntries: post.ledgerEntries,
      openInvoices: post.openInvoices,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[invoices] POST / failed:", error);
    const busy = message.includes("Billing ledger is busy");
    return res.status(busy ? 503 : 500).json({ success: false, error: message });
  }
});

router.post("/batch", async (req, res) => {
  try {
    const body = (req.body ?? {}) as InvoiceInputBody;
    const schoolId = String(body.schoolId || "").trim();
    const runId = String(body.runId || "").trim();
    const rows = Array.isArray(body.invoices) ? (body.invoices as InvoiceInputBody[]) : [];

    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    if (!rows.length) {
      return res.status(400).json({ success: false, error: "Missing invoices array" });
    }

    const settings = await loadSchoolBillingSettings(schoolId);
    const existingCount = listInvoices(schoolId).length;
    const entries: BillingLedgerEntry[] = [];
    const skipped: Array<{
      index: number;
      learnerId?: string;
      accountNo?: string;
      reason: string;
    }> = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const amount = normaliseAmount(row.amount);
      if (!amount) {
        skipped.push({
          index,
          learnerId: String(row.learnerId || row.id || "").trim() || undefined,
          accountNo: String(row.accountNo || "").trim() || undefined,
          reason: "Zero invoice amount",
        });
        continue;
      }

      const merged: InvoiceInputBody = {
        ...row,
        schoolId,
        runId: runId || row.runId,
        lineKey: row.lineKey || row.lineId || String(index),
      };
      const built = await buildInvoiceEntry(schoolId, merged, settings, existingCount, index);
      if (!built.entry) {
        skipped.push({
          index,
          learnerId: String(row.learnerId || row.id || "").trim() || undefined,
          accountNo: String(row.accountNo || "").trim() || undefined,
          reason: built.error || "Could not build invoice",
        });
        continue;
      }
      entries.push(built.entry);
    }

    const batch = appendSchoolEntriesSafe(schoolId, entries);
    const invoices = batch.results.map((r) => r.entry);

    const ledger = readSchoolLedger(schoolId);
    const affectedRefs = [
      ...new Set(invoices.map((e) => String(e.accountNo || "").trim().toUpperCase()).filter(Boolean)),
    ];
    const accounts = [];
    for (const ref of affectedRefs) {
      const post = await buildBillingAccountPostResponse(schoolId, ref, { ledger });
      if (post.account) accounts.push(post.account);
    }

    return res.json({
      success: true,
      runId: runId || undefined,
      invoices,
      createdCount: batch.createdCount,
      duplicateCount: batch.duplicateCount,
      skipped: [...skipped, ...batch.skipped],
      accounts,
      statements: accounts,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    console.error("[invoices] POST /batch failed:", error);
    const busy = message.includes("Billing ledger is busy");
    return res.status(busy ? 503 : 500).json({ success: false, error: message });
  }
});

router.get("/ledger", async (req, res) => {
  try {
    const schoolId = typeof req.query?.schoolId === "string" ? String(req.query.schoolId) : "";
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }
    await relinkSchoolBillingLedger(schoolId);
    return res.json({ success: true, entries: readSchoolLedger(schoolId) });
  } catch (error) {
    console.error("[invoices] GET /ledger failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
