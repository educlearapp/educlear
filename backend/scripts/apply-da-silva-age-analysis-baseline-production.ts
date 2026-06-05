/**
 * Production: refresh Da Silva age-analysis opening balance baselines (no transaction import).
 * Uses exact per-account Kid-e-Sys Age Analysis balances — no proportional scaling.
 *
 *   CONFIRM_DA_SILVA_AGE_BASELINE_REFRESH=true \
 *   SUPER_ADMIN_PASSWORD="..." \
 *   npx ts-node --transpile-only scripts/apply-da-silva-age-analysis-baseline-production.ts --apply
 */
import { config as loadDotenv } from "dotenv";
import fs from "fs";
import path from "path";

import {
  buildExactAgeAnalysisSnapshots,
  compareExactAgeAnalysisBalances,
  DA_SILVA_AGE_BASELINE_IMPORTED_AT,
} from "../src/services/migrationCentre/ageAnalysisExactBaseline";
import { calculateBillingSummary } from "../src/services/billingSummary";
import { buildAccountsFromAgeAnalysisSnapshots } from "../src/services/statementAccounts";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";

loadDotenv();

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_DA_SILVA_AGE_BASELINE_REFRESH";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);

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

async function fetchLiveBalances(): Promise<Record<string, number>> {
  const data = (await fetchJson(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { accounts?: Array<{ accountNo?: string; balance?: number }> };
  const out: Record<string, number> = {};
  for (const row of data.accounts || []) {
    const acct = String(row.accountNo || "").trim().toUpperCase();
    if (!acct) continue;
    out[acct] = Number(row.balance) || 0;
  }
  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const beforeSnapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL_ID);
  const beforeLocalRows = await buildAccountsFromAgeAnalysisSnapshots(SCHOOL_ID);
  const beforeLocalByAccount = Object.fromEntries(
    beforeLocalRows.map((row) => [String(row.accountNo).toUpperCase(), Number(row.balance) || 0])
  );

  const { ageAnalysisXls, snapshots, parsedAccountCount } = buildExactAgeAnalysisSnapshots({
    schoolId: SCHOOL_ID,
    importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
  });

  const kidesysBalanceByAccount: Record<string, number> = {};
  for (const [acct, snap] of Object.entries(snapshots)) {
    kidesysBalanceByAccount[acct] = Number(snap.balance) || 0;
  }

  const { resolveAuthoritativeAccountBalanceFromSnapshot } = await import(
    "../src/services/statementAccounts"
  );
  const { readSchoolLedger } = await import("../src/utils/billingLedgerStore");
  const ledger = readSchoolLedger(SCHOOL_ID);
  const afterLocalByAccount: Record<string, number> = {};
  for (const [acct, snap] of Object.entries(snapshots)) {
    const entries = ledger.filter(
      (e) => String(e.accountNo || "").trim().toUpperCase() === acct
    );
    afterLocalByAccount[acct] = resolveAuthoritativeAccountBalanceFromSnapshot(snap, entries);
  }

  const beforeMatch = compareExactAgeAnalysisBalances({
    kidesysBalanceByAccount,
    eduClearBalanceByAccount: beforeLocalByAccount,
  });
  const afterLocalMatch = compareExactAgeAnalysisBalances({
    kidesysBalanceByAccount,
    eduClearBalanceByAccount: afterLocalByAccount,
  });

  const payload = {
    schoolId: SCHOOL_ID,
    importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
    snapshots: Object.values(snapshots).map((s) => ({
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
        ageAnalysisXls,
        parsedAccountCount,
        snapshotCount: Object.keys(snapshots).length,
        importedAt: DA_SILVA_AGE_BASELINE_IMPORTED_AT,
        ali002: {
          kidesysBalance: kidesysBalanceByAccount.ALI002 ?? null,
          eduClearBefore: beforeLocalByAccount.ALI002 ?? null,
          eduClearAfter: afterLocalByAccount.ALI002 ?? null,
        },
        beforeFix: {
          matchingExactlyCount: beforeMatch.matchingExactly.length,
          unmatchedCount: beforeMatch.unmatched.length,
        },
        afterLocalPreview: {
          matchingExactlyCount: afterLocalMatch.matchingExactly.length,
          unmatchedCount: afterLocalMatch.unmatched.length,
          unmatchedAccounts: afterLocalMatch.unmatched,
          summary: calculateBillingSummary(
            Object.entries(afterLocalByAccount).map(([accountNo, balance]) => ({
              accountNo,
              balance,
            }))
          ),
        },
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
        ageAnalysisXls,
        ali002: {
          kidesysBalance: kidesysBalanceByAccount.ALI002 ?? null,
          eduClearBefore: beforeLocalByAccount.ALI002 ?? null,
          eduClearAfter: afterLocalByAccount.ALI002 ?? null,
        },
        matchingExactlyCount: afterLocalMatch.matchingExactly.length,
        unmatchedCount: afterLocalMatch.unmatched.length,
        unmatchedAccounts: afterLocalMatch.unmatched,
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
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const refreshPaths = [
    "/api/migration/age-analysis-baseline/refresh",
    "/api/migration/topup-payments/age-baseline-refresh",
  ];
  let result: unknown = null;
  let lastError: unknown = null;
  for (const refreshPath of refreshPaths) {
    try {
      result = await fetchJson(`${API_BASE}${refreshPath}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      lastError = null;
      break;
    } catch (e) {
      lastError = e;
    }
  }
  if (lastError) throw lastError;

  const afterLiveByAccount = await fetchLiveBalances();
  const afterLiveMatch = compareExactAgeAnalysisBalances({
    kidesysBalanceByAccount,
    eduClearBalanceByAccount: afterLiveByAccount,
  });

  console.log(
    JSON.stringify(
      {
        applyResult: result,
        ali002: {
          kidesysBalance: kidesysBalanceByAccount.ALI002 ?? null,
          eduClearBefore: beforeLocalByAccount.ALI002 ?? null,
          eduClearAfter: afterLiveByAccount.ALI002 ?? null,
        },
        matchingExactlyCount: afterLiveMatch.matchingExactly.length,
        unmatchedCount: afterLiveMatch.unmatched.length,
        unmatchedAccounts: afterLiveMatch.unmatched,
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
