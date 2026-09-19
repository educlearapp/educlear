/**
 * Dry-run age-analysis snapshot backfill for a school (default: Fly Eagle).
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/age-analysis-snapshot-backfill-dry-run.ts
 *   SCHOOL_ID=... npx ts-node --transpile-only scripts/age-analysis-snapshot-backfill-dry-run.ts
 *
 * Never applies. Apply requires a separate explicit path + APPLY_AGE_ANALYSIS_BACKFILL=true.
 */
import fs from "fs";
import path from "path";
import {
  FLY_EAGLE_SCHOOL_ID,
  planAgeAnalysisSnapshotBackfill,
} from "../src/services/ageAnalysisSnapshotBackfill";
import {
  selectStatementFamilyAccounts,
  type StatementFamilyAccount,
} from "../src/services/statementAccountIdentity";
import { prisma } from "../src/prisma";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../src/utils/familyAccountAgeAnalysisStore";
import { filterAccountsEligibleForNewPayment } from "../src/services/paymentAccountEligibility";
import { describeStatementIdentity } from "../src/services/statementAccountIdentity";
import { resolveEduClearAccountNo } from "../src/services/familyAccountNumber";

async function main() {
  const schoolId = String(process.env.SCHOOL_ID || FLY_EAGLE_SCHOOL_ID).trim();
  const outDir = path.join(
    process.cwd(),
    "storage",
    "fly-eagle-remediation",
    `age-analysis-backfill-dry-run-${new Date().toISOString().replace(/[:.]/g, "-")}`
  );
  fs.mkdirSync(outDir, { recursive: true });

  const plan = await planAgeAnalysisSnapshotBackfill(schoolId, { apply: false });

  const familyAccounts = (await prisma.familyAccount.findMany({
    where: { schoolId },
    select: {
      id: true,
      accountRef: true,
      accountNo: true,
      familyName: true,
      retiredAt: true,
      mergedIntoFamilyAccountId: true,
    },
  })) as StatementFamilyAccount[];

  const learners = await prisma.learner.findMany({
    where: { schoolId, familyAccountId: { not: null } },
    select: { familyAccountId: true },
    distinct: ["familyAccountId"],
  });
  const linked = new Set(
    learners.map((l) => String(l.familyAccountId || "").trim()).filter(Boolean)
  );
  const ledger = readSchoolLedger(schoolId);
  const snapshotsByRef = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);

  const activeBefore = selectStatementFamilyAccounts({
    familyAccounts,
    snapshotsByRef,
    ledger,
    linkedFamilyAccountIds: linked,
  });

  // Simulate post-backfill snap universe (in-memory only — no write).
  const simulatedSnaps = { ...snapshotsByRef };
  for (const c of plan.candidates) {
    const key = c.proposedSnapshotKey.toUpperCase();
    if (!simulatedSnaps[key]) {
      simulatedSnaps[key] = {
        schoolId,
        accountRef: key,
        accountHolder: c.proposedAccountHolder,
        balance: c.proposedBalance,
        buckets: {
          current: c.proposedBalance,
          d30: 0,
          d60: 0,
          d90: 0,
          d120: 0,
        },
        source: "educlear-registration",
        importedAt: new Date().toISOString(),
      };
    }
  }

  const activeAfter = selectStatementFamilyAccounts({
    familyAccounts,
    snapshotsByRef: simulatedSnaps,
    ledger,
    linkedFamilyAccountIds: linked,
  });

  const historical = selectStatementFamilyAccounts({
    familyAccounts,
    snapshotsByRef,
    ledger,
    linkedFamilyAccountIds: linked,
    includeRetired: true,
  });

  const targetCodes = [
    "SOT002",
    "SOT001",
    "HIR002",
    "HIR003",
    "LED002",
    "MAP003",
    "MAN009",
    "MAN005",
    "ABO001",
    "NAO001",
    "NAO002",
  ];

  function findIn(list: StatementFamilyAccount[], code: string) {
    return list.find((fa) => {
      const id = describeStatementIdentity(fa);
      return (
        (id.currentAccountNo || "").toUpperCase() === code ||
        id.legacyRef.toUpperCase() === code ||
        String(fa.accountRef || "").toUpperCase() === code
      );
    });
  }

  const regression = Object.fromEntries(
    targetCodes.map((code) => {
      const inActive = Boolean(findIn(activeBefore, code));
      const inHistorical = Boolean(findIn(historical, code));
      const fa = familyAccounts.find(
        (row) => resolveEduClearAccountNo(row).toUpperCase() === code
      );
      const payable =
        fa && linked.has(fa.id)
          ? filterAccountsEligibleForNewPayment(
              [{ familyAccountId: fa.id, eduClearAccountNo: code, memberLearnerIds: ["x"] }],
              linked
            ).length > 0
          : false;
      return [
        code,
        {
          inActiveStatements: inActive,
          inHistoricalStatements: inHistorical,
          payableIfLinked: payable,
          missingSnapCandidate: plan.candidates.some(
            (c) => (c.currentAccountNo || "").toUpperCase() === code
          ),
        },
      ];
    })
  );

  const summary = {
    schoolId,
    planMode: plan.mode,
    before: plan.before,
    afterExpected: plan.afterExpected,
    statementVisibility: {
      activeBeforeCount: activeBefore.length,
      activeAfterSimulatedCount: activeAfter.length,
      historicalCount: historical.length,
      deltaActiveFromBackfillSim: activeAfter.length - activeBefore.length,
    },
    regression,
    candidatesPreview: plan.candidates.slice(0, 50),
  };

  fs.writeFileSync(path.join(outDir, "plan.json"), JSON.stringify(plan, null, 2));
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outDir}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
