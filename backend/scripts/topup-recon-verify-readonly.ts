import "dotenv/config";

/**
 * READ-ONLY reconciliation verification for Da Silva top-up payments.
 *
 *   cd backend && npx tsx scripts/topup-recon-verify-readonly.ts
 *
 * Uses live production payments API + local Kid-e-Sys spreadsheet.
 * Does NOT import, delete, or modify any data.
 */
import fs from "fs";
import path from "path";

import { previewMigrationTopupPaymentsImport } from "../src/services/migrationCentre/topupPaymentsImportService";
import {
  normaliseAmount,
  normaliseIsoDate,
  type BillingLedgerEntry,
} from "../src/utils/billingLedgerStore";

const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const KIDE_FILE = path.join(process.cwd(), "storage", "kideesys-payments-from-2026-06-01.xlsx");
const API_BASE = process.env.API_BASE || "https://educlear-backend.onrender.com";

type LivePayment = {
  id: string;
  accountNo: string;
  amount: number;
  date: string;
  reference: string;
  source: string;
};

function paymentRefNumber(reference: string): number | null {
  const m = String(reference || "").match(/Payment\s+(\d+)/i);
  return m ? Number(m[1]) : null;
}

function normalizeReceipt(value: string): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function ledgerHasMatchingPayment(
  ledger: BillingLedgerEntry[],
  parsed: {
    accountNo: string;
    receiptNo: string;
    transactionDate: string;
    amount: number;
    paymentType: string;
    fingerprint: string;
  }
): boolean {
  const targetId = `kidesys-topup-payment-${String(parsed.fingerprint || "").slice(0, 40)}`;
  if (ledger.some((e) => e.id === targetId)) return true;

  const receipt = normalizeReceipt(parsed.receiptNo).replace(/\s+/g, "");
  const date = normaliseIsoDate(parsed.transactionDate);
  const amount = Math.round(normaliseAmount(parsed.amount) * 100) / 100;
  const accountNo = String(parsed.accountNo || "").trim();

  return ledger.some((e) => {
    if (e.type !== "payment") return false;
    if (String(e.accountNo || "").trim() !== accountNo) return false;
    const eAmount = Math.round(normaliseAmount(e.amount) * 100) / 100;
    if (Math.abs(eAmount - amount) > 0.001) return false;
    const eDate = normaliseIsoDate(e.date);
    if (date && eDate && eDate !== date) return false;
    const eReceipt = normalizeReceipt(e.reference || "").replace(/\s+/g, "");
    return Boolean(receipt && eReceipt && eReceipt === receipt);
  });
}

async function fetchLivePayments(schoolId: string): Promise<LivePayment[]> {
  const res = await fetch(`${API_BASE}/api/payments?schoolId=${encodeURIComponent(schoolId)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Payments API ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as { payments?: LivePayment[] };
  return Array.isArray(data.payments) ? data.payments : [];
}

async function fetchStatementTotals(schoolId: string) {
  const res = await fetch(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(schoolId)}`
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Statements API ${res.status}: ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as {
    accounts?: Array<{ balance?: number; status?: string }>;
  };
  const accounts = Array.isArray(data.accounts) ? data.accounts : [];
  const totalBalance = Math.round(accounts.reduce((s, a) => s + Number(a.balance || 0), 0) * 100) / 100;
  return { accountsCount: accounts.length, totalOutstandingBalance: totalBalance };
}

async function main() {
  if (!fs.existsSync(KIDE_FILE)) {
    throw new Error(`Kid-e-Sys file not found: ${KIDE_FILE}`);
  }

  const livePayments = await fetchLivePayments(DA_SILVA_SCHOOL_ID);
  const liveLedger: BillingLedgerEntry[] = livePayments.map((p) => ({
    id: p.id,
    schoolId: DA_SILVA_SCHOOL_ID,
    learnerId: "",
    accountNo: p.accountNo,
    type: "payment",
    amount: p.amount,
    date: p.date,
    reference: p.reference,
    description: "",
    source: p.source,
    createdAt: "",
  }));

  const preview = await previewMigrationTopupPaymentsImport({
    schoolId: DA_SILVA_SCHOOL_ID,
    transactionFilePath: KIDE_FILE,
    originalFileName: path.basename(KIDE_FILE),
    uploadedBy: "topup-recon-verify-readonly",
  });

  const parsedRows = JSON.parse(
    fs.readFileSync(
      path.join(
        process.cwd(),
        "uploads",
        "migration-centre",
        "topup-payments",
        DA_SILVA_SCHOOL_ID,
        `${preview.sessionId}.json`
      ),
      "utf8"
    )
  ).rows as Array<{
    rowNumber: number;
    accountNo: string;
    receiptNo: string;
    transactionDate: string;
    amount: number;
    paymentType: string;
    fingerprint: string;
  }>;

  const refRangeStart = 54255;
  const refRangeEnd = 54506;
  const inRefRange = parsedRows.filter((r) => {
    const n = paymentRefNumber(r.receiptNo);
    return n !== null && n >= refRangeStart && n <= refRangeEnd;
  });

  const ledgerOnlyNew: typeof parsedRows = [];
  const ledgerOnlyDup: typeof parsedRows = [];
  for (const row of parsedRows) {
    if (ledgerHasMatchingPayment(liveLedger, row)) ledgerOnlyDup.push(row);
    else ledgerOnlyNew.push(row);
  }

  const liveTopup = livePayments.filter((p) => String(p.source || "") === "kidesys_topup");
  const junePayments = livePayments.filter((p) => String(p.date || "") >= "2026-06-01");
  const topupRefNums = liveTopup
    .map((p) => paymentRefNumber(p.reference))
    .filter((n): n is number => n !== null);

  const statements = await fetchStatementTotals(DA_SILVA_SCHOOL_ID);

  const previewByStatus = {
    new: preview.rows.filter((r) => r.status === "new"),
    duplicate: preview.rows.filter((r) => r.status === "duplicate"),
    unmatched: preview.rows.filter((r) => r.status === "unmatched"),
  };

  const allStatuses = new Map<number, string>();
  for (const row of parsedRows) {
    const n = paymentRefNumber(row.receiptNo);
    if (n === null) continue;
    const inLedger = ledgerHasMatchingPayment(liveLedger, row);
    allStatuses.set(n, inLedger ? "ledger-duplicate" : "ledger-new");
  }

  const refRangeInLedger = inRefRange.filter((r) =>
    ledgerHasMatchingPayment(liveLedger, r)
  ).length;
  const refRangeMissingLedger = inRefRange.length - refRangeInLedger;

  const educlearExportPath = path.join(process.cwd(), "storage", "educlear-payments-from-2026-06-01.csv");
  let staleReconNote = "payment-reconciliation-summary.txt not found";
  const summaryPath = path.join(process.cwd(), "storage", "payment-reconciliation-summary.txt");
  if (fs.existsSync(summaryPath)) {
    staleReconNote = fs.readFileSync(summaryPath, "utf8").split("\n").slice(0, 15).join("\n");
  }

  const report = {
    readOnly: true,
    generatedAt: new Date().toISOString(),
    schoolId: DA_SILVA_SCHOOL_ID,
    apiBase: API_BASE,
    kidESysFile: KIDE_FILE,
    liveProduction: {
      totalPaymentsInLedger: livePayments.length,
      kidesysTopupCount: liveTopup.length,
      kidesysTopupValue: Math.round(liveTopup.reduce((s, p) => s + Math.abs(p.amount), 0) * 100) / 100,
      kidesysTopupRefRange:
        topupRefNums.length > 0
          ? `${Math.min(...topupRefNums)}–${Math.max(...topupRefNums)}`
          : null,
      paymentsFrom2026_06_01: junePayments.length,
      paymentsFrom2026_06_01Value:
        Math.round(junePayments.reduce((s, p) => s + Math.abs(p.amount), 0) * 100) / 100,
      statementAccountsCount: statements.accountsCount,
      totalOutstandingBalance: statements.totalOutstandingBalance,
      paymentRefs54255_54506InLiveLedger: livePayments.filter((p) => {
        const n = paymentRefNumber(p.reference);
        return n !== null && n >= refRangeStart && n <= refRangeEnd;
      }).length,
    },
    kidESysSpreadsheet: {
      totalRows: preview.totals.totalRows,
      totalValue: preview.totals.totalPaymentAmount,
      refs54255_54506RowCount: inRefRange.length,
    },
    localDryRunAgainstLocalDb: {
      note: "Uses local DATABASE_URL + local ledger — may differ from live UI dry-run",
      newPayments: preview.totals.newPayments,
      duplicatesSkipped: preview.totals.duplicatesSkipped,
      unmatchedRows: preview.totals.unmatchedRows,
    },
    ledgerOnlySimulationAgainstLiveApi: {
      note: "Duplicate detection using live ledger only (no Postgres MigrationTopupPaymentRow)",
      newPayments: ledgerOnlyNew.length,
      duplicates: ledgerOnlyDup.length,
      newPaymentValue:
        Math.round(ledgerOnlyNew.reduce((s, r) => s + r.amount, 0) * 100) / 100,
      refs54255_54506FoundInLedger: refRangeInLedger,
      refs54255_54506MissingFromLedger: refRangeMissingLedger,
    },
    userReportedLiveDryRun: {
      totalRows: 345,
      newPayments: 6,
      duplicates: 339,
      unmatched: 0,
      impliedDbOnlyDuplicates: 339 - ledgerOnlyDup.length,
    },
    staleReconciliationReport: {
      verdict: "STALE — generated before top-up batch imports were reflected in EduClear export",
      summaryExcerpt: staleReconNote,
      educlearExportUsed: educlearExportPath,
      educlearExportPaymentCount: 163,
      educlearExportValue: 576960,
      reportedMissing: { count: 191, value: 708165 },
      explanation:
        "The 2026-06-05 reconciliation compared Kid-e-Sys (345 rows) to an EduClear CSV with only 163 June+ payments. It did not include MigrationTopupPaymentRow fingerprints from batch imports. After batches imported 247+92=339 payments into Postgres, dry-run correctly marks them duplicate even when ledger is incomplete.",
    },
    refs54255_54506: {
      expectedRowCount: refRangeEnd - refRangeStart + 1,
      rowsInSpreadsheet: inRefRange.length,
      foundInLiveLedger: refRangeInLedger,
      missingFromLiveLedger: refRangeMissingLedger,
      verdict:
        refRangeMissingLedger > 0
          ? "Refs exist in batch Postgres records (per live UI duplicate) but most are NOT in live billing ledger API"
          : "All refs found in live ledger",
    },
    sixNewPayments: (() => {
      const inBatch1Range = (r: (typeof parsedRows)[0]) => {
        const n = paymentRefNumber(r.receiptNo);
        return n !== null && n >= refRangeStart && n <= refRangeEnd;
      };
      const inBatch2Range = (r: (typeof parsedRows)[0]) => {
        const n = paymentRefNumber(r.receiptNo);
        return n !== null && n >= 54508 && n <= 54600;
      };
      const rows = parsedRows
        .filter((r) => !inBatch1Range(r) && !inBatch2Range(r))
        .map((r) => ({
          rowNumber: r.rowNumber,
          accountNo: r.accountNo,
          receiptNo: r.receiptNo,
          date: r.transactionDate,
          amount: r.amount,
          refNum: paymentRefNumber(r.receiptNo),
        }));
      const totalValue = Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      return {
        count: rows.length,
        totalValue,
        note: "Rows outside batch-1 (54255–54506) and batch-2 (54508–54600) ref bands — align with live UI 6 NEW",
        rows,
      };
    })(),
    batchAttribution: {
      note: "From UI batch history (user-provided); Postgres batch row attribution requires production DATABASE_URL",
      batch2026_06_02: {
        file: "transaction_list.xls",
        imported: 247,
        total: 923465,
        likelyCoversRefs: "54255–~54499 (first tranche)",
      },
      batch2026_06_04: {
        file: "transaction_list_topup.xlsx",
        imported: 92,
        total: 304660,
        likelyCoversRefs: "54508–54600 (matches live kidesys_topup ledger ref band)",
      },
      combinedImported: 339,
      combinedValue: 1228125,
    },
    recommendation:
      "Do NOT apply import until ledger/Postgres alignment is verified. 247 batch rows may exist in Postgres but be absent from live ledger (restore-topup-payments-from-batch.ts documents this gap).",
  };

  const outJson = path.join(process.cwd(), "storage", "topup-recon-verify-readonly.json");
  const outTxt = path.join(process.cwd(), "storage", "topup-recon-verify-readonly.txt");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2), "utf8");

  const lines = [
    "=== Top-Up Payments READ-ONLY Reconciliation Verification ===",
    `Generated: ${report.generatedAt}`,
    `School: ${DA_SILVA_SCHOOL_ID}`,
    "",
    "LIVE PRODUCTION (API)",
    `  Total payments in ledger:     ${report.liveProduction.totalPaymentsInLedger}`,
    `  kidesys_topup payments:       ${report.liveProduction.kidesysTopupCount} · R${report.liveProduction.kidesysTopupValue.toLocaleString("en-ZA")}`,
    `  kidesys_topup ref band:       ${report.liveProduction.kidesysTopupRefRange || "—"}`,
    `  Payments from 2026-06-01+:    ${report.liveProduction.paymentsFrom2026_06_01} · R${report.liveProduction.paymentsFrom2026_06_01Value.toLocaleString("en-ZA")}`,
    `  Statement accounts:           ${report.liveProduction.statementAccountsCount}`,
    `  Total outstanding balance:    R${report.liveProduction.totalOutstandingBalance.toLocaleString("en-ZA")}`,
    `  Refs 54255–54506 in ledger:   ${report.liveProduction.paymentRefs54255_54506InLiveLedger}`,
    "",
    "KID-E-SYS SPREADSHEET",
    `  Total rows:                   ${report.kidESysSpreadsheet.totalRows}`,
    `  Total value:                  R${report.kidESysSpreadsheet.totalValue.toLocaleString("en-ZA")}`,
    `  Refs 54255–54506 rows:        ${report.kidESysSpreadsheet.refs54255_54506RowCount}`,
    "",
    "LIVE UI DRY-RUN (user-reported)",
    `  New:        6`,
    `  Duplicates: 339`,
    `  Unmatched:  0`,
    "",
    "LEDGER-ONLY SIMULATION (live API)",
    `  Would be NEW:        ${report.ledgerOnlySimulationAgainstLiveApi.newPayments}`,
    `  Would be DUPLICATE:  ${report.ledgerOnlySimulationAgainstLiveApi.duplicates}`,
    `  Refs 54255–54506 in ledger:   ${report.ledgerOnlySimulationAgainstLiveApi.refs54255_54506FoundInLedger}`,
    `  Refs 54255–54506 missing:     ${report.ledgerOnlySimulationAgainstLiveApi.refs54255_54506MissingFromLedger}`,
    `  Implied DB-only duplicates:   ${report.userReportedLiveDryRun.impliedDbOnlyDuplicates}`,
    "",
    "STALE RECONCILIATION (2026-06-05)",
    `  Verdict: ${report.staleReconciliationReport.verdict}`,
    `  Reported missing: 191 · R708,165.00`,
    `  EduClear export had: 163 · R576,960.00`,
    "",
    "BATCH ATTRIBUTION (UI history)",
    `  2026-06-02 transaction_list.xls:      247 · R923,465.00`,
    `  2026-06-04 transaction_list_topup.xlsx:  92 · R304,660.00`,
    `  Combined:                            339 · R1,228,125.00`,
    "",
    "SIX NEW PAYMENTS (not in either import batch)",
    `  Count: ${report.sixNewPayments.count} · R${report.sixNewPayments.totalValue.toLocaleString("en-ZA")}`,
    ...report.sixNewPayments.rows.map(
      (r) =>
        `  ${r.receiptNo} · ${r.accountNo} · ${r.date} · R${r.amount} (row ${r.rowNumber})`
    ),
    "",
    `RECOMMENDATION: ${report.recommendation}`,
    "",
    `Full JSON: ${outJson}`,
  ];
  fs.writeFileSync(outTxt, lines.join("\n"), "utf8");

  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
