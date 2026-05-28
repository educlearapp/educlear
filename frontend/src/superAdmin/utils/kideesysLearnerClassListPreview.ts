import type { MigrationFilePreview } from "./universalMigrationPreview";

/** Display labels for Kid-e-Sys class-list normalized preview columns. */
const KIDEESYS_CLASS_LIST_COLUMN_LABELS: Record<string, string> = {
  fullName: "Learner name",
  classroom: "Class / grade",
};

export function isKidESysClassListPreview(preview: MigrationFilePreview): boolean {
  return (preview.warnings || []).some((w) => /Kid-e-Sys class list/i.test(w));
}

export function migrationPreviewColumnLabel(
  column: string,
  preview: MigrationFilePreview
): string {
  if (!isKidESysClassListPreview(preview)) return column;
  return KIDEESYS_CLASS_LIST_COLUMN_LABELS[column] ?? column;
}
