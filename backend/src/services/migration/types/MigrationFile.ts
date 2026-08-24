export type MigrationFileCategory =
  | "learners"
  | "parents"
  | "billing"
  | "transactions"
  | "payment-receive-list"
  | "staff"
  | "historical"
  | "unknown";

export type MigrationSheetRole = "DATA" | "SUPPORTING" | "SUMMARY" | "UNKNOWN";

export interface MigrationFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  category: MigrationFileCategory;
  sourceSystem?: string;
  purpose?: "import" | "reconciliation";
  path: string;
  /** Worksheet name when this logical source came from a multi-sheet workbook. */
  worksheetName?: string;
  workbookFilename?: string;
  sheetRole?: MigrationSheetRole;
  sheetKind?: string;
  headerRowIndex?: number | null;
  categoryOverridden?: boolean;
}
