import { superAdminApiFetch } from "../superAdminApi";
import type { MigrationFileColumnMappings } from "./buildEffectiveFileMappings";
import type { MigrationFilePreview } from "./universalMigrationPreview";
import type { UniversalMigrationUploadedFile } from "./universalMigrationUpload";

export type KidESysReadinessCategoryKey =
  | "learners"
  | "parents"
  | "billing"
  | "transactions"
  | "staff";

export type KidESysReadinessCategory = {
  key: KidESysReadinessCategoryKey;
  label: string;
  required: boolean;
  status: "found" | "missing";
  fileCount: number;
  rowCount: number;
  entityLabel?: string;
  entityCount?: number;
  statusBadge: "ready" | "missing" | "optional";
  detailLine: string;
};

export type KidESysCrossValidationWarning = {
  checkId: string;
  category: KidESysReadinessCategoryKey | "general";
  message: string;
  count: number;
  samples?: string[];
};

export type KidESysMigrationReadinessResult = {
  systemId: "kideesys";
  readyForMigration: boolean;
  proceedStatus: "ready" | "missing_required";
  proceedMessage: string;
  categories: KidESysReadinessCategory[];
  totals: {
    learners: number;
    parents: number;
    staff: number;
    billingRows: number;
    transactionRows: number;
  };
  crossValidationWarnings: KidESysCrossValidationWarning[];
  crossValidationScope: "preview_sample" | "full_file";
  evaluatedAt: string;
};

export async function fetchKidESysMigrationReadiness(input: {
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  uploadedFiles?: UniversalMigrationUploadedFile[];
  fullFileChecks?: boolean;
  filePaths?: Record<string, string>;
}): Promise<KidESysMigrationReadinessResult> {
  const data = (await superAdminApiFetch("/api/migration/adapters/kideesys/readiness", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as { success?: boolean; result?: KidESysMigrationReadinessResult; error?: string };

  if (!data?.success || !data.result) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String(data.error)
        : "Kid-e-Sys readiness check failed";
    throw new Error(message);
  }

  return data.result;
}
