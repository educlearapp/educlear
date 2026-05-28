import { API_URL, superAdminApiFetch } from "../superAdminApi";

export type MigrationAdapterStatus =
  | "planned"
  | "researching"
  | "partial"
  | "ready"
  | "deprecated";

export type MigrationExportType =
  | "csv"
  | "xls"
  | "xlsx"
  | "database_export"
  | "api"
  | "mixed"
  | "unknown";

export type MigrationSystemResearch = {
  systemId: string;
  systemName: string;
  vendor: string;
  country: string;
  website: string;
  exportTypes: MigrationExportType[];
  supportsLearners: boolean;
  supportsParents: boolean;
  supportsBilling: boolean;
  supportsTransactions: boolean;
  supportsStaff: boolean;
  notes: string;
  adapterStatus: MigrationAdapterStatus;
  templateCount: number;
  lastReviewedAt: string;
};

function parseError(data: unknown, fallback: string): string {
  if (typeof data === "object" && data !== null && "error" in data) {
    return String((data as { error: string }).error);
  }
  return fallback;
}

function migrationSystemsRequestLabel(): string {
  return `GET ${API_URL}/api/migration/systems`;
}

export async function fetchMigrationSystems(): Promise<MigrationSystemResearch[]> {
  let data: unknown;
  try {
    data = await superAdminApiFetch("/api/migration/systems");
  } catch (e: unknown) {
    const base = e instanceof Error ? e.message : "Failed to list migration systems";
    const detail = import.meta.env.DEV ? ` (${migrationSystemsRequestLabel()})` : "";
    throw new Error(`${base}${detail}`);
  }

  const payload = data as
    | { success: boolean; systems?: MigrationSystemResearch[] }
    | { error?: string };

  if (!payload || typeof payload !== "object" || !("success" in payload) || !payload.success) {
    const base = parseError(payload, "Failed to list migration systems");
    const detail = import.meta.env.DEV ? ` (${migrationSystemsRequestLabel()})` : "";
    throw new Error(`${base}${detail}`);
  }

  const systems = Array.isArray(payload.systems) ? payload.systems : [];
  if (systems.length === 0) {
    const detail = import.meta.env.DEV ? ` (${migrationSystemsRequestLabel()})` : "";
    throw new Error(`Migration systems registry returned no systems${detail}`);
  }

  return systems;
}

export async function fetchMigrationSystem(systemId: string): Promise<MigrationSystemResearch> {
  const data = (await superAdminApiFetch(
    `/api/migration/systems/${encodeURIComponent(systemId)}`
  )) as { success: boolean; system?: MigrationSystemResearch } | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success || !data.system) {
    throw new Error(parseError(data, "Failed to load migration system"));
  }

  return data.system;
}

export async function saveMigrationSystem(
  payload: MigrationSystemResearch
): Promise<MigrationSystemResearch> {
  const data = (await superAdminApiFetch("/api/migration/systems", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })) as { success: boolean; system?: MigrationSystemResearch } | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success || !data.system) {
    throw new Error(parseError(data, "Failed to save migration system"));
  }

  return data.system;
}

export async function deleteMigrationSystem(systemId: string): Promise<void> {
  const data = (await superAdminApiFetch(`/api/migration/systems/${encodeURIComponent(systemId)}`, {
    method: "DELETE",
  })) as { success: boolean } | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    throw new Error(parseError(data, "Failed to delete migration system"));
  }
}
