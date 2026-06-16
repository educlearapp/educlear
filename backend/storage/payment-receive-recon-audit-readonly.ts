/**
 * READ-ONLY Payment Receive List reconciliation audit.
 * Does NOT modify any data. Output to storage only.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import {
  buildPaymentReceiveVerificationTable,
  calculatePaymentReceiveCardTotals,
} from "../src/services/migrationCentre/paymentReceiveListExactBaseline";
import type {
  ParsedPaymentReceiveRow,
  PaymentReceiveListParseAudit,
} from "../src/services/daSilvaMigration/paymentReceiveListParser";
import { parsePaymentReceiveAmount } from "../src/services/daSilvaMigration/paymentReceiveListParser";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const PDF_PATH = path.resolve(
  process.env.PAYMENT_RECEIVE_PDF || "/Users/dasilvaacademy/Desktop/payment_receive_list.pdf"
);

type LiveAccount = {
  accountNo: string;
  accountHolder: string;
  balance: number;
  status: string;
  kidesysSection: string;
  lastInvoice?: number;
  lastPayment?: number;
  lastInvoiceDate?: string;
  lastPaymentDate?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const BALANCE_SUFFIX_RE = /(-?\d[\d ]*,\d{2})\s*$/;
const HEADER_RE = /^AccountBalanceAmountTypeDateReceipt No$/i;
const SKIP_LINE_RE = /^Payment Receive List$|^Da Silva Academy$/i;
const EXPORT_DATE_RE = /^(\d{4}\/\d{2}\/\d{2})/;

function isGradeHeading(line: string): boolean {
  const v = String(line || "").trim();
  if (!v) return false;
  if (/^Creche\b/i.test(v)) return true;
  if (/^GRADE\s/i.test(v)) return true;
  if (/^Grade\s/i.test(v)) return true;
  return false;
}

type PartialRow = {
  accountNo: string;
  learnerName: string;
  balance: number | null;
  done: boolean;
};

function parseAccountLine(line: string): PartialRow | null {
  const rowM = line.match(/^(\d+)\s+([A-Z]{2,5}\d{2,5})(.*)$/i);
  if (rowM) {
    const accountNo = String(rowM[2] || "").trim().toUpperCase();
    const rest = String(rowM[3] || "").trim();
    const balM = rest.match(BALANCE_SUFFIX_RE);
    if (balM) {
      const name = rest.slice(0, rest.length - balM[0].length).trim();
      return { accountNo, learnerName: name, balance: parsePaymentReceiveAmount(balM[1]), done: true };
    }
    return { accountNo, learnerName: rest, balance: null, done: false };
  }

  const m = line.match(/^([A-Z]{2,5}\d{2,5})(.*)$/i);
  if (!m) return null;
  const accountNo = String(m[1] || "").trim().toUpperCase();
  const rest = String(m[2] || "").trim();
  const balM = rest.match(BALANCE_SUFFIX_RE);
  if (balM) {
    const name = rest.slice(0, rest.length - balM[0].length).trim();
    return { accountNo, learnerName: name, balance: parsePaymentReceiveAmount(balM[1]), done: true };
  }
  return { accountNo, learnerName: rest, balance: null, done: false };
}

function parsePaymentReceiveText(
  pdfPath: string,
  text: string
): {
  rows: ParsedPaymentReceiveRow[];
  uniqueByAccount: Record<string, ParsedPaymentReceiveRow>;
  audit: PaymentReceiveListParseAudit;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const rows: ParsedPaymentReceiveRow[] = [];
  let currentSection = "";
  let exportDate: string | undefined;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (SKIP_LINE_RE.test(line) || HEADER_RE.test(line)) {
      i += 1;
      continue;
    }
    const dateM = line.match(EXPORT_DATE_RE);
    if (dateM) {
      exportDate = dateM[1];
      i += 1;
      continue;
    }
    if (isGradeHeading(line)) {
      currentSection = line;
      i += 1;
      continue;
    }
    if (/^\d+\s+[A-Z]{2,5}\d{2,5}/i.test(line)) {
      const partial = parseAccountLine(line);
      if (partial) {
        const nameParts = partial.learnerName ? [partial.learnerName] : [];
        if (partial.done) {
          rows.push({
            accountNo: partial.accountNo,
            learnerName: nameParts.join(" ").trim(),
            balance: partial.balance ?? 0,
            gradeSection: currentSection || undefined,
          });
          i += 1;
          continue;
        }
        i += 1;
        while (i < lines.length) {
          const balM = lines[i].match(BALANCE_SUFFIX_RE);
          if (balM) {
            rows.push({
              accountNo: partial.accountNo,
              learnerName: nameParts.join(" ").trim(),
              balance: parsePaymentReceiveAmount(balM[1]),
              gradeSection: currentSection || undefined,
            });
            i += 1;
            break;
          }
          if (/^\d+\s+[A-Z]{2,5}\d{2,5}/i.test(lines[i])) break;
          if (HEADER_RE.test(lines[i]) || SKIP_LINE_RE.test(lines[i])) break;
          nameParts.push(lines[i]);
          i += 1;
        }
        continue;
      }
    }

    if (/^\d+$/.test(line) && i + 1 < lines.length) {
      const partial = parseAccountLine(lines[i + 1]);
      if (partial) {
        i += 2;
        const nameParts = partial.learnerName ? [partial.learnerName] : [];
        if (partial.done) {
          rows.push({
            accountNo: partial.accountNo,
            learnerName: nameParts.join(" ").trim(),
            balance: partial.balance ?? 0,
            gradeSection: currentSection || undefined,
          });
          continue;
        }
        while (i < lines.length) {
          const balM = lines[i].match(BALANCE_SUFFIX_RE);
          if (balM) {
            rows.push({
              accountNo: partial.accountNo,
              learnerName: nameParts.join(" ").trim(),
              balance: parsePaymentReceiveAmount(balM[1]),
              gradeSection: currentSection || undefined,
            });
            i += 1;
            break;
          }
          if (/^\d+$/.test(lines[i]) && parseAccountLine(lines[i + 1] || "")) break;
          if (HEADER_RE.test(lines[i]) || SKIP_LINE_RE.test(lines[i])) break;
          nameParts.push(lines[i]);
          i += 1;
        }
        continue;
      }
    }
    i += 1;
  }
  const uniqueByAccount: Record<string, ParsedPaymentReceiveRow> = {};
  const balanceConflicts: PaymentReceiveListParseAudit["balanceConflicts"] = [];
  for (const row of rows) {
    const acct = row.accountNo;
    if (!uniqueByAccount[acct]) {
      uniqueByAccount[acct] = row;
      continue;
    }
    if (Math.abs(uniqueByAccount[acct].balance - row.balance) > 0.001) {
      const conflict = balanceConflicts.find((c) => c.accountNo === acct);
      if (conflict) {
        if (!conflict.balances.includes(row.balance)) conflict.balances.push(row.balance);
      } else {
        balanceConflicts.push({
          accountNo: acct,
          balances: [uniqueByAccount[acct].balance, row.balance],
        });
      }
    }
  }
  const audit: PaymentReceiveListParseAudit = {
    pdfPath,
    rawRowCount: rows.length,
    uniqueAccountCount: Object.keys(uniqueByAccount).length,
    duplicateRowCount: rows.length - Object.keys(uniqueByAccount).length,
    balanceConflictCount: balanceConflicts.length,
    balanceConflicts,
    exportDate,
  };
  return { rows, uniqueByAccount, audit };
}

async function extractPdfText(pdfPath: string): Promise<string> {
  const fsMod = await import("fs");
  const { PDFParse } = await import("pdf-parse");
  const buffer = fsMod.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return String(result.text || "");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function fetchLiveAccounts(): Promise<LiveAccount[]> {
  const data = (await fetchJson(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as {
    accounts?: Array<{
      accountNo?: string;
      accountHolder?: string;
      familyName?: string;
      balance?: number;
      status?: string;
      kidesysSection?: string;
    }>;
  };
  return (data.accounts || []).map((row) => ({
    accountNo: String(row.accountNo || "").trim().toUpperCase(),
    accountHolder: String(row.accountHolder || row.familyName || "").trim(),
    balance: round2(Number(row.balance) || 0),
    status: String(row.status || "").trim(),
    kidesysSection: String(row.kidesysSection || "").trim(),
    lastInvoice: row.lastInvoice != null ? round2(Number(row.lastInvoice)) : undefined,
    lastPayment: row.lastPayment != null ? round2(Number(row.lastPayment)) : undefined,
    lastInvoiceDate: row.lastInvoiceDate ? String(row.lastInvoiceDate) : undefined,
    lastPaymentDate: row.lastPaymentDate ? String(row.lastPaymentDate) : undefined,
  }));
}

function inferMismatchReason(opts: {
  inPdf: boolean;
  inEduClear: boolean;
  difference: number;
  eduClearStatus: string;
  eduClearAccount?: LiveAccount & {
    lastInvoice?: number;
    lastPayment?: number;
    lastInvoiceDate?: string;
    lastPaymentDate?: string;
  };
}): string {
  const { inPdf, inEduClear, difference, eduClearStatus, eduClearAccount } = opts;

  if (!inPdf && inEduClear) return "Extra account in EduClear (not on Payment Receive List)";
  if (inPdf && !inEduClear) return "Missing account in EduClear (on PDF only)";

  const absDiff = Math.abs(difference);
  if (absDiff <= 0.01) return "Match";

  if (difference > 0) {
    if (eduClearAccount?.lastPayment && !eduClearAccount?.lastInvoice)
      return "Likely missing invoice or opening balance difference";
    if (eduClearAccount?.lastInvoiceDate && eduClearAccount?.lastPaymentDate) {
      const inv = String(eduClearAccount.lastInvoiceDate);
      const pay = String(eduClearAccount.lastPaymentDate);
      if (inv > pay) return "Likely missing payment — invoice posted after last payment";
    }
    return "Likely missing payment or opening balance difference";
  }

  if (difference < 0) {
    if (eduClearAccount?.lastPayment && Math.abs(Number(eduClearAccount.lastPayment) - absDiff) < 1)
      return "Possible duplicate payment posting";
    if (eduClearStatus === "Over Paid") return "Overpaid in EduClear — possible excess payment or missing invoice";
    return "Likely missing invoice, credit, or manual adjustment";
  }

  return "Unknown — requires transaction-level review";
}

async function main() {
  const pdfText = await extractPdfText(PDF_PATH);
  const { uniqueByAccount, audit } = parsePaymentReceiveText(PDF_PATH, pdfText);
  const liveAccounts = await fetchLiveAccounts();

  const pdfBalanceByAccount: Record<string, number> = {};
  const pdfNameByAccount: Record<string, string> = {};
  for (const [acct, row] of Object.entries(uniqueByAccount)) {
    pdfBalanceByAccount[acct] = round2(row.balance);
    pdfNameByAccount[acct] = String(row.learnerName || "").trim();
  }

  const eduClearBalanceByAccount: Record<string, number> = {};
  const eduClearMeta: Record<string, LiveAccount> = {};
  for (const row of liveAccounts) {
    if (!row.accountNo) continue;
    eduClearBalanceByAccount[row.accountNo] = row.balance;
    eduClearMeta[row.accountNo] = row;
  }

  const allPdfCardTotals = calculatePaymentReceiveCardTotals(
    Object.entries(pdfBalanceByAccount).map(([, balance]) => ({ balance }))
  );

  const verification = buildPaymentReceiveVerificationTable({
    pdfBalanceByAccount,
    eduClearBalanceByAccount,
  });

  const missingInEduClear = verification.rows.filter(
    (r) => !(r.accountNo in eduClearBalanceByAccount) && r.accountNo in pdfBalanceByAccount
  );
  const extraInEduClear = verification.rows.filter(
    (r) => !(r.accountNo in pdfBalanceByAccount) && r.accountNo in eduClearBalanceByAccount
  );

  const totalDiffValue = round2(
    verification.notMatching.reduce((s, r) => s + Math.abs(r.difference), 0)
  );

  const mismatchesRanked = [...verification.notMatching].sort(
    (a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.accountNo.localeCompare(b.accountNo)
  );

  const accountComparisons = [];
  for (const row of verification.rows) {
    const inPdf = row.accountNo in pdfBalanceByAccount;
    const inEc = row.accountNo in eduClearBalanceByAccount;
    const match = Math.abs(row.difference) <= 0.01 ? "YES" : "NO";
    accountComparisons.push({
      accountCode: row.accountNo,
      parentName: pdfNameByAccount[row.accountNo] || eduClearMeta[row.accountNo]?.accountHolder || "—",
      kideSysBalance: row.kidESysBalance,
      eduClearBalance: row.eduClearBalance,
      difference: row.difference,
      match,
      inPdf,
      inEduClear: inEc,
      eduClearStatus: eduClearMeta[row.accountNo]?.status || (inEc ? "—" : "MISSING"),
    });
  }

  const mismatchReasons = mismatchesRanked.map((row) => ({
    accountCode: row.accountNo,
    parentName: pdfNameByAccount[row.accountNo] || eduClearMeta[row.accountNo]?.accountHolder || "—",
    kideSysBalance: row.kidESysBalance,
    eduClearBalance: row.eduClearBalance,
    difference: row.difference,
    absDifference: round2(Math.abs(row.difference)),
    likelyReason: inferMismatchReason({
      inPdf: row.accountNo in pdfBalanceByAccount,
      inEduClear: row.accountNo in eduClearBalanceByAccount,
      difference: row.difference,
      eduClearStatus: eduClearMeta[row.accountNo]?.status || "",
      eduClearAccount: eduClearMeta[row.accountNo],
    }),
    eduClearStatus: eduClearMeta[row.accountNo]?.status || (row.accountNo in eduClearBalanceByAccount ? "—" : "MISSING"),
  }));

  const report = {
    readOnly: true,
    generatedAt: new Date().toISOString(),
    schoolId: SCHOOL_ID,
    apiBase: API_BASE,
    pdfPath: PDF_PATH,
    pdfExportDate: audit.exportDate,
    pdfParse: {
      rawRowCount: audit.rawRowCount,
      uniqueAccountCount: audit.uniqueAccountCount,
      duplicateRowCount: audit.duplicateRowCount,
      balanceConflictCount: audit.balanceConflictCount,
      balanceConflicts: audit.balanceConflicts,
    },
    pdfSummary: allPdfCardTotals,
    eduClearSummary: {
      accountCount: liveAccounts.length,
      totalOutstanding: round2(
        liveAccounts.filter((a) => a.balance > 0).reduce((s, a) => s + a.balance, 0)
      ),
      overPaidTotal: round2(
        liveAccounts.filter((a) => a.balance < 0).reduce((s, a) => s + Math.abs(a.balance), 0)
      ),
      netPosition: round2(liveAccounts.reduce((s, a) => s + a.balance, 0)),
    },
    reconciliation: {
      totalAccountsCompared: verification.rows.length,
      exactMatches: verification.matchingExactly.length,
      mismatchedAccounts: verification.notMatching.length,
      missingInEduClear: missingInEduClear.map((r) => r.accountNo),
      extraInEduClear: extraInEduClear.map((r) => r.accountNo),
      totalValueOfBalanceDifferences: totalDiffValue,
      fullyReconciled: verification.notMatching.length === 0,
    },
    accountComparisons,
    mismatchesRankedByImpact: mismatchReasons,
  };

  const outDir = path.join(process.cwd(), "storage");
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, "payment-receive-recon-audit.json");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    jsonPath,
    pdfAccounts: audit.uniqueAccountCount,
    eduClearAccounts: liveAccounts.length,
    compared: verification.rows.length,
    matches: verification.matchingExactly.length,
    mismatches: verification.notMatching.length,
    missingInEduClear: missingInEduClear.length,
    extraInEduClear: extraInEduClear.length,
    totalDiffValue,
    fullyReconciled: report.reconciliation.fullyReconciled,
    pdfSummary: allPdfCardTotals,
    eduClearSummary: report.eduClearSummary,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
