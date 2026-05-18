import { useCallback, useMemo, useState } from "react";
import type {
  DataCategoryId,
  FieldMappingRow,
  MigrationIssueRow,
  MigrationSource,
  MigrationSummary,
  SchoolOption,
  UploadedMigrationFile,
} from "../types/migration";

const EMPTY_SUMMARY: MigrationSummary = {
  projects: 0,
  inProgress: 0,
  completed: 0,
  needsReview: 0,
};

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls", ".pdf"];

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function formatFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function useMigrationCenter() {
  const [summary] = useState<MigrationSummary>(EMPTY_SUMMARY);
  const [schoolOptions] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [migrationSource, setMigrationSource] = useState<MigrationSource | "">("");
  const [selectedCategories, setSelectedCategories] = useState<Set<DataCategoryId>>(new Set());
  const [uploadedFiles, setUploadedFiles] = useState<UploadedMigrationFile[]>([]);
  const [fieldMappings] = useState<FieldMappingRow[]>([]);
  const [issues] = useState<MigrationIssueRow[]>([]);

  const hasUploadedFiles = uploadedFiles.length > 0;

  const toggleCategory = useCallback((id: DataCategoryId) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).filter(isAcceptedFile);
    if (incoming.length === 0) return;

    setUploadedFiles((prev) => {
      const existingIds = new Set(prev.map((f) => f.id));
      const next = [...prev];
      for (const file of incoming) {
        const id = formatFileId(file);
        if (existingIds.has(id)) continue;
        existingIds.add(id);
        next.push({
          id,
          name: file.name,
          size: file.size,
          type: file.type || "application/octet-stream",
        });
      }
      return next;
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  const clearFiles = useCallback(() => {
    setUploadedFiles([]);
  }, []);

  const selectedSchool = useMemo(
    () => schoolOptions.find((s) => s.id === selectedSchoolId) ?? null,
    [schoolOptions, selectedSchoolId]
  );

  return {
    summary,
    schoolOptions,
    selectedSchoolId,
    setSelectedSchoolId,
    selectedSchool,
    migrationSource,
    setMigrationSource,
    selectedCategories,
    toggleCategory,
    uploadedFiles,
    hasUploadedFiles,
    addFiles,
    removeFile,
    clearFiles,
    fieldMappings,
    issues,
    acceptedExtensions: ACCEPTED_EXTENSIONS,
  };
}
