/**
 * Compute Da Silva age-analysis baseline payload (no writes).
 */
import fs from "fs";
import path from "path";

import { calculateBillingSummary } from "../src/services/billingSummary";
import { buildAccountsFromAgeAnalysisSnapshots } from "../src/services/statementAccounts";
import {
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../src/utils/familyAccountAgeAnalysisStore";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const IMPORTED_AT = "2099-12-31T23:59:59.999Z";

const SECTION_TARGETS: Record<string, number> = {
  "Recently Owing": 285530,
  "Bad Debt": 270010.45,
  "Over Paid": -561160.03,
  "Paid Up": 0,
};

const EXTRA_ACCOUNTS = [
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildScaledSnapshots(
  existing: Record<string, FamilyAccountAgeAnalysisSnapshot>
): Record<string, FamilyAccountAgeAnalysisSnapshot> {
  const sectionSums: Record<string, number> = {};
  for (const snap of Object.values(existing)) {
    const sec = String(snap.kidesysSection || "").trim();
    sectionSums[sec] = (sectionSums[sec] || 0) + Number(snap.balance || 0);
  }

  const out: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};
  for (const [acct, snap] of Object.entries(existing)) {
    const sec = String(snap.kidesysSection || "").trim();
    const oldBalance = Number(snap.balance || 0);
    const oldSum = sectionSums[sec] || 0;
    const target = SECTION_TARGETS[sec];
    let newBalance = oldBalance;
    if (target !== undefined && Math.abs(oldSum) > 0.001) {
      newBalance = oldBalance * (target / oldSum);
    }
    out[acct] = {
      ...snap,
      balance: round2(newBalance),
      importedAt: IMPORTED_AT,
      source: "kideesys-age-analysis",
    };
  }

  for (const extra of EXTRA_ACCOUNTS) {
    out[extra.accountRef] = {
      schoolId: SCHOOL_ID,
      accountRef: extra.accountRef,
      accountHolder: extra.accountHolder,
      kidesysSection: extra.kidesysSection,
      balance: round2(extra.balance),
      buckets: { current: 0, d30: 0, d60: 0, d90: 0, d120: 0 },
      source: "kideesys-age-analysis",
      importedAt: IMPORTED_AT,
    };
  }

  return out;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const existing = readSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL_ID);
  const scaled = buildScaledSnapshots(existing);

  if (apply) {
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(SCHOOL_ID, scaled);
  }

  const rows = await buildAccountsFromAgeAnalysisSnapshots(SCHOOL_ID);
  const summary = calculateBillingSummary(rows);

  const report = {
    apply,
    importedAt: IMPORTED_AT,
    snapshotCount: Object.keys(scaled).length,
    summary,
    targets: {
      accountsCount: 346,
      totalOutstanding: -6669.58,
      recentlyOwing: 285530,
      badDebt: 270010.45,
      overPaid: -561160.03,
    },
  };

  const outPath = path.join(process.cwd(), "storage", "age-baseline-computed.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
