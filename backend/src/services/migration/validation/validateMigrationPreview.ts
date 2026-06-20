import { readMigrationFileRows } from "../core/readMigrationFileRows";
import { validateTransactionReadiness } from "./validateTransactionReadiness";
import type { MigrationFile } from "../types/MigrationFile";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type {
  MigrationFileColumnMappings,
  MigrationValidationIssue,
  MigrationValidationMode,
  MigrationValidationResult,
  MigrationValidationSeverity,
  MigrationValidationSummary,
} from "../types/MigrationValidation";

export type ValidateMigrationPreviewInput = {
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  mode?: MigrationValidationMode;
  /** Optional fileId → staging path overrides for full-file mode */
  filePaths?: Record<string, string>;
  /** ISO date (YYYY-MM-DD). Transactions before cutover are historical-only. */
  cutoverDate?: string | null;
};

const MAX_ISSUES_SHOWN = 500;

const LEARNER_NAME_FIELDS: MigrationTargetField[] = ["firstName", "lastName", "fullName"];
const GRADE_CLASS_FIELDS: MigrationTargetField[] = ["grade", "classroom"];
const NUMERIC_BALANCE_FIELDS: MigrationTargetField[] = [
  "openingBalance",
  "currentBalance",
  "balance",
];
const NUMERIC_AMOUNT_FIELDS: MigrationTargetField[] = ["amount", "debit", "credit", "feeAmount"];

const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Loose SA / international phone: digits with optional +, spaces, dashes; at least 9 digits. */
function isValidPhone(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  return /^[\d\s+\-().]+$/.test(raw.trim());
}

/** Temporary: log first parentPhone failure per process (diagnostics only). */
let parentPhoneDiagLogged = false;

function parentPhoneFailureReason(raw: string): string {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 9) return `too_few_digits (${digits.length})`;
  if (digits.length > 15) return `too_many_digits (${digits.length})`;
  if (!/^[\d\s+\-().]+$/.test(trimmed)) {
    const illegal = [...trimmed].filter((c) => !/[\d\s+\-().]/.test(c));
    const unique = [...new Set(illegal)];
    const detail = unique
      .map((c) => `${JSON.stringify(c)} U+${c.charCodeAt(0).toString(16)}`)
      .join(", ");
    return `illegal_characters: ${detail || "(none)"}`;
  }
  return "unknown";
}

function logParentPhoneDiagnosticOnce(
  raw: string,
  ctx: { filename: string; rowNumber: number }
): void {
  if (parentPhoneDiagLogged) return;
  parentPhoneDiagLogged = true;
  const normalized = cellString(raw);
  const valid = isValidPhone(normalized);
  const reason = valid ? "ok" : parentPhoneFailureReason(normalized);
  console.log("[migration][parentPhone-diagnostic] (first failure only)");
  console.log("RAW:", JSON.stringify(raw));
  console.log("NORMALIZED:", JSON.stringify(normalized));
  console.log("VALID:", valid);
  console.log("REASON:", reason);
  console.log("FILE:", ctx.filename, "ROW:", ctx.rowNumber);
}

function cellString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function isEmptyValue(value: unknown): boolean {
  return cellString(value).length === 0;
}

function isNumericValue(value: unknown): boolean {
  const s = cellString(value);
  if (!s) return true;
  const normalized = s.replace(/[\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
  if (normalized === "-" || normalized === "+") return false;
  const n = Number(normalized);
  return Number.isFinite(n);
}

function isValidDateValue(value: unknown): boolean {
  const s = cellString(value);
  if (!s) return true;
  if (/^\d{4,5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (Number.isFinite(serial) && serial > 20000 && serial < 80000) return true;
  }
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return true;
  const dmy = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `20${dmy[3]}` : dmy[3]);
    const month = Number(dmy[2]) - 1;
    const day = Number(dmy[1]);
    const d = new Date(year, month, day);
    return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
  }
  return false;
}

function issue(
  partial: Omit<MigrationValidationIssue, "severity"> & { severity: MigrationValidationSeverity }
): MigrationValidationIssue {
  return partial;
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

function compactColumnKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function sourceColumnForTarget(
  preview: MigrationFilePreview,
  rows: Record<string, unknown>[],
  aliases: string[]
): string {
  const candidates = [
    ...(Array.isArray(preview.columns) ? preview.columns : []),
    ...Object.keys(rows[0] ?? {}),
  ];
  const aliasKeys = new Set(aliases.map(compactColumnKey));
  for (const candidate of candidates) {
    const source = String(candidate || "").trim();
    if (source && aliasKeys.has(compactColumnKey(source))) return source;
  }
  return "";
}

function applyLearnerAdapterFallbackMappings(
  preview: MigrationFilePreview,
  rows: Record<string, unknown>[],
  targetToSource: Map<MigrationTargetField, string>
): void {
  if (String(preview.category || "").trim() !== "learners") return;
  if (!targetToSource.has("fullName")) {
    const source = sourceColumnForTarget(preview, rows, ["fullName", "Learner Name", "Child Name"]);
    if (source) targetToSource.set("fullName", source);
  }
  if (!targetToSource.has("classroom")) {
    const source = sourceColumnForTarget(preview, rows, ["classroom", "Classroom", "Class"]);
    if (source) targetToSource.set("classroom", source);
  }
}

function isSiblingAccountsReport(filename: string): boolean {
  const haystack = compactColumnKey(filename);
  return haystack.includes("siblingaccounts") || (haystack.includes("sibling") && haystack.includes("account"));
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

function buildSummary(
  issues: MigrationValidationIssue[],
  mode: MigrationValidationMode,
  rowsChecked: number,
  shownCount: number,
  truncated: boolean
): MigrationValidationSummary {
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;
  return {
    mode,
    rowsChecked,
    totalIssues: issues.length,
    errors,
    warnings,
    info,
    canProceed: errors === 0,
    issuesShown: shownCount,
    ...(truncated
      ? {
          issuesTruncated: true,
          truncationMessage: `Showing first ${MAX_ISSUES_SHOWN} of ${issues.length} issues. Fix these and re-validate to see more.`,
        }
      : {}),
  };
}

function applyIssueLimit(
  issues: MigrationValidationIssue[],
  mode: MigrationValidationMode,
  rowsChecked: number
): MigrationValidationResult {
  const truncated = issues.length > MAX_ISSUES_SHOWN;
  const shownIssues = truncated ? issues.slice(0, MAX_ISSUES_SHOWN) : issues;
  return {
    summary: buildSummary(issues, mode, rowsChecked, shownIssues.length, truncated),
    issues: shownIssues,
  };
}

type ValidateFileRowsInput = {
  preview: MigrationFilePreview;
  fileMappings: MigrationFileColumnMappings | undefined;
  rows: Record<string, unknown>[];
  fullFile: boolean;
};

function validateFileRows(input: ValidateFileRowsInput): MigrationValidationIssue[] {
  const { preview, fileMappings, rows, fullFile } = input;
  const issues: MigrationValidationIssue[] = [];
  const mappings = fileMappings?.mappings ?? [];
  const targetToSource = buildTargetToSource(mappings);
  applyLearnerAdapterFallbackMappings(preview, rows, targetToSource);

  if (mappings.length === 0) {
    issues.push(
      issue({
        fileId: preview.fileId,
        filename: preview.filename,
        rowNumber: 0,
        severity: "warning",
        category: preview.category,
        field: "mappings",
        message: "No column mappings selected for this file",
        value: "",
      })
    );
    return issues;
  }

  const mappedSources = new Set(mappings.map((m) => m.sourceColumn));
  const scopeLabel = fullFile ? "file" : "sample";

  for (const sourceColumn of mappedSources) {
    if (rows.length === 0) continue;
    const allEmpty = rows.every((row) => isEmptyValue(row[sourceColumn]));
    if (allEmpty) {
      const target =
        mappings.find((m) => m.sourceColumn === sourceColumn)?.targetField ?? sourceColumn;
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber: 0,
          severity: "warning",
          category: preview.category,
          field: String(target),
          message: fullFile
            ? `Mapped column "${sourceColumn}" is empty in all file rows`
            : `Mapped column "${sourceColumn}" is empty in all sample rows`,
          value: "",
        })
      );
    }
  }

  const hasNameMapping = LEARNER_NAME_FIELDS.some((f) => targetToSource.has(f));
  const hasGradeOrClassMapping = GRADE_CLASS_FIELDS.some((f) => targetToSource.has(f));

  const idNumbers: { value: string; rowNumber: number }[] = [];
  const accountNumbers: { value: string; rowNumber: number }[] = [];

  rows.forEach((row, idx) => {
    const rowNumber = idx + 1;

    if (hasNameMapping) {
      const first = cellString(getMappedValue(row, targetToSource, "firstName"));
      const last = cellString(getMappedValue(row, targetToSource, "lastName"));
      const full = cellString(getMappedValue(row, targetToSource, "fullName"));
      const hasFirst = targetToSource.has("firstName");
      const hasLast = targetToSource.has("lastName");
      const hasFull = targetToSource.has("fullName");

      if (hasFull && !full && !first && !last) {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field: "fullName",
            message: "Learner name is required but missing",
            value: "",
          })
        );
      } else if ((hasFirst || hasLast) && !full) {
        if ((hasFirst && !first) || (hasLast && !last)) {
          issues.push(
            issue({
              fileId: preview.fileId,
              filename: preview.filename,
              rowNumber,
              severity: "error",
              category: preview.category,
              field: hasFirst && !first ? "firstName" : "lastName",
              message: "Learner name is required but missing",
              value: "",
            })
          );
        }
      }
    } else if (
      preview.category === "learners" &&
      rows.length > 0 &&
      rowNumber === 1
    ) {
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber: 0,
          severity: "info",
          category: preview.category,
          field: "fullName",
          message: "No learner name field mapped (firstName, lastName, or fullName)",
          value: "",
        })
      );
    }

    if (hasGradeOrClassMapping) {
      for (const field of GRADE_CLASS_FIELDS) {
        if (!targetToSource.has(field)) continue;
        const raw = getMappedValue(row, targetToSource, field);
        if (isEmptyValue(raw)) {
          issues.push(
            issue({
              fileId: preview.fileId,
              filename: preview.filename,
              rowNumber,
              severity: "warning",
              category: preview.category,
              field,
              message: `${field === "grade" ? "Grade" : "Classroom"} is mapped but empty on this row`,
              value: "",
            })
          );
        }
      }
    }

    if (targetToSource.has("parentPhone")) {
      const raw = cellString(getMappedValue(row, targetToSource, "parentPhone"));
      if (raw && !isValidPhone(raw)) {
        logParentPhoneDiagnosticOnce(raw, {
          filename: preview.filename,
          rowNumber,
        });
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field: "parentPhone",
            message: "Parent phone number is invalid",
            value: raw,
          })
        );
      }
    }

    if (targetToSource.has("parentEmail")) {
      const raw = cellString(getMappedValue(row, targetToSource, "parentEmail"));
      if (raw && !EMAIL_RE.test(raw)) {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field: "parentEmail",
            message: "Parent email address is invalid",
            value: raw,
          })
        );
      }
    }

    for (const field of NUMERIC_BALANCE_FIELDS) {
      if (!targetToSource.has(field)) continue;
      const raw = getMappedValue(row, targetToSource, field);
      const s = cellString(raw);
      if (s && !isNumericValue(raw)) {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field,
            message: "Balance value is not numeric",
            value: s,
          })
        );
      }
    }

    for (const field of NUMERIC_AMOUNT_FIELDS) {
      if (!targetToSource.has(field)) continue;
      const raw = getMappedValue(row, targetToSource, field);
      const s = cellString(raw);
      if (s && !isNumericValue(raw)) {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field,
            message: "Amount value is not numeric",
            value: s,
          })
        );
      }
    }

    if (targetToSource.has("transactionDate")) {
      const raw = getMappedValue(row, targetToSource, "transactionDate");
      const s = cellString(raw);
      if (s && !isValidDateValue(raw)) {
        issues.push(
          issue({
            fileId: preview.fileId,
            filename: preview.filename,
            rowNumber,
            severity: "error",
            category: preview.category,
            field: "transactionDate",
            message: "Transaction date is invalid or unparseable",
            value: s,
          })
        );
      }
    }

    if (targetToSource.has("idNumber")) {
      const raw = cellString(getMappedValue(row, targetToSource, "idNumber"));
      if (raw) idNumbers.push({ value: raw.toLowerCase(), rowNumber });
    }

    if (targetToSource.has("accountNumber")) {
      const raw = cellString(getMappedValue(row, targetToSource, "accountNumber"));
      if (raw) accountNumbers.push({ value: raw.toLowerCase(), rowNumber });
    }
  });

  const dupId = findDuplicates(idNumbers);
  for (const { value, rows: dupRows } of dupId) {
    issues.push(
      issue({
        fileId: preview.fileId,
        filename: preview.filename,
        rowNumber: dupRows[0],
        severity: "error",
        category: preview.category,
        field: "idNumber",
        message: `Duplicate ID number in ${scopeLabel} (rows ${dupRows.join(", ")})`,
        value,
      })
    );
  }

  const dupAcc = findDuplicates(accountNumbers);
  for (const { value, rows: dupRows } of dupAcc) {
    const siblingAccounts = isSiblingAccountsReport(preview.filename);
    issues.push(
      issue({
        fileId: preview.fileId,
        filename: preview.filename,
        rowNumber: dupRows[0],
        severity: siblingAccounts ? "info" : "warning",
        category: preview.category,
        field: "accountNumber",
        message: siblingAccounts
          ? `Multiple learners share the same billing account in Sibling Accounts (rows ${dupRows.join(", ")})`
          : `Duplicate account number in ${scopeLabel} (rows ${dupRows.join(", ")})`,
        value,
      })
    );
  }

  return issues;
}

function findDuplicates(
  entries: { value: string; rowNumber: number }[]
): { value: string; rows: number[] }[] {
  const byValue = new Map<string, number[]>();
  for (const e of entries) {
    const list = byValue.get(e.value) ?? [];
    list.push(e.rowNumber);
    byValue.set(e.value, list);
  }
  const out: { value: string; rows: number[] }[] = [];
  for (const [value, rows] of byValue) {
    if (rows.length > 1) out.push({ value, rows });
  }
  return out;
}

function emptyMappingsResult(mode: MigrationValidationMode): MigrationValidationResult {
  return {
    summary: {
      mode,
      rowsChecked: 0,
      totalIssues: 0,
      errors: 0,
      warnings: 0,
      info: 0,
      canProceed: false,
      issuesShown: 0,
    },
    issues: [],
  };
}

function validateAllPreviews(
  previews: MigrationFilePreview[],
  mappingsByFile: Map<string, MigrationFileColumnMappings>,
  mode: MigrationValidationMode,
  rowsByFileId: Map<string, Record<string, unknown>[]>,
  cutoverDate?: string | null
): MigrationValidationResult {
  const issues: MigrationValidationIssue[] = [];
  let rowsChecked = 0;

  for (const preview of previews) {
    const rows = rowsByFileId.get(preview.fileId) ?? preview.sampleRows;
    rowsChecked += rows.length;
    issues.push(
      ...validateFileRows({
        preview,
        fileMappings: mappingsByFile.get(preview.fileId),
        rows,
        fullFile: mode === "full",
      })
    );
  }

  issues.push(
    ...validateTransactionReadiness({
      previews,
      mappings: [...mappingsByFile.values()],
      rowsByFileId,
      cutoverDate,
    })
  );

  return applyIssueLimit(issues, mode, rowsChecked);
}

/**
 * Validate preview sample rows against selected column mappings (no DB, no staging).
 */
export function validateMigrationPreview(
  input: ValidateMigrationPreviewInput
): MigrationValidationResult {
  const mode: MigrationValidationMode = input.mode === "full" ? "full" : "preview";
  const previews = Array.isArray(input.previews) ? input.previews : [];
  const mappingsList = Array.isArray(input.mappings) ? input.mappings : [];
  const mappingsByFile = new Map(
    mappingsList.map((m) => [String(m.fileId || "").trim(), m])
  );

  if (mappingsList.length === 0) {
    return emptyMappingsResult(mode);
  }

  if (mode === "full") {
    throw new Error("Use validateMigrationFull for full-file validation");
  }

  const rowsByFileId = new Map<string, Record<string, unknown>[]>();
  for (const preview of previews) {
    rowsByFileId.set(preview.fileId, preview.sampleRows);
  }

  return validateAllPreviews(previews, mappingsByFile, "preview", rowsByFileId, input.cutoverDate);
}

/**
 * Re-read staged files and validate every data row (no DB, no staging).
 */
export async function validateMigrationFull(
  input: ValidateMigrationPreviewInput
): Promise<MigrationValidationResult> {
  const previews = Array.isArray(input.previews) ? input.previews : [];
  const mappingsList = Array.isArray(input.mappings) ? input.mappings : [];
  const filePaths = input.filePaths ?? {};
  const mappingsByFile = new Map(
    mappingsList.map((m) => [String(m.fileId || "").trim(), m])
  );

  if (mappingsList.length === 0) {
    return emptyMappingsResult("full");
  }

  const issues: MigrationValidationIssue[] = [];
  const rowsByFileId = new Map<string, Record<string, unknown>[]>();
  let rowsChecked = 0;

  for (const preview of previews) {
    const pathValue = String(preview.path || filePaths[preview.fileId] || "").trim();
    if (!pathValue) {
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber: 0,
          severity: "error",
          category: preview.category,
          field: "path",
          message: "Staged file path missing — re-upload before full-file validation",
          value: "",
        })
      );
      rowsByFileId.set(preview.fileId, preview.sampleRows);
      continue;
    }

    const file: MigrationFile = {
      id: preview.fileId,
      filename: preview.filename,
      mimeType: "",
      size: 0,
      uploadedAt: new Date(),
      category: preview.category as MigrationFile["category"],
      path: pathValue,
    };

    const parsed = await readMigrationFileRows(file);
    rowsChecked += parsed.rowCount;
    rowsByFileId.set(preview.fileId, parsed.rows);

    for (const pi of parsed.parseIssues ?? []) {
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber: pi.rowNumber,
          severity: pi.severity,
          category: preview.category,
          field: pi.field,
          message: pi.message,
          value: "",
        })
      );
    }

    const parseIssueMessages = new Set(
      (parsed.parseIssues ?? []).map((pi) => pi.message)
    );
    for (const warn of parsed.warnings) {
      if (parseIssueMessages.has(warn)) continue;
      issues.push(
        issue({
          fileId: preview.fileId,
          filename: preview.filename,
          rowNumber: 0,
          severity: "warning",
          category: preview.category,
          field: "file",
          message: warn,
          value: "",
        })
      );
    }

    const previewForValidation: MigrationFilePreview = {
      ...preview,
      columns: parsed.columns.length > 0 ? parsed.columns : preview.columns,
      rowCount: parsed.rowCount,
    };

    issues.push(
      ...validateFileRows({
        preview: previewForValidation,
        fileMappings: mappingsByFile.get(preview.fileId),
        rows: parsed.rows,
        fullFile: true,
      })
    );
  }

  issues.push(
    ...validateTransactionReadiness({
      previews,
      mappings: mappingsList,
      rowsByFileId,
      cutoverDate: input.cutoverDate,
    })
  );

  return applyIssueLimit(issues, "full", rowsChecked);
}

/**
 * Validate migration data in preview or full mode.
 */
export async function validateMigration(
  input: ValidateMigrationPreviewInput
): Promise<MigrationValidationResult> {
  const mode: MigrationValidationMode = input.mode === "full" ? "full" : "preview";
  if (mode === "full") {
    return validateMigrationFull(input);
  }
  return validateMigrationPreview({ ...input, mode: "preview" });
}
