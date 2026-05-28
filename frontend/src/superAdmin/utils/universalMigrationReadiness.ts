import { superAdminApiFetch } from "../superAdminApi";
import type { MigrationFileColumnMappings } from "./buildEffectiveFileMappings";
import type { MigrationAdapterStatus } from "./universalMigrationSystems";
import type { UniversalMigrationFileCategory } from "./universalMigrationUpload";

export type MigrationRequiredFile = {
  fileKey: string;
  label: string;
  description: string;
  required: boolean;
  acceptedTypes: string[];
  category: UniversalMigrationFileCategory;
};

export type MigrationRequiredField = {
  fieldKey: string;
  label: string;
  targetField: string;
  required: boolean;
  category: UniversalMigrationFileCategory;
  aliases: string[];
};

export type MigrationAdapterReadinessTemplate = {
  templateId: string;
  systemId: string;
  systemName: string;
  version: string;
  requiredFiles: MigrationRequiredFile[];
  requiredFields: MigrationRequiredField[];
  optionalFields: MigrationRequiredField[];
  notes: string;
  lastReviewedAt: string;
};

export type AdapterReadinessUiStatus = "ready_to_test" | "needs_research";

export type AdapterReadinessWarning = {
  code: "missing_required_file_category" | "missing_required_field_mapping";
  message: string;
};

function parseError(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    return String((data as { error: string }).error);
  }
  return fallback;
}

export async function fetchReadinessTemplates(): Promise<MigrationAdapterReadinessTemplate[]> {
  const data = (await superAdminApiFetch("/api/migration/readiness-templates")) as
    | { success: boolean; templates?: MigrationAdapterReadinessTemplate[] }
    | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    throw new Error(parseError(data, "Failed to list readiness templates"));
  }

  return Array.isArray(data.templates) ? data.templates : [];
}

export async function fetchReadinessTemplate(
  systemId: string
): Promise<MigrationAdapterReadinessTemplate> {
  const data = (await superAdminApiFetch(
    `/api/migration/readiness-templates/${encodeURIComponent(systemId)}`
  )) as { success: boolean; template?: MigrationAdapterReadinessTemplate } | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success || !data.template) {
    throw new Error(parseError(data, "Failed to load readiness template"));
  }

  return data.template;
}

/**
 * Kid-e-Sys class lists use classroom labels; grade-or-class readiness accepts grade OR classroom.
 */
function isRequiredFieldMapped(
  systemId: string,
  field: MigrationRequiredField,
  mappedTargets: Set<string>
): boolean {
  if (systemId === "kideesys" && field.fieldKey === "grade-or-class" && field.category === "learners") {
    return mappedTargets.has("grade") || mappedTargets.has("classroom");
  }
  return mappedTargets.has(field.targetField);
}

export function deriveAdapterReadinessUiStatus(
  adapterStatus: MigrationAdapterStatus | undefined
): AdapterReadinessUiStatus {
  if (adapterStatus === "partial" || adapterStatus === "ready") {
    return "ready_to_test";
  }
  return "needs_research";
}

export function readinessUiStatusLabel(status: AdapterReadinessUiStatus): string {
  return status === "ready_to_test" ? "Ready to test" : "Needs research";
}

type UploadedFileLike = {
  id: string;
  category: UniversalMigrationFileCategory;
};

export function computeAdapterReadinessWarnings(input: {
  template: MigrationAdapterReadinessTemplate | null;
  uploadedFiles: UploadedFileLike[];
  mappings: MigrationFileColumnMappings[];
}): AdapterReadinessWarning[] {
  const { template, uploadedFiles, mappings } = input;
  if (!template) return [];

  const warnings: AdapterReadinessWarning[] = [];
  const uploadedCategories = new Set(uploadedFiles.map((f) => f.category));

  for (const file of template.requiredFiles) {
    if (!file.required) continue;
    if (!uploadedCategories.has(file.category)) {
      warnings.push({
        code: "missing_required_file_category",
        message: `Expected required file category not detected in uploads: ${file.label} (${file.category}).`,
      });
    }
  }

  const mappedByFile = new Map<string, Set<string>>();
  for (const fileMapping of mappings) {
    const targets = new Set(
      fileMapping.mappings.map((m) => String(m.targetField || "").trim()).filter(Boolean)
    );
    mappedByFile.set(fileMapping.fileId, targets);
  }

  for (const field of template.requiredFields) {
    if (!field.required) continue;
    if (!uploadedCategories.has(field.category)) continue;

    const fileIdsInCategory = uploadedFiles
      .filter((f) => f.category === field.category)
      .map((f) => f.id);

    const mappedSomewhere = mappings.some((fileMapping) => {
      if (!fileIdsInCategory.includes(fileMapping.fileId)) return false;
      const targets = mappedByFile.get(fileMapping.fileId);
      if (!targets) return false;
      return isRequiredFieldMapped(template.systemId, field, targets);
    });

    if (!mappedSomewhere) {
      warnings.push({
        code: "missing_required_field_mapping",
        message: `Required field not mapped yet: ${field.label} → ${field.targetField} (${field.category}).`,
      });
    }
  }

  return warnings;
}

export function splitReadinessFiles(template: MigrationAdapterReadinessTemplate): {
  required: MigrationRequiredFile[];
  optional: MigrationRequiredFile[];
} {
  const required: MigrationRequiredFile[] = [];
  const optional: MigrationRequiredFile[] = [];
  for (const file of template.requiredFiles) {
    if (file.required) required.push(file);
    else optional.push(file);
  }
  return { required, optional };
}
