import type { MigrationTargetField } from "../types/MigrationTargetField";

function compactColumnKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Compact header keys that map confidently to EduClear fields. */
const GENERIC_EXACT_COLUMN_MAP: Record<string, MigrationTargetField> = {
  learner: "fullName",
  student: "fullName",
  child: "fullName",
  pupil: "fullName",
  learnername: "fullName",
  studentname: "fullName",
  childname: "fullName",
  pupilname: "fullName",
  fullname: "fullName",
  firstname: "firstName",
  first: "firstName",
  givenname: "firstName",
  surname: "lastName",
  lastname: "lastName",
  familyname: "lastName",
  grade: "grade",
  year: "grade",
  form: "grade",
  class: "classroom",
  classroom: "classroom",
  registerclass: "classroom",
  homeroom: "classroom",
  gender: "gender",
  sex: "gender",
  dateofbirth: "dateOfBirth",
  dob: "dateOfBirth",
  birthdate: "dateOfBirth",
  birthday: "dateOfBirth",
  idnumber: "idNumber",
  idno: "idNumber",
  identitynumber: "idNumber",
  nationalid: "idNumber",
  status: "status",
  enrolment: "status",
  enrollment: "status",
  parent: "parentName",
  guardian: "parentName",
  mother: "parentName",
  father: "parentName",
  parentname: "parentName",
  guardianname: "parentName",
  contactname: "parentName",
  email: "parentEmail",
  parentemail: "parentEmail",
  mail: "parentEmail",
  cellphone: "parentPhone",
  cell: "parentPhone",
  mobile: "parentPhone",
  phone: "parentPhone",
  telephone: "parentPhone",
  tel: "parentPhone",
  parentphone: "parentPhone",
  address: "address",
  street: "address",
  suburb: "address",
  account: "accountNumber",
  accountnumber: "accountNumber",
  accountno: "accountNumber",
  familyaccount: "accountNumber",
  accno: "accountNumber",
  balance: "currentBalance",
  outstanding: "currentBalance",
  amountdue: "currentBalance",
  amountowing: "currentBalance",
  fees: "feeAmount",
  monthlyfee: "feeAmount",
  feeamount: "feeAmount",
  transactiondate: "transactionDate",
  transdate: "transactionDate",
  posteddate: "transactionDate",
  valuedate: "transactionDate",
  transactiontype: "transactionType",
  transtype: "transactionType",
  reference: "reference",
  ref: "reference",
  receipt: "reference",
  receiptno: "reference",
  invoice: "reference",
  invoiceno: "reference",
  description: "description",
  narrative: "description",
  details: "description",
  debit: "debit",
  credit: "credit",
  amount: "amount",
  paid: "credit",
  payment: "credit",
  runningbalance: "balance",
  ledgerbalance: "balance",
};

/**
 * Headers that may map to more than one EduClear field (e.g. name → learner or parent).
 * Mapping suggestions use lower confidence; adapter tests flag these for manual review.
 */
const GENERIC_AMBIGUOUS_KEYS = new Set([
  "name",
  "contact",
  "type",
  "date",
  "class",
  "balance",
  "amount",
  "paid",
  "payment",
]);

/** Ambiguous keys still resolve to a best-effort target for readiness counting. */
const GENERIC_AMBIGUOUS_TARGET: Partial<Record<string, MigrationTargetField>> = {
  name: "fullName",
  contact: "parentName",
  type: "transactionType",
  date: "transactionDate",
  class: "classroom",
  balance: "currentBalance",
  amount: "amount",
  paid: "credit",
  payment: "credit",
};

/**
 * Map a generic spreadsheet column header to an EduClear target field.
 * Returns null when uncertain — never guesses from partial tokens.
 */
export function normalizeGenericExcelColumn(column: string): MigrationTargetField | null {
  const key = compactColumnKey(column);
  if (!key) return null;

  if (GENERIC_EXACT_COLUMN_MAP[key]) {
    return GENERIC_EXACT_COLUMN_MAP[key];
  }

  if (GENERIC_AMBIGUOUS_KEYS.has(key)) {
    return GENERIC_AMBIGUOUS_TARGET[key] ?? null;
  }

  return null;
}

export function isAmbiguousGenericExcelColumn(column: string): boolean {
  const key = compactColumnKey(column);
  return key.length > 0 && GENERIC_AMBIGUOUS_KEYS.has(key);
}

export function normalizeGenericExcelColumns(columns: string[]): {
  mapped: Array<{ sourceColumn: string; targetField: MigrationTargetField; ambiguous: boolean }>;
  unmapped: string[];
  ambiguous: string[];
} {
  const mapped: Array<{
    sourceColumn: string;
    targetField: MigrationTargetField;
    ambiguous: boolean;
  }> = [];
  const unmapped: string[] = [];
  const ambiguous: string[] = [];

  for (const sourceColumn of columns) {
    const trimmed = String(sourceColumn || "").trim();
    if (!trimmed) continue;
    const targetField = normalizeGenericExcelColumn(trimmed);
    if (!targetField) {
      unmapped.push(trimmed);
      continue;
    }
    const isAmbiguous = isAmbiguousGenericExcelColumn(trimmed);
    mapped.push({ sourceColumn: trimmed, targetField, ambiguous: isAmbiguous });
    if (isAmbiguous) ambiguous.push(trimmed);
  }

  return { mapped, unmapped, ambiguous };
}

/** Share of non-empty columns with a generic normalization match (0–1). */
export function genericExcelNormalizationConfidence(columns: string[]): number {
  const cols = columns.map((c) => String(c || "").trim()).filter(Boolean);
  if (cols.length === 0) return 0;
  const mapped = cols.filter((c) => normalizeGenericExcelColumn(c) !== null).length;
  return mapped / cols.length;
}

const LEARNER_GROUP_KEYS = [
  "learner",
  "student",
  "child",
  "pupil",
  "fullname",
  "firstname",
  "grade",
  "classroom",
  "gender",
  "dateofbirth",
  "idnumber",
  "status",
  "name",
];
const PARENT_GROUP_KEYS = [
  "parent",
  "guardian",
  "mother",
  "father",
  "contact",
  "email",
  "phone",
  "mobile",
  "cell",
  "address",
];
const BILLING_GROUP_KEYS = [
  "account",
  "balance",
  "outstanding",
  "amountdue",
  "fees",
  "monthlyfee",
];
const TRANSACTION_GROUP_KEYS = [
  "transactiondate",
  "date",
  "type",
  "reference",
  "receipt",
  "invoice",
  "description",
  "debit",
  "credit",
  "amount",
  "paid",
  "payment",
];

const LEARNER_TARGETS: MigrationTargetField[] = [
  "fullName",
  "firstName",
  "lastName",
  "grade",
  "classroom",
  "gender",
  "dateOfBirth",
  "idNumber",
  "status",
];
const PARENT_TARGETS: MigrationTargetField[] = [
  "parentName",
  "parentEmail",
  "parentPhone",
  "address",
  "relationship",
];
const BILLING_TARGETS: MigrationTargetField[] = [
  "accountNumber",
  "accountName",
  "currentBalance",
  "feeAmount",
  "openingBalance",
  "billingPlan",
];
const TRANSACTION_TARGETS: MigrationTargetField[] = [
  "transactionDate",
  "transactionType",
  "reference",
  "description",
  "debit",
  "credit",
  "amount",
  "balance",
];

function columnMatchesGroup(
  column: string,
  keys: string[],
  targets: MigrationTargetField[]
): boolean {
  const compact = compactColumnKey(column);
  if (!compact) return false;
  if (keys.some((k) => compact === k || compact.includes(k))) return true;
  const normalized = normalizeGenericExcelColumn(column);
  return normalized !== null && targets.includes(normalized);
}

/** Distinct data domains (learner/parent/billing/transactions) recognised in headers. */
export function countGenericExcelHeaderGroups(columns: string[]): number {
  let groups = 0;
  if (columns.some((c) => columnMatchesGroup(c, LEARNER_GROUP_KEYS, LEARNER_TARGETS))) groups += 1;
  if (columns.some((c) => columnMatchesGroup(c, PARENT_GROUP_KEYS, PARENT_TARGETS))) groups += 1;
  if (columns.some((c) => columnMatchesGroup(c, BILLING_GROUP_KEYS, BILLING_TARGETS))) groups += 1;
  if (columns.some((c) => columnMatchesGroup(c, TRANSACTION_GROUP_KEYS, TRANSACTION_TARGETS)))
    groups += 1;
  return groups;
}
