/**
 * Read-only verification against Phase-1 acceptance criteria (production API).
 *
 *   npx tsx scripts/verify-phase1-billing-acceptance.ts
 *
 * Optional: include DIK001 R1 persistence test expectations (balance 499).
 */
import fs from "fs";
import path from "path";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const PHASE1_DIR = path.join(
  process.cwd(),
  "storage",
  "emergency-restore-2026-06-06T08-55-30-773Z"
);
const EXCLUDED = new Set(["JAC001", "LET007"]);

type StatementRow = {
  accountNo?: string;
  balance?: number;
  status?: string;
  lastPayment?: number;
  lastPaymentDate?: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function cardTotals(rows: StatementRow[]) {
  const positive = rows.filter((r) => (Number(r.balance) || 0) > 0);
  const negative = rows.filter((r) => (Number(r.balance) || 0) < 0);
  const totalOutstanding = roundMoney(positive.reduce((s, r) => s + Number(r.balance), 0));
  const overPaid = roundMoney(negative.reduce((s, r) => s + Math.abs(Number(r.balance)), 0));
  const recentlyOwing = roundMoney(
    positive.filter((r) => Number(r.balance) <= 10000).reduce((s, r) => s + Number(r.balance), 0)
  );
  const badDebt = roundMoney(
    positive.filter((r) => Number(r.balance) > 10000).reduce((s, r) => s + Number(r.balance), 0)
  );
  return {
    totalAccounts: rows.length,
    totalOutstanding,
    recentlyOwing,
    badDebt,
    overPaid,
    netPosition: roundMoney(totalOutstanding - overPaid),
  };
}

async function main() {
  const expectDik001PersistTest = !process.argv.includes("--skip-dik001-persist-test");

  const phase1ReportPath = path.join(PHASE1_DIR, "phase1-final-report.json");
  const expectedCards = fs.existsSync(phase1ReportPath)
    ? (
        JSON.parse(fs.readFileSync(phase1ReportPath, "utf8")) as {
          verification?: { cardComparison?: { expected?: Record<string, number> } };
        }
      ).verification?.cardComparison?.expected || {}
    : {
        totalAccounts: 344,
        totalOutstanding: 552540.45,
        recentlyOwing: 334550.45,
        badDebt: 217990,
        overPaid: 561160.03,
        netPosition: -8619.58,
      };

  if (expectDik001PersistTest) {
    expectedCards.totalOutstanding = roundMoney(Number(expectedCards.totalOutstanding) - 1);
    expectedCards.netPosition = roundMoney(Number(expectedCards.netPosition) - 1);
    expectedCards.recentlyOwing = roundMoney(Number(expectedCards.recentlyOwing) - 1);
  }

  const spotExpected: Record<
    string,
    { balance: number; lastPayment?: number; lastPaymentDate?: string }
  > = {
    DUP001: { balance: -12200, lastPayment: 3500, lastPaymentDate: "2026-06-03" },
    ALI002: { balance: 4000, lastPayment: 3000, lastPaymentDate: "2026-06-04" },
    MAM004: { balance: 1500, lastPayment: 3000, lastPaymentDate: "2026-06-06" },
    ADA004: { balance: -50, lastPayment: 6000, lastPaymentDate: "2026-06-04" },
    AFR002: { balance: -130, lastPayment: 130, lastPaymentDate: "2026-06-04" },
    DIK001: {
      balance: expectDik001PersistTest ? 499 : 500,
      lastPayment: expectDik001PersistTest ? 1 : undefined,
      lastPaymentDate: expectDik001PersistTest ? "2026-06-06" : undefined,
    },
  };

  const env = (await fetchJson(`${API_BASE}/api/payments/env`)) as Record<string, unknown>;
  const statements = (
    (await fetchJson(`${API_BASE}/api/statements?schoolId=${encodeURIComponent(SCHOOL_ID)}`)) as {
      accounts?: StatementRow[];
    }
  ).accounts || [];
  const ledger = (
    (await fetchJson(`${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`)) as {
      entries?: Array<Record<string, unknown>>;
    }
  ).entries || [];

  const liveCards = cardTotals(statements);
  const accountSet = new Set(
    statements.map((r) => String(r.accountNo || "").trim().toUpperCase()).filter(Boolean)
  );
  const extra = Array.from(accountSet).filter((a) => EXCLUDED.has(a));
  const missingExcluded = EXCLUDED.has("JAC001") && EXCLUDED.has("LET007");

  const cardDiff: Record<string, { expected: number; live: number; ok: boolean }> = {};
  for (const key of Object.keys(expectedCards)) {
    const expected = roundMoney(Number(expectedCards[key] || 0));
    const live = roundMoney(Number(liveCards[key as keyof typeof liveCards] || 0));
    cardDiff[key] = { expected, live, ok: Math.abs(expected - live) <= 0.01 };
  }

  const spotResults: Record<string, unknown> = {};
  for (const [acct, exp] of Object.entries(spotExpected)) {
    const row = statements.find((r) => String(r.accountNo || "").trim().toUpperCase() === acct);
    spotResults[acct] = {
      expectedBalance: exp.balance,
      liveBalance: row?.balance,
      balanceOk: Math.abs(roundMoney(Number(row?.balance) || 0) - exp.balance) <= 0.01,
      expectedLastPayment: exp.lastPayment,
      liveLastPayment: row?.lastPayment,
      expectedLastPaymentDate: exp.lastPaymentDate,
      liveLastPaymentDate: row?.lastPaymentDate,
    };
  }

  const undoCorrections = ledger.filter(
    (e) =>
      String(e.source || "") === "educlear_undo_correction" ||
      String(e.id || "").startsWith("undo-corr-")
  );
  const mamRestore = ledger.find((e) => e.id === "pay-mam004-restore-20260606-single");

  const report = {
    apiBase: API_BASE,
    gitCommit: env.gitCommit,
    serverTime: env.serverTime,
    accountCount: statements.length,
    accountCountOk: statements.length === 344,
    excludedPresent: extra,
    excludedAbsentOk: extra.length === 0,
    cardDiff,
    cardsOk: Object.values(cardDiff).every((c) => c.ok),
    spotResults,
    spotsOk: Object.values(spotResults).every((s) => (s as { balanceOk: boolean }).balanceOk),
    ledgerEntryCount: ledger.length,
    undoCorrectionCount: undoCorrections.length,
    mam004RestorePresent: Boolean(mamRestore),
    transactionsEndpointOk: false as boolean,
  };

  try {
    const txRes = await fetch(
      `${API_BASE}/api/statements/transactions?schoolId=${encodeURIComponent(SCHOOL_ID)}&accountNo=DIK001&period=all`
    );
    report.transactionsEndpointOk = txRes.ok;
  } catch {
    report.transactionsEndpointOk = false;
  }

  report.success =
    report.accountCountOk &&
    report.excludedAbsentOk &&
    report.cardsOk &&
    report.spotsOk &&
    report.undoCorrectionCount === 0 &&
    report.mam004RestorePresent;

  console.log(JSON.stringify(report, null, 2));
  if (!report.success) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
