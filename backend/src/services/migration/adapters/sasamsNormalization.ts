import type { MigrationTargetField } from "../types/MigrationTargetField";

function compactColumnKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Exact compact keys for conservative SA-SAMS header matching. */
const SASAMS_EXACT_COLUMN_MAP: Record<string, MigrationTargetField> = {
  learnername: "fullName",
  studentname: "fullName",
  pupilname: "fullName",
  nameandsurname: "fullName",
  admissionnumber: "learnerNumber",
  admissionno: "learnerNumber",
  registernumber: "learnerNumber",
  learnernumber: "learnerNumber",
  grade: "grade",
  year: "grade",
  form: "grade",
  class: "classroom",
  classname: "classroom",
  registerclass: "classroom",
  gender: "gender",
  sex: "gender",
  guardian: "parentName",
  guardianname: "parentName",
  parentname: "parentName",
  mother: "parentName",
  father: "parentName",
  cell: "parentPhone",
  cellphone: "parentPhone",
  mobile: "parentPhone",
  telephone: "parentPhone",
  tel: "parentPhone",
  admissiondate: "admissionDate",
  dateofadmission: "admissionDate",
  emis: "idNumber",
  emisnumber: "idNumber",
};

/** Headers that may map but need manual review in suggestions. */
const SASAMS_AMBIGUOUS_COMPACT_KEYS = new Set([
  "parent",
  "contact",
  "phone",
  "register",
  "name",
]);

/**
 * Map an SA-SAMS export column header to an EduClear target field.
 * Returns null when uncertain — never guesses from partial tokens.
 */
export function normalizeSASAMSColumn(column: string): MigrationTargetField | null {
  const key = compactColumnKey(column);
  if (!key) return null;
  return SASAMS_EXACT_COLUMN_MAP[key] ?? null;
}

export function isAmbiguousSASAMSColumn(column: string): boolean {
  const key = compactColumnKey(column);
  if (!key) return false;
  if (SASAMS_AMBIGUOUS_COMPACT_KEYS.has(key)) return true;
  const target = normalizeSASAMSColumn(column);
  if (!target) return false;
  return (
    key === "parent" ||
    key === "contact" ||
    key === "phone" ||
    key === "register" ||
    (key === "name" && target === "fullName")
  );
}

export function isSASAMSAdministrativeColumn(column: string): boolean {
  const key = compactColumnKey(column);
  if (!key) return false;
  return (
    key.includes("emis") ||
    key.includes("admissionnumber") ||
    key.includes("admissionno") ||
    key.includes("registernumber") ||
    key.includes("admissiondate") ||
    key.includes("learnernumber")
  );
}

export function normalizeSASAMSColumns(columns: string[]): {
  mapped: Array<{ sourceColumn: string; targetField: MigrationTargetField }>;
  unmapped: string[];
  administrative: string[];
} {
  const mapped: Array<{ sourceColumn: string; targetField: MigrationTargetField }> = [];
  const unmapped: string[] = [];
  const administrative: string[] = [];

  for (const sourceColumn of columns) {
    const trimmed = String(sourceColumn || "").trim();
    if (!trimmed) continue;
    if (isSASAMSAdministrativeColumn(trimmed)) {
      administrative.push(trimmed);
    }
    const targetField = normalizeSASAMSColumn(trimmed);
    if (targetField) {
      mapped.push({ sourceColumn: trimmed, targetField });
    } else {
      unmapped.push(trimmed);
    }
  }

  return { mapped, unmapped, administrative };
}

/** Share of non-empty columns with a confident SA-SAMS normalization (0–1). */
export function sasamsNormalizationConfidence(columns: string[]): number {
  const cols = columns.map((c) => String(c || "").trim()).filter(Boolean);
  if (cols.length === 0) return 0;
  const mapped = cols.filter((c) => normalizeSASAMSColumn(c) !== null).length;
  return mapped / cols.length;
}
