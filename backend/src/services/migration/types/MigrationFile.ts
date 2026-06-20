export type MigrationFileCategory =
  | "learners"
  | "parents"
  | "billing"
  | "transactions"
  | "payment-receive-list"
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
  sourceSystem?: string;
  purpose?: "import" | "reconciliation";
  path: string;
}
