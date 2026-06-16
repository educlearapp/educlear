/**
 * READ-ONLY manual review report for June catch-up blockers (Category B + C).
 * Does NOT create invoices or modify any data.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { learnerHasInvoiceForPeriod, normalizeInvoicePeriod } from "../src/utils/billingLedgerStore";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const JUNE_PERIOD = normalizeInvoicePeriod("June 2026", "2026-06-01");
const STORAGE = path.join(process.cwd(), "storage");

type CatchupLearner = {
  learnerId: string;
  learnerName: string;
  accountNo: string;
  amount: number;
  billingGroupKey: string;
  category: string;
  reason: string;
};

type ApiLearner = {
  id: string;
  firstName: string;
  lastName: string;
  familyAccountId: string | null;
  accountNo?: string;
  accountNumber?: string;
  familyAccount?: { accountRef?: string } | null;
};

type LedgerEntry = {
  type?: string;
  learnerId?: string;
  invoicePeriod?: string;
  period?: string;
  amount?: number;
};

type LiveAccount = {
  accountNo: string;
  accountHolder?: string;
  familyName?: string;
  balance: number;
};

type AccountProjection = {
  accountCode: string;
  parentName?: string;
  kideSysBalance: number;
  eduClearBefore: number;
  juneInvoiceAmount: number;
  eduClearAfter?: number;
  diffBefore?: number;
  diffAfter?: number;
  newDifference?: number;
  note?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function billingGroupKey(learner: ApiLearner): string {
  const familyAccountId = String(learner.familyAccountId || "").trim();
  if (familyAccountId) return `family:${familyAccountId}`;
  const ref = String(learner.familyAccount?.accountRef || "").trim().toUpperCase();
  if (ref) return `account:${ref}`;
  return `learner:${learner.id}`;
}

function learnerAccountNo(learner: ApiLearner): string {
  return String(
    learner.accountNo || learner.accountNumber || learner.familyAccount?.accountRef || ""
  )
    .trim()
    .toUpperCase();
}

function fullName(learner: { firstName?: string; lastName?: string }): string {
  return `${String(learner.firstName || "").trim()} ${String(learner.lastName || "").trim()}`
    .trim()
    .replace(/\s+/g, " ");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${url} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function classifyGroup(
  accountCode: string,
  reason: string,
  category: string
):
  | "currently_matching_would_mismatch"
  | "partial_fix_only"
  | "would_worsen_mismatch"
  | "missing_educlear_account" {
  if (accountCode === "MAT012") return "missing_educlear_account";
  if (category === "C_DO_NOT_APPLY" || reason.toLowerCase().includes("worsen")) {
    return "would_worsen_mismatch";
  }
  if (reason.toLowerCase().includes("partial fix")) return "partial_fix_only";
  return "currently_matching_would_mismatch";
}

function recommendationFor(
  group:
    | "currently_matching_would_mismatch"
    | "partial_fix_only"
    | "would_worsen_mismatch"
    | "missing_educlear_account"
): string {
  switch (group) {
    case "currently_matching_would_mismatch":
      return "Do not apply automatically — manual review required";
    case "partial_fix_only":
      return "Manual review required — partial fix only";
    case "would_worsen_mismatch":
      return "Exclude from catch-up";
    case "missing_educlear_account":
      return "Fix account setup first";
    default:
      return "Manual review required";
  }
}

async function main() {
  const safeReport = loadJson<{
    categorization: {
      B_MANUAL_REVIEW: { learners: CatchupLearner[] };
      C_DO_NOT_APPLY: { learners: CatchupLearner[] };
    };
    meta: Record<string, unknown>;
  }>(path.join(STORAGE, "june-catchup-safe-list-report.json"));

  const approval = loadJson<{
    paymentReceiveReconciliation: {
      newlyMismatchAccounts: AccountProjection[];
      remainFromCatchupAccounts: AccountProjection[];
    };
  }>(path.join(STORAGE, "june-catchup-104-approval-report.json"));

  const recon = loadJson<{
    accountComparisons: Array<{
      accountCode: string;
      parentName: string;
      kideSysBalance: number;
      eduClearBalance: number;
      difference: number;
      inEduClear: boolean;
    }>;
    reconciliation: { missingInEduClear: string[] };
  }>(path.join(STORAGE, "payment-receive-recon-audit.json"));

  const blockers = [
    ...safeReport.categorization.B_MANUAL_REVIEW.learners,
    ...safeReport.categorization.C_DO_NOT_APPLY.learners,
  ];

  const projectionByAccount = new Map<string, AccountProjection>();
  for (const row of [
    ...approval.paymentReceiveReconciliation.newlyMismatchAccounts,
    ...approval.paymentReceiveReconciliation.remainFromCatchupAccounts,
  ]) {
    projectionByAccount.set(row.accountCode.toUpperCase(), row);
  }

  const reconByAccount = new Map(
    recon.accountComparisons.map((row) => [row.accountCode.toUpperCase(), row])
  );

  const learnersRaw = (await fetchJson(
    `${API_BASE}/api/learners?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { learners?: ApiLearner[] } | ApiLearner[];
  const apiLearners = Array.isArray(learnersRaw)
    ? learnersRaw
    : (learnersRaw as { learners?: ApiLearner[] }).learners || [];

  const learnerById = new Map(apiLearners.map((l) => [l.id, l]));
  const learnersByGroup = new Map<string, ApiLearner[]>();
  for (const learner of apiLearners) {
    const key = billingGroupKey(learner);
    if (!learnersByGroup.has(key)) learnersByGroup.set(key, []);
    learnersByGroup.get(key)!.push(learner);
  }

  const ledgerRaw = (await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { entries?: LedgerEntry[] } | LedgerEntry[];
  const ledgerEntries = Array.isArray(ledgerRaw)
    ? ledgerRaw
    : (ledgerRaw as { entries?: LedgerEntry[] }).entries || [];
  const invoiceEntries = ledgerEntries.filter((e) => e.type === "invoice");

  const statementsRaw = (await fetchJson(
    `${API_BASE}/api/statements/accounts?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  )) as { accounts?: LiveAccount[] };
  const liveByAccount = new Map(
    (statementsRaw.accounts || []).map((a) => [
      String(a.accountNo || "").trim().toUpperCase(),
      a,
    ])
  );

  const blockerByAccount = new Map<string, CatchupLearner[]>();
  for (const learner of blockers) {
    const acct = learner.accountNo.toUpperCase();
    if (!blockerByAccount.has(acct)) blockerByAccount.set(acct, []);
    blockerByAccount.get(acct)!.push(learner);
  }

  const accountReports: Array<Record<string, unknown>> = [];

  for (const [accountCode, catchupLearners] of [...blockerByAccount.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const primary = catchupLearners[0];
    const projection = projectionByAccount.get(accountCode);
    const reconRow = reconByAccount.get(accountCode);
    const live = liveByAccount.get(accountCode);

    const groupKey = primary.billingGroupKey;
    const groupMembers = learnersByGroup.get(groupKey) || [];

    const learnersOnAccount = groupMembers
      .filter((l) => learnerAccountNo(l) === accountCode)
      .map((l) => ({
        learnerId: l.id,
        learnerName: fullName(l),
        accountNo: accountCode,
        inCatchupBlocker: catchupLearners.some((c) => c.learnerId === l.id),
        juneInvoiced: learnerHasInvoiceForPeriod(invoiceEntries, l.id, JUNE_PERIOD),
        catchupInvoiceAmount: catchupLearners.find((c) => c.learnerId === l.id)?.amount,
      }));

    if (!learnersOnAccount.length) {
      for (const c of catchupLearners) {
        learnersOnAccount.push({
          learnerId: c.learnerId,
          learnerName: c.learnerName,
          accountNo: accountCode,
          inCatchupBlocker: true,
          juneInvoiced: learnerHasInvoiceForPeriod(invoiceEntries, c.learnerId, JUNE_PERIOD),
          catchupInvoiceAmount: c.amount,
        });
      }
    }

    const siblingGroupSummary = groupMembers.map((l) => {
      const ref = learnerAccountNo(l);
      return {
        learnerId: l.id,
        learnerName: fullName(l),
        accountNo: ref,
        juneInvoiced: learnerHasInvoiceForPeriod(invoiceEntries, l.id, JUNE_PERIOD),
        inCatchupBlocker: blockers.some((b) => b.learnerId === l.id),
        onSameAccount: ref === accountCode,
      };
    });

    const juneInvoicedLearners = learnersOnAccount.filter((l) => l.juneInvoiced);
    const missedJuneLearners = learnersOnAccount.filter((l) => !l.juneInvoiced);
    const juneInvoicedInFamily = siblingGroupSummary
      .filter((l) => l.juneInvoiced)
      .map((l) => ({
        learnerId: l.learnerId,
        learnerName: l.learnerName,
        accountNo: l.accountNo,
        onSameAccount: l.onSameAccount,
      }));
    const missedJuneInFamily = siblingGroupSummary
      .filter((l) => !l.juneInvoiced)
      .map((l) => ({
        learnerId: l.learnerId,
        learnerName: l.learnerName,
        accountNo: l.accountNo,
        onSameAccount: l.onSameAccount,
        catchupInvoiceAmount: blockers.find((b) => b.learnerId === l.learnerId)?.amount,
      }));

    const kideSysBalance = round2(
      projection?.kideSysBalance ?? reconRow?.kideSysBalance ?? 0
    );
    const eduClearBalance = round2(
      live?.balance ?? projection?.eduClearBefore ?? reconRow?.eduClearBalance ?? 0
    );
    const differenceNow = round2(kideSysBalance - eduClearBalance);
    const invoiceAmount = round2(
      catchupLearners.reduce((s, l) => s + (Number(l.amount) || 0), 0)
    );
    const projectedDifference = round2(
      projection?.diffAfter ??
        projection?.newDifference ??
        differenceNow - invoiceAmount
    );
    const projectedEduClearBalance = round2(eduClearBalance + invoiceAmount);

    const classificationLabel =
      primary.category === "C_DO_NOT_APPLY"
        ? "Would worsen mismatch"
        : primary.reason.toLowerCase().includes("partial fix")
          ? "Partial fix only"
          : "Currently matches Kid-e-Sys";

    const reviewGroup = classifyGroup(accountCode, primary.reason, primary.category);

    accountReports.push({
      accountCode,
      parentName:
        projection?.parentName ||
        reconRow?.parentName ||
        live?.accountHolder ||
        live?.familyName ||
        primary.learnerName,
      learnersOnAccount,
      billingGroupKey: groupKey,
      siblingGroupSummary,
      juneInvoicedLearners: juneInvoicedLearners.map((l) => ({
        learnerId: l.learnerId,
        learnerName: l.learnerName,
        accountNo: l.accountNo,
      })),
      juneInvoicedInFamily,
      missedJuneLearners: missedJuneLearners.map((l) => ({
        learnerId: l.learnerId,
        learnerName: l.learnerName,
        accountNo: l.accountNo,
        catchupInvoiceAmount: l.catchupInvoiceAmount,
      })),
      missedJuneInFamily,
      kideSysBalance,
      eduClearBalance,
      differenceNow,
      invoiceAmountWouldAdd: invoiceAmount,
      projectedEduClearBalance,
      projectedDifference,
      classification: classificationLabel,
      reviewGroup,
      recommendation: recommendationFor(reviewGroup),
      category: primary.category,
      blockerReason: primary.reason,
    });
  }

  const mat012 = reconByAccount.get("MAT012");
  if (mat012 && !blockerByAccount.has("MAT012")) {
    accountReports.push({
      accountCode: "MAT012",
      parentName: mat012.parentName,
      learnersOnAccount: [],
      billingGroupKey: null,
      siblingGroupSummary: [],
      juneInvoicedLearners: [],
      missedJuneLearners: [],
      kideSysBalance: round2(mat012.kideSysBalance),
      eduClearBalance: round2(mat012.eduClearBalance),
      differenceNow: round2(mat012.difference),
      invoiceAmountWouldAdd: 0,
      projectedEduClearBalance: round2(mat012.eduClearBalance),
      projectedDifference: round2(mat012.difference),
      classification: "Missing EduClear account",
      reviewGroup: "missing_educlear_account",
      recommendation: "Fix account setup first",
      category: "B_MANUAL_REVIEW",
      blockerReason: "On Kid-e-Sys Payment Receive List but missing from EduClear accounts",
      note: "Not in June catch-up learner set — separate setup issue",
    });
  }

  const grouped = {
    currently_matching_would_mismatch: accountReports.filter(
      (a) => a.reviewGroup === "currently_matching_would_mismatch"
    ),
    partial_fix_only: accountReports.filter((a) => a.reviewGroup === "partial_fix_only"),
    would_worsen_mismatch: accountReports.filter((a) => a.reviewGroup === "would_worsen_mismatch"),
    missing_educlear_account: accountReports.filter(
      (a) => a.reviewGroup === "missing_educlear_account"
    ),
  };

  const totalValueBlocked = round2(blockers.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const matchingAccounts = grouped.currently_matching_would_mismatch.length;
  const needSeparateCorrection =
    grouped.partial_fix_only.length +
    grouped.would_worsen_mismatch.length +
    grouped.missing_educlear_account.length;

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      mode: "READ_ONLY",
      schoolId: SCHOOL_ID,
      schoolName: "Da Silva Academy",
      invoicePeriod: "June 2026 / 2026-06",
      sourceReports: [
        "june-catchup-safe-list-report.json",
        "june-catchup-104-approval-report.json",
        "payment-receive-recon-audit.json",
      ],
      apiBase: API_BASE,
      ledgerEntryCount: ledgerEntries.length,
      noInvoicesCreated: true,
      noProductionDataChanged: true,
    },
    summary: {
      totalAccountsForManualReview: accountReports.length,
      totalLearnerInvoicesBlocked: blockers.length,
      totalValueBlocked,
      accountsCurrentlyMatchingMustNotAutoApply: matchingAccounts,
      accountsNeedingSeparateCorrection: needSeparateCorrection,
      breakdown: {
        currently_matching_would_mismatch: {
          accounts: grouped.currently_matching_would_mismatch.length,
          learners: grouped.currently_matching_would_mismatch.reduce(
            (s, a) => s + ((a.missedJuneLearners as unknown[])?.length || 0),
            0
          ),
          invoiceValue: round2(
            grouped.currently_matching_would_mismatch.reduce(
              (s, a) => s + (Number(a.invoiceAmountWouldAdd) || 0),
              0
            )
          ),
        },
        partial_fix_only: {
          accounts: grouped.partial_fix_only.length,
          learners: grouped.partial_fix_only.reduce(
            (s, a) => s + ((a.missedJuneLearners as unknown[])?.length || 0),
            0
          ),
          invoiceValue: round2(
            grouped.partial_fix_only.reduce(
              (s, a) => s + (Number(a.invoiceAmountWouldAdd) || 0),
              0
            )
          ),
        },
        would_worsen_mismatch: {
          accounts: grouped.would_worsen_mismatch.length,
          learners: grouped.would_worsen_mismatch.reduce(
            (s, a) => s + ((a.missedJuneLearners as unknown[])?.length || 0),
            0
          ),
          invoiceValue: round2(
            grouped.would_worsen_mismatch.reduce(
              (s, a) => s + (Number(a.invoiceAmountWouldAdd) || 0),
              0
            )
          ),
        },
        missing_educlear_account: {
          accounts: grouped.missing_educlear_account.length,
          learners: 0,
          invoiceValue: 0,
        },
      },
    },
    grouped,
    accounts: accountReports,
    finalRecommendation: {
      safeCatchUpCanProceedAfterExcludingThese:
        "Reconciliation-only yes — 54 safe learners fix 53 mismatches with zero new Kid-e-Sys mismatches. Live execute still blocked: invoice-run sibling integrity gate fails while 46 billing groups include these excluded eligible siblings.",
      codeAdjustmentNeeded:
        "Optional for automation only. Root cause is business/manual: partial sibling June invoicing left accounts matching Kid-e-Sys while siblings were missed. Resolving each family (invoice allocation, NDA001 gap, TSH016 over-balance, MAT012 missing account) is manual review — not a code bug. Scoped-run integrity relaxation would be a product decision, not required for correct balances.",
      action:
        "Exclude all 46 blocker accounts (B+C) plus MAT012 from automatic catch-up. Apply safe list (54 learners) only after business sign-off on sibling cases; integrity gate may still require per-family batching or backend scoped-run change.",
    },
  };

  const outPath = path.join(STORAGE, "june-catchup-manual-review-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        outPath,
        accounts: accountReports.length,
        learnersBlocked: blockers.length,
        valueBlocked: totalValueBlocked,
        matchingMustNotTouch: matchingAccounts,
        needSeparateCorrection,
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
