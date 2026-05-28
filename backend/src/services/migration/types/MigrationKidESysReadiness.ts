export type KidESysReadinessCategoryKey =
  | "learners"
  | "parents"
  | "billing"
  | "transactions"
  | "staff";

export type KidESysReadinessCategoryStatus = "found" | "missing";

export type KidESysReadinessStatusBadge = "ready" | "missing" | "optional";

export type KidESysReadinessCategory = {
  key: KidESysReadinessCategoryKey;
  label: string;
  required: boolean;
  status: KidESysReadinessCategoryStatus;
  fileCount: number;
  rowCount: number;
  entityLabel?: string;
  entityCount?: number;
  statusBadge: KidESysReadinessStatusBadge;
  detailLine: string;
};

export type KidESysCrossValidationWarning = {
  checkId: string;
  category: KidESysReadinessCategoryKey | "general";
  message: string;
  count: number;
  samples?: string[];
};

export type KidESysMigrationTotals = {
  learners: number;
  parents: number;
  staff: number;
  billingRows: number;
  transactionRows: number;
};

export type KidESysMigrationProceedStatus = "ready" | "missing_required";

export type KidESysMigrationReadinessResult = {
  systemId: "kideesys";
  readyForMigration: boolean;
  proceedStatus: KidESysMigrationProceedStatus;
  proceedMessage: string;
  categories: KidESysReadinessCategory[];
  totals: KidESysMigrationTotals;
  crossValidationWarnings: KidESysCrossValidationWarning[];
  crossValidationScope: "preview_sample" | "full_file";
  evaluatedAt: string;
};
