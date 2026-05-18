import { useCallback, useEffect, useMemo, useState } from "react";
import { SASAMS_ACCEPTED_EXTENSIONS } from "../components/sasamsConstants";
import type {
  SasamsApiContext,
  SasamsReportActionId,
  SasamsReportSummary,
  SasamsUploadTypeId,
  SasamsValidationRow,
  UploadedSasamsFile,
} from "../types/sasamsReport";

/** Backend-ready path builder — always scoped to the logged-in school. */
export function buildSasamsReportApiPath(actionId: SasamsReportActionId, ctx: SasamsApiContext): string {
  return `/api/schools/${encodeURIComponent(ctx.schoolId)}/sasams-reports/${actionId}`;
}

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return SASAMS_ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function formatFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

export function useSasamsReportUpload(schoolId: string) {
  const [uploadType, setUploadType] = useState<SasamsUploadTypeId | "">("");
  const [uploadedFiles, setUploadedFiles] = useState<UploadedSasamsFile[]>([]);
  const [validationRows] = useState<SasamsValidationRow[]>([]);

  useEffect(() => {
    setUploadedFiles([]);
    setUploadType("");
  }, [schoolId]);

  const schoolFiles = useMemo(
    () => uploadedFiles.filter((file) => file.schoolId === schoolId),
    [uploadedFiles, schoolId]
  );

  const hasUploadedFiles = schoolFiles.length > 0;

  const summary = useMemo<SasamsReportSummary>(
    () => ({
      filesUploaded: schoolFiles.length,
      learnersMatched: 0,
      reportsReady: 0,
      errorsNeedsReview: 0,
    }),
    [schoolFiles.length]
  );

  const apiContext: SasamsApiContext = useMemo(
    () => ({
      schoolId,
      uploadType,
      fileIds: schoolFiles.map((f) => f.id),
    }),
    [schoolId, uploadType, schoolFiles]
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      if (!schoolId) return;

      const incoming = Array.from(files).filter(isAcceptedFile);
      if (incoming.length === 0) return;

      const uploadedAt = new Date().toISOString();

      setUploadedFiles((prev) => {
        const scoped = prev.filter((file) => file.schoolId === schoolId);
        const existingIds = new Set(scoped.map((file) => file.id));
        const otherSchools = prev.filter((file) => file.schoolId !== schoolId);
        const next = [...otherSchools, ...scoped];

        for (const file of incoming) {
          const id = formatFileId(file);
          if (existingIds.has(id)) continue;
          existingIds.add(id);
          next.push({
            id,
            schoolId,
            name: file.name,
            size: file.size,
            type: file.type || "application/octet-stream",
            uploadedAt,
          });
        }

        return next;
      });
    },
    [schoolId]
  );

  const removeFile = useCallback(
    (id: string) => {
      setUploadedFiles((prev) => prev.filter((file) => file.id !== id || file.schoolId !== schoolId));
    },
    [schoolId]
  );

  const clearFiles = useCallback(() => {
    setUploadedFiles((prev) => prev.filter((file) => file.schoolId !== schoolId));
  }, [schoolId]);

  return {
    schoolId,
    summary,
    uploadType,
    setUploadType,
    uploadedFiles: schoolFiles,
    hasUploadedFiles,
    addFiles,
    removeFile,
    clearFiles,
    validationRows,
    apiContext,
    acceptedExtensions: SASAMS_ACCEPTED_EXTENSIONS,
  };
}
