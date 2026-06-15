import { Router } from "express";

import { loadSchoolBillingSettings } from "./billingSettings";
import { buildBillingAccountPostResponse } from "../services/billingPostResponse";
import { relinkSchoolBillingLedger } from "../services/billingLedgerRelink";
import {
  assertOfficialBillingAccountRef,
  resolveOfficialBillingAccountRef,
} from "../services/officialBillingAccountRef";
import {
  buildInvoiceReference,
  computeInvoiceDueDate,
  normaliseIsoDate,
  resolveInvoiceMessage,
} from "../utils/billingSettingsEngine";
import {
  appendSchoolEntriesSafe,
  appendSchoolEntrySafe,
  buildInvoiceRunEntryId,
  listInvoices,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

const router = Router();

type InvoiceInputBody = Record<string, unknown>;

async function resolveInvoiceAccountNo(
  schoolId: string,
  body: InvoiceInputBody
): Promise<{ accountNo: string; error?: string }> {
  const learnerId = String(body.learnerId || "").trim();
  const accountNo = await resolveOfficialBillingAccountRef(schoolId, {
    learnerId,
    accountNo: String(body.accountNo || body.accountRef || "").trim(),
  });
  if (!accountNo) {
    return {
      accountNo: "",
      error:
        "Could not resolve an official billing account ref for this learner. Link the learner to a Kid-e-Sys family account before invoicing.",
    };
  }
  try {
    assertOfficialBillingAccountRef(schoolId, accountNo);
  } catch (guardError) {
    const message =
      guardError instanceof Error ? guardError.message : "Invalid billing account ref";
    return { accountNo: "", error: message };
  }
  return { accountNo };
}

async function buildInvoiceEntry(
  schoolId: string,
  body: InvoiceInputBody,
  settings: Awaited<ReturnType<typeof loadSchoolBillingSettings>>,
  existingInvoiceCount: number,
  index = 0
): Promise<{ entry?: BillingLedgerEntry; error?: string }> {
  const learnerId = String(body.learnerId || "").trim();
  const amount = normaliseAmount(body.amount);
  if (!amount) {
    return { error: "Missing amount" };
  }

  const resolved = await resolveInvoiceAccountNo(schoolId, body);
  if (!resolved.accountNo) {
    return { error: resolved.error || "Invalid account" };
  }

  const invoiceDate =
    normaliseIsoDate(body.date || body.invoiceDate) || new Date().toISOString().slice(0, 10);
  const dueDate = computeInvoiceDueDate(
    invoiceDate,
    settings,
    normaliseIsoDate(body.dueDate) || undefined
  );

  const fallbackRef = String(body.reference || body.invoiceNumber || `INV-${Date.now()}`).trim();
  const reference = buildInvoiceReference(
    settings,
    invoiceDate,
    existingInvoiceCount + index + 1,
    fallbackRef
  );

  const description =
    String(body.description || "").trim() ||
    resolveInvoiceMessage(settings) ||
    "Invoice";

  const runId = body.runId ? String(body.runId).trim() : "";
  const lineKey = String(body.lineKey || body.lineId || "").trim();
  const defaultId = runId
    ? buildInvoiceRunEntryId(runId, learnerId, resolved.accountNo, lineKey || String(index))
    : `invoice-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;

  const entry: BillingLedgerEntry = {
    id: String(body.id || defaultId).trim() || defaultId,
    schoolId,
    learnerId,
    accountNo: resolved.accountNo,
    type: "invoice",
    amount,
    date: invoiceDate,
    dueDate,
    reference,
    description,
    runId: runId || undefined,
    createdAt: new Date().toISOString(),
  };

  return { entry };
}

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
