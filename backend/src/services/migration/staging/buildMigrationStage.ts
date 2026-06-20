import { randomUUID } from "crypto";
import { computeTransactionReadiness } from "../core/computeTransactionReadiness";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type {
  MigrationStage,
  MigrationStagedCounts,
  MigrationTransactionReadinessCounts,
} from "../types/MigrationStage";
import type {
  MigrationFileColumnMappings,
  MigrationValidationIssue,
  MigrationValidationSummary,
} from "../types/MigrationValidation";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import {
  BILLING_TARGET_FIELDS,
  LEARNER_TARGET_FIELDS,
  PARENT_TARGET_FIELDS,
  TRANSACTION_TARGET_FIELDS,
} from "../types/MigrationTargetField";
import { buildPaymentReceiveListStageData } from "../core/paymentReceiveListReconciliation";

export type BuildMigrationStageInput = {
  sourceSystem: string;
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  validationSummary: MigrationValidationSummary;
  issues?: MigrationValidationIssue[];
  /** ISO date (YYYY-MM-DD) — transactions before cutover are historical-only. */
  cutoverDate?: string | null;
  /** Full-file rows per fileId (required for accurate transaction readiness counts). */
  rowsByFileId?: Map<string, Record<string, unknown>[]>;
};

const EMPTY_TRANSACTION_READINESS: MigrationTransactionReadinessCounts = {
  historicalOnlyTransactions: 0,
  eligibleActiveTransactions: 0,
  blockedTransactions: 0,
  unmatchedTransactions: 0,
};

const LEARNER_FIELDS = new Set<string>(LEARNER_TARGET_FIELDS);
const PARENT_FIELDS = new Set<string>(PARENT_TARGET_FIELDS);
const BILLING_FIELDS = new Set<string>(BILLING_TARGET_FIELDS);
const TRANSACTION_FIELDS = new Set<string>(TRANSACTION_TARGET_FIELDS);

/** Ensure transaction_list Date column maps when present (Kid-e-Sys export header). */
export function enrichKidESysTransactionDateMappings(
  previews: MigrationFilePreview[],
  mappings: MigrationFileColumnMappings[]
): MigrationFileColumnMappings[] {
  const previewByFileId = new Map(previews.map((p) => [p.fileId, p]));
  return mappings.map((fileMappings) => {
    const preview = previewByFileId.get(fileMappings.fileId);
    if (!preview || String(preview.category || "").trim() !== "transactions") {
      return fileMappings;
    }
    const existing = fileMappings.mappings ?? [];
    if (existing.some((m) => String(m.targetField || "").trim() === "transactionDate")) {
      return fileMappings;
    }
    const dateColumn = (preview.columns ?? []).find(
      (col) => String(col || "").trim().toLowerCase() === "date"
    );
    if (!dateColumn) return fileMappings;
    return {
      ...fileMappings,
      mappings: [
        ...existing,
        { sourceColumn: dateColumn, targetField: "transactionDate" },
      ],
    };
  });
}

function computeStagedCounts(previews: MigrationFilePreview[]): MigrationStagedCounts {
  const counts: MigrationStagedCounts = {
    learners: 0,
    parents: 0,
    billingAccounts: 0,
    transactions: 0,
    staff: 0,
    historical: 0,
  };

  for (const preview of previews) {
    const rowCount = Math.max(0, Number(preview.rowCount) || 0);
    if (rowCount === 0) continue;

    const category = String(preview.category || "").trim();
    switch (category) {
      case "learners":
        counts.learners += rowCount;
        break;
      case "parents":
        counts.parents += rowCount;
        break;
      case "billing":
        counts.billingAccounts += rowCount;
        break;
      case "transactions":
        counts.transactions += rowCount;
        break;
      case "payment-receive-list":
        break;
      case "staff":
        counts.staff += rowCount;
        break;
      case "historical":
        counts.historical += rowCount;
        break;
      default:
        break;
    }
  }

  return counts;
}

function collectWarnings(
  previews: MigrationFilePreview[],
  issues?: MigrationValidationIssue[]
): string[] {
  const seen = new Set<string>();
  const warnings: string[] = [];

  const push = (msg: string) => {
    const trimmed = msg.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    warnings.push(trimmed);
  };

  for (const preview of previews) {
    for (const w of preview.warnings ?? []) {
      push(`${preview.filename}: ${w}`);
    }
  }

  for (const issue of issues ?? []) {
    if (issue.severity === "warning") {
      push(`${issue.filename} (row ${issue.rowNumber}): ${issue.message}`);
    }
  }

  return warnings;
}

function normalizeCutoverDate(raw: string | null | undefined): string | undefined {
  const s = String(raw || "").trim();
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function buildMigrationStage(input: BuildMigrationStageInput): MigrationStage {
  const sourceSystem = String(input.sourceSystem || "").trim() || "unknown";
  const previews = input.previews ?? [];
  const mappings = input.mappings ?? [];
  const validationSummary = input.validationSummary;
  const cutoverDate = normalizeCutoverDate(input.cutoverDate);

  const rowsByFileId =
    input.rowsByFileId ??
    new Map(previews.map((p) => [p.fileId, p.sampleRows ?? []]));

  const effectiveMappings = enrichKidESysTransactionDateMappings(previews, mappings);
  const stagedCounts = computeStagedCounts(previews);
  const paymentReceiveList = buildPaymentReceiveListStageData({
    previews,
    rowsByFileId,
  });
  const transactionReadiness = computeTransactionReadiness({
    previews,
    mappings: effectiveMappings,
    rowsByFileId,
    cutoverDate,
  });
  const warnings = collectWarnings(previews, input.issues);

  if (transactionReadiness.historicalOnlyTransactions > 0) {
    warnings.push(
      "Historical learner transactions are preserved for history only and will not affect active head count or new billing."
    );
  }

  if (paymentReceiveList) {
    warnings.push(
      "Payment Receive List PDF is optional reconciliation-only reference data and does not affect balances."
    );
  }

  return {
    stageId: randomUUID(),
    createdAt: new Date().toISOString(),
    sourceSystem,
    ...(cutoverDate ? { cutoverDate } : {}),
    files: previews.map((p) => {
      const pathValue = String((p as { path?: string }).path || "").trim();
      return {
        fileId: p.fileId,
        filename: p.filename,
        category: p.category,
        rowCount: Math.max(0, Number(p.rowCount) || 0),
        ...(pathValue ? { path: pathValue } : {}),
      };
    }),
    mappings: effectiveMappings,
    validationSummary,
    stagedCounts,
    transactionReadiness,
    ...(paymentReceiveList ? { paymentReceiveList } : {}),
    warnings,
    canApply: validationSummary.canProceed,
  };
}

export { EMPTY_TRANSACTION_READINESS };

/** Classify a mapped target field (for tests / tooling). */
export function migrationTargetCategory(
  field: MigrationTargetField
): "learner" | "parent" | "billing" | "transaction" | "other" {
  if (LEARNER_FIELDS.has(field)) return "learner";
  if (PARENT_FIELDS.has(field)) return "parent";
  if (BILLING_FIELDS.has(field)) return "billing";
  if (TRANSACTION_FIELDS.has(field)) return "transaction";
  return "other";
}
