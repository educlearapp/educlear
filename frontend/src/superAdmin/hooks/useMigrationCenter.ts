import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, API_URL } from "../../api";
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

  const hasUploadedFiles = uploadedFiles.length > 0;

  useEffect(() => {
    void (async () => {
      try {
        const schools = (await apiFetch("/api/schools")) as Array<{
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
    const data = await apiFetch("/api/super-admin/migration/projects", {
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

    const files = getUploadedFileList();
    const { headers, rows, fileName } = await readMigrationFiles(files);

    let projectId = project?.projectId;
    if (!projectId) {
      const created = await createProject();
      projectId = created.projectId;
    }

    const result = await apiFetch("/api/super-admin/migration/validate", {
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
    await apiFetch("/api/super-admin/migration/staging", {
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
    return apiFetch(
      `/api/super-admin/migration/staging/${encodeURIComponent(project.projectId)}/preview?schoolId=${encodeURIComponent(selectedSchoolId)}`
    );
  }, [project?.projectId, selectedSchoolId]);

  const finalImport = useCallback(
    async (acknowledgedWarnings = false) => {
      if (!project?.projectId || !project.confirmToken) {
        throw new Error("Run validation and staging before final import.");
      }
      return apiFetch("/api/super-admin/migration/import", {
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
    return apiFetch("/api/super-admin/migration/rollback", {
      method: "POST",
      body: JSON.stringify({
        schoolId: selectedSchoolId,
        projectId: project.projectId,
      }),
    });
  }, [project?.projectId, selectedSchoolId]);

  const repairClassrooms = useCallback(async () => {
    if (!selectedSchoolId) throw new Error("Select a target school first.");
    return apiFetch("/api/super-admin/migration/repair-classrooms", {
      method: "POST",
      body: JSON.stringify({ schoolId: selectedSchoolId }),
    });
  }, [selectedSchoolId]);

  const downloadTemplate = useCallback(() => {
    window.open(`${API_URL}/api/super-admin/migration/template`, "_blank");
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
