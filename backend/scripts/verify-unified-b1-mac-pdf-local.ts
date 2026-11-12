/**
 * Local-only: unified B1 Manage ↔ PDF identity on authorised Oct-26 freeze.
 * Adds display-only in-memory Nov payments for SIL007/WOL001 targets (not written to disk).
 * Does NOT deploy. Does NOT mutate production ledger files.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildStatementManageTransactions,
  buildStatementTransactions,
} from "../src/services/statementTransactionBuilder";
import {
  computeAgeBaselineStatementOpening,
  computeAgeBaselineStatementClosing,
} from "../src/services/statementAgeBaseline";
import {
  resolveAuthoritativeAccountBalanceFromSnapshot,
  roundStatementMoney,
} from "../src/services/statementAccounts";
import {
  buildStatementDisplayRows,
  generateStatementPdfBuffer,
} from "../src/services/statementPdfService";
import type { StatementPdfInput } from "../src/services/statementPdfTypes";
import type { BillingLedgerEntry } from "../src/utils/billingLedgerStore";
import type { FamilyAccountAgeAnalysisSnapshot } from "../src/utils/familyAccountAgeAnalysisStore";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SCHOOL = "cmpideqeq0000108xb6ouv9zi";
const OCT_LEDGER = path.join(
  ROOT,
  "backend/storage/billing-ledger-production-backup-2026-10-26T07-40-16Z-pre-d71309c.json"
);
const AGE_FILE = path.join(ROOT, "backend/data/family-account-age-analysis.json");
const OUT_DIR = path.join(
  ROOT,
  "docs/verification/statement-manage-transactions-table/unified-b1-local"
);

function money(n: number): number {
  return roundStatementMoney(n);
}

function loadLedger(): BillingLedgerEntry[] {
  const raw = JSON.parse(fs.readFileSync(OCT_LEDGER, "utf8"));
  const entries = Array.isArray(raw) ? raw : raw[SCHOOL] || raw.entries || [];
  if (!Array.isArray(entries)) throw new Error("Oct ledger shape unexpected");
  return entries as BillingLedgerEntry[];
}

function loadAgeMap(): Map<string, FamilyAccountAgeAnalysisSnapshot> {
  const raw = JSON.parse(fs.readFileSync(AGE_FILE, "utf8"));
  const school = raw[SCHOOL] || raw;
  const map = new Map<string, FamilyAccountAgeAnalysisSnapshot>();
  for (const [ref, snap] of Object.entries(school)) {
    if (!snap || typeof snap !== "object") continue;
    map.set(String(ref).toUpperCase(), snap as FamilyAccountAgeAnalysisSnapshot);
  }
  return map;
}

function scoped(entries: BillingLedgerEntry[], accountRef: string): BillingLedgerEntry[] {
  const ref = accountRef.toUpperCase();
  return entries.filter((e) => String(e.accountNo || "").trim().toUpperCase() === ref);
}

/** In-memory Nov payments so Oct freeze can hit owner Nov Summary targets (not persisted). */
function withNovOverlays(entries: BillingLedgerEntry[]): BillingLedgerEntry[] {
  const overlays: BillingLedgerEntry[] = [
    {
      id: "local-overlay-PAY-20261104-SIL007-001",
      schoolId: SCHOOL,
      learnerId: "SIL007",
      accountNo: "SIL007",
      type: "payment",
      amount: 450,
      date: "2026-11-04",
      createdAt: "2026-11-04T12:00:00.000Z",
      reference: "PAY-20261104-SIL007-001",
      description: "Payment",
      source: "manual",
      method: "EFT",
    } as BillingLedgerEntry,
    {
      id: "local-overlay-PAY-20261106-WOL001-001",
      schoolId: SCHOOL,
      learnerId: "WOL001",
      accountNo: "WOL001",
      type: "payment",
      amount: 3000,
      date: "2026-11-06",
      createdAt: "2026-11-06T12:00:00.000Z",
      reference: "PAY-20261106-WOL001-001",
      description: "Payment",
      source: "manual",
      method: "EFT",
    } as BillingLedgerEntry,
  ];
  return [...entries, ...overlays];
}

function fingerprint(rows: Array<{
  date: string;
  reference: string;
  amountIn: number;
  amountOut: number;
  balance: number | null;
}>) {
  return rows.map((r) => ({
    date: r.date,
    reference: r.reference,
    amountIn: money(r.amountIn || 0),
    amountOut: money(r.amountOut || 0),
    balance: r.balance == null ? null : money(r.balance),
  }));
}

function isBbfRow(row: {
  isMigrationBroughtForward?: boolean;
  statementSection?: string;
}): boolean {
  return Boolean(row.isMigrationBroughtForward) || row.statementSection === "brought-forward";
}

function isHistoricalRow(row: {
  isImportedHistory?: boolean;
  statementSection?: string;
}): boolean {
  return Boolean(row.isImportedHistory) || row.statementSection === "historical";
}

function isLiveRow(row: {
  isMigrationBroughtForward?: boolean;
  isImportedHistory?: boolean;
  statementSection?: string;
}): boolean {
  if (isBbfRow(row) || isHistoricalRow(row)) return false;
  if (row.statementSection === "active") return true;
  // Manage rows without section: live = not hist/bbf
  return row.statementSection == null;
}

/** Newest-first Manage: first live row is chronologically last (after same-day chronoSeq fix). */
function lastLiveRunning(
  rows: Array<{
    date?: string;
    reference?: string;
    balance: number | null;
    chronoSeq?: number;
    isMigrationBroughtForward?: boolean;
    isImportedHistory?: boolean;
    statementSection?: string;
  }>
): number | null {
  const firstLive = rows.find((row) => isLiveRow(row) && row.balance != null);
  if (firstLive) return money(firstLive.balance as number);
  const bbf = rows.find((row) => isBbfRow(row) && row.balance != null);
  return bbf ? money(bbf.balance as number) : null;
}

function buildPair(
  accountRef: string,
  ledger: BillingLedgerEntry[],
  ageMap: Map<string, FamilyAccountAgeAnalysisSnapshot>
) {
  const snap = ageMap.get(accountRef.toUpperCase());
  if (!snap) throw new Error(`No age snap for ${accountRef}`);
  const baseline = {
    balance: Number(snap.balance) || 0,
    importedAt: String(snap.importedAt || "").trim(),
  };
  const accountEntries = scoped(ledger, accountRef);
  const opening = computeAgeBaselineStatementOpening(baseline, accountEntries, "All Time");
  const auth = resolveAuthoritativeAccountBalanceFromSnapshot(snap, accountEntries);
  const closingHelper = computeAgeBaselineStatementClosing(baseline, accountEntries, "All Time");

  const manage = buildStatementManageTransactions({
    schoolId: SCHOOL,
    accountRef,
    ledgerEntries: accountEntries,
    periodFilteredEntries: accountEntries,
    period: "All Time",
    openingBalance: opening,
    nameByLearnerId: new Map(),
    kidesysHistory: [],
    ageAnalysisBaseline: baseline,
  });

  const pdf = buildStatementTransactions({
    schoolId: SCHOOL,
    accountRef,
    ledgerEntries: accountEntries,
    period: "All Time",
    openingBalance: opening,
    nameByLearnerId: new Map(),
    kidesysHistory: [],
    ageAnalysisBaseline: baseline,
  });

  return { snap, baseline, opening, auth, closingHelper, manage, pdf, accountEntries };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ageMap = loadAgeMap();
  const baseLedger = withNovOverlays(loadLedger());

  // --- Fleet: 344 Age Analysis accounts ---
  let reconcileOk = 0;
  const fails: Array<{ ref: string; auth: number; last: number | null }> = [];
  for (const ref of [...ageMap.keys()].sort()) {
    const { auth, manage } = buildPair(ref, baseLedger, ageMap);
    const last = lastLiveRunning(manage);
    if (last != null && money(last) === money(auth)) reconcileOk++;
    else fails.push({ ref, auth: money(auth), last });
  }

  // --- SIL007 / WOL001 targets ---
  const sil = buildPair("SIL007", baseLedger, ageMap);
  const wol = buildPair("WOL001", baseLedger, ageMap);

  const silManageFp = fingerprint(sil.manage);
  const silPdfFp = fingerprint(sil.pdf);
  const wolManageFp = fingerprint(wol.manage);
  const wolPdfFp = fingerprint(wol.pdf);

  // Identity: same amounts/balances ignoring display order (sort key).
  const sortKey = (r: { date: string; reference: string; amountIn: number; amountOut: number }) =>
    `${r.date}|${r.reference}|${r.amountIn}|${r.amountOut}`;
  const sortedEq = (a: typeof silManageFp, b: typeof silPdfFp) => {
    const as = [...a].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    const bs = [...b].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
    if (as.length !== bs.length) return false;
    return as.every((row, i) => JSON.stringify(row) === JSON.stringify(bs[i]));
  };

  const silMacPdfMatch = sortedEq(silManageFp, silPdfFp);
  const wolMacPdfMatch = sortedEq(wolManageFp, wolPdfFp);

  // PDF display rows (chronological) last balance
  const silPdfInput: StatementPdfInput = {
    school: {
      name: "Da Silva Academy (local B1 verify)",
      email: "verify@local",
      phone: "",
      address: "",
    },
    accountNo: "SIL007",
    accountLabel: "Family Account SIL007",
    children: [],
    contact: null,
    period: "All Time",
    statementDate: "2026-11-12",
    balance: sil.auth,
    transactions: sil.pdf,
    isFamilyAccount: true,
    openingBalance: sil.opening,
    includeBroughtForward: false,
  };
  const wolPdfInput: StatementPdfInput = {
    ...silPdfInput,
    accountNo: "WOL001",
    accountLabel: "Family Account WOL001",
    balance: wol.auth,
    transactions: wol.pdf,
    openingBalance: wol.opening,
  };

  const silDisplay = buildStatementDisplayRows(silPdfInput);
  const wolDisplay = buildStatementDisplayRows(wolPdfInput);
  const silDisplayLast = [...silDisplay].reverse().find((r) => r.balance != null)?.balance ?? null;
  const wolDisplayLast = [...wolDisplay].reverse().find((r) => r.balance != null)?.balance ?? null;

  const silBuf = await generateStatementPdfBuffer(silPdfInput);
  const wolBuf = await generateStatementPdfBuffer(wolPdfInput);
  fs.writeFileSync(path.join(OUT_DIR, "SIL007-unified-b1-all-time.pdf"), silBuf);
  fs.writeFileSync(path.join(OUT_DIR, "WOL001-unified-b1-all-time.pdf"), wolBuf);

  const report = {
    status: "LOCAL_VERIFY_ONLY_NO_DEPLOY",
    snapshot: {
      ledger: path.basename(OCT_LEDGER),
      age: path.basename(AGE_FILE),
      note: "Nov figures via in-memory overlays only — not an authorised November production freeze.",
    },
    fleet: {
      accounts: ageMap.size,
      reconcileOk,
      failCount: fails.length,
      failSample: fails.slice(0, 10),
    },
    sil007: {
      auth: sil.auth,
      closingHelper: sil.closingHelper,
      openingBbf: sil.opening,
      manageLastRunning: lastLiveRunning(sil.manage),
      pdfLastRunning: lastLiveRunning(sil.pdf),
      displayLastBalance: silDisplayLast,
      macPdfFingerprintMatch: silMacPdfMatch,
      manageRowCount: sil.manage.length,
      pdfRowCount: sil.pdf.length,
      target: -3000,
      matchesTarget: money(sil.auth) === -3000 && lastLiveRunning(sil.manage) === -3000,
    },
    wol001: {
      auth: wol.auth,
      closingHelper: wol.closingHelper,
      openingBbf: wol.opening,
      manageLastRunning: lastLiveRunning(wol.manage),
      pdfLastRunning: lastLiveRunning(wol.pdf),
      displayLastBalance: wolDisplayLast,
      macPdfFingerprintMatch: wolMacPdfMatch,
      manageRowCount: wol.manage.length,
      pdfRowCount: wol.pdf.length,
      target: 3190.7,
      matchesTarget: money(wol.auth) === 3190.7 && lastLiveRunning(wol.manage) === 3190.7,
    },
    pdfSamples: {
      sil007: path.join(OUT_DIR, "SIL007-unified-b1-all-time.pdf"),
      wol001: path.join(OUT_DIR, "WOL001-unified-b1-all-time.pdf"),
    },
    architecture: {
      sharedSource: "buildStatementManageTransactionsWithAgeBaseline",
      pdfDelegatesVia: "buildStatementTransactions → buildStatementManageTransactions when ageAnalysisBaseline set",
      pdfInputWiring: "statementPdfData.buildStatementPdfInput passes ageAnalysisBaseline + full scoped ledger",
    },
  };

  fs.writeFileSync(path.join(OUT_DIR, "UNIFIED-B1-VERIFY.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  const ok =
    reconcileOk === ageMap.size &&
    silMacPdfMatch &&
    wolMacPdfMatch &&
    report.sil007.matchesTarget &&
    report.wol001.matchesTarget &&
    money(sil.auth) === money(sil.closingHelper) &&
    money(wol.auth) === money(wol.closingHelper);
  if (!ok) {
    console.error("VERIFY_FAIL");
    process.exit(1);
  }
  console.log("VERIFY_PASS");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
