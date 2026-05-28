import {
  buildMigrationLearnerMatchIndex,
  isKidESysLearnerClassListPreview,
  resolveLearnerForRow,
  type LearnerIndexEntry,
} from "../core/computeTransactionReadiness";
import {
  classifyTransactionReadiness,
  isLearnerEligibleForNewBilling,
  shouldTransactionBeHistoricalOnly,
} from "../core/transactionEligibility";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import { TRANSACTION_TARGET_FIELDS } from "../types/MigrationTargetField";
import {
  parseMigrationLearnerStatus,
  requiresReviewBeforeApply,
  type MigrationLearnerStatus,
} from "../types/MigrationLearnerStatus";
import type {
  MigrationFileColumnMappings,
  MigrationValidationIssue,
} from "../types/MigrationValidation";

const TRANSACTION_FIELDS = new Set<string>(TRANSACTION_TARGET_FIELDS);
const AMOUNT_FIELDS = new Set(["amount", "debit", "credit"]);

function cellString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return String(value).trim();
}

function isEmptyValue(value: unknown): boolean {
  return cellString(value).length === 0;
}

function isNumericValue(value: unknown): boolean {
  const s = cellString(value);
  if (!s) return false;
  const normalized = s.replace(/[\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
  if (normalized === "-" || normalized === "+") return false;
  return Number.isFinite(Number(normalized));
}

function buildTargetToSource(
  mappings: MigrationFileColumnMappings["mappings"]
): Map<MigrationTargetField, string> {
  const map = new Map<MigrationTargetField, string>();
  for (const m of mappings) {
    const target = String(m.targetField || "").trim() as MigrationTargetField;
    const source = String(m.sourceColumn || "").trim();
    if (target && source) map.set(target, source);
  }
  return map;
}

function getMappedValue(
  row: Record<string, unknown>,
  targetToSource: Map<MigrationTargetField, string>,
  field: MigrationTargetField
): unknown {
  const source = targetToSource.get(field);
  if (!source) return undefined;
  return row[source];
}

function hasTransactionMappings(targetToSource: Map<MigrationTargetField, string>): boolean {
  for (const field of TRANSACTION_FIELDS) {
    if (targetToSource.has(field as MigrationTargetField)) return true;
  }
  return false;
}

function issue(
  partial: Omit<MigrationValidationIssue, "severity"> & {
    severity: MigrationValidationIssue["severity"];
  }
): MigrationValidationIssue {
  return partial;
}

type ValidateLearnerStatusRowsInput = {
  preview: MigrationFilePreview;
  fileMappings: MigrationFileColumnMappings | undefined;
  rows: Record<string, unknown>[];
};

export function validateLearnerStatusRows(
  input: ValidateLearnerStatusRowsInput
): MigrationValidationIssue[] {
  const issues: MigrationValidationIssue[] = [];
  const targetToSource = buildTargetToSource(input.fileMappings?.mappings ?? []);
  const statusMapped = targetToSource.has("status");
  if (!statusMapped) {
    if (input.preview.category !== "learners") return issues;
    // Kid-e-Sys class lists represent active learners unless explicitly marked otherwise.
    if (isKidESysLearnerClassListPreview(input.preview)) return issues;
  }

  input.rows.forEach((row, idx) => {
    const rowNumber = idx + 1;
    const statusRaw = cellString(getMappedValue(row, targetToSource, "status"));
    const status = parseMigrationLearnerStatus(statusRaw, {
      fileCategory: input.preview.category,
    });
    if (requiresReviewBeforeApply(status)) {
      issues.push(
        issue({
          fileId: input.preview.fileId,
          filename: input.preview.filename,
          rowNumber,
          severity: "error",
          category: input.preview.category,
          field: "status",
          message: "Learner status is UNKNOWN — review enrollment before apply",
          value: statusRaw,
        })
      );
    }
  });

  return issues;
}

type ValidateTransactionReadinessRowsInput = {
  preview: MigrationFilePreview;
  fileMappings: MigrationFileColumnMappings | undefined;
  rows: Record<string, unknown>[];
  learnerIndex: Map<string, LearnerIndexEntry>;
  cutoverDate?: string | null;
};

export function validateTransactionReadinessRows(
  input: ValidateTransactionReadinessRowsInput
): MigrationValidationIssue[] {
  const { preview, rows, learnerIndex, cutoverDate } = input;
  const issues: MigrationValidationIssue[] = [];
  const targetToSource = buildTargetToSource(input.fileMappings?.mappings ?? []);
  const category = String(preview.category || "").trim();
  const isTransactionFile =
    category === "transactions" || hasTransactionMappings(targetToSource);
  if (!isTransactionFile) return issues;

  const hasAmountMapping = [...AMOUNT_FIELDS].some((f) =>
    targetToSource.has(f as MigrationTargetField)
  );
  const hasDateMapping = targetToSource.has("transactionDate");

  rows.forEach((row, idx) => {
    const rowNumber = idx + 1;
    const { entry, matched } = resolveLearnerForRow(row, targetToSource, learnerIndex);
    const learnerStatus: MigrationLearnerStatus | null = entry?.status ?? null;

    const txDateRaw = getMappedValue(row, targetToSource, "transactionDate");
    const datePresent = !hasDateMapping || !isEmptyValue(txDateRaw);

    if (hasDateMapping && isEmptyValue(txDateRaw)) {
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber,
          severity: "error",
          category: preview.category,
          field: "transactionDate",
          message: "Transaction date is required but missing",
          value: "",
        })
      );
    }

    if (hasAmountMapping) {
      let anyAmount = false;
      let anyInvalid = false;
      for (const field of AMOUNT_FIELDS) {
        if (!targetToSource.has(field as MigrationTargetField)) continue;
        const raw = getMappedValue(row, targetToSource, field as MigrationTargetField);
        const s = cellString(raw);
        if (!s) continue;
        anyAmount = true;
        if (!isNumericValue(raw)) anyInvalid = true;
      }
      if (!anyAmount) {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field: "amount",
            message: "Transaction amount is required but missing",
            value: "",
          })
        );
      } else if (anyInvalid) {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field: "amount",
            message: "Transaction amount is invalid",
            value: cellString(
              getMappedValue(row, targetToSource, "amount" as MigrationTargetField)
            ),
          })
        );
      }
    }

    const hasMatchField =
      targetToSource.has("accountNumber") ||
      targetToSource.has("idNumber") ||
      targetToSource.has("fullName");
    if (hasMatchField && !matched) {
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber,
          severity: "warning",
          category: preview.category,
          field: "accountNumber",
          message: "Transaction has no matching learner or billing account in staged files",
          value: "",
        })
      );
    }

    if (learnerStatus && requiresReviewBeforeApply(learnerStatus)) {
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber,
          severity: "warning",
          category: preview.category,
          field: "status",
          message: "Transaction linked to learner with UNKNOWN status — review before apply",
          value: learnerStatus,
        })
      );
    }

    const historicalOnly = shouldTransactionBeHistoricalOnly({
      learnerStatus,
      accountStatus: cellString(getMappedValue(row, targetToSource, "status")),
      transactionDate: txDateRaw,
      cutoverDate,
    });

    const bucket = classifyTransactionReadiness({
      learnerStatus,
      grade: entry?.grade,
      classroom: entry?.classroom,
      accountStatus: cellString(getMappedValue(row, targetToSource, "status")),
      transactionDate: txDateRaw,
      cutoverDate,
      hasLearnerOrAccountMatch: matched,
      amountValid: !hasAmountMapping || [...AMOUNT_FIELDS].some((f) => {
        if (!targetToSource.has(f as MigrationTargetField)) return false;
        const raw = getMappedValue(row, targetToSource, f as MigrationTargetField);
        return cellString(raw).length > 0 && isNumericValue(raw);
      }),
      datePresent,
    });

    if (
      learnerStatus === "HISTORICAL" &&
      !historicalOnly &&
      bucket === "eligibleActive"
    ) {
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber,
          severity: "warning",
          category: preview.category,
          field: "status",
          message:
            "Transaction mapped to HISTORICAL learner may affect new billing — will be treated as historical-only",
          value: learnerStatus,
        })
      );
    }

    if (
      learnerStatus &&
      (learnerStatus === "HISTORICAL" || learnerStatus === "UNENROLLED") &&
      !historicalOnly &&
      datePresent
    ) {
      const eligible = entry
        ? isLearnerEligibleForNewBilling({
            status: entry.status,
            grade: entry.grade,
            classroom: entry.classroom,
            accountStatus: entry.accountStatus,
          })
        : false;
      if (!eligible && bucket !== "historicalOnly") {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field: "status",
            message:
              "Active billing transaction is linked to inactive (historical/unenrolled) learner",
            value: learnerStatus,
          })
        );
      }
    }
  });

  return issues;
}

export type ValidateTransactionReadinessInput = {
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  rowsByFileId: Map<string, Record<string, unknown>[]>;
  cutoverDate?: string | null;
};

export function validateTransactionReadiness(
  input: ValidateTransactionReadinessInput
): MigrationValidationIssue[] {
  const mappingsByFile = new Map(input.mappings.map((m) => [m.fileId, m]));
  const learnerIndex = buildMigrationLearnerMatchIndex(
    input.previews,
    mappingsByFile,
    input.rowsByFileId
  );

  const issues: MigrationValidationIssue[] = [];
  for (const preview of input.previews) {
    const rows = input.rowsByFileId.get(preview.fileId) ?? preview.sampleRows;
    const fileMappings = mappingsByFile.get(preview.fileId);
    issues.push(
      ...validateLearnerStatusRows({ preview, fileMappings, rows }),
      ...validateTransactionReadinessRows({
        preview,
        fileMappings,
        rows,
        learnerIndex,
        cutoverDate: input.cutoverDate,
      })
    );
  }
  return issues;
}
