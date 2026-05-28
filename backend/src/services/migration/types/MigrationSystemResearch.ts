/** Adapter implementation readiness for a legacy school system (research registry only). */
export type MigrationAdapterStatus =
  | "planned"
  | "researching"
  | "partial"
  | "ready"
  | "deprecated";

/** Known or expected export formats from a source system. */
export type MigrationExportType =
  | "csv"
  | "xls"
  | "xlsx"
  | "database_export"
  | "api"
  | "mixed"
  | "unknown";

/** Structured research record for a South African (or generic) school management system. */
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

export const MIGRATION_ADAPTER_STATUSES: MigrationAdapterStatus[] = [
  "planned",
  "researching",
  "partial",
  "ready",
  "deprecated",
];

export const MIGRATION_EXPORT_TYPES: MigrationExportType[] = [
  "csv",
  "xls",
  "xlsx",
  "database_export",
  "api",
  "mixed",
  "unknown",
];
