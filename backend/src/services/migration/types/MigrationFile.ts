export type MigrationFileCategory =
  | "learners"
  | "parents"
  | "billing"
  | "transactions"
  | "staff"
  | "historical"
  | "unknown";

export interface MigrationFile {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  category: MigrationFileCategory;
  path: string;
}
