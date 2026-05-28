import { superAdminApiFetch } from "../superAdminApi";
import type { MigrationFileColumnMappings } from "./buildEffectiveFileMappings";
import type { MigrationAdapterReadinessTemplate } from "./universalMigrationReadiness";
import type { MigrationFilePreview } from "./universalMigrationPreview";
import type { UniversalMigrationUploadedFile } from "./universalMigrationUpload";
import type { MigrationValidationSummary } from "./universalMigrationValidate";

export type MigrationAdapterTestStatus = "pass" | "warning" | "fail" | "not_supported";

export type MigrationAdapterTestCheck = {
  id: string;
  label: string;
  status: MigrationAdapterTestStatus;
  message: string;
  details?: string;
};

export type MigrationAdapterTestRecommendation = "ready" | "partial" | "needs_research";

export type MigrationAdapterTestResult = {
  systemId: string;
  testedAt: string;
  overallStatus: MigrationAdapterTestStatus;
  recommendation: MigrationAdapterTestRecommendation;
  checks: MigrationAdapterTestCheck[];
  passed: MigrationAdapterTestCheck[];
  warnings: MigrationAdapterTestCheck[];
  failed: MigrationAdapterTestCheck[];
  notSupported: MigrationAdapterTestCheck[];
};

function parseError(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    return String((data as { error: string }).error);
  }
  return fallback;
}

export async function fetchMigrationAdapterTest(input: {
  systemId: string;
  uploadedFiles: UniversalMigrationUploadedFile[];
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  validationSummary?: MigrationValidationSummary | null;
  readinessTemplate?: MigrationAdapterReadinessTemplate | null;
}): Promise<MigrationAdapterTestResult> {
  const systemId = String(input.systemId || "").trim();
  if (!systemId) throw new Error("Source system is required");

  const data = (await superAdminApiFetch(
    `/api/migration/adapters/${encodeURIComponent(systemId)}/test`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uploadedFiles: input.uploadedFiles,
        previews: input.previews,
        mappings: input.mappings,
        validationSummary: input.validationSummary ?? null,
        readinessTemplate: input.readinessTemplate ?? null,
      }),
    }
  )) as { success: boolean; result?: MigrationAdapterTestResult } | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success || !data.result) {
    throw new Error(parseError(data, "Adapter test failed"));
  }

  return data.result;
}

export function adapterTestStatusLabel(status: MigrationAdapterTestStatus): string {
  switch (status) {
    case "pass":
      return "Pass";
    case "warning":
      return "Warning";
    case "fail":
      return "Fail";
    case "not_supported":
      return "Not supported";
    default:
      return status;
  }
}

export function adapterTestRecommendationLabel(
  recommendation: MigrationAdapterTestRecommendation
): string {
  switch (recommendation) {
    case "ready":
      return "Ready";
    case "partial":
      return "Partial";
    case "needs_research":
      return "Needs research";
    default:
      return recommendation;
  }
}
