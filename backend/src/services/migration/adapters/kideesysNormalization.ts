import type { MigrationTargetField } from "../types/MigrationTargetField";

function compactColumnKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Exact compact keys for conservative Kid-e-Sys header matching. */
const KIDEESYS_EXACT_COLUMN_MAP: Record<string, MigrationTargetField> = {
  fullname: "fullName",
  childname: "fullName",
  learnername: "fullName",
  studentname: "fullName",
  learner: "fullName",
  contactname: "parentName",
  parentname: "parentName",
  guardian: "parentName",
  guardianname: "parentName",
  relationship: "relationship",
  mobile: "parentPhone",
  cell: "parentPhone",
  cellno: "parentPhone",
  telephone: "parentPhone",
  email: "parentEmail",
  account: "accountNumber",
  accountnumber: "accountNumber",
  accountno: "accountNumber",
  accno: "accountNumber",
  balance: "currentBalance",
  outstanding: "currentBalance",
  amountowing: "currentBalance",
  receipt: "reference",
  receiptnumber: "reference",
  invoicenumber: "reference",
  invoice: "reference",
  transactiondate: "transactionDate",
  transdate: "transactionDate",
  grade: "grade",
  year: "grade",
  class: "classroom",
  classroom: "classroom",
  amount: "amount",
  debit: "debit",
  credit: "credit",
  description: "description",
  transactiontype: "transactionType",
  enrolmentdate: "admissionDate",
  enrollmentdate: "admissionDate",
};

/**
 * Map a Kid-e-Sys export column header to an EduClear target field.
 * Returns null when uncertain — never guesses from partial tokens.
 */
export function normalizeKidESysColumn(
  column: string,
  category?: string
): MigrationTargetField | null {
  const key = compactColumnKey(column);
  if (!key) return null;
  if (key === "date" && String(category || "").trim() === "transactions") {
    return "transactionDate";
  }
  return KIDEESYS_EXACT_COLUMN_MAP[key] ?? null;
}

export function normalizeKidESysColumns(columns: string[]): {
  mapped: Array<{ sourceColumn: string; targetField: MigrationTargetField }>;
  unmapped: string[];
} {
  const mapped: Array<{ sourceColumn: string; targetField: MigrationTargetField }> = [];
  const unmapped: string[] = [];

  for (const sourceColumn of columns) {
    const trimmed = String(sourceColumn || "").trim();
    if (!trimmed) continue;
    const targetField = normalizeKidESysColumn(trimmed);
    if (targetField) {
      mapped.push({ sourceColumn: trimmed, targetField });
    } else {
      unmapped.push(trimmed);
    }
  }

  return { mapped, unmapped };
}

/** Share of non-empty columns with a confident Kid-e-Sys normalization (0–1). */
export function kidESysNormalizationConfidence(columns: string[]): number {
  const cols = columns.map((c) => String(c || "").trim()).filter(Boolean);
  if (cols.length === 0) return 0;
  const mapped = cols.filter((c) => normalizeKidESysColumn(c) !== null).length;
  return mapped / cols.length;
}
