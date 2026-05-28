import { superAdminApiFetch } from "../superAdminApi";

export type MigrationTemplateMappingRule = {
  sourceColumn: string;
  targetField: string;
};

export type MigrationMappingTemplate = {
  id: string;
  name: string;
  sourceSystem: string;
  description: string;
  mappings: MigrationTemplateMappingRule[];
  createdAt: string;
  updatedAt: string;
};

export const MIGRATION_TEMPLATE_SOURCE_SYSTEMS: { id: string; label: string }[] = [
  { id: "kideesys", label: "Kid-e-Sys" },
  { id: "sasams", label: "SA-SAMS" },
  { id: "d6", label: "d6" },
  { id: "adam", label: "ADAM" },
  { id: "edadmin", label: "Ed-admin" },
  { id: "edupac", label: "EduPac" },
  { id: "generic", label: "Generic Excel" },
  { id: "excel", label: "Excel" },
  { id: "csv", label: "CSV" },
];

function parseError(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    return String((data as { error: string }).error);
  }
  return fallback;
}

export async function fetchMigrationTemplates(): Promise<MigrationMappingTemplate[]> {
  const data = (await superAdminApiFetch("/api/migration/templates")) as
    | { success: boolean; templates?: MigrationMappingTemplate[] }
    | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    throw new Error(parseError(data, "Failed to list templates"));
  }

  return Array.isArray(data.templates) ? data.templates : [];
}

export async function fetchMigrationTemplate(id: string): Promise<MigrationMappingTemplate> {
  const data = (await superAdminApiFetch(`/api/migration/templates/${encodeURIComponent(id)}`)) as
    | { success: boolean; template?: MigrationMappingTemplate }
    | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success || !data.template) {
    throw new Error(parseError(data, "Failed to load template"));
  }

  return data.template;
}

export async function saveMigrationTemplate(payload: {
  name: string;
  sourceSystem: string;
  description?: string;
  mappings: MigrationTemplateMappingRule[];
}): Promise<MigrationMappingTemplate> {
  const data = (await superAdminApiFetch("/api/migration/templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })) as { success: boolean; template?: MigrationMappingTemplate } | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success || !data.template) {
    throw new Error(parseError(data, "Failed to save template"));
  }

  return data.template;
}

export async function deleteMigrationTemplate(id: string): Promise<void> {
  const data = (await superAdminApiFetch(`/api/migration/templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  })) as { success: boolean } | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    throw new Error(parseError(data, "Failed to delete template"));
  }
}
