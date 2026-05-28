import { evaluateKidESysDetection } from "./kideesysDetection";
import { evaluateSASAMSDetection } from "./sasamsDetection";
import {
  countGenericExcelHeaderGroups,
  genericExcelNormalizationConfidence,
} from "./genericExcelNormalization";
import { GENERIC_EXCEL_CONFIDENCE_RULES, GENERIC_EXCEL_SUPPORTED_FILE_TYPES } from "./genericExcelMetadata";

function compactKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function isGenericSpreadsheetFilename(filename: string): boolean {
  const lower = String(filename || "").trim().toLowerCase();
  return GENERIC_EXCEL_SUPPORTED_FILE_TYPES.some((ext) => lower.endsWith(`.${ext}`));
}

function hasReadableHeaders(columns: string[]): boolean {
  return columns.map((c) => String(c || "").trim()).filter(Boolean).length > 0;
}

function isStronglyKnownNonGenericSystem(input: {
  filenames: string[];
  columns: string[];
}): boolean {
  const kid = evaluateKidESysDetection({
    filenames: input.filenames,
    columns: input.columns,
  });
  if (kid.detected) return true;
  const sasams = evaluateSASAMSDetection({
    filenames: input.filenames,
    columns: input.columns,
  });
  return sasams.detected;
}

export type GenericExcelDetectionResult = {
  detected: boolean;
  spreadsheetFileCount: number;
  headerCount: number;
  headerGroupsMatched: number;
  normalizationRatio: number;
  excludedByKnownSystem: boolean;
  reason: string;
};

export function evaluateGenericExcelDetection(input: {
  filenames: string[];
  columns?: string[];
  /** When true, require column preview (headers) for a positive detect. */
  requireReadableStructure?: boolean;
}): GenericExcelDetectionResult {
  const filenames = (input.filenames || []).map((f) => String(f).trim()).filter(Boolean);
  const columns = (input.columns || []).map((c) => String(c).trim()).filter(Boolean);
  const requireReadableStructure = input.requireReadableStructure !== false;

  const spreadsheetFiles = filenames.filter(isGenericSpreadsheetFilename);
  const spreadsheetFileCount = spreadsheetFiles.length;
  const hasSpreadsheet = spreadsheetFileCount > 0;
  const headerCount = columns.length;
  const headersReadable = hasReadableHeaders(columns);
  const headerGroupsMatched = headersReadable ? countGenericExcelHeaderGroups(columns) : 0;
  const normalizationRatio = headersReadable ? genericExcelNormalizationConfidence(columns) : 0;
  const excludedByKnownSystem = isStronglyKnownNonGenericSystem({ filenames, columns });

  const rules = GENERIC_EXCEL_CONFIDENCE_RULES;

  let detected = false;
  let reason: string;

  if (!hasSpreadsheet) {
    reason = "No CSV/XLS/XLSX filenames in upload set.";
  } else if (excludedByKnownSystem) {
    reason =
      "Files match a known system export (e.g. Kid-e-Sys, SA-SAMS) — use that adapter instead of generic fallback.";
  } else if (filenames.length > spreadsheetFileCount) {
    reason = "Mixed file types — generic adapter expects CSV/XLS/XLSX only.";
  } else if (requireReadableStructure && !headersReadable) {
    reason = "Spreadsheet extension detected but column headers are not available yet — load previews first.";
  } else if (requireReadableStructure && headerGroupsMatched < rules.minHeaderGroups) {
    reason = `Readable headers but no learner/parent/billing/transaction field groups recognised (${headerGroupsMatched} group(s)).`;
  } else if (
    requireReadableStructure &&
    normalizationRatio < rules.minNormalizedColumnRatio
  ) {
    reason = `Low column recognition (${Math.round(normalizationRatio * 100)}%) — verify header row or map manually.`;
  } else if (!requireReadableStructure) {
    reason = "Spreadsheet filenames only — load previews to confirm readable structure.";
  } else {
    detected = true;
    reason = `Generic spreadsheet: ${spreadsheetFileCount} file(s), ${headerGroupsMatched} header group(s), ${Math.round(normalizationRatio * 100)}% columns recognised.`;
  }

  return {
    detected,
    spreadsheetFileCount,
    headerCount,
    headerGroupsMatched,
    normalizationRatio,
    excludedByKnownSystem,
    reason,
  };
}

/** Conservative detect — returns false when structure is unreadable or another system is likely. */
export function detectGenericExcelExports(filenames: string[], columns?: string[]): boolean {
  const cols = columns ?? [];
  const requireReadableStructure = cols.length > 0;
  return evaluateGenericExcelDetection({
    filenames,
    columns: cols,
    requireReadableStructure,
  }).detected;
}
