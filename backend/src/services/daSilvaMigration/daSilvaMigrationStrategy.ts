import fs from "fs";
import path from "path";

/**
 * Da Silva Academy migration — SA-SAMS base + Kid-e-Sys billing only.
 *
 * Source of truth:
 * - SA-SAMS class lists → classrooms + class placement
 * - SA-SAMS learner register → learner master profile
 * - SA-SAMS parent/guardian → parents + parent-learner links (not archived-only)
 * - Kid-e-Sys → billing account numbers, family accounts, plans, balances, history
 *
 * Canonical Kid-e-Sys official CSV/ZIP export (child.csv, accounts.csv, …) is imported via
 * {@link importDaSilvaKidESysCsv} in daSilvaKidESysCsvImporter.ts — does not replace this path.
 */
export const DA_SILVA_MIGRATION_STRATEGY = "sasams-kideesys" as const;

export type DaSilvaMigrationStrategy = typeof DA_SILVA_MIGRATION_STRATEGY | "kideesys-dasilva";

export type DaSilvaSasamsIngestPaths = {
  classListDir: string;
  learnerRegister: string;
  parentRegister: string;
};

export type DaSilvaKideesysBillingPaths = {
  billingPlan: string;
  ageAnalysis: string;
  transactions: string;
};

export type DaSilvaStagedMigrationPaths = DaSilvaSasamsIngestPaths & DaSilvaKideesysBillingPaths;

export {
  DA_SILVA_BILLING_ACCOUNT_TARGET,
  DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
  DA_SILVA_BILLING_MATCH_MIN_RATIO,
  DA_SILVA_MIN_BILLING_MATCH_COUNT as DA_SILVA_BILLING_MATCH_MIN_MATCHED,
} from "./daSilvaConstants";

export function resolveDaSilvaSasamsPaths(root: string): DaSilvaSasamsIngestPaths {
  const base = root.trim();
  const sasamsDir = pathExists(pathJoin(base, "sasams"))
    ? pathJoin(base, "sasams")
    : base;

  const classListDir = firstExistingDir([
    pathJoin(sasamsDir, "class_lists"),
    pathJoin(sasamsDir, "class_list"),
    pathJoin(base, "sasams_class_lists"),
    pathJoin(base, "05_class_list"),
  ]);

  const learnerRegister = firstExistingFile([
    pathJoin(sasamsDir, "learner_register.xls"),
    pathJoin(sasamsDir, "learner_register.xlsx"),
    pathJoin(sasamsDir, "learners.xls"),
    pathJoin(base, "sasams_learner_register.xls"),
  ]);

  const parentRegister = firstExistingFile([
    pathJoin(sasamsDir, "parent_register.xls"),
    pathJoin(sasamsDir, "parent_contact.xls"),
    pathJoin(sasamsDir, "parents.xls"),
    pathJoin(base, "sasams_parent_register.xls"),
  ]);

  return { classListDir, learnerRegister, parentRegister };
}

/** Optional Kid-e-Sys files used for second-pass billing reconciliation (not SA-SAMS). */
export function discoverBillingSecondPassPaths(ageAnalysisPath: string): {
  billingPlan?: string;
  transactions?: string;
  contactList?: string;
} {
  const ageDir = path.dirname(ageAnalysisPath);
  const kideesysDir = path.basename(ageDir).toLowerCase().includes("age")
    ? path.dirname(ageDir)
    : ageDir;
  const root = path.dirname(kideesysDir);

  const billingPlan = firstExistingFileOptional([
    path.join(kideesysDir, "billing_plan_summary.xls"),
    path.join(kideesysDir, "billing_plan_summary_by_child.xls"),
    path.join(root, "03_billing_plan_summary_by_child", "billing_plan_summary_by_child.xls"),
    path.join(root, "03_billing_plan", "billing_plan.xls"),
  ]);

  const transactions = firstExistingFileOptional([
    path.join(kideesysDir, "transaction_list.xls"),
    path.join(root, "01_transaction_list", "transaction_list.xls"),
    path.join(root, "01_transactions.xls"),
  ]);

  const contactList = firstExistingFileOptional([
    path.join(kideesysDir, "contact_list.xls"),
    path.join(root, "04_contact_list", "contact_list.xls"),
    path.join(root, "04_contact_list.xls"),
  ]);

  return {
    ...(billingPlan ? { billingPlan } : {}),
    ...(transactions ? { transactions } : {}),
    ...(contactList ? { contactList } : {}),
  };
}

export function resolveDaSilvaKideesysBillingPaths(root: string): DaSilvaKideesysBillingPaths {
  const base = root.trim();
  return {
    billingPlan: firstExistingFile([
      pathJoin(base, "03_billing_plan_summary_by_child", "billing_plan_summary_by_child.xls"),
      pathJoin(base, "03_billing_plan", "billing_plan.xls"),
    ]),
    ageAnalysis: firstExistingFile([
      pathJoin(base, "02_account_list_age_analysis", "account_list_(age_analysis).xls"),
      pathJoin(base, "02_age_analysis.xls"),
    ]),
    transactions: firstExistingFile([
      pathJoin(base, "01_transaction_list", "transaction_list.xls"),
      pathJoin(base, "01_transactions.xls"),
    ]),
  };
}

function pathJoin(...parts: string[]): string {
  return path.join(...parts);
}

function pathExists(p: string): boolean {
  return fs.existsSync(p);
}

function firstExistingDir(candidates: string[]): string {
  for (const c of candidates) {
    if (pathExists(c)) return c;
  }
  return candidates[0];
}

function firstExistingFile(candidates: string[]): string {
  const found = firstExistingFileOptional(candidates);
  return found ?? candidates[0];
}

function firstExistingFileOptional(candidates: string[]): string | undefined {
  for (const c of candidates) {
    if (pathExists(c)) return c;
  }
  return undefined;
}
