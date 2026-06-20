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
import {
  clearUniversalMigrationSession,
  fetchUniversalMigrationSession,
  saveUniversalMigrationSession,
  type PersistentUniversalMigrationSessionPatch,
} from "../../superAdmin/utils/universalMigrationSession";
import { fetchMigrationTargetSchools } from "../../superAdmin/utils/migrationTargetSchools";
import type { SchoolOption } from "../../superAdmin/types/migration";
import type { MigrationStage } from "../../superAdmin/utils/universalMigrationStage";

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
  selectedSessionSchoolId: string;
  setSelectedSessionSchoolId: (value: string) => void;
  targetSchools: SchoolOption[];
  targetSchoolsLoading: boolean;
  sessionRestoreBusy: boolean;
  sessionNotice: string | null;
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
  dryRunStage: MigrationStage | null;
  setDryRunStage: (stage: MigrationStage | null) => void;
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
  const [sourceSystem, setSourceSystemState] = useState("generic-excel-csv");
  const [selectedSessionSchoolId, setSelectedSessionSchoolId] = useState("");
  const [targetSchools, setTargetSchools] = useState<SchoolOption[]>([]);
  const [targetSchoolsLoading, setTargetSchoolsLoading] = useState(true);
  const [sessionRestoreBusy, setSessionRestoreBusy] = useState(false);
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
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
  const [dryRunStage, setDryRunStage] = useState<MigrationStage | null>(null);
  const [kidESysReadiness, setKidESysReadiness] = useState<KidESysMigrationReadinessResult | null>(
    null
  );
  const [kidESysReadinessBusy, setKidESysReadinessBusy] = useState(false);
  const [kidESysReadinessError, setKidESysReadinessError] = useState<string | null>(null);

  const resetLocalWorkflowState = useCallback(() => {
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
    setDryRunStage(null);
    setKidESysReadiness(null);
    setKidESysReadinessError(null);
    clearMigrationAdapterTestSession();
  }, []);

  const persistSession = useCallback(
    (patch: PersistentUniversalMigrationSessionPatch) => {
      const schoolId = selectedSessionSchoolId.trim();
      if (!schoolId) return;
      void saveUniversalMigrationSession(schoolId, patch).catch((e: unknown) => {
        setSessionNotice(e instanceof Error ? e.message : "Migration session save failed");
      });
    },
    [selectedSessionSchoolId]
  );

  const setSourceSystem = useCallback(
    (value: string) => {
      setSourceSystemState(value);
      setAdapterTestResult((prev) => (prev && prev.systemId !== value.trim() ? null : prev));
      setDryRunStage(null);
      persistSession({ sourceSystem: value, dryRunStage: null });
    },
    [persistSession]
  );

  const setCutoverDatePersisted = useCallback(
    (value: string) => {
      setCutoverDate(value);
      setDryRunStage(null);
      persistSession({ cutoverDate: value, dryRunStage: null });
    },
    [persistSession]
  );

  const setValidationModePersisted = useCallback(
    (mode: MigrationValidationMode) => {
      setValidationMode(mode);
      setDryRunStage(null);
      persistSession({
        validationMode: mode,
        validationSummary: null,
        validationIssues: [],
        dryRunStage: null,
      });
    },
    [persistSession]
  );

  const setDryRunStagePersisted = useCallback(
    (stage: MigrationStage | null) => {
      setDryRunStage(stage);
      persistSession({ dryRunStage: stage });
    },
    [persistSession]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setTargetSchoolsLoading(true);
      try {
        const { schools } = await fetchMigrationTargetSchools();
        if (!cancelled) setTargetSchools(schools);
      } catch {
        if (!cancelled) setTargetSchools([]);
      } finally {
        if (!cancelled) setTargetSchoolsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const schoolId = selectedSessionSchoolId.trim();
    if (!schoolId) {
      resetLocalWorkflowState();
      setSessionNotice(null);
      return;
    }
    let cancelled = false;
    setSessionRestoreBusy(true);
    setSessionNotice(null);
    void (async () => {
      try {
        const session = await fetchUniversalMigrationSession(schoolId);
        if (cancelled) return;
        if (!session) {
          resetLocalWorkflowState();
          setSessionNotice("No saved migration session for this school yet.");
          return;
        }
        setUploadedFiles(session.uploadedFiles ?? []);
        setPreviews(session.previews ?? []);
        setMappingSuggestions(session.mappingSuggestions ?? []);
        setMappingOverrides(session.mappingOverrides ?? {});
        setValidationSummary(session.validationSummary ?? null);
        setValidationIssues(session.validationIssues ?? []);
        setValidationMode(session.validationMode === "full" ? "full" : "preview");
        setCutoverDate(session.cutoverDate ?? "");
        setSourceSystemState(session.sourceSystem || "generic-excel-csv");
        setDryRunStage(session.dryRunStage ?? null);
        setValidationNotice(null);
        setError(null);
        setSessionNotice(
          `Restored migration session saved ${new Date(session.updatedAt).toLocaleString()}.`
        );
      } catch (e: unknown) {
        if (!cancelled) {
          resetLocalWorkflowState();
          setSessionNotice(e instanceof Error ? e.message : "Migration session restore failed");
        }
      } finally {
        if (!cancelled) setSessionRestoreBusy(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSessionSchoolId, resetLocalWorkflowState]);

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
          sourceSystem.trim() || undefined,
          selectedSessionSchoolId.trim() || undefined
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
    [sourceSystem, selectedSessionSchoolId]
  );

  const loadPreviews = useCallback(
    async (files: UniversalMigrationUploadedFile[]) => {
      if (files.length === 0) return;
      setPreviewBusy(true);
      try {
        const result = await fetchUniversalMigrationPreviews(
          files,
          sourceSystem.trim() || undefined,
          selectedSessionSchoolId.trim() || undefined
        );
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
    [loadMappingSuggestions, sourceSystem, selectedSessionSchoolId]
  );

  const handleMappingOverride = useCallback(
    (fileId: string, sourceColumn: string, target: string) => {
      setMappingOverrides((prev) => {
        const next = {
          ...prev,
          [fileId]: {
            ...(prev[fileId] ?? {}),
            [sourceColumn]: target,
          },
        };
        persistSession({
          mappingOverrides: next,
          validationSummary: null,
          validationIssues: [],
          dryRunStage: null,
        });
        return next;
      });
      setValidationSummary(null);
      setValidationIssues([]);
      setValidationNotice(null);
    },
    [persistSession]
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
        ...(selectedSessionSchoolId.trim() ? { schoolId: selectedSessionSchoolId.trim() } : {}),
        ...(validationMode === "full" ? { filePaths } : {}),
        ...(cutoverDate.trim() ? { cutoverDate: cutoverDate.trim() } : {}),
      });
      setValidationSummary(result.summary);
      setValidationIssues(result.issues);
      setDryRunStage(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Validation failed");
      setValidationSummary(null);
      setValidationIssues([]);
    } finally {
      setValidateBusy(false);
    }
  }, [
    mappingSuggestions,
    mappingOverrides,
    previews,
    uploadedFiles,
    validationMode,
    cutoverDate,
    selectedSessionSchoolId,
  ]);

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
      if (!selectedSessionSchoolId.trim()) {
        setError("Select the target school for this migration session before uploading files.");
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
        const result = await uploadUniversalMigrationFiles(
          accepted,
          {
            schoolId: selectedSessionSchoolId.trim(),
            sourceSystem: sourceSystem.trim() || undefined,
          },
          (pct) => setUploadProgress(pct)
        );
        setUploadedFiles((prev) => [...result.files, ...prev]);
        setDryRunStage(null);
        await loadPreviews(result.files);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Upload failed");
      } finally {
        setBusy(false);
        setUploadProgress(null);
      }
    },
    [loadPreviews, selectedSessionSchoolId, sourceSystem]
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
    const schoolId = selectedSessionSchoolId.trim();
    resetLocalWorkflowState();
    setSessionNotice(null);
    if (schoolId) {
      void clearUniversalMigrationSession(schoolId)
        .then(() => setSessionNotice("Migration session cleared."))
        .catch((e: unknown) =>
          setSessionNotice(e instanceof Error ? e.message : "Failed to clear migration session")
        );
    }
  }, [resetLocalWorkflowState, selectedSessionSchoolId]);

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
          persistSession({
            mappingOverrides: next,
            validationSummary: null,
            validationIssues: [],
            dryRunStage: null,
          });
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
    [previews, persistSession]
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
    setDryRunStage(null);
    persistSession({ validationSummary: null, validationIssues: [], dryRunStage: null });
  }, [persistSession]);

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
      selectedSessionSchoolId,
      setSelectedSessionSchoolId,
      targetSchools,
      targetSchoolsLoading,
      sessionRestoreBusy,
      sessionNotice,
      registrySystems,
      registrySystemsLoading,
      registrySystemsError,
      registrySystemsToast,
      readinessTemplate,
      readinessLoading,
      cutoverDate,
      setCutoverDate: setCutoverDatePersisted,
      validationMode,
      setValidationMode: setValidationModePersisted,
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
      dryRunStage,
      setDryRunStage: setDryRunStagePersisted,
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
      selectedSessionSchoolId,
      targetSchools,
      targetSchoolsLoading,
      sessionRestoreBusy,
      sessionNotice,
      registrySystems,
      registrySystemsLoading,
      registrySystemsError,
      registrySystemsToast,
      readinessTemplate,
      readinessLoading,
      cutoverDate,
      setCutoverDatePersisted,
      validationMode,
      setValidationModePersisted,
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
      dryRunStage,
      setDryRunStagePersisted,
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
