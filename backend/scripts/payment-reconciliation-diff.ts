/**
 * Read-only: compare Kid-e-Sys vs EduClear payment exports (CSV or XLSX).
 *
 * Matches payments using:
 * - Account Number
 * - Payment Date
 * - Amount
 * - Reference / Receipt Number where available
 *
 * Outputs:
 * - backend/storage/payment-reconciliation-diff.csv
 * - backend/storage/payment-reconciliation-summary.txt
 *
 * Usage:
 *   npx ts-node scripts/payment-reconciliation-diff.ts \
 *     [kidEsysPath] \
 *     [eduClearPath]
 *
 * Supports Kid-e-Sys .xlsx/.xls (first worksheet) and .csv.
 * EduClear input is .csv.
 *
 * Defaults:
 *   kidEsysPath  = backend/storage/kideesys-payments-from-2026-06-01.xlsx
 *   eduClearPath = backend/storage/educlear-payments-from-2026-06-01.csv
 *
 * DO NOT import payments.
 * DO NOT modify billing data.
 */
import fs from "fs";
import path from "path";

import { parseKideesysSpreadsheetFile } from "../src/utils/kideesysSpreadsheet";

type CsvRow = Record<string, string>;

type PaymentRow = {
  lineNo: number;
  accountNo: string;
  date: string;
  amountCents: number;
  reference: string;
  referenceNorm: string;
  raw: CsvRow;
};

type Totals = { count: number; valueCents: number };

type IssueType =
  | "KIDE_MISSING_IN_EDU"
  | "EDU_MISSING_IN_KIDE"
  | "POSSIBLE_DUPLICATE_KIDE"
  | "POSSIBLE_DUPLICATE_EDU"
  | "AMOUNT_MISMATCH"
  | "DATE_MISMATCH"
  | "REFERENCE_MISMATCH"
  | "ACCOUNT_MISMATCH";

function csvEscape(value: string | number): string {
  const raw = String(value ?? "");
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Robust CSV parser for:
 * - commas
 * - quoted cells
 * - escaped quotes ("")
 * - newlines inside quoted cells
 */
function parseCsv(rawInput: string): { headers: string[]; rows: string[][] } {
  const input = stripBom(String(rawInput || ""));
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };

  const pushRow = () => {
    // ignore trailing empty line
    if (row.length === 1 && row[0] === "" && rows.length === 0) return;
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = input[i + 1];
        if (next === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      pushCell();
      continue;
    }

    if (ch === "\n") {
      pushCell();
      pushRow();
      continue;
    }

    if (ch === "\r") {
      // ignore; handle \r\n
      continue;
    }

    cell += ch;
  }

  pushCell();
  pushRow();

  const headers = (rows.shift() || []).map((h) => String(h || "").trim());
  const dataRows = rows.filter((r) => r.some((c) => String(c || "").trim() !== ""));

  return { headers, rows: dataRows };
}

function rowsToObjects(headers: string[], rows: string[][]): CsvRow[] {
  const normalizedHeaders = headers.map((h) => String(h || "").trim());
  return rows.map((r) => {
    const obj: CsvRow = {};
    for (let i = 0; i < normalizedHeaders.length; i++) {
      const key = normalizedHeaders[i] || `col_${i + 1}`;
      obj[key] = String(r[i] ?? "").trim();
    }
    return obj;
  });
}

function headerKey(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\w ]+/g, "")
    .trim();
}

function pickFirst(row: CsvRow, candidates: string[]): string {
  const keys = Object.keys(row);
  const index = new Map<string, string>();
  for (const k of keys) index.set(headerKey(k), k);
  for (const candidate of candidates) {
    const realKey = index.get(headerKey(candidate));
    if (realKey) return String(row[realKey] || "").trim();
  }
  return "";
}

function normalizeAccountNo(value: string): string {
  return String(value || "").trim().toUpperCase();
}

function parseIsoDate(value: string): string {
  const raw = String(value || "").trim();
  const ymdDash = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (ymdDash) return `${ymdDash[1]}-${ymdDash[2]}-${ymdDash[3]}`;
  const ymdSlash = raw.match(/^(\d{4})\/(\d{2})\/(\d{2})/);
  if (ymdSlash) return `${ymdSlash[1]}-${ymdSlash[2]}-${ymdSlash[3]}`;
  // Kid-e-Sys exports sometimes include dd/mm/yyyy or dd-mm-yyyy
  const dmy = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (dmy) {
    const day = String(dmy[1]).padStart(2, "0");
    const month = String(dmy[2]).padStart(2, "0");
    const year = dmy[3];
    return `${year}-${month}-${day}`;
  }
  return raw.slice(0, 10);
}

function parseMoneyToCents(value: string): number {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  const cleaned = raw
    .replace(/R/gi, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.abs(n) * 100);
}

function normalizeReference(value: string): string {
  const raw = String(value || "").trim();
  return raw;
}

function normalizeReferenceKey(value: string): string {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  // Keep a conservative key (letters, numbers, space, dash)
  return raw.replace(/[^A-Z0-9 \-_/]+/g, "").trim();
}

function formatMoneyFromCents(cents: number): string {
  const n = Math.round(Number(cents || 0));
  return (n / 100).toFixed(2);
}

function paymentFingerprint(p: PaymentRow): { withRef: string; noRef: string } {
  const base = `${p.accountNo}|${p.date}|${p.amountCents}`;
  const noRef = base;
  const withRef = p.referenceNorm ? `${base}|${p.referenceNorm}` : base;
  return { withRef, noRef };
}

function sumTotals(rows: PaymentRow[]): Totals {
  const valueCents = rows.reduce((s, r) => s + r.amountCents, 0);
  return { count: rows.length, valueCents };
}

function buildMatchIndex(rows: PaymentRow[]) {
  const byWithRef = new Map<string, number[]>();
  const byNoRef = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const fp = paymentFingerprint(rows[i]);
    if (!byWithRef.has(fp.withRef)) byWithRef.set(fp.withRef, []);
    byWithRef.get(fp.withRef)!.push(i);

    if (!byNoRef.has(fp.noRef)) byNoRef.set(fp.noRef, []);
    byNoRef.get(fp.noRef)!.push(i);
  }
  return { byWithRef, byNoRef };
}

function popIndex(map: Map<string, number[]>, key: string): number | null {
  const list = map.get(key);
  if (!list || list.length === 0) return null;
  const idx = list.pop();
  if (list.length === 0) map.delete(key);
  return typeof idx === "number" ? idx : null;
}

function findFirstCandidate(
  eduRows: PaymentRow[],
  usedEdu: Set<number>,
  predicate: (p: PaymentRow) => boolean
): { index: number; row: PaymentRow } | null {
  for (let i = 0; i < eduRows.length; i++) {
    if (usedEdu.has(i)) continue;
    const r = eduRows[i];
    if (predicate(r)) return { index: i, row: r };
  }
  return null;
}

function isSpreadsheetPath(filePath: string): boolean {
  return /\.(xlsx|xls)$/i.test(filePath);
}

function isCsvPath(filePath: string): boolean {
  return /\.csv$/i.test(filePath);
}

/**
 * Kid-e-Sys Transaction List report layout:
 * Section header "Payment" then rows:
 * 0: index, 1: Payment ref, 2: date, 3: account, 4: name, 5: type, 6: amount
 */
function parseKidEsysReportPaymentRows(matrix: string[][]): CsvRow[] {
  const sectionIdx = matrix.findIndex(
    (r) => String(r?.[0] ?? "").trim().toLowerCase() === "payment"
  );
  if (sectionIdx === -1) return [];

  const out: CsvRow[] = [];
  for (let i = sectionIdx + 1; i < matrix.length; i++) {
    const cells = matrix[i] || [];
    const first = String(cells[0] ?? "").trim();
    const second = String(cells[1] ?? "").trim();

    if (
      first &&
      !/^\d+$/.test(first) &&
      /to/i.test(first) &&
      cells.slice(1).every((c) => !String(c ?? "").trim())
    ) {
      continue;
    }
    if (cells.every((c) => !String(c ?? "").trim())) continue;

    const sectionTitle = first.toLowerCase();
    const looksLikeSectionHeader =
      ["invoice", "payment", "credit_note", "credit note", "debit_note", "debit note"].includes(
        sectionTitle
      ) && cells.slice(1).every((c) => !String(c ?? "").trim());
    if (looksLikeSectionHeader) break;

    if (!/^\d+$/.test(first)) continue;
    if (/total/i.test(second)) continue;

    out.push({
      "Account Number": String(cells[3] ?? "").trim(),
      "Payment Date": String(cells[2] ?? "").trim(),
      Amount: String(cells[6] ?? "").trim(),
      "Receipt / Reference Number": second,
      Description: String(cells[4] ?? "").trim(),
      "Payment Type": String(cells[5] ?? "").trim(),
      _sourceLine: String(i + 1),
    });
  }
  return out;
}

function loadSpreadsheetObjects(filePath: string): { headers: string[]; objects: CsvRow[] } {
  const sheet = parseKideesysSpreadsheetFile(filePath);
  const matrix = sheet.rows;

  const reportPayments = parseKidEsysReportPaymentRows(matrix);
  if (reportPayments.length) {
    const headers = Object.keys(reportPayments[0]).filter((k) => !k.startsWith("_"));
    return { headers, objects: reportPayments };
  }

  const nonEmpty = matrix.filter((r) => r.some((c) => String(c || "").trim() !== ""));
  if (!nonEmpty.length) return { headers: [], objects: [] };

  const headers = nonEmpty[0].map((h) => String(h || "").trim());
  const dataRows = nonEmpty.slice(1);
  const objects = rowsToObjects(headers, dataRows);
  return { headers, objects };
}

function mapObjectsToPayments(objects: CsvRow[], kind: "kidesys" | "educlear"): PaymentRow[] {
  return objects
    .map((row, idx) => {
      const accountNo = normalizeAccountNo(
        pickFirst(row, [
          "Account Number",
          "Account No",
          "Account",
          "Acc No",
          "AccNo",
          "AccountNo",
          "account_no",
          "account_ref",
          "debtor_code",
        ])
      );

      const date = parseIsoDate(
        pickFirst(row, [
          "Payment Date",
          "Date",
          "Transaction Date",
          "Txn Date",
          "transaction_date",
          "payment_date",
        ])
      );

      const amountCents = parseMoneyToCents(
        pickFirst(row, ["Amount", "Payment Amount", "Value", "Paid", "Paid Amount", "money_in"])
      );

      const reference = normalizeReference(
        pickFirst(row, [
          "Receipt / Reference Number",
          "Reference / Receipt Number",
          "Receipt No",
          "Receipt Number",
          "Reference",
          "Ref",
          "Receipt",
          "receipt_no",
          "payment_no",
        ])
      );

      const referenceNorm = normalizeReferenceKey(reference);
      const sourceLine = Number(row._sourceLine) || idx + 2;

      return {
        lineNo: sourceLine,
        accountNo,
        date,
        amountCents,
        reference,
        referenceNorm,
        raw: row,
      } satisfies PaymentRow;
    })
    .filter((p) => {
      if (!p.accountNo) return false;
      if (!p.date) return false;
      if (!p.amountCents) return false;
      void kind;
      return true;
    });
}

function loadPaymentsFromFile(filePath: string, kind: "kidesys" | "educlear"): PaymentRow[] {
  if (isSpreadsheetPath(filePath)) {
    const { objects } = loadSpreadsheetObjects(filePath);
    return mapObjectsToPayments(objects, kind);
  }

  if (!isCsvPath(filePath)) {
    throw new Error(`Unsupported file type: ${filePath} (expected .csv, .xlsx, or .xls)`);
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseCsv(raw);
  const objects = rowsToObjects(parsed.headers, parsed.rows);
  return mapObjectsToPayments(objects, kind);
}

function buildDuplicateIssues(kind: "kidesys" | "educlear", rows: PaymentRow[]) {
  const counts = new Map<string, { count: number; valueCents: number }>();
  for (const r of rows) {
    const fp = paymentFingerprint(r);
    const key = r.referenceNorm ? fp.withRef : fp.noRef;
    const prev = counts.get(key) || { count: 0, valueCents: 0 };
    counts.set(key, { count: prev.count + 1, valueCents: prev.valueCents + r.amountCents });
  }

  const issues: {
    type: IssueType;
    row: PaymentRow;
    note: string;
    duplicateGroupCount: number;
  }[] = [];

  for (const r of rows) {
    const fp = paymentFingerprint(r);
    const key = r.referenceNorm ? fp.withRef : fp.noRef;
    const meta = counts.get(key);
    if (!meta || meta.count <= 1) continue;
    issues.push({
      type: kind === "kidesys" ? "POSSIBLE_DUPLICATE_KIDE" : "POSSIBLE_DUPLICATE_EDU",
      row: r,
      note: `Duplicate fingerprint occurs ${meta.count} times in ${kind}`,
      duplicateGroupCount: meta.count,
    });
  }

  const duplicateGroups = [...counts.values()].filter((m) => m.count > 1);
  const duplicateCount = duplicateGroups.reduce((s, m) => s + m.count, 0);
  const duplicateValueCents = duplicateGroups.reduce((s, m) => s + m.valueCents, 0);

  return { issues, duplicateCount, duplicateValueCents };
}

async function main() {
  const defaultKid = path.join(process.cwd(), "storage", "kideesys-payments-from-2026-06-01.xlsx");
  const defaultEdu = path.join(process.cwd(), "storage", "educlear-payments-from-2026-06-01.csv");

  const kidPath = path.resolve(process.argv[2] || defaultKid);
  const eduPath = path.resolve(process.argv[3] || defaultEdu);

  if (!fs.existsSync(kidPath)) {
    throw new Error(`Kid-e-Sys export not found: ${kidPath}`);
  }
  if (!fs.existsSync(eduPath)) {
    throw new Error(`EduClear CSV not found: ${eduPath}`);
  }

  const kideysRows = loadPaymentsFromFile(kidPath, "kidesys");
  const eduRows = loadPaymentsFromFile(eduPath, "educlear");

  const kidTotals = sumTotals(kideysRows);
  const eduTotals = sumTotals(eduRows);

  const eduIndex = buildMatchIndex(eduRows);
  const usedEdu = new Set<number>();

  const missingInEdu: { row: PaymentRow; note: string }[] = [];
  const mismatchIssues: {
    type: IssueType;
    kid: PaymentRow;
    edu: PaymentRow;
    note: string;
  }[] = [];

  for (const kid of kideysRows) {
    const fp = paymentFingerprint(kid);

    // Prefer strict match when reference exists on Kid row.
    let matchedIndex: number | null = null;
    if (kid.referenceNorm) {
      matchedIndex = popIndex(eduIndex.byWithRef, fp.withRef);
    }
    if (matchedIndex == null) {
      matchedIndex = popIndex(eduIndex.byNoRef, fp.noRef);
    }

    if (matchedIndex != null) {
      usedEdu.add(matchedIndex);
      continue;
    }

    // Try detect mismatches (same account+amount, but date differs; or same account+date, amount differs; or reference differs).
    const candidateDateMismatch = findFirstCandidate(
      eduRows,
      usedEdu,
      (e) =>
        e.accountNo === kid.accountNo &&
        e.amountCents === kid.amountCents &&
        (kid.referenceNorm ? e.referenceNorm === kid.referenceNorm : true) &&
        e.date !== kid.date
    );
    if (candidateDateMismatch) {
      usedEdu.add(candidateDateMismatch.index);
      mismatchIssues.push({
        type: "DATE_MISMATCH",
        kid,
        edu: candidateDateMismatch.row,
        note: "Account + Amount match, but Payment Date differs",
      });
      continue;
    }

    const candidateAmountMismatch = findFirstCandidate(
      eduRows,
      usedEdu,
      (e) =>
        e.accountNo === kid.accountNo &&
        e.date === kid.date &&
        (kid.referenceNorm ? e.referenceNorm === kid.referenceNorm : true) &&
        e.amountCents !== kid.amountCents
    );
    if (candidateAmountMismatch) {
      usedEdu.add(candidateAmountMismatch.index);
      mismatchIssues.push({
        type: "AMOUNT_MISMATCH",
        kid,
        edu: candidateAmountMismatch.row,
        note: "Account + Date match, but Amount differs",
      });
      continue;
    }

    if (kid.referenceNorm) {
      const candidateRefMismatch = findFirstCandidate(
        eduRows,
        usedEdu,
        (e) =>
          e.accountNo === kid.accountNo &&
          e.date === kid.date &&
          e.amountCents === kid.amountCents &&
          e.referenceNorm !== kid.referenceNorm
      );
      if (candidateRefMismatch) {
        usedEdu.add(candidateRefMismatch.index);
        mismatchIssues.push({
          type: "REFERENCE_MISMATCH",
          kid,
          edu: candidateRefMismatch.row,
          note: "Account + Date + Amount match, but Reference differs",
        });
        continue;
      }
    }

    if (kid.referenceNorm) {
      const candidateAccountMismatch = findFirstCandidate(
        eduRows,
        usedEdu,
        (e) =>
          e.date === kid.date &&
          e.amountCents === kid.amountCents &&
          e.referenceNorm === kid.referenceNorm &&
          e.accountNo !== kid.accountNo
      );
      if (candidateAccountMismatch) {
        usedEdu.add(candidateAccountMismatch.index);
        mismatchIssues.push({
          type: "ACCOUNT_MISMATCH",
          kid,
          edu: candidateAccountMismatch.row,
          note: "Date + Amount + Reference match, but Account Number differs",
        });
        continue;
      }
    }

    missingInEdu.push({ row: kid, note: "No matching payment in EduClear export" });
  }

  const missingInKid = eduRows
    .map((row, idx) => ({ row, idx }))
    .filter((r) => !usedEdu.has(r.idx))
    .map((r) => ({ row: r.row, note: "No matching payment in Kid-e-Sys export" }));

  const missingEduTotals = sumTotals(missingInEdu.map((m) => m.row));
  const missingKidTotals = sumTotals(missingInKid.map((m) => m.row));

  const kidDup = buildDuplicateIssues("kidesys", kideysRows);
  const eduDup = buildDuplicateIssues("educlear", eduRows);
  const duplicateCount = kidDup.duplicateCount + eduDup.duplicateCount;
  const duplicateValueCents = kidDup.duplicateValueCents + eduDup.duplicateValueCents;

  const outDir = path.join(process.cwd(), "storage");
  fs.mkdirSync(outDir, { recursive: true });

  const diffCsvPath = path.join(outDir, "payment-reconciliation-diff.csv");
  const summaryPath = path.join(outDir, "payment-reconciliation-summary.txt");

  const diffHeaders = [
    "Issue",
    "Side",
    "Account Number",
    "Payment Date",
    "Amount",
    "Reference / Receipt Number",
    "Source CSV",
    "Source Line",
    "Matched Account Number",
    "Matched Payment Date",
    "Matched Amount",
    "Matched Reference / Receipt Number",
    "Matched CSV",
    "Matched Line",
    "Notes",
  ];

  const diffLines: string[] = [diffHeaders.join(",")];

  const pushIssue = (params: {
    issue: IssueType;
    side: "Kid-e-Sys" | "EduClear" | "Both";
    row: PaymentRow;
    rowCsv: "Kid-e-Sys" | "EduClear";
    note: string;
    matched?: { row: PaymentRow; csv: "Kid-e-Sys" | "EduClear"; note?: string };
  }) => {
    const matched = params.matched?.row;
    diffLines.push(
      [
        csvEscape(params.issue),
        csvEscape(params.side),
        csvEscape(params.row.accountNo),
        csvEscape(params.row.date),
        csvEscape(formatMoneyFromCents(params.row.amountCents)),
        csvEscape(params.row.reference),
        csvEscape(params.rowCsv),
        csvEscape(params.row.lineNo),
        csvEscape(matched?.accountNo || ""),
        csvEscape(matched?.date || ""),
        csvEscape(matched ? formatMoneyFromCents(matched.amountCents) : ""),
        csvEscape(matched?.reference || ""),
        csvEscape(params.matched?.csv || ""),
        csvEscape(matched?.lineNo || ""),
        csvEscape(params.note),
      ].join(",")
    );
  };

  for (const m of missingInEdu) {
    pushIssue({
      issue: "KIDE_MISSING_IN_EDU",
      side: "Kid-e-Sys",
      row: m.row,
      rowCsv: "Kid-e-Sys",
      note: m.note,
    });
  }

  for (const m of missingInKid) {
    pushIssue({
      issue: "EDU_MISSING_IN_KIDE",
      side: "EduClear",
      row: m.row,
      rowCsv: "EduClear",
      note: m.note,
    });
  }

  for (const mm of mismatchIssues) {
    pushIssue({
      issue: mm.type,
      side: "Both",
      row: mm.kid,
      rowCsv: "Kid-e-Sys",
      note: mm.note,
      matched: { row: mm.edu, csv: "EduClear" },
    });
  }

  for (const d of kidDup.issues) {
    pushIssue({
      issue: d.type,
      side: "Kid-e-Sys",
      row: d.row,
      rowCsv: "Kid-e-Sys",
      note: d.note,
    });
  }

  for (const d of eduDup.issues) {
    pushIssue({
      issue: d.type,
      side: "EduClear",
      row: d.row,
      rowCsv: "EduClear",
      note: d.note,
    });
  }

  fs.writeFileSync(diffCsvPath, diffLines.join("\n"), "utf8");

  const summaryLines: string[] = [];
  summaryLines.push("=== Payment reconciliation diff (read-only) ===");
  summaryLines.push(`Generated: ${new Date().toISOString()}`);
  summaryLines.push("");
  summaryLines.push("INPUTS");
  summaryLines.push(`  Kid-e-Sys file: ${kidPath}`);
  summaryLines.push(`  EduClear file:  ${eduPath}`);
  summaryLines.push("");
  summaryLines.push("TOTALS");
  summaryLines.push(
    `  Kid-e-Sys payments: ${kidTotals.count} · R${formatMoneyFromCents(kidTotals.valueCents)}`
  );
  summaryLines.push(
    `  EduClear payments:  ${eduTotals.count} · R${formatMoneyFromCents(eduTotals.valueCents)}`
  );
  summaryLines.push("");
  summaryLines.push("MISSING");
  summaryLines.push(
    `  In Kid-e-Sys but missing in EduClear: ${missingEduTotals.count} · R${formatMoneyFromCents(
      missingEduTotals.valueCents
    )}`
  );
  summaryLines.push(
    `  In EduClear but missing in Kid-e-Sys: ${missingKidTotals.count} · R${formatMoneyFromCents(
      missingKidTotals.valueCents
    )}`
  );
  summaryLines.push("");
  summaryLines.push("MISMATCHES");
  summaryLines.push(
    `  Amount mismatches: ${mismatchIssues.filter((i) => i.type === "AMOUNT_MISMATCH").length}`
  );
  summaryLines.push(
    `  Date mismatches:   ${mismatchIssues.filter((i) => i.type === "DATE_MISMATCH").length}`
  );
  summaryLines.push(
    `  Ref mismatches:    ${mismatchIssues.filter((i) => i.type === "REFERENCE_MISMATCH").length}`
  );
  summaryLines.push(
    `  Account mismatches:${mismatchIssues.filter((i) => i.type === "ACCOUNT_MISMATCH").length}`
  );
  summaryLines.push("");
  summaryLines.push("DUPLICATES (fingerprint-based)");
  summaryLines.push(
    `  Kid-e-Sys duplicates: ${kidDup.duplicateCount} · R${formatMoneyFromCents(
      kidDup.duplicateValueCents
    )}`
  );
  summaryLines.push(
    `  EduClear duplicates:  ${eduDup.duplicateCount} · R${formatMoneyFromCents(
      eduDup.duplicateValueCents
    )}`
  );
  summaryLines.push(
    `  Duplicate total:      ${duplicateCount} · R${formatMoneyFromCents(duplicateValueCents)}`
  );
  summaryLines.push("");
  summaryLines.push("OUTPUTS");
  summaryLines.push(`  Diff CSV:     ${diffCsvPath}`);
  summaryLines.push(`  Summary TXT:  ${summaryPath}`);

  fs.writeFileSync(summaryPath, summaryLines.join("\n"), "utf8");

  console.log(summaryLines.join("\n"));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

