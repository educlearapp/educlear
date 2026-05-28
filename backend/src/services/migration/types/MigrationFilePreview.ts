export interface MigrationFilePreview {
  fileId: string;
  filename: string;
  category: string;
  columns: string[];
  sampleRows: Record<string, unknown>[];
  rowCount: number;
  warnings: string[];
  /** Staging disk path — persisted on dry-run stage for apply. */
  path?: string;
}
