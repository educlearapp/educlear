import { useCallback, useEffect, useMemo, useState } from "react";
import { API_URL } from "../../api";
import { superAdminApiFetch, superAdminApiUpload, superAdminAuthHeaders } from "../superAdminApi";
import type {
  DataCategoryId,
  FieldMappingRow,
  MigrationIssueRow,
  MigrationProjectState,
  MigrationSource,
  MigrationSummary,
  MigrationValidationReport,
  SchoolOption,
  UploadedMigrationFile,
} from "../types/migration";
import { readMigrationFiles } from "../utils/migrationCsv";

const EMPTY_SUMMARY: MigrationSummary = {
  projects: 0,
  inProgress: 0,
  completed: 0,
  needsReview: 0,
};

const ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls", ".pdf"];

const CORE_IMPORT_CATEGORIES: DataCategoryId[] = [
  "learners",
  "parents",
  "parentRelationships",
  "classes",
];

function isAcceptedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function formatFileId(file: File): string {
  return `${file.name}-${file.size}-${file.lastModified}`;
}

function hasBillingOrAccountingCategories(selected: Set<DataCategoryId>): boolean {
  const blocked: DataCategoryId[] = [
    "schoolFeesAccounts",
    "openingBalances",
    "invoices",
    "payments",
  ];
  return blocked.some((id) => selected.has(id));
}

export function useMigrationCenter() {
  const [summary, setSummary] = useState<MigrationSummary>(EMPTY_SUMMARY);
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [migrationSource, setMigrationSource] = useState<MigrationSource | "">("");
  const [selectedCategories, setSelectedCategories] = useState<Set<DataCategoryId>>(
    () => new Set(CORE_IMPORT_CATEGORIES)
  );
  const [uploadedFiles, setUploadedFiles] = useState<UploadedMigrationFile[]>([]);
  const [fileObjects, setFileObjects] = useState<Map<string, File>>(new Map());
  const [fieldMappings, setFieldMappings] = useState<FieldMappingRow[]>([]);
  const [issues, setIssues] = useState<MigrationIssueRow[]>([]);
  const [project, setProject] = useState<MigrationProjectState | null>(null);
  const [busy, setBusy] = useState(false);
  const [validateUploadProgress, setValidateUploadProgress] = useState<number | null>(null);
  const [validateUploadPhase, setValidateUploadPhase] = useState<
    "idle" | "uploading" | "validating"
  >("idle");

  const hasUploadedFiles = uploadedFiles.length > 0;

  useEffect(() => {
    void (async () => {
      try {
        const schools = (await superAdminApiFetch("/api/schools")) as Array<{
          id: string;
          name: string;
        }>;
        setSchoolOptions(
          (schools || []).map((s) => ({ id: s.id, name: s.name }))
        );
      } catch {
        setSchoolOptions([]);
      }
    })();
  }, []);

  useEffect(() => {
    setSummary({
      projects: project ? 1 : 0,
      inProgress: project?.report && !project.report.canImport ? 1 : 0,
      completed: 0,
      needsReview: project?.report?.warningCount
        ? project.report.warningCount
        : issues.filter((i) => i.severity === "warning").length,
    });
  }, [project, issues]);

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

    setFileObjects((prev) => {
      const next = new Map(prev);
      for (const file of incoming) {
        next.set(formatFileId(file), file);
      }
      return next;
    });
  }, []);

  const removeFile = useCallback((id: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== id));
    setFileObjects((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const clearFiles = useCallback(() => {
    setUploadedFiles([]);
    setFileObjects(new Map());
    setFieldMappings([]);
    setIssues([]);
  }, []);

  const selectedSchool = useMemo(
    () => schoolOptions.find((s) => s.id === selectedSchoolId) ?? null,
    [schoolOptions, selectedSchoolId]
  );

  const getUploadedFileList = useCallback(() => {
    return uploadedFiles
      .map((meta) => fileObjects.get(meta.id))
      .filter((f): f is File => Boolean(f));
  }, [uploadedFiles, fileObjects]);

  const createProject = useCallback(async () => {
    if (!selectedSchoolId) throw new Error("Select a target school first.");
    const data = await superAdminApiFetch("/api/super-admin/migration/projects", {
      method: "POST",
      body: JSON.stringify({
        schoolId: selectedSchoolId,
        source: migrationSource || "csv",
        categories: [...selectedCategories],
      }),
    });
    setProject({
      projectId: data.projectId,
      confirmToken: "",
      report: null,
      stagedRows: [],
      headers: [],
    });
    return data;
  }, [selectedSchoolId, migrationSource, selectedCategories]);

  const validateFiles = useCallback(async () => {
    if (!selectedSchoolId) throw new Error("Select a target school first.");
    if (hasBillingOrAccountingCategories(selectedCategories)) {
      throw new Error(
        "Billing and accounting imports are not enabled in this migration pass. Deselect those categories."
      );
    }

    let projectId = project?.projectId;
    if (!projectId) {
      const created = await createProject();
      projectId = created.projectId;
    }
    if (!projectId) {
      throw new Error("Could not create migration project.");
    }

    if (migrationSource === "kideesys") {
      const kideesysFiles = getUploadedFileList().filter((f) => {
        const name = f.name.toLowerCase();
        return name.endsWith(".xls") || name.endsWith(".xlsx");
      });
      if (!kideesysFiles.length) {
        throw new Error(
          "Upload Kid-e-Sys .xls exports (class lists, contacts, billing, age analysis, transactions, employees)."
        );
      }

      const form = new FormData();
      form.append("schoolId", selectedSchoolId);
      form.append("source", "kideesys");
      form.append("projectId", projectId);
      for (const file of kideesysFiles) {
        form.append("files", file, file.name);
      }

      setValidateUploadPhase("uploading");
      setValidateUploadProgress(0);

      let result: Record<string, unknown>;
      try {
        result = (await superAdminApiUpload(
          "/api/super-admin/migration/validate",
          form,
          (percent) => {
            setValidateUploadProgress(percent);
            if (percent >= 100) setValidateUploadPhase("validating");
          }
        )) as Record<string, unknown>;
      } finally {
        setValidateUploadProgress(null);
        setValidateUploadPhase("idle");
      }

      const report = result.report as MigrationValidationReport;
      const stagedRows = (result.stagedRows || []) as Record<string, string>[];
      setProject({
        projectId: result.projectId as string,
        confirmToken: result.confirmToken as string,
        report,
        stagedRows,
        headers: [],
      });
      setFieldMappings(report.mappings || []);
      setIssues(report.issues || []);

      return {
        report,
        fileName: String(result.fileName || `${kideesysFiles.length} Kid-e-Sys export file(s)`),
        confirmToken: result.confirmToken as string,
      };
    }

    const files = getUploadedFileList();
    const { headers, rows, fileName } = await readMigrationFiles(files);

    const result = await superAdminApiFetch("/api/super-admin/migration/validate", {
      method: "POST",
      body: JSON.stringify({
        schoolId: selectedSchoolId,
        source: migrationSource || "csv",
        projectId,
        categories: [...selectedCategories],
        headers,
        rows,
      }),
    });

    const report = result.report as MigrationValidationReport;
    setProject({
      projectId: result.projectId,
      confirmToken: result.confirmToken,
      report,
      stagedRows: rows,
      headers,
    });
    setFieldMappings(report.mappings || []);
    setIssues(report.issues || []);

    return { report, fileName, confirmToken: result.confirmToken as string };
  }, [
    selectedSchoolId,
    selectedCategories,
    getUploadedFileList,
    project?.projectId,
    migrationSource,
    createProject,
  ]);

  const importStaging = useCallback(async () => {
    if (!project?.report || !project.projectId) {
      throw new Error("Validate files before importing to staging.");
    }
    if (!project.report.canImport) {
      throw new Error("Validation has blocking errors — fix count mismatches before staging.");
    }
    await superAdminApiFetch("/api/super-admin/migration/staging", {
      method: "POST",
      body: JSON.stringify({
        schoolId: selectedSchoolId,
        projectId: project.projectId,
        source: migrationSource || "csv",
        categories: [...selectedCategories],
        report: project.report,
        rows: project.stagedRows,
      }),
    });
    return project;
  }, [project, selectedSchoolId, migrationSource, selectedCategories]);

  const previewStaging = useCallback(async () => {
    if (!project?.projectId || !selectedSchoolId) {
      throw new Error("No staged project — validate and import to staging first.");
    }
    return superAdminApiFetch(
      `/api/super-admin/migration/staging/${encodeURIComponent(project.projectId)}/preview?schoolId=${encodeURIComponent(selectedSchoolId)}`
    );
  }, [project?.projectId, selectedSchoolId]);

  const finalImport = useCallback(
    async (acknowledgedWarnings = false) => {
      if (!project?.projectId || !project.confirmToken) {
        throw new Error("Run validation and staging before final import.");
      }
      return superAdminApiFetch("/api/super-admin/migration/import", {
        method: "POST",
        body: JSON.stringify({
          schoolId: selectedSchoolId,
          projectId: project.projectId,
          confirmToken: project.confirmToken,
          acknowledgedWarnings,
        }),
      });
    },
    [project, selectedSchoolId]
  );

  const rollbackImport = useCallback(async () => {
    if (!project?.projectId) throw new Error("No project id for rollback.");
    return superAdminApiFetch("/api/super-admin/migration/rollback", {
      method: "POST",
      body: JSON.stringify({
        schoolId: selectedSchoolId,
        projectId: project.projectId,
      }),
    });
  }, [project?.projectId, selectedSchoolId]);

  const repairClassrooms = useCallback(async () => {
    if (!selectedSchoolId) throw new Error("Select a target school first.");
    return superAdminApiFetch("/api/super-admin/migration/repair-classrooms", {
      method: "POST",
      body: JSON.stringify({ schoolId: selectedSchoolId }),
    });
  }, [selectedSchoolId]);

  const downloadTemplate = useCallback(async () => {
    const res = await fetch(`${API_URL}/api/super-admin/migration/template`, {
      headers: superAdminAuthHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      let message = "Failed to download template";
      try {
        const data = text ? JSON.parse(text) : null;
        if (data?.error) message = String(data.error);
      } catch {
        if (text) message = text;
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "educlear-migration-learners.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }, []);

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
    project,
    busy,
    setBusy,
    validateUploadProgress,
    validateUploadPhase,
    createProject,
    validateFiles,
    importStaging,
    previewStaging,
    finalImport,
    rollbackImport,
    repairClassrooms,
    downloadTemplate,
  };
}
