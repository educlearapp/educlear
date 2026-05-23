import {
  classifyVarianceGroup,
  isMergedFamilyAccount,
  learnersPerAccount,
  type DaSilvaVarianceRowInput,
} from "./daSilvaVarianceClassification";
import type { ParsedBillingAccount, ParsedTransaction } from "./parsers";

type ReconciliationRow = {
  accountNo: string;
  fullName: string;
  ageAnalysisBalance: number;
  ledgerBalanceFromImport: number;
  variance: number;
};

type StagedLearnerAccount = {
  accountNo: string;
};

export const KIDESYS_OPENING_BALANCE_LABEL = "Kid-e-Sys opening balance adjustment";
export const DA_SILVA_MIGRATION_CUTOVER_DATE = "2026-05-23";

export type DaSilvaOpeningBalanceAdjustment = {
  accountNo: string;
  fullName: string;
  varianceGroup: "activeAgeAnalysisMismatch";
  beforeBalance: number;
  afterBalance: number;
  adjustmentAmount: number;
  entryType: "invoice" | "credit";
  date: string;
  description: string;
  reference: string;
};

export type DaSilvaOpeningBalanceSummary = {
  cutoverDate: string;
  adjustmentCount: number;
  /** Sum of absolute adjustment amounts (R). */
  totalAdjustmentValue: number;
  /** Signed sum of adjustments (R). */
  netAdjustmentValue: number;
  totalBeforeBalance: number;
  totalAfterBalance: number;
  /**
   * Non-zero age-analysis accounts where |age - (ledger + adjustment)| > 1c after the plan.
   * Must be 0 when every active mismatch is covered and merged-family rows already reconcile.
   */
  ageAnalysisRemainingVarianceCount: number;
};

export type DaSilvaOpeningBalancePlan = {
  label: string;
  summary: DaSilvaOpeningBalanceSummary;
  adjustments: DaSilvaOpeningBalanceAdjustment[];
  /** Every planned adjustment closes ledger import → age analysis within 1c. */
  allAdjustmentsBalanceToAgeAnalysis: boolean;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function openingBalanceReference(accountNo: string): string {
  return `KIDESYS-OPENING-${accountNo}`;
}

/**
 * Age-analysis accounts with a Kid-e-Sys balance still out of line after opening adjustments.
 * Skips zero-balance / overpaid-credit rows (no age-analysis debt to align).
 */
export function countAgeAnalysisVarianceAfterAdjustments(
  reconciliationRows: ReconciliationRow[],
  adjustments: DaSilvaOpeningBalanceAdjustment[],
  ageAnalysisAccountNos: Set<string>
): number {
  const adjustmentByAccount = new Map(
    adjustments.map((a) => [a.accountNo, a.adjustmentAmount])
  );
  let remaining = 0;
  for (const row of reconciliationRows) {
    if (!ageAnalysisAccountNos.has(row.accountNo)) continue;
    if (Math.abs(row.ageAnalysisBalance) <= 0.01) continue;
    const adjustmentAmount = adjustmentByAccount.get(row.accountNo) || 0;
    const projectedLedger = roundMoney(row.ledgerBalanceFromImport + adjustmentAmount);
    const variance = roundMoney(row.ageAnalysisBalance - projectedLedger);
    if (Math.abs(variance) > 0.01) remaining++;
  }
  return remaining;
}

export function buildOpeningBalancePlan(opts: {
  accounts: ParsedBillingAccount[];
  transactions: ParsedTransaction[];
  reconciliationRows: ReconciliationRow[];
  learners: StagedLearnerAccount[];
  mergedFamilyAccountNos: string[];
  cutoverDate?: string;
}): DaSilvaOpeningBalancePlan {
  const cutoverDate = opts.cutoverDate || DA_SILVA_MIGRATION_CUTOVER_DATE;
  const ageAnalysisAccountNos = new Set(opts.accounts.map((a) => a.accountNo));
  const mergedFamilyAccountNos = new Set(opts.mergedFamilyAccountNos);
  const learnerCountByAccount = learnersPerAccount(opts.learners);
  const accountNameByNo = new Map(opts.accounts.map((a) => [a.accountNo, a.fullName]));

  const adjustments: DaSilvaOpeningBalanceAdjustment[] = [];

  for (const row of opts.reconciliationRows) {
    if (!ageAnalysisAccountNos.has(row.accountNo)) continue;

    const fullName = row.fullName || accountNameByNo.get(row.accountNo) || "";
    const inAgeAnalysis = true;
    const mergedFamily = isMergedFamilyAccount(
      row.accountNo,
      fullName,
      learnerCountByAccount,
      mergedFamilyAccountNos
    );

    const varianceInput: DaSilvaVarianceRowInput = {
      accountNo: row.accountNo,
      fullName,
      ageAnalysisBalance: row.ageAnalysisBalance,
      ledgerBalanceFromImport: row.ledgerBalanceFromImport,
      variance: row.variance,
    };

    const varianceGroup = classifyVarianceGroup(
      varianceInput,
      inAgeAnalysis,
      opts.transactions,
      mergedFamily
    );

    if (varianceGroup !== "activeAgeAnalysisMismatch") continue;

    const beforeBalance = roundMoney(row.ledgerBalanceFromImport);
    const afterBalance = roundMoney(row.ageAnalysisBalance);
    const adjustmentAmount = roundMoney(afterBalance - beforeBalance);

    if (Math.abs(adjustmentAmount) <= 0.01) continue;

    const entryType: "invoice" | "credit" = adjustmentAmount > 0 ? "invoice" : "credit";

    adjustments.push({
      accountNo: row.accountNo,
      fullName,
      varianceGroup: "activeAgeAnalysisMismatch",
      beforeBalance,
      afterBalance,
      adjustmentAmount,
      entryType,
      date: cutoverDate,
      description: KIDESYS_OPENING_BALANCE_LABEL,
      reference: openingBalanceReference(row.accountNo),
    });
  }

  adjustments.sort((a, b) => a.accountNo.localeCompare(b.accountNo));

  const totalBeforeBalance = roundMoney(
    adjustments.reduce((s, a) => s + a.beforeBalance, 0)
  );
  const totalAfterBalance = roundMoney(
    adjustments.reduce((s, a) => s + a.afterBalance, 0)
  );
  const netAdjustmentValue = roundMoney(
    adjustments.reduce((s, a) => s + a.adjustmentAmount, 0)
  );
  const totalAdjustmentValue = roundMoney(
    adjustments.reduce((s, a) => s + Math.abs(a.adjustmentAmount), 0)
  );

  const allAdjustmentsBalanceToAgeAnalysis = adjustments.every(
    (a) => Math.abs(a.beforeBalance + a.adjustmentAmount - a.afterBalance) <= 0.01
  );
  const ageAnalysisRemainingVarianceCount = countAgeAnalysisVarianceAfterAdjustments(
    opts.reconciliationRows,
    adjustments,
    ageAnalysisAccountNos
  );

  return {
    label: KIDESYS_OPENING_BALANCE_LABEL,
    summary: {
      cutoverDate,
      adjustmentCount: adjustments.length,
      totalAdjustmentValue,
      netAdjustmentValue,
      totalBeforeBalance,
      totalAfterBalance,
      ageAnalysisRemainingVarianceCount,
    },
    adjustments,
    allAdjustmentsBalanceToAgeAnalysis,
  };
}
