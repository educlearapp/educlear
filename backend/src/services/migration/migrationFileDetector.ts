import path from "path";
import { detectMigrationCategory, isLearnerClassExportFilename } from "./core/detectMigrationCategory";
import { detectKidESysExports } from "./adapters/kideesysDetection";
import { detectSASAMSExports } from "./adapters/sasamsDetection";
import { normalizeKidESysColumn } from "./adapters/kideesysNormalization";
import { normalizeSASAMSColumn } from "./adapters/sasamsNormalization";
import { normalizeGenericExcelColumn } from "./adapters/genericExcelNormalization";
import type { MigrationFileCategory } from "./types/MigrationFile";
import type {
  MigrationDataGroup,
  MigrationFileKind,
  MigrationSourceSystem,
} from "./migrationTypes";

function compactKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function detectMigrationFileKind(filename: string): MigrationFileKind {
  const ext = path.extname(String(filename || "")).toLowerCase();
  if (ext === ".csv") return "csv";
  if (ext === ".xls") return "xls";
  if (ext === ".xlsx") return "xlsx";
  if (ext === ".zip") return "zip";
  return "unknown";
}

type HeaderRule = {
  group: MigrationDataGroup;
  keys: string[];
  minMatches?: number;
};

const HEADER_RULES: HeaderRule[] = [
  {
    group: "parent_learner_links",
    keys: ["parentlearner", "parentchild", "guardianlearner", "linktype", "relationship"],
    minMatches: 2,
  },
  {
    group: "transaction_history",
    keys: ["transactionno", "transactionnumber", "receiptno", "paymentno", "journalno"],
  },
  {
    group: "journals",
    keys: ["journal", "debit", "credit", "journaldate"],
    minMatches: 2,
  },
  {
    group: "invoices",
    keys: ["invoiceno", "invoicenumber", "invoicedate", "duedate"],
    minMatches: 2,
  },
  {
    group: "payments",
    keys: ["receiptno", "paymentdate", "paymentmethod", "amountpaid"],
    minMatches: 2,
  },
  {
    group: "balances",
    keys: ["ageanalysis", "currentbalance", "days30", "days60", "days90", "days120"],
    minMatches: 2,
  },
  {
    group: "billing_plans",
    keys: ["billingplan", "monthlyfee", "feeamount", "planname"],
    minMatches: 2,
  },
  {
    group: "accounts",
    keys: ["accountnumber", "accountno", "accountholder", "familyaccount"],
    minMatches: 2,
  },
  {
    group: "parents",
    keys: ["parentname", "guardian", "father", "mother", "cellno", "parentemail"],
    minMatches: 2,
  },
  {
    group: "learners",
    keys: [
      "learnername",
      "firstname",
      "surname",
      "idnumber",
      "dateofbirth",
      "admissionnumber",
      "grade",
      "class",
    ],
    minMatches: 2,
  },
  {
    group: "classrooms",
    keys: ["classroom", "registerclass", "homeroom", "classlist"],
  },
  {
    group: "staff",
    keys: ["employee", "staffname", "payroll", "teacher"],
  },
];

function normalizeHeader(column: string, source: MigrationSourceSystem): string {
  const trimmed = String(column || "").trim();
  if (!trimmed) return "";
  if (source === "kideesys") {
    const k = normalizeKidESysColumn(trimmed);
    if (k) return compactKey(k);
  }
  if (source === "sasams") {
    const s = normalizeSASAMSColumn(trimmed);
    if (s) return compactKey(s);
  }
  const g = normalizeGenericExcelColumn(trimmed);
  if (g) return compactKey(g);
  return compactKey(trimmed);
}

function scoreHeaderGroup(
  columns: string[],
  source: MigrationSourceSystem,
  rule: HeaderRule
): number {
  const normalized = columns.map((c) => normalizeHeader(c, source)).filter(Boolean);
  let matches = 0;
  for (const key of rule.keys) {
    if (normalized.some((col) => col === key || col.includes(key))) matches += 1;
  }
  const min = rule.minMatches ?? 1;
  return matches >= min ? matches : 0;
}

export function detectSourceSystemFromFiles(
  filenames: string[],
  columnsByFile?: Map<string, string[]>
): MigrationSourceSystem {
  const names = filenames.map((f) => String(f).trim()).filter(Boolean);
  if (detectSASAMSExports(names)) return "sasams";
  if (detectKidESysExports(names)) return "kideesys";

  const allColumns: string[] = [];
  if (columnsByFile) {
    for (const cols of columnsByFile.values()) allColumns.push(...cols);
  }
  const compactCols = allColumns.map((c) => compactKey(c));
  if (compactCols.some((c) => c.includes("sasams") || c.includes("emis"))) return "sasams";
  if (
    compactCols.some(
      (c) =>
        c.includes("kideesys") ||
        c.includes("accountlist") ||
        c.includes("billingplan")
    )
  ) {
    return "kideesys";
  }

  const hasCsvOnly = names.every((n) => /\.csv$/i.test(n));
  if (hasCsvOnly && names.length > 0) return "generic-csv";
  if (names.some((n) => /\.xlsx?$/i.test(n))) return "generic-excel";
  return "unknown";
}

export function detectMigrationDataGroup(input: {
  filename: string;
  columns: string[];
  sourceSystem: MigrationSourceSystem;
  rowCount?: number;
}): MigrationDataGroup {
  const filename = String(input.filename || "");
  const haystack = compactKey(filename);
  const basename = path.basename(filename, path.extname(filename));
  const source = input.sourceSystem;
  const columns = input.columns ?? [];

  if (isLearnerClassExportFilename(haystack, basename) && columns.length > 0) {
    return "classrooms";
  }

  let best: { group: MigrationDataGroup; score: number } = { group: "unknown", score: 0 };
  for (const rule of HEADER_RULES) {
    const score = scoreHeaderGroup(columns, source, rule);
    if (score > best.score) best = { group: rule.group, score };
  }
  if (best.score > 0) return best.group;

  const filenameCategory = detectMigrationCategory(filename);
  switch (filenameCategory) {
    case "learners":
      return haystack.includes("class") && !haystack.includes("register") ? "classrooms" : "learners";
    case "parents":
      return haystack.includes("link") ? "parent_learner_links" : "parents";
    case "billing":
      return haystack.includes("age") || haystack.includes("balance") ? "balances" : "accounts";
    case "transactions":
      return haystack.includes("invoice")
        ? "invoices"
        : haystack.includes("payment") || haystack.includes("receipt")
          ? "payments"
          : "transaction_history";
    case "staff":
      return "staff";
    default:
      return "unknown";
  }
}

export function dataGroupToFileCategory(group: MigrationDataGroup): MigrationFileCategory {
  switch (group) {
    case "classrooms":
    case "learners":
      return "learners";
    case "parents":
    case "parent_learner_links":
      return "parents";
    case "accounts":
    case "billing_plans":
    case "balances":
      return "billing";
    case "invoices":
    case "payments":
    case "journals":
    case "transaction_history":
      return "transactions";
    case "staff":
      return "staff";
    default:
      return "unknown";
  }
}

/** Import order: demographics before billing; never derive billing from class lists. */
export const MIGRATION_DATA_GROUP_PRIORITY: Record<MigrationDataGroup, number> = {
  classrooms: 10,
  learners: 20,
  parents: 30,
  parent_learner_links: 40,
  accounts: 50,
  billing_plans: 60,
  balances: 70,
  invoices: 80,
  payments: 90,
  journals: 95,
  transaction_history: 100,
  staff: 5,
  unknown: 999,
};

export const MIGRATION_SOURCE_PRIORITY: Record<MigrationSourceSystem, number> = {
  sasams: 100,
  kideesys: 80,
  "generic-excel": 50,
  "generic-csv": 40,
  unknown: 0,
};

export function sortFilesByImportPriority<
  T extends { dataGroup: MigrationDataGroup; sourceSystem: MigrationSourceSystem }
>(files: T[]): T[] {
  return [...files].sort((a, b) => {
    const g =
      MIGRATION_DATA_GROUP_PRIORITY[a.dataGroup] -
      MIGRATION_DATA_GROUP_PRIORITY[b.dataGroup];
    if (g !== 0) return g;
    return (
      MIGRATION_SOURCE_PRIORITY[b.sourceSystem] -
      MIGRATION_SOURCE_PRIORITY[a.sourceSystem]
    );
  });
}
