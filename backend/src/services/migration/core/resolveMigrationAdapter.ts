import { MIGRATION_ADAPTERS } from "../adapters";
import type { MigrationAdapter } from "../types/MigrationAdapter";

/** Registry systemId → adapter `source` key when they differ. */
const SYSTEM_ID_TO_ADAPTER_SOURCE: Record<string, string> = {
  "generic-excel-csv": "generic-excel",
};

export function resolveMigrationAdapterSource(systemId: string): string {
  const trimmed = String(systemId || "").trim();
  return SYSTEM_ID_TO_ADAPTER_SOURCE[trimmed] ?? trimmed;
}

export function getMigrationAdapterForSystem(systemId: string): MigrationAdapter | undefined {
  const source = resolveMigrationAdapterSource(systemId);
  return MIGRATION_ADAPTERS.find((adapter) => adapter.source === source);
}
