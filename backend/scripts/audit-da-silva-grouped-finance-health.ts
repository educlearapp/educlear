import "dotenv/config";
import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { buildAccountsFromAgeAnalysisSnapshots } from "../src/services/statementAccounts";
import {
  buildFinanceAccountSnapshots,
  groupFinanceSnapshotsByHealth,
} from "../../frontend/src/finance/financeAccountEngine";
import { DEFAULT_FINANCE_POLICY, type AccountHealth } from "../../frontend/src/finance/financePolicy";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const REPORT_DIR = path.join(process.cwd(), "storage", "finance-health-audit");
const JSON_REPORT = path.join(REPORT_DIR, "da-silva-grouped-health-audit.json");
const CSV_REPORT = path.join(REPORT_DIR, "da-silva-grouped-health-audit.csv");

type AuditRow = {
  accountRef: string;
  parent: string;
  learners: string[];
  totalBalance: number;
  overpaidAmount: number;
  monthlyFeeTotal: number;
  overdueAmount: number;
  dueNow: number;
  monthsOutstanding: number;
  calculatedHealthStatus: AccountHealth;
  reason: string;
  expectedHealthStatus: AccountHealth;
  classificationValid: boolean;
  duplicateCount: number;
  learnerCount: number;
  siblingAccount: boolean;
};

function installLocalStorageMock() {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    get length() {
      return store.size;
    },
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
  };
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function expectedHealth(input: {
  totalBalance: number;
  overpaidAmount: number;
  overdueAmount: number;
  monthlyFeeTotal: number;
}): AccountHealth {
  if (input.totalBalance <= 0 || input.overpaidAmount > 0 || input.overdueAmount <= 0) {
    return "Excellent";
  }
  const months = input.monthlyFeeTotal > 0
    ? input.overdueAmount / input.monthlyFeeTotal
    : 1;
  if (months <= 1) return "Needs Attention";
  if (months <= 3) return "Action Required";
  return "Critical";
}

function csvEscape(value: unknown) {
  const raw = Array.isArray(value) ? value.join(" | ") : String(value ?? "");
  return `"${raw.replace(/"/g, '""')}"`;
}

function seededRandomSample<T extends { accountRef: string }>(rows: T[], count: number) {
  if (rows.length <= count) return rows;
  const scored = rows.map((row) => {
    let hash = 2166136261;
    const key = `finance-health-audit:${row.accountRef}`;
    for (const char of key) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return { row, score: hash >>> 0 };
  });
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, count)
    .map((entry) => entry.row);
}

async function loadLearnersWithBillingPlans() {
  const learners = await prisma.learner.findMany({
    where: { schoolId: SCHOOL_ID },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      grade: true,
      familyAccountId: true,
      familyAccount: { select: { accountRef: true, familyName: true } },
      links: {
        select: {
          isPrimary: true,
          parent: {
            select: {
              firstName: true,
              surname: true,
            },
          },
        },
      },
      billingPlanLines: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          feeDescription: true,
          amount: true,
        },
      },
    } as any,
  });

  return learners.map((learner: any) => {
    const parents = (learner.links || [])
      .map((link: any) => ({ ...(link.parent || {}), isPrimary: link.isPrimary === true }))
      .filter(Boolean)
      .map((parent: any) => ({
        firstName: parent.firstName,
        surname: parent.surname || "",
        lastName: parent.surname || "",
        isPrimary: parent.isPrimary === true,
      }));
    return {
      id: learner.id,
      learnerId: learner.id,
      firstName: learner.firstName || "",
      lastName: learner.lastName || "",
      name: learner.firstName || "",
      surname: learner.lastName || "",
      grade: learner.grade || "",
      familyAccountId: learner.familyAccountId || "",
      familyAccount: learner.familyAccount,
      accountRef: learner.familyAccount?.accountRef || "",
      parents,
      billingPlan: (learner.billingPlanLines || []).map((line: any) => ({
        id: line.id,
        description: line.feeDescription,
        amount: Number(line.amount) || 0,
      })),
    };
  });
}

async function main() {
  installLocalStorageMock();
  fs.mkdirSync(REPORT_DIR, { recursive: true });

  const [statementRows, learners] = await Promise.all([
    buildAccountsFromAgeAnalysisSnapshots(SCHOOL_ID),
    loadLearnersWithBillingPlans(),
  ]);

  const snapshots = buildFinanceAccountSnapshots({
    schoolId: SCHOOL_ID,
    learners,
    statementRows: statementRows as any,
    policy: DEFAULT_FINANCE_POLICY,
    today: "2026-06-27",
  });

  const accountRefCounts = snapshots.reduce<Record<string, number>>((acc, snapshot) => {
    const ref = snapshot.accountRef || snapshot.billingAccountRef || "NO_ACCOUNT";
    acc[ref] = (acc[ref] || 0) + 1;
    return acc;
  }, {});

  const auditRows: AuditRow[] = snapshots
    .map((snapshot) => {
      const expectedHealthStatus = expectedHealth({
        totalBalance: snapshot.totalBalance,
        overpaidAmount: snapshot.overpaidAmount,
        overdueAmount: snapshot.overdueAmount,
        monthlyFeeTotal: snapshot.monthlyFeeTotal,
      });
      return {
        accountRef: snapshot.accountRef || snapshot.billingAccountRef,
        parent: snapshot.parentGuardianName,
        learners: snapshot.learnerNames,
        totalBalance: roundMoney(snapshot.totalBalance),
        overpaidAmount: roundMoney(snapshot.overpaidAmount),
        monthlyFeeTotal: roundMoney(snapshot.monthlyFeeTotal),
        overdueAmount: roundMoney(snapshot.overdueAmount),
        dueNow: roundMoney(snapshot.dueNow),
        monthsOutstanding: roundMoney(snapshot.monthsOutstanding),
        calculatedHealthStatus: snapshot.healthStatus,
        reason: snapshot.collectionsReason,
        expectedHealthStatus,
        classificationValid: expectedHealthStatus === snapshot.healthStatus,
        duplicateCount: accountRefCounts[snapshot.accountRef || snapshot.billingAccountRef] || 0,
        learnerCount: snapshot.learnerNames.length,
        siblingAccount: snapshot.learnerNames.length > 1,
      };
    })
    .sort((a, b) => a.accountRef.localeCompare(b.accountRef, undefined, { numeric: true }));

  const groups = groupFinanceSnapshotsByHealth(snapshots);
  const counts: Record<AccountHealth, number> = {
    Excellent: groups.Excellent.length,
    "Needs Attention": groups["Needs Attention"].length,
    "Action Required": groups["Action Required"].length,
    Critical: groups.Critical.length,
  };
  const groupedCount = counts.Excellent + counts["Needs Attention"] + counts["Action Required"] + counts.Critical;
  const siblingRows = auditRows.filter((row) => row.siblingAccount);
  const singleRows = auditRows.filter((row) => !row.siblingAccount);
  const duplicateRows = auditRows.filter((row) => row.duplicateCount !== 1);
  const invalidRows = auditRows.filter((row) => !row.classificationValid);
  const mak020 = auditRows.find((row) => row.accountRef === "MAK020") || null;
  const criticalRows = auditRows.filter((row) => row.calculatedHealthStatus === "Critical");

  const report = {
    generatedAt: new Date().toISOString(),
    schoolId: SCHOOL_ID,
    source: "buildAccountsFromAgeAnalysisSnapshots + Prisma learner billing plans + buildFinanceAccountSnapshots",
    statementRowsCount: statementRows.length,
    groupedAccountCount: snapshots.length,
    counts,
    groupedCountsSum: groupedCount,
    expectedGroupedAccountCount: 344,
    countsEqualGroupedAccounts: groupedCount === snapshots.length,
    groupedAccountsEqual344: snapshots.length === 344,
    duplicateAccountRefs: duplicateRows,
    invalidClassifications: invalidRows,
    specificAudits: {
      MAK020: mak020,
      allCriticalAccounts: criticalRows,
      randomSiblingAccounts: seededRandomSample(siblingRows, 20),
      randomSingleLearnerAccounts: seededRandomSample(singleRows, 20),
    },
    allAccounts: auditRows,
  };

  const csvHeader = [
    "Account Ref",
    "Parent",
    "Learners",
    "Total Balance",
    "Overpaid Amount",
    "Monthly Fee Total",
    "Overdue Amount (Due Now)",
    "Months Outstanding",
    "Calculated Health Status",
    "Why",
    "Expected Health Status",
    "Classification Valid",
    "Duplicate Count",
  ];
  const csvRows = auditRows.map((row) => [
    row.accountRef,
    row.parent,
    row.learners,
    row.totalBalance,
    row.overpaidAmount,
    row.monthlyFeeTotal,
    row.overdueAmount,
    row.monthsOutstanding,
    row.calculatedHealthStatus,
    row.reason,
    row.expectedHealthStatus,
    row.classificationValid,
    row.duplicateCount,
  ]);
  fs.writeFileSync(JSON_REPORT, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(CSV_REPORT, [csvHeader, ...csvRows].map((row) => row.map(csvEscape).join(",")).join("\n"), "utf8");

  console.log(JSON.stringify({
    jsonReport: JSON_REPORT,
    csvReport: CSV_REPORT,
    statementRowsCount: statementRows.length,
    groupedAccountCount: snapshots.length,
    counts,
    groupedCountsSum: groupedCount,
    groupedAccountsEqual344: snapshots.length === 344,
    countsEqualGroupedAccounts: groupedCount === snapshots.length,
    duplicateAccountRefCount: duplicateRows.length,
    invalidClassificationCount: invalidRows.length,
    mak020,
    criticalCount: criticalRows.length,
    siblingSampleCount: seededRandomSample(siblingRows, 20).length,
    singleSampleCount: seededRandomSample(singleRows, 20).length,
  }, null, 2));

  if (invalidRows.length || duplicateRows.length || snapshots.length !== 344 || groupedCount !== snapshots.length) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
