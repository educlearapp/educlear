import crypto from "crypto";
import fs from "fs";
import path from "path";

import { prisma } from "../../prisma";
import { resolveBillingAccountRef } from "../resolveBillingAccountRef";
import { finalizeSchoolBillingLedgerAfterPaymentWrites } from "../billingPaymentPostService";
import {
  normaliseAmount,
  normaliseIsoDate,
  readSchoolLedger,
  writeSchoolLedger,
  upsertSchoolEntries,
  type BillingLedgerEntry,
} from "../../utils/billingLedgerStore";
import { readMigrationSpreadsheetMatrix } from "../../utils/migrationLearnerFileParser";

type ParsedTopupPaymentRow = {
  rowNumber: number;
  accountNoRaw: string;
  accountNo: string;
  receiptNo: string;
  transactionDate: string;
  amount: number;
  paymentType: string;
  description: string;
  fingerprint: string;
};

export type MigrationTopupPaymentsPreviewRow = {
  rowNumber: number;
  accountNo: string;
  receiptNo: string;
  transactionDate: string;
  amount: number;
  paymentType: string;
  description: string;
  status: "new" | "duplicate" | "unmatched";
  reason: string;
  fingerprint: string;
};

export type MigrationTopupPaymentsPreview = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  sessionId: string;
  fileName: string;
  canApply: boolean;
  totals: {
    totalRows: number;
    newPayments: number;
    duplicatesSkipped: number;
    unmatchedRows: number;
    accountsAffected: number;
    totalPaymentAmount: number;
  };
  rows: MigrationTopupPaymentsPreviewRow[];
};

export type MigrationTopupPaymentsApplyResult = {
  success: boolean;
  schoolId: string;
  batchId: string;
  fileName: string;
  uploadedAt: string;
  uploadedBy: string;
  rowsImported: number;
  rowsSkipped: number;
  totalAmount: number;
  ledgerEntryIds: string[];
};

type SessionPayload = {
  schoolId: string;
  fileName: string;
  createdAt: string;
  uploadedBy: string;
  rows: ParsedTopupPaymentRow[];
};

const SESSION_ROOT = path.join(process.cwd(), "uploads", "migration-centre", "topup-payments");
const PREVIEW_SAMPLE = 200;

function sessionPath(schoolId: string, sessionId: string): string {
  return path.join(SESSION_ROOT, schoolId, `${sessionId}.json`);
}

function newSessionId(): string {
  return `tp-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function normalizeHeaderKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function matrixToRecords(matrix: string[][]): { headers: string[]; rows: Record<string, string>[] } {
  if (!matrix.length) return { headers: [], rows: [] };
  let headerIdx = 0;
  while (headerIdx < matrix.length && matrix[headerIdx].every((c) => !String(c ?? "").trim())) {
    headerIdx++;
  }
  if (headerIdx >= matrix.length) return { headers: [], rows: [] };
  const headers = matrix[headerIdx].map((h) => String(h ?? "").trim());
  const rows: Record<string, string>[] = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i];
    if (cells.every((c) => !String(c ?? "").trim())) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = String(cells[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function pickField(row: Record<string, string>, aliases: string[]): string {
  const map = new Map<string, string>();
  for (const [key, value] of Object.entries(row)) {
    map.set(normalizeHeaderKey(key), String(value ?? "").trim());
  }
  for (const alias of aliases) {
    const value = map.get(normalizeHeaderKey(alias));
    if (value) return value;
  }
  return "";
}

function normalizeReceipt(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9\-_/]/g, "");
}

function normalizePaymentType(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const norm = raw.replace(/\s+/g, " ").trim();
  return norm.length > 48 ? norm.slice(0, 48) : norm;
}

function normalizeMoney(value: unknown): number {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[Rr]/g, "").replace(/\s+/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100) / 100;
}

function buildFingerprint(input: {
  accountNo: string;
  receiptNo: string;
  transactionDate: string;
  amount: number;
  paymentType: string;
}): string {
  const accountNo = String(input.accountNo || "").trim();
  const receiptNo = normalizeReceipt(input.receiptNo);
  const date = normaliseIsoDate(input.transactionDate);
  const amount = Math.round(normaliseAmount(input.amount) * 100) / 100;
  const paymentType = normalizePaymentType(input.paymentType).toUpperCase();
  const key = [accountNo, receiptNo, date, amount.toFixed(2), paymentType].join("|");
  return crypto.createHash("sha1").update(key).digest("hex");
}

function ledgerEntryIdFromFingerprint(fingerprint: string): string {
  return `kidesys-topup-payment-${String(fingerprint || "").slice(0, 40)}`;
}

function parseTopupRowsFromSpreadsheet(parsePath: string, fileName: string): ParsedTopupPaymentRow[] {
  const buffer = fs.readFileSync(parsePath);
  const matrix = readMigrationSpreadsheetMatrix(buffer, fileName);
  const { rows } = matrixToRecords(matrix);
  const out: ParsedTopupPaymentRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNumber = i + 2;

    const accountNoRaw =
      pickField(row, ["account_no", "account", "account_number", "account_ref", "debtor_code"]) || "";
    const receiptNo =
      pickField(row, ["receipt_no", "receipt_number", "receipt", "reference", "ref", "payment_no"]) ||
      "";
    const dateRaw =
      pickField(row, ["transaction_date", "date", "payment_date", "received_date", "posted_date"]) ||
      "";
    const amountRaw = pickField(row, ["amount", "value", "total", "payment_amount", "money_in"]) || "";
    const paymentType = pickField(row, ["payment_type", "type", "method", "payment_method"]) || "";
    const description =
      pickField(row, ["description", "memo", "notes", "narrative"]) ||
      pickField(row, ["details"]) ||
      "Kid-e-Sys top-up payment";

    const amount = normalizeMoney(amountRaw);
    const transactionDate = normaliseIsoDate(dateRaw) || normaliseIsoDate(dateRaw.replace(/\./g, "-"));
    const accountNo = String(accountNoRaw || "").trim();

    if (!accountNo && !receiptNo && !transactionDate && !amount) continue;

    const fingerprint = buildFingerprint({
      accountNo,
      receiptNo,
      transactionDate,
      amount,
      paymentType,
    });

    out.push({
      rowNumber,
      accountNoRaw,
      accountNo,
      receiptNo,
      transactionDate,
      amount,
      paymentType,
      description: String(description || "").trim(),
      fingerprint,
    });
  }

  if (out.length) return out;

  // Fallback: Kid-e-Sys "Transaction List" export sometimes ships as a report-style sheet where the
  // first column is a section title ("Invoice", "Payment", ...) and there are no explicit headers.
  // In that case we parse ONLY the "Payment" section by fixed column positions.
  const sectionIdx = matrix.findIndex(
    (r) => String(r?.[0] ?? "").trim().toLowerCase() === "payment"
  );
  if (sectionIdx === -1) return out;

  for (let i = sectionIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    const first = String(cells[0] ?? "").trim();
    const second = String(cells[1] ?? "").trim();

    // Skip report date range line ("1 January ...") and blank spacer lines.
    if (
      first &&
      !/^\d+$/.test(first) &&
      /to/i.test(first) &&
      cells.slice(1).every((c) => !String(c ?? "").trim())
    ) {
      continue;
    }
    if (cells.every((c) => !String(c ?? "").trim())) continue;

    // Stop when a new section header appears (e.g., "Invoice") in the first cell and the rest is empty.
    const sectionTitle = first.toLowerCase();
    const looksLikeSectionHeader =
      ["invoice", "payment", "credit_note", "credit note", "debit_note", "debit note"].includes(sectionTitle) &&
      cells.slice(1).every((c) => !String(c ?? "").trim());
    if (looksLikeSectionHeader) break;

    // Expected layout under "Payment" section:
    // 0: row index, 1: payment ref (e.g. "Payment 33470"), 2: date, 3: account ref / debtor code,
    // 4: name/description, 6: amount (often negative in report).
    if (!/^\d+$/.test(first)) continue;
    const rowNumber = i + 1; // 1-indexed sheet row number
    const accountNoRaw = String(cells[3] ?? "").trim();
    const accountNo = accountNoRaw;
    const receiptNo = String(second || "").trim();
    const transactionDate = normaliseIsoDate(String(cells[2] ?? "").trim());
    const amount = normalizeMoney(cells[6] ?? "");
    const paymentType = "Payment";
    const description = String(cells[4] ?? "").trim() || "Kid-e-Sys top-up payment";

    if (!accountNo && !receiptNo && !transactionDate && !amount) continue;

    const fingerprint = buildFingerprint({
      accountNo,
      receiptNo,
      transactionDate,
      amount,
      paymentType,
    });

    out.push({
      rowNumber,
      accountNoRaw,
      accountNo,
      receiptNo,
      transactionDate,
      amount,
      paymentType,
      description,
      fingerprint,
    });
  }

  return out;
}

async function fingerprintAlreadyImported(schoolId: string, fingerprint: string): Promise<boolean> {
  const existing = await prisma.migrationTopupPaymentRow.findFirst({
    where: { schoolId, fingerprint },
    select: { id: true },
  });
  return Boolean(existing?.id);
}

function ledgerHasMatchingPayment(schoolId: string, parsed: ParsedTopupPaymentRow): boolean {
  const ledger = readSchoolLedger(schoolId);
  const targetId = ledgerEntryIdFromFingerprint(parsed.fingerprint);
  if (ledger.some((e) => e.id === targetId)) return true;

  const receipt = normalizeReceipt(parsed.receiptNo);
  const date = normaliseIsoDate(parsed.transactionDate);
  const amount = Math.round(normaliseAmount(parsed.amount) * 100) / 100;
  const paymentType = normalizePaymentType(parsed.paymentType);
  const accountNo = String(parsed.accountNo || "").trim();

  return ledger.some((e) => {
    if (e.type !== "payment") return false;
    if (String(e.accountNo || "").trim() !== accountNo) return false;
    const eAmount = Math.round(normaliseAmount(e.amount) * 100) / 100;
    if (Math.abs(eAmount - amount) > 0.001) return false;
    const eDate = normaliseIsoDate(e.date);
    if (date && eDate && eDate !== date) return false;
    const eReceipt = normalizeReceipt(e.reference || "");
    if (receipt && eReceipt && eReceipt !== receipt) return false;
    if (paymentType) {
      const eType = normalizePaymentType(e.method || e.reference || "");
      if (eType && eType.toLowerCase() === paymentType.toLowerCase()) return true;
    }
    return Boolean(receipt && eReceipt === receipt);
  });
}

export async function previewMigrationTopupPaymentsImport(opts: {
  schoolId: string;
  transactionFilePath: string;
  originalFileName: string;
  uploadedBy: string;
}): Promise<MigrationTopupPaymentsPreview> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw new Error("schoolId required");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const parsedRows = parseTopupRowsFromSpreadsheet(
    path.resolve(opts.transactionFilePath),
    opts.originalFileName
  );

  if (!parsedRows.length) throw new Error("No payment rows parsed from file");

  const previewRows: MigrationTopupPaymentsPreviewRow[] = [];
  const accountSet = new Set<string>();
  let totalPaymentAmount = 0;

  let newPayments = 0;
  let duplicatesSkipped = 0;
  let unmatchedRows = 0;
  const seenFingerprints = new Set<string>();

  for (const row of parsedRows) {
    totalPaymentAmount += row.amount || 0;
    const accountNo = String(row.accountNo || "").trim();
    if (accountNo) accountSet.add(accountNo);

    if (!accountNo) {
      unmatchedRows += 1;
      previewRows.push({
        rowNumber: row.rowNumber,
        accountNo: "",
        receiptNo: row.receiptNo,
        transactionDate: row.transactionDate,
        amount: row.amount,
        paymentType: row.paymentType,
        description: row.description,
        status: "unmatched",
        reason: "Missing account number",
        fingerprint: row.fingerprint,
      });
      continue;
    }

    const resolved = await resolveBillingAccountRef(schoolId, accountNo);
    if (!resolved?.accountRef) {
      unmatchedRows += 1;
      previewRows.push({
        rowNumber: row.rowNumber,
        accountNo,
        receiptNo: row.receiptNo,
        transactionDate: row.transactionDate,
        amount: row.amount,
        paymentType: row.paymentType,
        description: row.description,
        status: "unmatched",
        reason: `Account not found for ref ${accountNo}`,
        fingerprint: row.fingerprint,
      });
      continue;
    }

    const normalizedRow: ParsedTopupPaymentRow = { ...row, accountNo: resolved.accountRef };
    if (seenFingerprints.has(normalizedRow.fingerprint)) {
      duplicatesSkipped += 1;
      previewRows.push({
        rowNumber: row.rowNumber,
        accountNo: normalizedRow.accountNo,
        receiptNo: row.receiptNo,
        transactionDate: row.transactionDate,
        amount: row.amount,
        paymentType: row.paymentType,
        description: row.description,
        status: "duplicate",
        reason: "Duplicate within uploaded file",
        fingerprint: normalizedRow.fingerprint,
      });
      continue;
    }
    seenFingerprints.add(normalizedRow.fingerprint);
    const alreadyImported =
      ledgerHasMatchingPayment(schoolId, normalizedRow) ||
      (await fingerprintAlreadyImported(schoolId, normalizedRow.fingerprint));
    if (alreadyImported) {
      duplicatesSkipped += 1;
      previewRows.push({
        rowNumber: row.rowNumber,
        accountNo: normalizedRow.accountNo,
        receiptNo: row.receiptNo,
        transactionDate: row.transactionDate,
        amount: row.amount,
        paymentType: row.paymentType,
        description: row.description,
        status: "duplicate",
        reason: "Already imported / matching payment exists",
        fingerprint: normalizedRow.fingerprint,
      });
      continue;
    }

    newPayments += 1;
    previewRows.push({
      rowNumber: row.rowNumber,
      accountNo: normalizedRow.accountNo,
      receiptNo: row.receiptNo,
      transactionDate: row.transactionDate,
      amount: row.amount,
      paymentType: row.paymentType,
      description: row.description,
      status: "new",
      reason: "Ready to import",
      fingerprint: normalizedRow.fingerprint,
    });
  }

  const sessionId = newSessionId();
  const sessionDir = path.join(SESSION_ROOT, schoolId);
  fs.mkdirSync(sessionDir, { recursive: true });
  const payload: SessionPayload = {
    schoolId,
    fileName: opts.originalFileName,
    createdAt: new Date().toISOString(),
    uploadedBy: String(opts.uploadedBy || "").trim() || "Migration Centre",
    rows: parsedRows,
  };
  fs.writeFileSync(sessionPath(schoolId, sessionId), JSON.stringify(payload, null, 2), "utf8");

  return {
    success: true,
    schoolId,
    schoolName: school.name,
    sessionId,
    fileName: opts.originalFileName,
    canApply: newPayments > 0,
    totals: {
      totalRows: parsedRows.length,
      newPayments,
      duplicatesSkipped,
      unmatchedRows,
      accountsAffected: accountSet.size,
      totalPaymentAmount: Math.round(totalPaymentAmount * 100) / 100,
    },
    rows: previewRows.slice(0, PREVIEW_SAMPLE),
  };
}

export async function applyMigrationTopupPaymentsImport(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<MigrationTopupPaymentsApplyResult> {
  const schoolId = String(opts.schoolId || "").trim();
  const sessionId = String(opts.sessionId || "").trim();
  if (!schoolId || !sessionId) throw new Error("schoolId and sessionId required");

  const file = sessionPath(schoolId, sessionId);
  if (!fs.existsSync(file)) throw new Error("Import session expired or not found — run preview again");

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8")) as SessionPayload;
  } catch {
    throw new Error("Invalid import session data");
  }
  if (payload.schoolId !== schoolId) throw new Error("Session does not match school");

  const uploadedBy = String(payload.uploadedBy || "").trim() || "Migration Centre";
  const uploadedAt = new Date().toISOString();

  const ledgerEntries: BillingLedgerEntry[] = [];
  const ledgerEntryIds: string[] = [];
  const importedRows: Array<ParsedTopupPaymentRow & { accountNo: string; ledgerEntryId: string }> = [];

  let rowsImported = 0;
  let rowsSkipped = 0;
  let totalAmount = 0;
  const seenFingerprints = new Set<string>();

  for (const row of payload.rows || []) {
    const accountNoRaw = String(row.accountNo || "").trim();
    const resolved = accountNoRaw ? await resolveBillingAccountRef(schoolId, accountNoRaw) : null;
    const accountNo = String(resolved?.accountRef || "").trim();
    if (!accountNo) {
      rowsSkipped += 1;
      continue;
    }

    const normalized: ParsedTopupPaymentRow = { ...row, accountNo };
    if (seenFingerprints.has(normalized.fingerprint)) {
      rowsSkipped += 1;
      continue;
    }
    seenFingerprints.add(normalized.fingerprint);
    const duplicate =
      ledgerHasMatchingPayment(schoolId, normalized) ||
      (await fingerprintAlreadyImported(schoolId, normalized.fingerprint));
    if (duplicate) {
      rowsSkipped += 1;
      continue;
    }

    const id = ledgerEntryIdFromFingerprint(normalized.fingerprint);
    const date = normaliseIsoDate(normalized.transactionDate) || new Date().toISOString().slice(0, 10);
    const amount = Math.round(normaliseAmount(normalized.amount) * 100) / 100;
    const receiptNo = String(normalized.receiptNo || "").trim();
    const paymentType = normalizePaymentType(normalized.paymentType) || "EFT";
    const description = String(normalized.description || "").trim() || "Kid-e-Sys top-up payment";

    if (!amount || !date) {
      rowsSkipped += 1;
      continue;
    }

    const entry: BillingLedgerEntry = {
      id,
      schoolId,
      learnerId: "",
      accountNo,
      type: "payment",
      amount,
      date,
      reference: receiptNo || paymentType,
      description,
      method: paymentType || undefined,
      source: "kidesys_topup",
      createdAt: uploadedAt,
    };

    ledgerEntries.push(entry);
    ledgerEntryIds.push(id);
    importedRows.push({ ...normalized, accountNo, ledgerEntryId: id });
    rowsImported += 1;
    totalAmount += amount;
  }

  const batch = await prisma.migrationTopupPaymentBatch.create({
    data: {
      schoolId,
      uploadedBy,
      sourceFilename: payload.fileName,
      uploadedAt: new Date(uploadedAt),
      rowsImported,
      rowsSkipped,
      totalAmount: Math.round(totalAmount * 100) / 100,
    },
    select: { id: true },
  });

  if (ledgerEntries.length) {
    upsertSchoolEntries(schoolId, ledgerEntries);
  }

  if (ledgerEntryIds.length) {
    await prisma.migrationTopupPaymentRow.createMany({
      data: ledgerEntries.map((entry) => ({
        schoolId,
        batchId: batch.id,
        fingerprint:
          importedRows.find((r) => r.ledgerEntryId === entry.id)?.fingerprint ||
          crypto.createHash("sha1").update(entry.id).digest("hex"),
        accountNo: entry.accountNo,
        receiptNo: entry.reference || "",
        transactionDate: entry.date,
        amount: entry.amount,
        paymentType: entry.method || "",
        ledgerEntryId: entry.id,
        status: "imported",
        reason: "Imported",
      })),
      skipDuplicates: true,
    });
  }

  await finalizeSchoolBillingLedgerAfterPaymentWrites(schoolId);

  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }

  return {
    success: true,
    schoolId,
    batchId: batch.id,
    fileName: payload.fileName,
    uploadedAt,
    uploadedBy,
    rowsImported,
    rowsSkipped,
    totalAmount: Math.round(totalAmount * 100) / 100,
    ledgerEntryIds,
  };
}

export async function listTopupPaymentBatches(schoolId: string) {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];
  return prisma.migrationTopupPaymentBatch.findMany({
    where: { schoolId: sid },
    orderBy: { uploadedAt: "desc" },
    take: 50,
  });
}

export async function rollbackTopupPaymentBatch(opts: {
  schoolId: string;
  batchId: string;
}): Promise<{ success: boolean; batchId: string; removed: number }> {
  const schoolId = String(opts.schoolId || "").trim();
  const batchId = String(opts.batchId || "").trim();
  if (!schoolId || !batchId) throw new Error("schoolId and batchId required");

  const batch = await prisma.migrationTopupPaymentBatch.findFirst({
    where: { id: batchId, schoolId },
    select: { id: true, rolledBackAt: true },
  });
  if (!batch) throw new Error("Batch not found");
  if (batch.rolledBackAt) throw new Error("Batch already rolled back");

  const rows = await prisma.migrationTopupPaymentRow.findMany({
    where: { batchId, schoolId, status: "imported" },
    select: { ledgerEntryId: true },
  });
  const ids = (rows as Array<{ ledgerEntryId: string | null }>)
    .map((r) => String(r.ledgerEntryId || "").trim())
    .filter(Boolean);
  const ledger = readSchoolLedger(schoolId);
  const before = ledger.length;
  const next = ledger.filter((e) => !ids.includes(e.id));
  writeSchoolLedger(schoolId, next);

  await prisma.migrationTopupPaymentBatch.update({
    where: { id: batchId },
    data: { rolledBackAt: new Date(), rolledBackBy: "migration-centre" },
  });
  await prisma.migrationTopupPaymentRow.updateMany({
    where: { batchId, schoolId },
    data: { status: "rolled_back", reason: "Rolled back" },
  });

  await finalizeSchoolBillingLedgerAfterPaymentWrites(schoolId);

  return { success: true, batchId, removed: Math.max(0, before - next.length) };
}

