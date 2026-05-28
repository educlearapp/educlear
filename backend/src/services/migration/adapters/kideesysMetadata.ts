import type { MigrationFileCategory } from "../types/MigrationFile";
import type { MigrationTargetField } from "../types/MigrationTargetField";

/** Read-only Kid-e-Sys Adapter v1 metadata — no registry or live import side effects. */
export const KIDEESYS_ADAPTER_VERSION = "1";

export type KidESysSupportedExport = {
  exportKey: string;
  label: string;
  description: string;
  typicalCategories: MigrationFileCategory[];
};

export const KIDEESYS_SUPPORTED_EXPORTS: KidESysSupportedExport[] = [
  {
    exportKey: "account-list",
    label: "Account List",
    description: "Family or debtor accounts, often paired with age analysis.",
    typicalCategories: ["billing"],
  },
  {
    exportKey: "transaction-list",
    label: "Transaction List",
    description: "Receipts, invoices, and ledger movements.",
    typicalCategories: ["transactions"],
  },
  {
    exportKey: "contact-list",
    label: "Contact List",
    description: "Guardians and contact details linked to accounts.",
    typicalCategories: ["parents"],
  },
  {
    exportKey: "billing-plan",
    label: "Billing Plan",
    description: "Fee structures and billing configuration.",
    typicalCategories: ["billing"],
  },
  {
    exportKey: "age-analysis",
    label: "Age Analysis",
    description: "Outstanding balances by account at a point in time.",
    typicalCategories: ["billing"],
  },
];

export const KIDEESYS_SUPPORTED_FILES = [
  "Account List",
  "Transaction List",
  "Contact List",
  "Billing Plan",
  "Age Analysis",
  "Class list / learner registers (per grade)",
] as const;

export const KIDEESYS_SUPPORTED_CATEGORIES: MigrationFileCategory[] = [
  "learners",
  "parents",
  "billing",
  "transactions",
  "staff",
];

export const KIDEESYS_CONFIDENCE_RULES = {
  /** Minimum filename signal score before `detect()` may return true (filenames only). */
  minFilenameScore: 4,
  /** Minimum distinct header groups (learner/parent/billing/transactions) for column-assisted confidence. */
  minHeaderGroups: 2,
  /** Minimum share of preview columns that map via `normalizeKidESysColumn`. */
  minNormalizedColumnRatio: 0.25,
  /** Minimum mapped columns (absolute) for column recognition pass. */
  minNormalizedColumnCount: 2,
} as const;

/** Conservative Kid-e-Sys column label → EduClear target field aliases. */
export const KIDEESYS_KNOWN_ALIASES: Partial<Record<MigrationTargetField, string[]>> = {
  fullName: ["Child Name", "Learner Name", "Learner", "Student Name"],
  grade: ["Grade", "Year"],
  classroom: ["Class", "Register Class", "Classroom"],
  parentName: ["Contact Name", "Guardian", "Responsible Party", "Parent Name"],
  parentPhone: ["Mobile", "Cell", "Tel", "Cell No"],
  parentEmail: ["Email", "E-mail"],
  relationship: ["Relationship", "Relation", "Father", "Mother"],
  accountNumber: ["Account", "Account Number", "Account No", "Acc No"],
  currentBalance: ["Balance", "Outstanding", "Amount Owing"],
  reference: ["Receipt", "Receipt Number", "Invoice", "Invoice Number"],
  transactionDate: ["Transaction Date", "Date", "Posted Date"],
  amount: ["Amount", "Value", "Debit", "Credit"],
};

export const KIDEESYS_ADAPTER_METADATA = {
  adapterId: "kideesys-adapter-v1",
  version: KIDEESYS_ADAPTER_VERSION,
  source: "kideesys",
  capabilities: {
    detection: true,
    normalization: true,
    readiness: true,
    parse: false,
    map: false,
    validate: false,
    stage: false,
  },
  supportedFiles: [...KIDEESYS_SUPPORTED_FILES],
  supportedCategories: [...KIDEESYS_SUPPORTED_CATEGORIES],
  supportedExports: [...KIDEESYS_SUPPORTED_EXPORTS],
  confidenceRules: { ...KIDEESYS_CONFIDENCE_RULES },
  knownAliases: { ...KIDEESYS_KNOWN_ALIASES },
} as const;
