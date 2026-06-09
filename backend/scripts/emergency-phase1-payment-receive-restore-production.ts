/**
 * Emergency Phase 0 backup + Phase 1 Payment Receive List baseline restore (production).
 *
 *   CONFIRM_DA_SILVA_PAYMENT_RECEIVE_BASELINE=true \
 *   SUPER_ADMIN_PASSWORD="..." \
 *   PAYMENT_RECEIVE_PDF="/Users/dasilvaacademy/Desktop/payment_receive_list.pdf" \
 *   npx ts-node --transpile-only scripts/emergency-phase1-payment-receive-restore-production.ts --apply
 */
import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

import { parsePaymentReceiveListPdf } from "../src/services/daSilvaMigration/paymentReceiveListParser";
import {
  buildPaymentReceiveVerificationTable,
  calculatePaymentReceiveCardTotals,
  DA_SILVA_AGE_BASELINE_IMPORTED_AT,
} from "../src/services/migrationCentre/paymentReceiveListExactBaseline";
import { normalizeKidesysBillingSection } from "../src/services/billingSummary";
import {
  filterPostImportBalanceEntries,
  roundStatementMoney,
} from "../src/services/statementAccounts";
import {
  calculateBalanceFromEntries,
  type BillingLedgerEntry,
} from "../src/utils/billingLedgerStore";

loadDotenv();

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_DA_SILVA_PAYMENT_RECEIVE_BASELINE";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const DEFAULT_PDF = "/Users/dasilvaacademy/Desktop/payment_receive_list.pdf";
const EXCLUDED_ACCOUNTS = new Set(["JAC001", "LET007"]);
const PROVEN_PAYLOAD = path.join(
  process.cwd(),
  "storage",
  "payment-receive-apply-1780671635131",
  "payload.json"
);

type StatementRow = {
  accountNo?: string;
  balance?: number;
  status?: string;
  lastPayment?: number;
  lastPaymentDate?: string;
};

function sectionFromBalance(balance: number): string {
  if (balance > 10000) return "Bad Debt";
  if (balance > 0) return "Recently Owing";
  if (balance < 0) return "Over Paid";
  return "Up To Date";
}

function expectedStatusFromPdfBalance(balance: number): string {
  const section = sectionFromBalance(balance);
  if (section === "Recently Owing") return "Recently Owing";
  if (section === "Bad Debt") return "Bad Debt";
  if (section === "Over Paid") return "Over Paid";
  return "Up To Date";
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`${url} ${res.status}: ${String(text).slice(0, 400)}`);
  }
  return data;
}

async function loginSuperAdmin(): Promise<string> {
  const tokenPath = path.join(process.cwd(), "storage", ".recovery-auth-token");
  if (fs.existsSync(tokenPath)) {
    const cached = String(fs.readFileSync(tokenPath, "utf8")).trim();
    if (cached) return cached;
  }

  const email = String(process.env.SUPER_ADMIN_EMAIL || "info@educlear.co.za").trim();
  const password = String(process.env.SUPER_ADMIN_PASSWORD || "").trim();
  if (!password) throw new Error("SUPER_ADMIN_PASSWORD required");
  const data = (await fetchJson(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })) as { token?: string };
  const token = String(data.token || "").trim();
  if (!token) throw new Error("Login failed — no token");
  return token;
}

async function fetchLiveStatements(): Promise<StatementRow[]> {
  const data = (await fetchJson(
    `${API_BASE}/api/statements?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { statements?: StatementRow[] };
  return data.statements || [];
}

function postImportLedgerDelta(entries: BillingLedgerEntry[]): number {
  const postImport = filterPostImportBalanceEntries(entries, DA_SILVA_AGE_BASELINE_IMPORTED_AT);
  return roundStatementMoney(calculateBalanceFromEntries(postImport));
}

async function phase0Backup(outDir: string): Promise<{ ledgerPath: string; ledgerCount: number }> {
  fs.mkdirSync(outDir, { recursive: true });
  const ledgerData = (await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { entries?: BillingLedgerEntry[] };
  const entries = ledgerData.entries || [];
  const ledgerPath = path.join(outDir, "billing-ledger-production-backup.json");
  fs.writeFileSync(ledgerPath, JSON.stringify(ledgerData, null, 2));

  const statements = await fetchLiveStatements();
  fs.writeFileSync(path.join(outDir, "statements-pre-restore.json"), JSON.stringify(statements, null, 2));

  const env = await fetchJson(`${API_BASE}/api/payments/env`);
  fs.writeFileSync(path.join(outDir, "payments-env-pre-restore.json"), JSON.stringify(env, null, 2));

  const manifest = {
    generatedAt: new Date().toISOString(),
    schoolId: SCHOOL_ID,
    apiBase: API_BASE,
    ledgerEntryCount: entries.length,
    statementAccountCount: statements.length,
    ledgerPath,
  };
  fs.writeFileSync(path.join(outDir, "phase0-backup-manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify(manifest, null, 2));
  return { ledgerPath, ledgerCount: entries.length };
}

async function buildRestorePayload(
  pdfPath: string,
  ledgerEntries: BillingLedgerEntry[]
): Promise<{
  payload: { schoolId: string; importedAt: string; snapshots: Array<Record<string, unknown>> };
  pdfBalanceByAccount: Record<string, number>;
}> {
  const { uniqueByAccount } = await parsePaymentReceiveListPdf(pdfPath);
  const pdfBalanceByAccount: Record<string, number> = {};
  for (const [acct, row] of Object.entries(uniqueByAccount)) {
    if (EXCLUDED_ACCOUNTS.has(acct)) continue;
    pdfBalanceByAccount[acct] = roundStatementMoney(row.balance);
  }

  const entriesByAccount = new Map<string, BillingLedgerEntry[]>();
  for (const entry of ledgerEntries) {
    const acct = String(entry.accountNo || "").trim().toUpperCase();
    if (!acct) continue;
    const bucket = entriesByAccount.get(acct) || [];
    bucket.push(entry);
    entriesByAccount.set(acct, bucket);
  }

  const snapshots: Array<Record<string, unknown>> = [];
  for (const [accountRef, row] of Object.entries(uniqueByAccount)) {
    if (EXCLUDED_ACCOUNTS.has(accountRef)) continue;
    const pdfBalance = roundStatementMoney(row.balance);
    const accountEntries = entriesByAccount.get(accountRef) || [];
    const ledgerDelta = postImportLedgerDelta(accountEntries);
    // live = baseline + ledgerDelta => baseline = pdfBalance - ledgerDelta
    let baselineBalance = roundStatementMoney(pdfBalance - ledgerDelta);

    // MAM004: enforce proven baseline R4,500 when manual R3,000 exists (final live R1,500)
    if (accountRef === "MAM004" && Math.abs(pdfBalance - 1500) <= 0.01 && ledgerDelta <= -2999) {
      baselineBalance = 4500;
    }

    snapshots.push({
      accountRef,
      accountHolder: String(row.learnerName || "").trim() || accountRef,
      kidesysSection: normalizeKidesysBillingSection(sectionFromBalance(pdfBalance)),
      balance: baselineBalance,
      buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
    });
  }

  snapshots.sort((a, b) => String(a.accountRef).localeCompare(String(b.accountRef)));

  return {
    payload: {
      schoolId: SCHOOL_ID,
      importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
      snapshots,
    },
    pdfBalanceByAccount,
  };
}

function verifyAgainstPdf(
  pdfBalanceByAccount: Record<string, number>,
  statements: StatementRow[]
): {
  pdfAccounts: number;
  eduClearAccounts: number;
  matched: number;
  mismatched: Array<Record<string, unknown>>;
  missing: string[];
  extra: string[];
  statusMismatches: Array<Record<string, unknown>>;
  cardComparison: Record<string, unknown>;
} {
  const liveByAccount: Record<string, StatementRow> = {};
  for (const row of statements) {
    const acct = String(row.accountNo || "").trim().toUpperCase();
    if (!acct) continue;
    liveByAccount[acct] = row;
  }

  const pdfSet = new Set(Object.keys(pdfBalanceByAccount));
  const liveSet = new Set(Object.keys(liveByAccount));
  const missing = Array.from(pdfSet).filter((a) => !liveSet.has(a)).sort();
  const extra = Array.from(liveSet).filter((a) => !pdfSet.has(a)).sort();

  const mismatched: Array<Record<string, unknown>> = [];
  const statusMismatches: Array<Record<string, unknown>> = [];
  let matched = 0;

  for (const acct of Array.from(pdfSet).sort()) {
    const pdfBal = roundStatementMoney(pdfBalanceByAccount[acct]);
    const live = liveByAccount[acct];
    if (!live) continue;
    const liveBal = roundStatementMoney(live.balance);
    const diff = roundStatementMoney(liveBal - pdfBal);
    const expectedStatus = expectedStatusFromPdfBalance(pdfBal);
    const liveStatus = String(live.status || "").trim();
    if (Math.abs(diff) <= 0.01) {
      matched += 1;
    } else {
      mismatched.push({ accountNo: acct, pdfBalance: pdfBal, liveBalance: liveBal, difference: diff });
    }
    if (liveStatus !== expectedStatus) {
      statusMismatches.push({
        accountNo: acct,
        pdfBalance: pdfBal,
        expectedStatus,
        liveStatus,
      });
    }
  }

  const pdfCards = calculatePaymentReceiveCardTotals(
    Object.entries(pdfBalanceByAccount).map(([, balance]) => ({ balance }))
  );
  const liveCards = calculatePaymentReceiveCardTotals(
    Object.keys(pdfBalanceByAccount)
      .filter((a) => liveByAccount[a])
      .map((a) => ({ balance: Number(liveByAccount[a]?.balance) || 0 }))
  );

  return {
    pdfAccounts: pdfSet.size,
    eduClearAccounts: liveSet.size,
    matched,
    mismatched,
    missing,
    extra,
    statusMismatches,
    cardComparison: {
      expected: pdfCards,
      live: liveCards,
    },
  };
}

async function runLivePaymentPersistenceTest(
  statements: StatementRow[],
  ledgerEntries: BillingLedgerEntry[]
): Promise<Record<string, unknown>> {
  const candidates = statements
    .filter((s) => {
      const bal = Number(s.balance) || 0;
      const acct = String(s.accountNo || "").trim().toUpperCase();
      return bal >= 500 && bal <= 5000 && acct && acct !== "MAM004";
    })
    .sort((a, b) => Number(a.balance) - Number(b.balance));

  const testAccount = String(candidates[0]?.accountNo || "MOT033").trim().toUpperCase();
  const paymentAmount = 1;
  const idempotencyKey = `recovery-persist-test-${Date.now()}`;

  const beforeStatements = await fetchLiveStatements();
  const beforeRow = beforeStatements.find(
    (s) => String(s.accountNo || "").trim().toUpperCase() === testAccount
  );
  const beforeBalance = roundStatementMoney(beforeRow?.balance);
  const beforeCards = calculatePaymentReceiveCardTotals(
    beforeStatements.map((s) => ({ balance: Number(s.balance) || 0 }))
  );

  const postResult = (await fetchJson(`${API_BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_ID,
      accountNo: testAccount,
      amount: paymentAmount,
      date: new Date().toISOString().slice(0, 10),
      reference: idempotencyKey,
      method: "EFT",
      description: "Recovery persistence test R0.01",
      idempotencyKey,
    }),
  })) as Record<string, unknown>;

  const afterImmediate = await fetchLiveStatements();
  const afterRow = afterImmediate.find(
    (s) => String(s.accountNo || "").trim().toUpperCase() === testAccount
  );
  const afterBalance = roundStatementMoney(afterRow?.balance);
  const afterCards = calculatePaymentReceiveCardTotals(
    afterImmediate.map((s) => ({ balance: Number(s.balance) || 0 }))
  );

  await new Promise((r) => setTimeout(r, 2000));
  const afterDelay = await fetchLiveStatements();
  const afterDelayRow = afterDelay.find(
    (s) => String(s.accountNo || "").trim().toUpperCase() === testAccount
  );

  const ledgerAfter = (await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { entries?: BillingLedgerEntry[] };
  const testPayments = (ledgerAfter.entries || []).filter(
    (e) =>
      String(e.accountNo || "").trim().toUpperCase() === testAccount &&
      String(e.reference || "") === idempotencyKey
  );

  return {
    testAccount,
    paymentAmount,
    idempotencyKey,
    beforeBalance,
    afterBalance,
    expectedAfterBalance: roundStatementMoney(beforeBalance - paymentAmount),
    balanceUpdatedImmediately: Math.abs(afterBalance - (beforeBalance - paymentAmount)) <= 0.01,
    balanceStableAfterDelay:
      Math.abs(roundStatementMoney(afterDelayRow?.balance) - afterBalance) <= 0.01,
    beforeCards,
    afterCards,
    postApiResponse: {
      success: postResult.success,
      duplicate: postResult.duplicate,
      balance: postResult.balance,
      lastPayment: (postResult.account as StatementRow | undefined)?.lastPayment,
      lastPaymentDate: (postResult.account as StatementRow | undefined)?.lastPaymentDate,
    },
    ledgerPaymentCount: testPayments.length,
    duplicatePayment: testPayments.length > 1,
    storageNote:
      "Payments persist in production billing-ledger.json on Render instance; baseline in family-account-age-analysis.json. Without persistent disk, ledger can be lost on deploy — see docs/billing-ledger-persistence-ACTION.md",
  };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const pdfPath = path.resolve(process.env.PAYMENT_RECEIVE_PDF || DEFAULT_PDF);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outDir = path.join(process.cwd(), "storage", `emergency-restore-${stamp}`);

  console.log("=== Phase 0: Production backup ===");
  const backup = await phase0Backup(outDir);

  const ledgerData = JSON.parse(
    fs.readFileSync(backup.ledgerPath, "utf8")
  ) as { entries?: BillingLedgerEntry[] };
  const ledgerEntries = ledgerData.entries || [];

  let payload: { schoolId: string; importedAt: string; snapshots: Array<Record<string, unknown>> };
  let pdfBalanceByAccount: Record<string, number>;

  if (fs.existsSync(PROVEN_PAYLOAD) && process.env.USE_PROVEN_PAYLOAD !== "false") {
    const proven = JSON.parse(fs.readFileSync(PROVEN_PAYLOAD, "utf8")) as typeof payload & {
      snapshots: Array<{ accountRef: string; balance: number }>;
    };
    proven.snapshots = proven.snapshots.filter(
      (s) => !EXCLUDED_ACCOUNTS.has(String(s.accountRef || "").trim().toUpperCase())
    );
    payload = proven;
    const { uniqueByAccount } = await parsePaymentReceiveListPdf(pdfPath);
    pdfBalanceByAccount = {};
    for (const [acct, row] of Object.entries(uniqueByAccount)) {
      if (EXCLUDED_ACCOUNTS.has(acct)) continue;
      pdfBalanceByAccount[acct] = roundStatementMoney(row.balance);
    }
    console.log(`Using proven payload (${payload.snapshots.length} snapshots, excludes JAC001/LET007)`);
  } else {
    const built = await buildRestorePayload(pdfPath, ledgerEntries);
    payload = built.payload;
    pdfBalanceByAccount = built.pdfBalanceByAccount;
  }

  fs.writeFileSync(path.join(outDir, "payload.json"), JSON.stringify(payload, null, 2));
  console.log(`Payload snapshots: ${payload.snapshots.length}`);

  if (!apply) {
    console.log(`Plan only. Re-run with --apply and ${CONFIRM_ENV}=true`);
    return;
  }

  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    throw new Error(`Refusing --apply without ${CONFIRM_ENV}=true`);
  }

  console.log("=== Phase 1: Apply baseline restore ===");
  const token = await loginSuperAdmin();
  const applyResult = await fetchJson(`${API_BASE}/api/migration/age-analysis-baseline/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  fs.writeFileSync(path.join(outDir, "apply-result.json"), JSON.stringify(applyResult, null, 2));
  console.log(JSON.stringify(applyResult, null, 2));

  console.log("=== Phase 1 verification ===");
  const afterStatements = await fetchLiveStatements();
  const verification = verifyAgainstPdf(pdfBalanceByAccount, afterStatements);
  fs.writeFileSync(path.join(outDir, "verification.json"), JSON.stringify(verification, null, 2));

  const spot = ["MAM004", "DUP001", "ALI002", "ADA004", "AFR002"];
  const spotCheck = Object.fromEntries(
    spot.map((acct) => {
      const row = afterStatements.find((s) => String(s.accountNo || "").trim().toUpperCase() === acct);
      return [
        acct,
        {
          pdf: pdfBalanceByAccount[acct],
          live: row?.balance,
          status: row?.status,
          lastPayment: row?.lastPayment,
          lastPaymentDate: row?.lastPaymentDate,
          matches: Math.abs(roundStatementMoney(row?.balance) - roundStatementMoney(pdfBalanceByAccount[acct])) <= 0.01,
        },
      ];
    })
  );

  const report = {
    phase0: { outDir, ledgerCount: backup.ledgerCount },
    applyResult,
    verification,
    spotCheck,
    success:
      verification.matched === verification.pdfAccounts &&
      verification.missing.length === 0 &&
      verification.extra.length === 0 &&
      verification.mismatched.length === 0 &&
      verification.statusMismatches.length === 0,
  };

  fs.writeFileSync(path.join(outDir, "phase1-final-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));

  if (!report.success) {
    console.error("Phase 1 verification FAILED — not running payment persistence test");
    process.exit(1);
  }

  console.log("=== Live payment persistence test ===");
  const paymentTest = await runLivePaymentPersistenceTest(afterStatements, ledgerEntries);
  fs.writeFileSync(path.join(outDir, "payment-persistence-test.json"), JSON.stringify(paymentTest, null, 2));
  console.log(JSON.stringify(paymentTest, null, 2));

  if (
    !paymentTest.balanceUpdatedImmediately ||
    paymentTest.duplicatePayment ||
    !paymentTest.balanceStableAfterDelay
  ) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
