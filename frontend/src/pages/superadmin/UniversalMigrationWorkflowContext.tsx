import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyMigrationTemplateToSession,
  collectMappingRulesForTemplate,
} from "../../superAdmin/utils/applyMigrationTemplate";
import {
  buildEffectiveFileMappings,
  hasSelectedMappings,
  type MigrationFileColumnMappings,
} from "../../superAdmin/utils/buildEffectiveFileMappings";
import {
  fetchUniversalMigrationMappingSuggestions,
  type FileMappingSuggestion,
} from "../../superAdmin/utils/universalMigrationMappings";
import type { MigrationMappingTemplate } from "../../superAdmin/utils/universalMigrationTemplates";
import {
  fetchUniversalMigrationPreviews,
  type MigrationFilePreview,
} from "../../superAdmin/utils/universalMigrationPreview";
import {
  uploadUniversalMigrationFiles,
  type UniversalMigrationUploadedFile,
} from "../../superAdmin/utils/universalMigrationUpload";
import {
  fetchUniversalMigrationValidation,
  type MigrationValidationIssue,
  type MigrationValidationMode,
  type MigrationValidationSummary,
} from "../../superAdmin/utils/universalMigrationValidate";
import { exportUniversalMigrationValidationReport } from "../../superAdmin/utils/universalMigrationReportExport";
import {
  fetchMigrationSystems,
  type MigrationSystemResearch,
} from "../../superAdmin/utils/universalMigrationSystems";
import {
  fetchReadinessTemplate,
  type MigrationAdapterReadinessTemplate,
} from "../../superAdmin/utils/universalMigrationReadiness";
import {
  fetchMigrationAdapterTest,
  type MigrationAdapterTestResult,
} from "../../superAdmin/utils/universalMigrationAdapterTest";
import {
  clearMigrationAdapterTestSession,
  setMigrationAdapterTestResult,
} from "../../superAdmin/utils/universalMigrationAdapterTestSession";
import {
  fetchKidESysMigrationReadiness,
  type KidESysMigrationReadinessResult,
} from "../../superAdmin/utils/universalMigrationKidESysReadiness";

export type UniversalMigrationWorkflowContextValue = {
  uploadedFiles: UniversalMigrationUploadedFile[];
  previews: MigrationFilePreview[];
  mappingSuggestions: FileMappingSuggestion[];
  mappingOverrides: Record<string, Record<string, string>>;
  effectiveMappings: MigrationFileColumnMappings[];
  previewBusy: boolean;
  mappingBusy: boolean;
  validateBusy: boolean;
  validationSummary: MigrationValidationSummary | null;
  validationIssues: MigrationValidationIssue[];
  validationNotice: string | null;
  busy: boolean;
  uploadProgress: number | null;
  error: string | null;
  templateNotice: string | null;
  setTemplateNotice: (message: string | null) => void;
  saveTemplateOpen: boolean;
  setSaveTemplateOpen: (open: boolean) => void;
  loadTemplateOpen: boolean;
  setLoadTemplateOpen: (open: boolean) => void;
  sourceSystem: string;
  setSourceSystem: (value: string) => void;
  registrySystems: MigrationSystemResearch[];
  registrySystemsLoading: boolean;
  registrySystemsError: string | null;
  registrySystemsToast: string | null;
  readinessTemplate: MigrationAdapterReadinessTemplate | null;
  readinessLoading: boolean;
  cutoverDate: string;
  setCutoverDate: (value: string) => void;
  validationMode: MigrationValidationMode;
  setValidationMode: (mode: MigrationValidationMode) => void;
  resetValidationResults: () => void;
  exportBusy: boolean;
  adapterTestBusy: boolean;
  adapterTestResult: MigrationAdapterTestResult | null;
  canTestAdapter: boolean;
  rulesForSave: ReturnType<typeof collectMappingRulesForTemplate>;
  handleMappingOverride: (fileId: string, sourceColumn: string, target: string) => void;
  handleValidate: () => Promise<void>;
  handleTestAdapter: () => Promise<void>;
  clearAll: () => void;
  handleApplyTemplate: (template: MigrationMappingTemplate) => void;
  handleExportValidation: () => Promise<void>;
  uploadFiles: (fileList: FileList | File[]) => Promise<void>;
  kidESysReadiness: KidESysMigrationReadinessResult | null;
  kidESysReadinessBusy: boolean;
  kidESysReadinessError: string | null;
  refreshKidESysReadiness: () => Promise<void>;
};

const UniversalMigrationWorkflowContext = createContext<UniversalMigrationWorkflowContextValue | null>(
  null
);

export function useUniversalMigrationWorkflow(): UniversalMigrationWorkflowContextValue {
  const ctx = useContext(UniversalMigrationWorkflowContext);
  if (!ctx) {
    throw new Error("useUniversalMigrationWorkflow must be used within UniversalMigrationWorkflowProvider");
  }
  return ctx;
}

export function UniversalMigrationWorkflowProvider({ children }: { children: ReactNode }) {
  const [uploadedFiles, setUploadedFiles] = useState<UniversalMigrationUploadedFile[]>([]);
  const [previews, setPreviews] = useState<MigrationFilePreview[]>([]);
  const [mappingSuggestions, setMappingSuggestions] = useState<FileMappingSuggestion[]>([]);
  const [mappingOverrides, setMappingOverrides] = useState<
    Record<string, Record<string, string>>
  >({});
  const [previewBusy, setPreviewBusy] = useState(false);
  const [mappingBusy, setMappingBusy] = useState(false);
  const [validateBusy, setValidateBusy] = useState(false);
  const [validationSummary, setValidationSummary] = useState<MigrationValidationSummary | null>(null);
  const [validationIssues, setValidationIssues] = useState<MigrationValidationIssue[]>([]);
  const [validationNotice, setValidationNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false);
  const [loadTemplateOpen, setLoadTemplateOpen] = useState(false);
  const [sourceSystem, setSourceSystem] = useState("generic-excel-csv");
  const [registrySystems, setRegistrySystems] = useState<MigrationSystemResearch[]>([]);
  const [registrySystemsLoading, setRegistrySystemsLoading] = useState(true);
  const [registrySystemsError, setRegistrySystemsError] = useState<string | null>(null);
  const [registrySystemsToast, setRegistrySystemsToast] = useState<string | null>(null);
  const [readinessTemplate, setReadinessTemplate] = useState<MigrationAdapterReadinessTemplate | null>(
    null
  );
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [cutoverDate, setCutoverDate] = useState("");
  const [validationMode, setValidationMode] = useState<MigrationValidationMode>("preview");
  const [exportBusy, setExportBusy] = useState(false);
  const [adapterTestBusy, setAdapterTestBusy] = useState(false);
  const [adapterTestResult, setAdapterTestResult] = useState<MigrationAdapterTestResult | null>(null);
  const [kidESysReadiness, setKidESysReadiness] = useState<KidESysMigrationReadinessResult | null>(
    null
  );
  const [kidESysReadinessBusy, setKidESysReadinessBusy] = useState(false);
  const [kidESysReadinessError, setKidESysReadinessError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setRegistrySystemsLoading(true);
      setRegistrySystemsError(null);
      try {
        const rows = await fetchMigrationSystems();
        if (!cancelled) {
          setRegistrySystems(rows);
          setRegistrySystemsError(null);
        }
      } catch (e: unknown) {
        const message =
          e instanceof Error ? e.message : "Failed to load migration source systems";
        console.error("[Migration Center] fetchMigrationSystems failed:", e);
        if (!cancelled) {
          setRegistrySystems([]);
          setRegistrySystemsError(message);
          setRegistrySystemsToast(message);
        }
      } finally {
        if (!cancelled) setRegistrySystemsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!registrySystemsToast) return;
    const timer = window.setTimeout(() => setRegistrySystemsToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [registrySystemsToast]);

  useEffect(() => {
    const systemId = sourceSystem.trim();
    if (!systemId) {
      setReadinessTemplate(null);
      return;
    }
    let cancelled = false;
    setReadinessLoading(true);
    void (async () => {
      try {
        const template = await fetchReadinessTemplate(systemId);
        if (!cancelled) setReadinessTemplate(template);
      } catch {
        if (!cancelled) setReadinessTemplate(null);
      } finally {
        if (!cancelled) setReadinessLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceSystem]);

  useEffect(() => {
    setAdapterTestResult((prev) =>
      prev && prev.systemId !== sourceSystem.trim() ? null : prev
    );
  }, [sourceSystem]);

  const effectiveMappings = useMemo(
    () => buildEffectiveFileMappings(mappingSuggestions, mappingOverrides),
    [mappingSuggestions, mappingOverrides]
  );

  const loadMappingSuggestions = useCallback(
    async (previewList: MigrationFilePreview[]) => {
      if (previewList.length === 0) return;
      setMappingBusy(true);
      try {
        const result = await fetchUniversalMigrationMappingSuggestions(
          previewList,
          sourceSystem.trim() || undefined
        );
        setMappingSuggestions((prev) => {
          const byId = new Map(prev.map((s) => [s.fileId, s]));
          for (const suggestion of result.suggestions) {
            byId.set(suggestion.fileId, suggestion);
          }
          return Array.from(byId.values());
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Mapping suggestions failed");
      } finally {
        setMappingBusy(false);
      }
    },
    [sourceSystem]
  );

  const loadPreviews = useCallback(
    async (files: UniversalMigrationUploadedFile[]) => {
      if (files.length === 0) return;
      setPreviewBusy(true);
      try {
        const result = await fetchUniversalMigrationPreviews(files, sourceSystem.trim() || undefined);
        const merged = (() => {
          const byId = new Map<string, MigrationFilePreview>();
          for (const preview of result.previews) {
            byId.set(preview.fileId, preview);
          }
          return Array.from(byId.values());
        })();
        setPreviews((prev) => {
          const byId = new Map(prev.map((p) => [p.fileId, p]));
          for (const preview of result.previews) {
            byId.set(preview.fileId, preview);
          }
          return Array.from(byId.values());
        });
        await loadMappingSuggestions(merged);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Preview failed");
      } finally {
        setPreviewBusy(false);
      }
    },
    [loadMappingSuggestions, sourceSystem]
  );

  const handleMappingOverride = useCallback(
    (fileId: string, sourceColumn: string, target: string) => {
      setMappingOverrides((prev) => ({
        ...prev,
        [fileId]: {
          ...(prev[fileId] ?? {}),
          [sourceColumn]: target,
        },
      }));
      setValidationSummary(null);
      setValidationIssues([]);
      setValidationNotice(null);
    },
    []
  );

  const handleValidate = useCallback(async () => {
    const mappings = buildEffectiveFileMappings(mappingSuggestions, mappingOverrides);
    if (!hasSelectedMappings(mappings)) {
      setValidationNotice("Select mappings before validation.");
      setValidationSummary(null);
      setValidationIssues([]);
      setError(null);
      return;
    }

    setValidateBusy(true);
    setValidationNotice(null);
    setError(null);
    try {
      const previewsWithPaths = previews.map((p) => ({
        ...p,
        path: p.path || uploadedFiles.find((f) => f.id === p.fileId)?.path,
      }));
      const filePaths = Object.fromEntries(uploadedFiles.map((f) => [f.id, f.path]));
      const result = await fetchUniversalMigrationValidation({
        previews: previewsWithPaths,
        mappings,
        mode: validationMode,
        ...(validationMode === "full" ? { filePaths } : {}),
        ...(cutoverDate.trim() ? { cutoverDate: cutoverDate.trim() } : {}),
      });
      setValidationSummary(result.summary);
      setValidationIssues(result.issues);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Validation failed");
      setValidationSummary(null);
      setValidationIssues([]);
    } finally {
      setValidateBusy(false);
    }
  }, [mappingSuggestions, mappingOverrides, previews, uploadedFiles, validationMode, cutoverDate]);

  const uploadFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const incoming = Array.from(fileList);
      const accepted = incoming.filter((file) => {
        const name = file.name.toLowerCase();
        return [".csv", ".xls", ".xlsx", ".pdf"].some((ext) => name.endsWith(ext));
      });
      if (accepted.length === 0) {
        setError("No valid files. Accepted formats: CSV, XLS, XLSX, PDF.");
        return;
      }
      if (accepted.length < incoming.length) {
        setError("Some files were skipped. Only CSV, XLS, XLSX, and PDF are accepted.");
      } else {
        setError(null);
      }

      setBusy(true);
      setUploadProgress(0);
      try {
        const result = await uploadUniversalMigrationFiles(accepted, (pct) => setUploadProgress(pct));
        setUploadedFiles((prev) => [...result.files, ...prev]);
        await loadPreviews(result.files);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusy(false);
        setUploadProgress(null);
      }
    },
    [loadPreviews]
  );

  const canTestAdapter =
    sourceSystem.trim().length > 0 && uploadedFiles.length > 0 && previews.length > 0;

  const isKidESysSource = sourceSystem.trim() === "kideesys";

  const refreshKidESysReadiness = useCallback(async () => {
    if (!isKidESysSource || previews.length === 0) {
      setKidESysReadiness(null);
      setKidESysReadinessError(null);
      return;
    }
    const mappings = buildEffectiveFileMappings(mappingSuggestions, mappingOverrides);
    setKidESysReadinessBusy(true);
    setKidESysReadinessError(null);
    try {
      const previewsWithPaths = previews.map((p) => ({
        ...p,
        path: p.path || uploadedFiles.find((f) => f.id === p.fileId)?.path,
      }));
      const filePaths = Object.fromEntries(uploadedFiles.map((f) => [f.id, f.path]));
      const result = await fetchKidESysMigrationReadiness({
        previews: previewsWithPaths,
        mappings,
        uploadedFiles,
        fullFileChecks: validationMode === "full",
        filePaths,
      });
      setKidESysReadiness(result);
    } catch (e: unknown) {
      setKidESysReadiness(null);
      setKidESysReadinessError(e instanceof Error ? e.message : "Kid-e-Sys readiness check failed");
    } finally {
      setKidESysReadinessBusy(false);
    }
  }, [
    isKidESysSource,
    previews,
    mappingSuggestions,
    mappingOverrides,
    uploadedFiles,
    validationMode,
  ]);

  useEffect(() => {
    if (!isKidESysSource) {
      setKidESysReadiness(null);
      setKidESysReadinessError(null);
      return;
    }
    if (previews.length === 0) {
      setKidESysReadiness(null);
      return;
    }
    void refreshKidESysReadiness();
  }, [isKidESysSource, previews, mappingSuggestions, mappingOverrides, uploadedFiles, validationMode, refreshKidESysReadiness]);

  const handleTestAdapter = useCallback(async () => {
    if (!canTestAdapter) return;
    setAdapterTestBusy(true);
    setError(null);
    try {
      const result = await fetchMigrationAdapterTest({
        systemId: sourceSystem,
        uploadedFiles,
        previews,
        mappings: effectiveMappings,
        validationSummary,
        readinessTemplate,
      });
      setAdapterTestResult(result);
      setMigrationAdapterTestResult(sourceSystem, result);
      setValidationNotice("Adapter readiness test completed (read-only).");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Adapter test failed");
      setAdapterTestResult(null);
    } finally {
      setAdapterTestBusy(false);
    }
  }, [
    canTestAdapter,
    sourceSystem,
    uploadedFiles,
    previews,
    effectiveMappings,
    validationSummary,
    readinessTemplate,
  ]);

  const clearAll = useCallback(() => {
    setUploadedFiles([]);
    setPreviews([]);
    setMappingSuggestions([]);
    setMappingOverrides({});
    setValidationSummary(null);
    setValidationIssues([]);
    setValidationNotice(null);
    setError(null);
    setTemplateNotice(null);
    setAdapterTestResult(null);
    setKidESysReadiness(null);
    setKidESysReadinessError(null);
    clearMigrationAdapterTestSession();
  }, []);

  const handleApplyTemplate = useCallback(
    (template: MigrationMappingTemplate) => {
      try {
        const result = applyMigrationTemplateToSession({
          previews,
          template,
        });
        setMappingOverrides((prev) => {
          const next = { ...prev };
          for (const [fileId, fileOverrides] of Object.entries(result.overrides)) {
            next[fileId] = { ...(next[fileId] ?? {}), ...fileOverrides };
          }
          return next;
        });
        const parts = [`Applied ${result.appliedCount} column mapping(s) from "${template.name}".`];
        if (result.unmatchedTemplateRules > 0) {
          parts.push(
            `${result.unmatchedTemplateRules} template rule(s) had no matching column in the current upload.`
          );
        }
        setTemplateNotice(parts.join(" "));
        setValidationSummary(null);
        setValidationIssues([]);
        setValidationNotice(null);
        setError(null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to apply template");
      }
    },
    [previews]
  );

  const handleExportValidation = useCallback(async () => {
    if (!validationSummary) return;
    setExportBusy(true);
    setError(null);
    try {
      await exportUniversalMigrationValidationReport({
        summary: validationSummary,
        issues: validationIssues,
      });
      setValidationNotice("Validation report exported.");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Validation export failed");
    } finally {
      setExportBusy(false);
    }
  }, [validationSummary, validationIssues]);

  const rulesForSave = useMemo(
    () => collectMappingRulesForTemplate(mappingSuggestions, mappingOverrides),
    [mappingSuggestions, mappingOverrides]
  );

  const resetValidationResults = useCallback(() => {
    setValidationSummary(null);
    setValidationIssues([]);
    setValidationNotice(null);
  }, []);

  const value = useMemo<UniversalMigrationWorkflowContextValue>(
    () => ({
      uploadedFiles,
      previews,
      mappingSuggestions,
      mappingOverrides,
      effectiveMappings,
      previewBusy,
      mappingBusy,
      validateBusy,
      validationSummary,
      validationIssues,
      validationNotice,
      busy,
      uploadProgress,
      error,
      templateNotice,
      setTemplateNotice,
      saveTemplateOpen,
      setSaveTemplateOpen,
      loadTemplateOpen,
      setLoadTemplateOpen,
      sourceSystem,
      setSourceSystem,
      registrySystems,
      registrySystemsLoading,
      registrySystemsError,
      registrySystemsToast,
      readinessTemplate,
      readinessLoading,
      cutoverDate,
      setCutoverDate,
      validationMode,
      setValidationMode,
      exportBusy,
      adapterTestBusy,
      adapterTestResult,
      canTestAdapter,
      rulesForSave,
      handleMappingOverride,
      handleValidate,
      handleTestAdapter,
      clearAll,
      handleApplyTemplate,
      handleExportValidation,
      uploadFiles,
      resetValidationResults,
      kidESysReadiness,
      kidESysReadinessBusy,
      kidESysReadinessError,
      refreshKidESysReadiness,
    }),
    [
      uploadedFiles,
      previews,
      mappingSuggestions,
      mappingOverrides,
      effectiveMappings,
      previewBusy,
      mappingBusy,
      validateBusy,
      validationSummary,
      validationIssues,
      validationNotice,
      busy,
      uploadProgress,
      error,
      templateNotice,
      setTemplateNotice,
      saveTemplateOpen,
      loadTemplateOpen,
      sourceSystem,
      registrySystems,
      registrySystemsLoading,
      registrySystemsError,
      registrySystemsToast,
      readinessTemplate,
      readinessLoading,
      cutoverDate,
      validationMode,
      exportBusy,
      adapterTestBusy,
      adapterTestResult,
      canTestAdapter,
      rulesForSave,
      handleMappingOverride,
      handleValidate,
      handleTestAdapter,
      clearAll,
      handleApplyTemplate,
      handleExportValidation,
      uploadFiles,
      resetValidationResults,
      kidESysReadiness,
      kidESysReadinessBusy,
      kidESysReadinessError,
      refreshKidESysReadiness,
    ]
  );

  return (
    <UniversalMigrationWorkflowContext.Provider value={value}>
      {children}
    </UniversalMigrationWorkflowContext.Provider>
  );
}
