import { SASAMS_CONFIDENCE_RULES } from "./sasamsMetadata";
import { normalizeSASAMSColumn } from "./sasamsNormalization";

function compactKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function scoreFilenameSignals(files: string[]): { score: number; hasStrongBrand: boolean } {
  let score = 0;
  let hasStrongBrand = false;

  for (const file of files) {
    const h = compactKey(file);
    const lower = String(file || "").trim().toLowerCase();
    if (!h) continue;

    if (h.includes("sasams") || lower.includes("sa-sams") || lower.includes("sa_sams")) {
      score += 4;
      hasStrongBrand = true;
    }

    if (h.includes("learnerregister") || (h.includes("learner") && h.includes("register"))) score += 2;
    if (h.includes("classlist") || (h.includes("class") && h.includes("list"))) score += 2;
    if (h.includes("educator")) score += 1;
    if (h.includes("parent") || h.includes("guardian")) score += 1;
    if (h.includes("contact") && (h.includes("list") || h.includes("parent"))) score += 2;
    if (h.includes("register") && !h.includes("registerclass")) score += 1;
  }

  return { score, hasStrongBrand };
}

function columnMatchesAny(column: string, keys: string[]): boolean {
  const compact = compactKey(column);
  if (!compact) return false;
  if (keys.some((k) => compact === k || compact.includes(k))) return true;
  const normalized = normalizeSASAMSColumn(column);
  return normalized !== null && keys.includes(normalized);
}

function countHeaderGroups(columns: string[]): number {
  const learnerKeys = [
    "learnername",
    "admissionnumber",
    "grade",
    "class",
    "gender",
    "fullName",
    "classroom",
    "learnerNumber",
    "idNumber",
  ];
  const parentKeys = ["parent", "guardian", "contact", "phone", "cell", "parentName", "parentPhone"];
  const adminKeys = ["emis", "registernumber", "admissiondate", "admissionDate", "learnerNumber"];

  let groups = 0;
  if (columns.some((c) => columnMatchesAny(c, learnerKeys))) groups += 1;
  if (columns.some((c) => columnMatchesAny(c, parentKeys))) groups += 1;
  if (columns.some((c) => columnMatchesAny(c, adminKeys))) groups += 1;
  return groups;
}

export type SASAMSDetectionResult = {
  detected: boolean;
  filenameScore: number;
  headerGroupsMatched: number;
  reason: string;
};

export function evaluateSASAMSDetection(input: {
  filenames: string[];
  columns?: string[];
}): SASAMSDetectionResult {
  const filenames = (input.filenames || []).map((f) => String(f).trim()).filter(Boolean);
  const columns = (input.columns || []).map((c) => String(c).trim()).filter(Boolean);

  const { score: filenameScore, hasStrongBrand } = scoreFilenameSignals(filenames);
  const headerGroupsMatched = columns.length > 0 ? countHeaderGroups(columns) : 0;

  const rules = SASAMS_CONFIDENCE_RULES;
  const filenamePass =
    filenameScore >= rules.minFilenameScore &&
    (hasStrongBrand || filenameScore >= rules.minFilenameScore + 2);

  const headerAssistedPass =
    headerGroupsMatched >= rules.minHeaderGroups && filenameScore >= 2;

  const detected = filenamePass || headerAssistedPass;

  let reason: string;
  if (detected) {
    reason = headerAssistedPass
      ? `SA-SAMS signals: filename score ${filenameScore}, ${headerGroupsMatched} header group(s).`
      : `Likely SA-SAMS export filenames (score ${filenameScore}).`;
  } else if (filenameScore > 0 || headerGroupsMatched > 0) {
    reason = `Insufficient confidence (filename score ${filenameScore}, header groups ${headerGroupsMatched}).`;
  } else {
    reason = "No SA-SAMS filename or header signals detected.";
  }

  return { detected, filenameScore, headerGroupsMatched, reason };
}

/** Conservative detect — returns false when uncertain. */
export function detectSASAMSExports(filenames: string[], columns?: string[]): boolean {
  return evaluateSASAMSDetection({ filenames, columns }).detected;
}
