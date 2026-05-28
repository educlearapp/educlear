import type { MigrationFileCategory } from "./MigrationFile";
import type { MigrationTargetField } from "./MigrationTargetField";

/** Expected upload file slot for a source system (readiness guidance only). */
export type MigrationRequiredFile = {
  fileKey: string;
  label: string;
  description: string;
  required: boolean;
  acceptedTypes: string[];
  category: MigrationFileCategory;
};

/** Expected column mapping for a source system (readiness guidance only). */
export type MigrationRequiredField = {
  fieldKey: string;
  label: string;
  targetField: MigrationTargetField;
  required: boolean;
  category: MigrationFileCategory;
  aliases: string[];
};

/** Pre-import checklist for a legacy source system — no live import side effects. */
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

export const MIGRATION_READINESS_ACCEPTED_TYPES = ["csv", "xls", "xlsx"] as const;
