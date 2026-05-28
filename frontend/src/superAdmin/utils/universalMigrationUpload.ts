import { superAdminApiUpload } from "../superAdminApi";

export type UniversalMigrationFileCategory =
  | "learners"
  | "parents"
  | "billing"
  | "transactions"
  | "staff"
  | "historical"
  | "unknown";

export type UniversalMigrationUploadedFile = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  category: UniversalMigrationFileCategory;
  path: string;
};

export type UniversalMigrationUploadResponse = {
  success: boolean;
  files: UniversalMigrationUploadedFile[];
};

export async function uploadUniversalMigrationFiles(
  files: File[],
  onProgress?: (percent: number) => void
): Promise<UniversalMigrationUploadResponse> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  const data = (await superAdminApiUpload("/api/migration/upload", formData, onProgress)) as
    | UniversalMigrationUploadResponse
    | { error?: string };

  if (!data || typeof data !== "object" || !("success" in data) || !data.success) {
    const message =
      typeof data === "object" && data !== null && "error" in data
        ? String((data as { error: string }).error)
        : "Upload failed";
    throw new Error(message);
  }

  return data as UniversalMigrationUploadResponse;
}
