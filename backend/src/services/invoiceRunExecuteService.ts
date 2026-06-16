import fs from "fs";
import path from "path";

import { prisma } from "../prisma";
import { loadSchoolBillingSettings } from "../routes/billingSettings";
import { buildInvoiceEntry } from "./invoiceEntryBuilder";
import {
  readExplicitlyEmptyBillingPlanLearnerIds,
  readSchoolBillingPlansResolved,
} from "./learnerBillingPlanDbStore";
import {
  assertOfficialBillingAccountRef,
  resolveOfficialBillingAccountRef,
} from "./officialBillingAccountRef";
import { activeLearnerWhere } from "../utils/learnerEnrollment";
import {
  buildBillingPlanLookupIndexes,
  resolveLearnerBillingPlanItems,
  type StoredBillingPlanItem,
} from "../utils/learnerBillingPlanStore";
import {
  appendSchoolEntriesSafe,
  buildInvoiceRunEntryId,
  learnerHasInvoiceForPeriod,
  ledgerHasRunId,
  listInvoices,
  normaliseAmount,
  normalizeInvoicePeriod,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { normaliseIsoDate, resolveInvoiceMessage } from "../utils/billingSettingsEngine";
import type { InvoiceRunSkipReason } from "../types/invoiceRunSkipReasons";

const MONEY_TOLERANCE = 0.01;

export type InvoiceRunExecuteRequest = {
  schoolId: string;
  runId: string;
  invoicePeriod: string;
  invoiceDate: string;
  dueDate?: string;
  description?: string;
  dryRun?: boolean;
  learnerIds?: string[];
  extraFeesByLearnerId?: Record<string, StoredBillingPlanItem[]>;
};

export type InvoiceRunLearnerRow = {
  learnerId: string;
  learnerName: string;
  accountNo: string;
  status: "invoiced" | "skipped";
  amount?: number;
  skipReason?: InvoiceRunSkipReason;
  skipDetail?: string;
  billingGroupKey: string;
};

export type InvoiceRunAccountValidation = {
  accountNo: string;
  billingGroupKey: string;
  activeCount: number;
  eligibleCount: number;
  invoicedCount: number;
  skippedCount: number;
  expectedTotal: number;
  actualTotal: number;
  siblingValidationPassed: boolean;
  issues?: string[];
};

export type InvoiceRunIntegrity = {
  passed: boolean;
  eligibleCount: number;
  invoiceLineCount: number;
  skippedCount: number;
  skipReasonCounts: Record<string, number>;
  processedCount: number;
};

export type InvoiceRunExecuteResult = {
  success: boolean;
  dryRun: boolean;
  runId: string;
  invoicePeriod: string;
  integrity: InvoiceRunIntegrity;
  learners: InvoiceRunLearnerRow[];
  accounts: InvoiceRunAccountValidation[];
  invoices?: BillingLedgerEntry[];
  createdCount?: number;
  duplicateCount?: number;
  error?: string;
  errorCode?: string;
};

type LearnerRecord = {
  id: string;
  firstName: string;
  lastName: string;
  enrollmentStatus: string;
  admissionNo: string | null;
  idNumber: string | null;
  familyAccountId: string | null;
  familyAccount: { accountRef: string } | null;
};

export function sumBillingPlanAmount(items: StoredBillingPlanItem[]): number {
  return items.reduce((total, item) => total + (Number(item.amount) || 0), 0);
}

export function resolveBillingGroupKeyForRun(learner: {
  id: string;
  familyAccountId: string | null;
  familyAccount: { accountRef: string } | null;
}): string {
  const familyAccountId = String(learner.familyAccountId || "").trim();
  if (familyAccountId) return `family:${familyAccountId}`;
  const ref = String(learner.familyAccount?.accountRef || "").trim().toUpperCase();
  if (ref) return `account:${ref}`;
  return `learner:${learner.id}`;
}

export function learnerFullName(learner: { firstName: string; lastName: string }): string {
  return `${String(learner.firstName || "").trim()} ${String(learner.lastName || "").trim()}`
    .trim()
    .replace(/\s+/g, " ");
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function moneyEqual(a: number, b: number): boolean {
  return Math.abs(roundMoney(a) - roundMoney(b)) <= MONEY_TOLERANCE;
}

export type LearnerEligibilityInput = {
  learner: LearnerRecord;
  planItems: StoredBillingPlanItem[];
  accountNo: string;
  accountError?: string;
  invoicePeriod: string;
  existingLedger: BillingLedgerEntry[];
  extraFees?: StoredBillingPlanItem[];
};

export type LearnerEligibilityResult = {
  billableEligible: boolean;
  status: "invoiced" | "skipped";
  amount: number;
  skipReason?: InvoiceRunSkipReason;
  skipDetail?: string;
};

export function evaluateLearnerEligibility(
  input: LearnerEligibilityInput
): LearnerEligibilityResult {
  const { learner, planItems, accountNo, accountError, invoicePeriod, existingLedger, extraFees } =
    input;

  if (String(learner.enrollmentStatus || "").toUpperCase() !== "ACTIVE") {
    return {
      billableEligible: false,
      status: "skipped",
      amount: 0,
      skipReason: "INACTIVE_LEARNER",
      skipDetail: `Enrollment status: ${learner.enrollmentStatus}`,
    };
  }

  const combinedPlan = [...planItems, ...(extraFees || [])];
  if (!combinedPlan.length) {
    return {
      billableEligible: false,
      status: "skipped",
      amount: 0,
      skipReason: "BILLING_PLAN_EMPTY",
    };
  }

  const amount = roundMoney(sumBillingPlanAmount(combinedPlan));
  if (amount <= 0) {
    return {
      billableEligible: false,
      status: "skipped",
      amount: 0,
      skipReason: "ZERO_INVOICE_AMOUNT",
    };
  }

  if (!accountNo) {
    const reason: InvoiceRunSkipReason = accountError?.includes("not on the official")
      ? "OFFICIAL_ACCOUNT_REF_NOT_RESOLVED"
      : "ACCOUNT_NOT_FOUND";
    return {
      billableEligible: false,
      status: "skipped",
      amount: 0,
      skipReason: reason,
      skipDetail: accountError,
    };
  }

  if (learnerHasInvoiceForPeriod(existingLedger, learner.id, invoicePeriod)) {
    return {
      billableEligible: true,
      status: "skipped",
      amount,
      skipReason: "DUPLICATE_INVOICE",
      skipDetail: `Learner already invoiced for period ${invoicePeriod}`,
    };
  }

  return {
    billableEligible: true,
    status: "invoiced",
    amount,
  };
}

export function buildSkipReasonCounts(
  learners: InvoiceRunLearnerRow[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of learners) {
    if (row.status !== "skipped" || !row.skipReason) continue;
    counts[row.skipReason] = (counts[row.skipReason] || 0) + 1;
  }
  return counts;
}

export function validateIntegrityGate(
  learners: InvoiceRunLearnerRow[],
  accounts: InvoiceRunAccountValidation[]
): InvoiceRunIntegrity {
  const billableEligible = learners.filter((row) => {
    if (row.status === "invoiced") return true;
    return row.skipReason === "DUPLICATE_INVOICE";
  });

  const invoiced = learners.filter((row) => row.status === "invoiced");
  const skippedEligible = learners.filter(
    (row) => row.status === "skipped" && row.skipReason === "DUPLICATE_INVOICE"
  );

  const eligibleCount = billableEligible.length;
  const invoiceLineCount = invoiced.length;
  const skippedEligibleCount = skippedEligible.length;
  const skipReasonCounts = buildSkipReasonCounts(learners);

  const siblingFailed = accounts.some((account) => !account.siblingValidationPassed);
  const balanceFailed = accounts.some(
    (account) =>
      account.invoicedCount > 0 &&
      !moneyEqual(account.expectedTotal, account.actualTotal)
  );

  const equationOk = eligibleCount === invoiceLineCount + skippedEligibleCount;
  const allAccountedFor = learners.every(
    (row) => row.status === "invoiced" || row.status === "skipped"
  );

  const passed = equationOk && allAccountedFor && !siblingFailed && !balanceFailed;

  return {
    passed,
    eligibleCount,
    invoiceLineCount,
    skippedCount: learners.filter((row) => row.status === "skipped").length,
    skipReasonCounts,
    processedCount: learners.length,
  };
}

export function validateSiblingAccounts(
  allActiveLearners: LearnerRecord[],
  learnerRows: InvoiceRunLearnerRow[],
  eligibilityByLearnerId: Map<string, LearnerEligibilityResult>,
  existingLedger: BillingLedgerEntry[],
  invoicePeriod: string,
  resolveEligibilityForLearner?: (learner: LearnerRecord) => LearnerEligibilityResult
): InvoiceRunAccountValidation[] {
  const rowsById = new Map(learnerRows.map((row) => [row.learnerId, row]));
  const groupKeys = new Set<string>();

  for (const learner of allActiveLearners) {
    groupKeys.add(resolveBillingGroupKeyForRun(learner));
  }

  const getEligibility = (learner: LearnerRecord): LearnerEligibilityResult | undefined => {
    const cached = eligibilityByLearnerId.get(learner.id);
    if (cached) return cached;
    return resolveEligibilityForLearner?.(learner);
  };

  const validations: InvoiceRunAccountValidation[] = [];

  for (const billingGroupKey of groupKeys) {
    const groupLearners = allActiveLearners.filter(
      (learner) => resolveBillingGroupKeyForRun(learner) === billingGroupKey
    );
    if (!groupLearners.length) continue;

    const accountNo =
      groupLearners
        .map((learner) => rowsById.get(learner.id)?.accountNo || "")
        .find((ref) => ref) ||
      String(groupLearners[0]?.familyAccount?.accountRef || "").trim().toUpperCase();

    const eligibleInGroup = groupLearners.filter((learner) => {
      const evalResult = getEligibility(learner);
      if (evalResult?.billableEligible) return true;
      if (evalResult?.skipReason === "DUPLICATE_INVOICE") return true;
      if (learnerHasInvoiceForPeriod(existingLedger, learner.id, invoicePeriod)) return true;
      return false;
    });

    const issues: string[] = [];
    let invoicedCount = 0;
    let skippedCount = 0;
    let expectedTotal = 0;
    let actualTotal = 0;

    for (const learner of eligibleInGroup) {
      const row = rowsById.get(learner.id);
      const evalResult = getEligibility(learner);
      const amount = evalResult?.amount || row?.amount || 0;

      if (!row) {
        if (learnerHasInvoiceForPeriod(existingLedger, learner.id, invoicePeriod)) {
          skippedCount += 1;
          continue;
        }
        issues.push(
          `Eligible sibling ${learnerFullName(learner)} (${learner.id}) missing from run scope`
        );
        continue;
      }

      expectedTotal += amount;
      if (row.status === "invoiced") {
        invoicedCount += 1;
        actualTotal += row.amount || 0;
      } else {
        skippedCount += 1;
      }
    }

    if (groupLearners.length > 1 && eligibleInGroup.length > 0) {
      const invoicedOrSkippedIds = new Set(
        eligibleInGroup
          .filter((learner) => {
            const row = rowsById.get(learner.id);
            if (row) return true;
            return learnerHasInvoiceForPeriod(existingLedger, learner.id, invoicePeriod);
          })
          .map((learner) => learner.id)
      );
      for (const learner of eligibleInGroup) {
        if (invoicedOrSkippedIds.has(learner.id)) continue;
        issues.push(
          `Eligible sibling ${learnerFullName(learner)} was not invoiced or explicitly skipped`
        );
      }
    }

    if (invoicedCount > 0 && !moneyEqual(expectedTotal, actualTotal)) {
      issues.push(
        `Account total mismatch: expected ${roundMoney(expectedTotal)}, actual ${roundMoney(actualTotal)}`
      );
    }

    const siblingValidationPassed = issues.length === 0;

    validations.push({
      accountNo,
      billingGroupKey,
      activeCount: groupLearners.length,
      eligibleCount: eligibleInGroup.length,
      invoicedCount,
      skippedCount,
      expectedTotal: roundMoney(expectedTotal),
      actualTotal: roundMoney(actualTotal),
      siblingValidationPassed,
      issues: issues.length ? issues : undefined,
    });
  }

  return validations;
}

export async function resolveLearnerAccountForRun(
  schoolId: string,
  learner: LearnerRecord
): Promise<{ accountNo: string; error?: string }> {
  const accountNo = await resolveOfficialBillingAccountRef(schoolId, {
    learnerId: learner.id,
    learner,
  });
  if (!accountNo) {
    return {
      accountNo: "",
      error:
        "Could not resolve an official billing account ref for this learner. Link the learner to a Kid-e-Sys family account before invoicing.",
    };
  }
  try {
    assertOfficialBillingAccountRef(schoolId, accountNo);
    return { accountNo };
  } catch (guardError) {
    const message =
      guardError instanceof Error ? guardError.message : "Invalid billing account ref";
    return { accountNo: "", error: message };
  }
}

function writeIntegrityAuditReport(
  schoolId: string,
  runId: string,
  result: InvoiceRunExecuteResult
): void {
  try {
    const storageDir = path.join(process.cwd(), "storage");
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    const filePath = path.join(
      storageDir,
      `invoice-run-execute-audit-${Date.now()}.json`
    );
    fs.writeFileSync(
      filePath,
      JSON.stringify({ schoolId, runId, at: new Date().toISOString(), result }, null, 2),
      "utf8"
    );
  } catch (error) {
    console.warn("[invoice-run-execute] Failed to write audit report:", error);
  }
}

export async function executeInvoiceRun(
  request: InvoiceRunExecuteRequest
): Promise<InvoiceRunExecuteResult> {
  const schoolId = String(request.schoolId || "").trim();
  const runId = String(request.runId || "").trim();
  const invoiceDate =
    normaliseIsoDate(request.invoiceDate) || new Date().toISOString().slice(0, 10);
  const invoicePeriod = normalizeInvoicePeriod(request.invoicePeriod, invoiceDate);
  const dryRun = request.dryRun === true;
  const scopeLearnerIds = Array.isArray(request.learnerIds)
    ? request.learnerIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];

  if (!schoolId) {
    return {
      success: false,
      dryRun,
      runId,
      invoicePeriod,
      integrity: {
        passed: false,
        eligibleCount: 0,
        invoiceLineCount: 0,
        skippedCount: 0,
        skipReasonCounts: {},
        processedCount: 0,
      },
      learners: [],
      accounts: [],
      error: "Missing schoolId",
      errorCode: "INVALID_REQUEST",
    };
  }

  if (!runId) {
    return {
      success: false,
      dryRun,
      runId,
      invoicePeriod,
      integrity: {
        passed: false,
        eligibleCount: 0,
        invoiceLineCount: 0,
        skippedCount: 0,
        skipReasonCounts: {},
        processedCount: 0,
      },
      learners: [],
      accounts: [],
      error: "Missing runId",
      errorCode: "INVALID_REQUEST",
    };
  }

  if (!invoicePeriod) {
    return {
      success: false,
      dryRun,
      runId,
      invoicePeriod: "",
      integrity: {
        passed: false,
        eligibleCount: 0,
        invoiceLineCount: 0,
        skippedCount: 0,
        skipReasonCounts: {},
        processedCount: 0,
      },
      learners: [],
      accounts: [],
      error: "Missing or invalid invoicePeriod",
      errorCode: "INVALID_REQUEST",
    };
  }

  const existingLedger = readSchoolLedger(schoolId);
  if (!dryRun && ledgerHasRunId(existingLedger, runId)) {
    const failed: InvoiceRunExecuteResult = {
      success: false,
      dryRun,
      runId,
      invoicePeriod,
      integrity: {
        passed: false,
        eligibleCount: 0,
        invoiceLineCount: 0,
        skippedCount: 0,
        skipReasonCounts: {},
        processedCount: 0,
      },
      learners: [],
      accounts: [],
      error: `Run id ${runId} already has ledger invoices`,
      errorCode: "DUPLICATE_RUN_ID",
    };
    writeIntegrityAuditReport(schoolId, runId, failed);
    return failed;
  }

  const allActiveLearners = (await prisma.learner.findMany({
    where: activeLearnerWhere(schoolId),
    select: {
      id: true,
      firstName: true,
      lastName: true,
      enrollmentStatus: true,
      admissionNo: true,
      idNumber: true,
      familyAccountId: true,
      familyAccount: { select: { accountRef: true } },
    },
  })) as LearnerRecord[];

  const learnersInScope =
    scopeLearnerIds.length > 0
      ? allActiveLearners.filter((learner) => scopeLearnerIds.includes(learner.id))
      : allActiveLearners;

  const inactiveInScope = scopeLearnerIds.length
    ? (
        await prisma.learner.findMany({
          where: { schoolId, id: { in: scopeLearnerIds }, enrollmentStatus: { not: "ACTIVE" } },
          select: {
            id: true,
            firstName: true,
            lastName: true,
            enrollmentStatus: true,
            admissionNo: true,
            idNumber: true,
            familyAccountId: true,
            familyAccount: { select: { accountRef: true } },
          },
        })
      ).map((learner) => learner as LearnerRecord)
    : [];

  const processedLearners = [...learnersInScope, ...inactiveInScope];

  const plansByLearnerId = await readSchoolBillingPlansResolved(schoolId);
  const explicitlyEmpty = await readExplicitlyEmptyBillingPlanLearnerIds(schoolId);
  const planIndexes = buildBillingPlanLookupIndexes(plansByLearnerId, allActiveLearners);
  const extraFeesByLearnerId = request.extraFeesByLearnerId || {};

  const learnerRows: InvoiceRunLearnerRow[] = [];
  const eligibilityByLearnerId = new Map<string, LearnerEligibilityResult>();

  for (const learner of allActiveLearners) {
    const planItems = resolveLearnerBillingPlanItems(
      learner,
      plansByLearnerId,
      planIndexes,
      explicitlyEmpty
    );
    const accountResolved = await resolveLearnerAccountForRun(schoolId, learner);
    const eligibility = evaluateLearnerEligibility({
      learner,
      planItems,
      accountNo: accountResolved.accountNo,
      accountError: accountResolved.error,
      invoicePeriod,
      existingLedger,
      extraFees: extraFeesByLearnerId[learner.id],
    });
    eligibilityByLearnerId.set(learner.id, eligibility);
  }

  for (const learner of processedLearners) {
    let eligibility = eligibilityByLearnerId.get(learner.id);
    let accountNo = String(learner.familyAccount?.accountRef || "").trim().toUpperCase();

    if (!eligibility) {
      const planItems = resolveLearnerBillingPlanItems(
        learner,
        plansByLearnerId,
        planIndexes,
        explicitlyEmpty
      );
      const accountResolved = await resolveLearnerAccountForRun(schoolId, learner);
      accountNo = accountResolved.accountNo;
      eligibility = evaluateLearnerEligibility({
        learner,
        planItems,
        accountNo: accountResolved.accountNo,
        accountError: accountResolved.error,
        invoicePeriod,
        existingLedger,
        extraFees: extraFeesByLearnerId[learner.id],
      });
      eligibilityByLearnerId.set(learner.id, eligibility);
    } else {
      const accountResolved = await resolveLearnerAccountForRun(schoolId, learner);
      accountNo = accountResolved.accountNo;
    }

    learnerRows.push({
      learnerId: learner.id,
      learnerName: learnerFullName(learner),
      accountNo,
      status: eligibility.status,
      amount: eligibility.amount > 0 ? eligibility.amount : undefined,
      skipReason: eligibility.skipReason,
      skipDetail: eligibility.skipDetail,
      billingGroupKey: resolveBillingGroupKeyForRun(learner),
    });
  }

  const accounts = validateSiblingAccounts(
    allActiveLearners,
    learnerRows,
    eligibilityByLearnerId,
    existingLedger,
    invoicePeriod
  );

  const integrity = validateIntegrityGate(learnerRows, accounts);

  const baseResult: InvoiceRunExecuteResult = {
    success: integrity.passed,
    dryRun,
    runId,
    invoicePeriod,
    integrity,
    learners: learnerRows,
    accounts,
  };

  if (!integrity.passed) {
    const siblingIssue = accounts.find((account) => !account.siblingValidationPassed);
    const failed: InvoiceRunExecuteResult = {
      ...baseResult,
      success: false,
      error: siblingIssue
        ? `Sibling validation failed for account ${siblingIssue.accountNo}`
        : "Invoice run integrity gate failed",
      errorCode: "INTEGRITY_GATE_FAILED",
    };
    writeIntegrityAuditReport(schoolId, runId, failed);
    return failed;
  }

  const toInvoice = learnerRows.filter((row) => row.status === "invoiced");
  if (!toInvoice.length) {
    return {
      ...baseResult,
      success: true,
      invoices: dryRun ? [] : undefined,
      createdCount: 0,
      duplicateCount: 0,
    };
  }

  const settings = await loadSchoolBillingSettings(schoolId);
  const existingInvoiceCount = listInvoices(schoolId).length;
  const description =
    String(request.description || "").trim() ||
    resolveInvoiceMessage(settings) ||
    `Invoice Run ${request.invoicePeriod}`;

  const builtEntries: BillingLedgerEntry[] = [];
  for (let index = 0; index < toInvoice.length; index += 1) {
    const row = toInvoice[index];
    const built = await buildInvoiceEntry(
      schoolId,
      {
        schoolId,
        learnerId: row.learnerId,
        accountNo: row.accountNo,
        amount: row.amount,
        date: invoiceDate,
        dueDate: request.dueDate,
        description,
        runId,
        invoicePeriod,
        lineKey: row.learnerId,
        id: buildInvoiceRunEntryId(runId, row.learnerId, row.accountNo, row.learnerId),
      },
      settings,
      existingInvoiceCount,
      index
    );
    if (!built.entry) {
      const failed: InvoiceRunExecuteResult = {
        ...baseResult,
        success: false,
        error: built.error || `Could not build invoice for learner ${row.learnerId}`,
        errorCode: "BUILD_FAILED",
      };
      writeIntegrityAuditReport(schoolId, runId, failed);
      return failed;
    }
    builtEntries.push(built.entry);
  }

  if (dryRun) {
    return {
      ...baseResult,
      success: true,
      invoices: builtEntries,
      createdCount: builtEntries.length,
      duplicateCount: 0,
    };
  }

  const ledgerBeforeCount = readSchoolLedger(schoolId).filter((e) => e.type === "invoice").length;
  const batch = appendSchoolEntriesSafe(schoolId, builtEntries);
  const ledgerAfterCount = readSchoolLedger(schoolId).filter((e) => e.type === "invoice").length;

  if (batch.createdCount !== builtEntries.length - batch.duplicateCount) {
    console.warn(
      "[invoice-run-execute] Unexpected batch result",
      batch.createdCount,
      builtEntries.length,
      batch.duplicateCount
    );
  }

  const executed: InvoiceRunExecuteResult = {
    ...baseResult,
    success: true,
    invoices: batch.results.map((result) => result.entry),
    createdCount: batch.createdCount,
    duplicateCount: batch.duplicateCount,
  };

  if (ledgerAfterCount < ledgerBeforeCount + batch.createdCount) {
    executed.success = false;
    executed.error = "Ledger write verification failed";
    executed.errorCode = "LEDGER_WRITE_FAILED";
    writeIntegrityAuditReport(schoolId, runId, executed);
    return executed;
  }

  return executed;
}

/** @internal Exported for unit tests — runs eligibility + integrity without DB or ledger writes. */
export function buildInvoiceRunPlanForTest(input: {
  allActiveLearners: LearnerRecord[];
  processedLearners: LearnerRecord[];
  plansByLearnerId: Record<string, StoredBillingPlanItem[]>;
  explicitlyEmpty: Set<string>;
  accountNoByLearnerId: Record<string, string>;
  accountErrorByLearnerId?: Record<string, string>;
  existingLedger: BillingLedgerEntry[];
  invoicePeriod: string;
  extraFeesByLearnerId?: Record<string, StoredBillingPlanItem[]>;
}): {
  learnerRows: InvoiceRunLearnerRow[];
  accounts: InvoiceRunAccountValidation[];
  integrity: InvoiceRunIntegrity;
} {
  const planIndexes = buildBillingPlanLookupIndexes(
    input.plansByLearnerId,
    input.allActiveLearners
  );
  const learnerRows: InvoiceRunLearnerRow[] = [];
  const eligibilityByLearnerId = new Map<string, LearnerEligibilityResult>();

  for (const learner of input.processedLearners) {
    const planItems = resolveLearnerBillingPlanItems(
      learner,
      input.plansByLearnerId,
      planIndexes,
      input.explicitlyEmpty
    );
    const accountNo = input.accountNoByLearnerId[learner.id] || "";
    const eligibility = evaluateLearnerEligibility({
      learner,
      planItems,
      accountNo,
      accountError: input.accountErrorByLearnerId?.[learner.id],
      invoicePeriod: input.invoicePeriod,
      existingLedger: input.existingLedger,
      extraFees: input.extraFeesByLearnerId?.[learner.id],
    });
    eligibilityByLearnerId.set(learner.id, eligibility);
    learnerRows.push({
      learnerId: learner.id,
      learnerName: learnerFullName(learner),
      accountNo,
      status: eligibility.status,
      amount: eligibility.amount > 0 ? eligibility.amount : undefined,
      skipReason: eligibility.skipReason,
      skipDetail: eligibility.skipDetail,
      billingGroupKey: resolveBillingGroupKeyForRun(learner),
    });
  }

  const accounts = validateSiblingAccounts(
    input.allActiveLearners,
    learnerRows,
    eligibilityByLearnerId,
    input.existingLedger,
    input.invoicePeriod,
    (learner) => {
      const planItems = resolveLearnerBillingPlanItems(
        learner,
        input.plansByLearnerId,
        planIndexes,
        input.explicitlyEmpty
      );
      return evaluateLearnerEligibility({
        learner,
        planItems,
        accountNo: input.accountNoByLearnerId[learner.id] || "",
        accountError: input.accountErrorByLearnerId?.[learner.id],
        invoicePeriod: input.invoicePeriod,
        existingLedger: input.existingLedger,
        extraFees: input.extraFeesByLearnerId?.[learner.id],
      });
    }
  );
  const integrity = validateIntegrityGate(learnerRows, accounts);
  return { learnerRows, accounts, integrity };
}
