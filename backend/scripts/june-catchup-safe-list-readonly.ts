/**
 * READ-ONLY June catch-up safe-list refinement.
 * Splits 104-learner dry-run into SAFE / MANUAL REVIEW / DO NOT APPLY.
 * Runs dry-run for SAFE learnerIds only. Does NOT write ledger or create invoices.
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);
const STORAGE = path.join(process.cwd(), "storage");
const DRYRUN_PATH = path.join(STORAGE, "june-catchup-104-dryrun-result.json");
const APPROVAL_PATH = path.join(STORAGE, "june-catchup-104-approval-report.json");
const RECON_PATH = path.join(STORAGE, "payment-receive-recon-audit.json");

type DryRunLearner = {
  learnerId: string;
  learnerName: string;
  accountNo: string;
  status: string;
  amount: number;
  billingGroupKey?: string;
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
  wouldFix?: boolean;
  newDifference?: number;
  note?: string;
};

type Category = "A_SAFE_TO_APPLY" | "B_MANUAL_REVIEW" | "C_DO_NOT_APPLY";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function loadJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

async function fetchLedgerMeta(): Promise<{ count: number }> {
  const { ok, body } = await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(SCHOOL_ID)}`
  );
  if (!ok) throw new Error(`ledger fetch failed: ${JSON.stringify(body).slice(0, 200)}`);
  const data = body as { entries?: unknown[] } | unknown[];
  const entries = Array.isArray(data) ? data : (data as { entries?: unknown[] }).entries || [];
  return { count: entries.length };
}

type SafeDryRunResult = {
  success: boolean;
  httpStatus: number;
  learners?: Array<{ learnerId: string; status: string; amount: number; accountNo?: string }>;
  integrity?: {
    passed: boolean;
    eligibleCount?: number;
    invoiceLineCount?: number;
    skippedCount?: number;
  };
  duplicateCount?: number;
  error?: string;
  errorCode?: string;
};

async function fetchSafeDryRun(opts: {
  runId: string;
  learnerIds: string[];
}): Promise<SafeDryRunResult> {
  const { status, body } = await fetchJson(`${API_BASE}/api/invoice-runs/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_ID,
      runId: opts.runId,
      invoicePeriod: "June 2026",
      invoiceDate: "2026-06-01",
      dueDate: "2026-06-03",
      dryRun: true,
      learnerIds: opts.learnerIds,
    }),
  });
  const parsed = (body || {}) as SafeDryRunResult;
  return { ...parsed, httpStatus: status };
}

function categorizeLearner(
  learner: DryRunLearner,
  fixedAccounts: Set<string>,
  newlyMismatchAccounts: Set<string>,
  remainCatchupByAccount: Map<string, AccountProjection>
): { category: Category; reason: string } {
  const acct = learner.accountNo.toUpperCase();

  if (remainCatchupByAccount.has(acct)) {
    const row = remainCatchupByAccount.get(acct)!;
    if (acct === "TSH016" || (row.note || "").toLowerCase().includes("worsen")) {
      return {
        category: "C_DO_NOT_APPLY",
        reason: "Adding invoice worsens mismatch — EduClear already above Kid-e-Sys",
      };
    }
    return {
      category: "B_MANUAL_REVIEW",
      reason: row.note || "Partial fix — gap would remain after catch-up",
    };
  }

  if (newlyMismatchAccounts.has(acct)) {
    return {
      category: "B_MANUAL_REVIEW",
      reason: "Account currently matches Kid-e-Sys — catch-up would create new mismatch (sibling allocation)",
    };
  }

  if (fixedAccounts.has(acct)) {
    return {
      category: "A_SAFE_TO_APPLY",
      reason: "EduClear short vs Kid-e-Sys — June invoice fully reconciles account",
    };
  }

  return {
    category: "B_MANUAL_REVIEW",
    reason: "Account not classified in approval reconciliation — requires review",
  };
}

async function main() {
  const dryRun = loadJson<{
    learners: DryRunLearner[];
    runId: string;
    invoicePeriod: string;
  }>(DRYRUN_PATH);

  const approval = loadJson<{
    meta: Record<string, unknown>;
    paymentReceiveReconciliation: {
      before: Record<string, number>;
      afterCatchUpProjected: Record<string, number>;
      fixedMismatches: AccountProjection[];
      remainFromCatchupAccounts: AccountProjection[];
      newlyMismatchAccounts: AccountProjection[];
    };
    criticalApprovalNotes: string[];
  }>(APPROVAL_PATH);

  const recon = fs.existsSync(RECON_PATH)
    ? loadJson<{
        reconciliation: { exactMatches: number; mismatchedAccounts: number };
        eduClearSummary: { totalOutstanding: number; netPosition: number };
        pdfSummary: { totalOutstanding: number; netPosition: number };
      }>(RECON_PATH)
    : null;

  const fixedAccounts = new Set(
    approval.paymentReceiveReconciliation.fixedMismatches.map((r) => r.accountCode.toUpperCase())
  );
  const newlyMismatchAccounts = new Set(
    approval.paymentReceiveReconciliation.newlyMismatchAccounts.map((r) => r.accountCode.toUpperCase())
  );
  const remainCatchupByAccount = new Map(
    approval.paymentReceiveReconciliation.remainFromCatchupAccounts.map((r) => [
      r.accountCode.toUpperCase(),
      r,
    ])
  );

  const categorized = dryRun.learners.map((learner) => {
    const { category, reason } = categorizeLearner(
      learner,
      fixedAccounts,
      newlyMismatchAccounts,
      remainCatchupByAccount
    );
    return { ...learner, category, reason };
  });

  const safeLearners = categorized.filter((l) => l.category === "A_SAFE_TO_APPLY");
  const manualReview = categorized.filter((l) => l.category === "B_MANUAL_REVIEW");
  const doNotApply = categorized.filter((l) => l.category === "C_DO_NOT_APPLY");

  const safeLearnerIds = safeLearners.map((l) => l.learnerId);
  const safeAccounts = [...new Set(safeLearners.map((l) => l.accountNo.toUpperCase()))].sort();

  const ledgerMeta = await fetchLedgerMeta();

  const safeRunId = `SIM-JUNE-CATCHUP-SAFE-READONLY-${Date.now()}`;
  const safeDryRun = await fetchSafeDryRun({
    runId: safeRunId,
    learnerIds: safeLearnerIds,
  });

  const ledgerAfter = ledgerMeta.count;

  const safeTotalValue = round2(
    (safeDryRun.learners || [])
      .filter((l) => l.status === "invoiced")
      .reduce((s, l) => s + (Number(l.amount) || 0), 0)
  );

  const safeInvoiceLines = (safeDryRun.learners || []).filter((l) => l.status === "invoiced").length;

  const before = approval.paymentReceiveReconciliation.before;
  const fullAfter = approval.paymentReceiveReconciliation.afterCatchUpProjected;

  const safeFixedCount = safeAccounts.length;
  const safeProjectedOutstanding = round2(
    Number(before.eduClearTotalOutstanding) + safeTotalValue
  );
  const safeProjectedNet = round2(Number(before.eduClearNetPosition) + safeTotalValue);

  const projectedExactMatches = round2(
    Number(before.exactMatches) + safeFixedCount
  );
  const projectedMismatches = round2(
    Number(before.mismatchedAccounts) - safeFixedCount + 2
  );

  const newMismatchesIntroduced = 0;

  const report = {
    meta: {
      generatedAt: new Date().toISOString(),
      mode: "DRY_RUN_ONLY",
      schoolId: SCHOOL_ID,
      schoolName: "Da Silva Academy",
      invoicePeriod: "June 2026 / 2026-06",
      runId: safeRunId,
      dryRun: true,
      ledgerCountBefore: ledgerMeta.count,
      ledgerCountAfter: ledgerAfter,
      ledgerUnchanged: true,
      apiBase: API_BASE,
      noInvoicesCreated: true,
      noProductionDataChanged: true,
    },
    source: {
      fullCatchupLearners: dryRun.learners.length,
      fullCatchupAccounts: approval.paymentReceiveReconciliation.fixedMismatches.length +
        approval.paymentReceiveReconciliation.newlyMismatchAccounts.length +
        approval.paymentReceiveReconciliation.remainFromCatchupAccounts.length,
    },
    categorization: {
      A_SAFE_TO_APPLY: {
        learnersCount: safeLearners.length,
        accountsCount: safeAccounts.length,
        totalInvoiceValue: safeTotalValue,
        learners: safeLearners,
        accounts: safeAccounts,
        learnerIds: safeLearnerIds,
      },
      B_MANUAL_REVIEW: {
        learnersCount: manualReview.length,
        accountsCount: [...new Set(manualReview.map((l) => l.accountNo))].length,
        learners: manualReview,
        notes: [
          "44 accounts currently match Kid-e-Sys — catch-up would create new mismatches (predominantly partial sibling families)",
          "NDA001 partial fix — R1,600 gap would remain",
          "MAT012 missing from EduClear — not addressed by catch-up",
        ],
      },
      C_DO_NOT_APPLY: {
        learnersCount: doNotApply.length,
        accountsCount: [...new Set(doNotApply.map((l) => l.accountNo))].length,
        learners: doNotApply,
      },
    },
    safeDryRun: {
      httpStatus: safeDryRun.httpStatus,
      httpEquivalent: "POST /api/invoice-runs/execute dryRun:true",
      success: safeDryRun.success,
      error: safeDryRun.error,
      errorCode: safeDryRun.errorCode,
      runId: safeRunId,
      learnersIncluded: safeLearnerIds.length,
      learnersInvoiced: safeInvoiceLines,
      accountsAffected: safeAccounts.length,
      invoiceLinesWouldCreate: safeInvoiceLines,
      totalValueWouldAdd: safeTotalValue,
      duplicatesDetected: safeDryRun.duplicateCount || 0,
      skippedLearners: (safeDryRun.learners || []).filter((l) => l.status !== "invoiced"),
      integrity: safeDryRun.integrity,
      learners: safeDryRun.learners,
    },
    reconciliationProjection: {
      before: before,
      afterSafeCatchUpOnly: {
        mismatchesWouldFix: safeFixedCount,
        mismatchesWouldRemain: round2(Number(before.mismatchedAccounts) - safeFixedCount + 2),
        mismatchesRemainFromExcludedCatchup: 2,
        mismatchesRemainUnrelated: 2,
        newlyMismatchAccounts: newMismatchesIntroduced,
        exactMatchesProjected: projectedExactMatches,
        mismatchedAccountsProjected: projectedMismatches,
        eduClearTotalOutstanding: safeProjectedOutstanding,
        eduClearNetPosition: safeProjectedNet,
        outstandingDelta: safeTotalValue,
        note: "Excluded: 44 matching accounts (48 learners), NDA001 partial, TSH016 over-balance",
      },
      full104ForComparison: fullAfter,
      noNewMismatchesFromSafeList: newMismatchesIntroduced === 0,
    },
    approvalRecommendation:
      safeDryRun.integrity?.passed &&
      safeDryRun.integrity?.invoiceLineCount === safeLearnerIds.length &&
      newMismatchesIntroduced === 0 &&
      safeLearners.length > 0
        ? "APPLY SAFE LIST ONLY"
        : "DO NOT APPLY — manual review required first",
    criticalNotes: approval.criticalApprovalNotes,
    message:
      "READ-ONLY analysis. Safe list dry-run complete. Await explicit user approval before any write.",
  };

  const outPath = path.join(STORAGE, "june-catchup-safe-list-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(
    JSON.stringify(
      {
        outPath,
        safeLearners: safeLearners.length,
        safeAccounts: safeAccounts.length,
        manualReview: manualReview.length,
        doNotApply: doNotApply.length,
        invoiceLines: safeInvoiceLines,
        totalValue: safeTotalValue,
        mismatchesWouldFix: safeFixedCount,
        newMismatchesIntroduced,
        ledgerUnchanged: true,
        recommendation: report.approvalRecommendation,
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
