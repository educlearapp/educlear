/**
 * READ-ONLY billing baseline capture for pre/post deploy safety checks.
 * Does NOT write invoices, payments, ledger, snapshots, or migrations.
 *
 * Capture before deploy:
 *   API_BASE=https://educlear-backend.onrender.com SCHOOL_ID=cmpideqeq0000108xb6ouv9zi \
 *     npx tsx scripts/capture-billing-baseline.ts --out billing-baseline-before.json
 *
 * Compare after deploy (before any new invoice/payment):
 *   npx tsx scripts/capture-billing-baseline.ts --compare billing-baseline-before.json
 */
import fs from "fs";
import path from "path";
import { createHash } from "crypto";

const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const SCHOOL_ID = String(
  process.env.SCHOOL_ID || "cmpideqeq0000108xb6ouv9zi"
).trim();

/** Spot-check accounts: owing, overpaid, bad debt (Da Silva). */
const SPOT_ACCOUNTS = [
  "DUP001",
  "ALI002",
  "MAM004",
  "ADA004",
  "AFR002",
  "DIK001",
  "JOH001",
  "SMY001",
  "VAN003",
  "BRO002",
  "CAR005",
  "DAV006",
  "ENG007",
  "FOU008",
  "GOU009",
  "HEN010",
  "ISA011",
  "JAC012",
  "KHO013",
  "LEE014",
  "MAR015",
  "NEL016",
  "ORT017",
  "PET018",
  "QUI019",
  "RAM020",
];

type StatementRow = {
  accountNo?: string;
  balance?: number;
  status?: string;
  kidesysSection?: string;
};

type Baseline = {
  capturedAt: string;
  apiBase: string;
  schoolId: string;
  accountsCount: number;
  cards: {
    totalOutstanding: number;
    recentlyOwing: number;
    badDebt: number;
    overPaid: number;
    netPosition: number;
  };
  kidesysCards: {
    totalOutstanding: number;
    recentlyOwing: number;
    badDebt: number;
    overPaid: number;
  };
  spotBalances: Record<string, number>;
  sampleBalances: Array<{ accountNo: string; balance: number; status: string }>;
  ledgerEntryCount: number;
  ledgerFingerprint: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizeSection(value: unknown): string {
  return String(value || "").trim();
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} → ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

function computeCards(rows: StatementRow[]) {
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
    totalOutstanding,
    recentlyOwing,
    badDebt,
    overPaid,
    netPosition: roundMoney(totalOutstanding - overPaid),
  };
}

function computeKidesysSectionCards(rows: StatementRow[]) {
  let totalOutstanding = 0;
  let recentlyOwing = 0;
  let badDebt = 0;
  let overPaid = 0;
  for (const row of rows) {
    const balance = roundMoney(Number(row.balance) || 0);
    totalOutstanding += balance;
    const section = normalizeSection(row.kidesysSection || row.status);
    if (section === "Recently Owing") recentlyOwing += balance;
    if (section === "Bad Debt") badDebt += balance;
    if (section === "Over Paid") overPaid += balance;
  }
  return {
    totalOutstanding: roundMoney(totalOutstanding),
    recentlyOwing: roundMoney(recentlyOwing),
    badDebt: roundMoney(badDebt),
    overPaid: roundMoney(overPaid),
  };
}

function ledgerFingerprint(entries: unknown[]): string {
  const canonical = JSON.stringify(
    entries.map((e: any) => ({
      id: e?.id,
      type: e?.type,
      accountNo: e?.accountNo,
      amount: e?.amount,
      date: e?.date,
      learnerId: e?.learnerId,
      runId: e?.runId,
      createdAt: e?.createdAt,
    }))
  );
  return createHash("sha256").update(canonical).digest("hex");
}

async function capture(): Promise<Baseline> {
  const statementsData = await fetchJson(
    `${API_BASE}/api/statements?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  );
  const rows: StatementRow[] = Array.isArray(statementsData?.statements)
    ? statementsData.statements
    : Array.isArray(statementsData?.accounts)
      ? statementsData.accounts
      : [];

  const ledgerData = await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  );
  const ledgerEntries = Array.isArray(ledgerData?.entries) ? ledgerData.entries : [];

  const byAccount = new Map<string, StatementRow>();
  for (const row of rows) {
    const ref = String(row.accountNo || "").trim().toUpperCase();
    if (ref) byAccount.set(ref, row);
  }

  const spotBalances: Record<string, number> = {};
  for (const ref of SPOT_ACCOUNTS) {
    const row = byAccount.get(ref.toUpperCase());
    if (row) spotBalances[ref] = roundMoney(Number(row.balance) || 0);
  }

  const owing = rows.filter((r) => (Number(r.balance) || 0) > 0);
  const overpaid = rows.filter((r) => (Number(r.balance) || 0) < 0);
  const sampleSet = new Map<string, StatementRow>();
  for (const row of [...owing.slice(0, 10), ...overpaid.slice(0, 10)]) {
    const ref = String(row.accountNo || "").trim().toUpperCase();
    if (ref) sampleSet.set(ref, row);
  }
  for (const ref of SPOT_ACCOUNTS) {
    const row = byAccount.get(ref.toUpperCase());
    if (row) sampleSet.set(ref.toUpperCase(), row);
  }

  const sampleBalances = [...sampleSet.values()]
    .map((row) => ({
      accountNo: String(row.accountNo || ""),
      balance: roundMoney(Number(row.balance) || 0),
      status: normalizeSection(row.status || row.kidesysSection),
    }))
    .sort((a, b) => a.accountNo.localeCompare(b.accountNo));

  return {
    capturedAt: new Date().toISOString(),
    apiBase: API_BASE,
    schoolId: SCHOOL_ID,
    accountsCount: rows.length,
    cards: computeCards(rows),
    kidesysCards: computeKidesysSectionCards(rows),
    spotBalances,
    sampleBalances,
    ledgerEntryCount: ledgerEntries.length,
    ledgerFingerprint: ledgerFingerprint(ledgerEntries),
  };
}

function compare(before: Baseline, after: Baseline): string[] {
  const issues: string[] = [];
  const eq = (a: number, b: number, label: string) => {
    if (Math.abs(a - b) > 0.001) issues.push(`${label}: before=${a} after=${b} (delta ${roundMoney(b - a)})`);
  };

  if (before.accountsCount !== after.accountsCount) {
    issues.push(`accountsCount: before=${before.accountsCount} after=${after.accountsCount}`);
  }
  eq(before.cards.totalOutstanding, after.cards.totalOutstanding, "cards.totalOutstanding");
  eq(before.cards.recentlyOwing, after.cards.recentlyOwing, "cards.recentlyOwing");
  eq(before.cards.badDebt, after.cards.badDebt, "cards.badDebt");
  eq(before.cards.overPaid, after.cards.overPaid, "cards.overPaid");
  eq(before.cards.netPosition, after.cards.netPosition, "cards.netPosition");
  eq(before.kidesysCards.totalOutstanding, after.kidesysCards.totalOutstanding, "kidesysCards.totalOutstanding");
  eq(before.kidesysCards.recentlyOwing, after.kidesysCards.recentlyOwing, "kidesysCards.recentlyOwing");
  eq(before.kidesysCards.badDebt, after.kidesysCards.badDebt, "kidesysCards.badDebt");
  eq(before.kidesysCards.overPaid, after.kidesysCards.overPaid, "kidesysCards.overPaid");

  if (before.ledgerEntryCount !== after.ledgerEntryCount) {
    issues.push(
      `ledgerEntryCount: before=${before.ledgerEntryCount} after=${after.ledgerEntryCount}`
    );
  }
  if (before.ledgerFingerprint !== after.ledgerFingerprint) {
    issues.push("ledgerFingerprint: ledger content changed (no new posts expected)");
  }

  for (const [ref, bal] of Object.entries(before.spotBalances)) {
    const next = after.spotBalances[ref];
    if (next === undefined) {
      issues.push(`spot balance missing after deploy: ${ref}`);
      continue;
    }
    eq(bal, next, `spot ${ref}`);
  }

  const beforeSample = new Map(before.sampleBalances.map((r) => [r.accountNo.toUpperCase(), r.balance]));
  for (const row of after.sampleBalances) {
    const ref = row.accountNo.toUpperCase();
    const prev = beforeSample.get(ref);
    if (prev !== undefined && Math.abs(prev - row.balance) > 0.001) {
      issues.push(`sample ${ref}: before=${prev} after=${row.balance}`);
    }
  }

  return issues;
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const compareIdx = args.indexOf("--compare");

  if (compareIdx >= 0) {
    const beforePath = args[compareIdx + 1];
    if (!beforePath || !fs.existsSync(beforePath)) {
      throw new Error("Usage: --compare <baseline-before.json>");
    }
    const before = JSON.parse(fs.readFileSync(beforePath, "utf8")) as Baseline;
    const after = await capture();
    const issues = compare(before, after);
    const outPath = path.join(process.cwd(), "billing-baseline-compare.json");
    fs.writeFileSync(
      outPath,
      JSON.stringify({ before, after, issues, comparedAt: new Date().toISOString() }, null, 2),
      "utf8"
    );
    if (issues.length) {
      console.error("BASELINE MISMATCH — STOP AND ROLLBACK:");
      for (const issue of issues) console.error(`  - ${issue}`);
      console.error(`\nWrote ${outPath}`);
      process.exit(1);
    }
    console.log("BASELINE OK — all captured totals and sample balances match.");
    console.log(`Accounts: ${after.accountsCount}`);
    console.log(`Cards: ${JSON.stringify(after.cards)}`);
    console.log(`Ledger entries: ${after.ledgerEntryCount} (fingerprint unchanged)`);
    console.log(`Wrote ${outPath}`);
    return;
  }

  const baseline = await capture();
  const outPath =
    outIdx >= 0 && args[outIdx + 1]
      ? path.resolve(args[outIdx + 1])
      : path.join(process.cwd(), "billing-baseline.json");

  fs.writeFileSync(outPath, JSON.stringify(baseline, null, 2), "utf8");
  console.log(`Captured billing baseline → ${outPath}`);
  console.log(`Accounts: ${baseline.accountsCount}`);
  console.log(`Cards: ${JSON.stringify(baseline.cards)}`);
  console.log(`Spot checks: ${Object.keys(baseline.spotBalances).length} accounts`);
  console.log(`Sample balances: ${baseline.sampleBalances.length} rows`);
  console.log(`Ledger: ${baseline.ledgerEntryCount} entries`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
