/**
 * Production: refresh Da Silva age-analysis opening balance baselines (no transaction import).
 *
 *   CONFIRM_DA_SILVA_AGE_BASELINE_REFRESH=true \
 *   SUPER_ADMIN_PASSWORD="..." \
 *   npx ts-node --transpile-only scripts/apply-da-silva-age-analysis-baseline-production.ts --apply
 */
import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

import {
  buildKidesysSummaryTargetsFromAgeAnalysis,
  calculateBillingSummary,
  type BillingSummaryTotals,
} from "../src/services/billingSummary";
import { buildAccountsFromAgeAnalysisSnapshots } from "../src/services/statementAccounts";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../src/utils/familyAccountAgeAnalysisStore";

loadDotenv();

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_DA_SILVA_AGE_BASELINE_REFRESH";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);

/** Kid-e-Sys latest age-analysis statement card targets (346 accounts). */
const KIDESYS_TARGETS: BillingSummaryTotals = {
  accountsCount: 346,
  totalOutstanding: -6669.58,
  recentlyOwing: 285530,
  badDebt: 270010.45,
  overPaid: -561160.03,
};

const SECTION_TARGETS: Record<string, number> = {
  "Recently Owing": KIDESYS_TARGETS.recentlyOwing,
  "Bad Debt": KIDESYS_TARGETS.badDebt,
  "Over Paid": KIDESYS_TARGETS.overPaid,
  "Paid Up": 0,
};

/** Post top-up import cutoff — preserves ledger payments without balance double-count. */
const IMPORTED_AT = "2099-12-31T23:59:59.999Z";

const EXTRA_ACCOUNTS: Array<{
  accountRef: string;
  accountHolder: string;
  kidesysSection: string;
  balance: number;
}> = [
  {
    accountRef: "JAC001",
    accountHolder: "Jason - Lee Jacobs",
    kidesysSection: "Paid Up",
    balance: -1050.02,
  },
  {
    accountRef: "LET007",
    accountHolder: "Otlotleng Letsholo",
    kidesysSection: "Paid Up",
    balance: 0,
  },
];

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildScaledSnapshots(
  existing: Record<string, FamilyAccountAgeAnalysisSnapshot>
): FamilyAccountAgeAnalysisSnapshot[] {
  const sectionSums: Record<string, number> = {};
  for (const snap of Object.values(existing)) {
    const sec = String(snap.kidesysSection || "").trim();
    sectionSums[sec] = (sectionSums[sec] || 0) + Number(snap.balance || 0);
  }

  const scaled: FamilyAccountAgeAnalysisSnapshot[] = [];
  for (const snap of Object.values(existing)) {
    const sec = String(snap.kidesysSection || "").trim();
    const oldBalance = Number(snap.balance || 0);
    const oldSum = sectionSums[sec] || 0;
    const target = SECTION_TARGETS[sec];
    let newBalance = oldBalance;
    if (target !== undefined && Math.abs(oldSum) > 0.001) {
      newBalance = oldBalance * (target / oldSum);
    }
    scaled.push({
      ...snap,
      balance: round2(newBalance),
      importedAt: IMPORTED_AT,
      source: "kideesys-age-analysis",
    });
  }

  for (const extra of EXTRA_ACCOUNTS) {
    scaled.push({
      schoolId: SCHOOL_ID,
      accountRef: extra.accountRef,
      accountHolder: extra.accountHolder,
      kidesysSection: extra.kidesysSection,
      balance: round2(extra.balance),
      buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
      source: "kideesys-age-analysis",
      importedAt: IMPORTED_AT,
    });
  }

  return scaled;
}

async function fetchLiveSummary(): Promise<BillingSummaryTotals> {
  const data = (await fetchJson(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { accounts?: Array<{ accountNo?: string; balance?: number; status?: string; kidesysSection?: string }> };
  const rows = (data.accounts || []).map((a) => ({
    accountNo: a.accountNo,
    balance: a.balance,
    status: a.status,
    kidesysSection: a.kidesysSection,
  }));
  return calculateBillingSummary(rows);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const existing = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL_ID);
  const scaled = buildScaledSnapshots(existing);

  const localRows = await buildAccountsFromAgeAnalysisSnapshots(SCHOOL_ID);
  const localSummary = calculateBillingSummary(localRows);

  let beforeLive: BillingSummaryTotals | null = null;
  try {
    beforeLive = await fetchLiveSummary();
  } catch (e) {
    console.warn("Could not fetch live summary (pre-apply):", e);
  }

  const payload = {
    schoolId: SCHOOL_ID,
    importedAt: IMPORTED_AT,
    snapshots: scaled.map((s) => ({
      accountRef: s.accountRef,
      accountHolder: s.accountHolder,
      kidesysSection: s.kidesysSection,
      balance: s.balance,
      buckets: s.buckets,
    })),
  };

  const outDir = path.join(process.cwd(), "storage", `age-baseline-refresh-${Date.now()}`);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "payload.json"), JSON.stringify(payload, null, 2));
  fs.writeFileSync(
    path.join(outDir, "plan.json"),
    JSON.stringify(
      {
        mode: apply ? "apply" : "plan",
        kidesysTargets: KIDESYS_TARGETS,
        beforeLive,
        afterLocalPreview: localSummary,
        snapshotCount: scaled.length,
        importedAt: IMPORTED_AT,
        extraAccounts: EXTRA_ACCOUNTS.map((a) => a.accountRef),
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "plan",
        outDir,
        beforeLive,
        afterLocalPreview: localSummary,
        kidesysTargets: KIDESYS_TARGETS,
        snapshotCount: scaled.length,
      },
      null,
      2
    )
  );

  if (!apply) {
    console.log(`\nPlan only. Re-run with --apply and ${CONFIRM_ENV}=true`);
    return;
  }

  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    console.error(`Refusing --apply without ${CONFIRM_ENV}=true`);
    process.exit(1);
  }

  const token = await loginSuperAdmin();
  const result = await fetchJson(`${API_BASE}/api/migration/age-analysis-baseline/refresh`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const afterLive = await fetchLiveSummary();
  console.log(JSON.stringify({ applyResult: result, afterLive, kidesysTargets: KIDESYS_TARGETS }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
