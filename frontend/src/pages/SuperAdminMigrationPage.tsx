import { useCallback, useState } from "react";
import MigrationActions from "../superAdmin/components/migration/MigrationActions";
import MigrationDataCategories from "../superAdmin/components/migration/MigrationDataCategories";
import MigrationFileUpload from "../superAdmin/components/migration/MigrationFileUpload";
import MigrationIssuesTable from "../superAdmin/components/migration/MigrationIssuesTable";
import MigrationMappingTable from "../superAdmin/components/migration/MigrationMappingTable";
import MigrationSchoolSelect from "../superAdmin/components/migration/MigrationSchoolSelect";
import MigrationSourceSelect from "../superAdmin/components/migration/MigrationSourceSelect";
import DaSilvaMigrationPanel from "../superAdmin/components/migration/DaSilvaMigrationPanel";
import MigrationStubModal, { type StubNotice } from "../superAdmin/components/migration/MigrationStubModal";
import MigrationSummaryCards from "../superAdmin/components/migration/MigrationSummaryCards";
import { useMigrationCenter } from "../superAdmin/hooks/useMigrationCenter";
import type { MigrationActionId, MigrationSource } from "../superAdmin/types/migration";
import { formatValidationReportSummary } from "../superAdmin/utils/migrationCsv";
import "./SuperAdminMigrationPage.css";

function formatNormalizationPreview(
  preview: Array<{
    originalName?: string;
    canonicalName: string;
    normalizedName?: string;
    detectedGrade?: string;
    detectedClassLetter?: string;
    detectedYear?: number | null;
    importYear?: number | null;
    rawLabels: string[];
    learnerCount: number;
    teacherEmail: string;
    warnings?: string[];
    needsConfirmation?: boolean;
    warning?: string;
  }>
): string {
  if (!preview.length) return "No classrooms to normalize.";
  return preview
    .slice(0, 40)
    .map((row) => {
      const original = row.originalName || row.rawLabels[0] || "—";
      const normalized = row.normalizedName || row.canonicalName;
      const grade = row.detectedGrade || "—";
      const letter = row.detectedClassLetter || "—";
      const year =
        row.importYear ?? row.detectedYear ?? null;
      const yearLabel = year != null ? String(year) : "—";
      const warnList = row.warnings?.length
        ? row.warnings
        : row.warning
          ? [row.warning]
          : [];
      const confirm = row.needsConfirmation ? " [needs confirmation]" : "";
      const teacher = row.teacherEmail ? ` · teacher: ${row.teacherEmail}` : "";
      const warn =
        warnList.length > 0 ? `\n    ⚠ ${warnList.join("; ")}` : "";
      return [
        `${original} → ${normalized}${confirm}`,
        `    grade: ${grade} · group: ${letter} · year: ${yearLabel} · ${row.learnerCount} learner(s)${teacher}`,
        warn,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

export default function SuperAdminMigrationPage() {
  const {
    summary,
    schoolOptions,
    selectedSchoolId,
    setSelectedSchoolId,
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
    acceptedExtensions,
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
  } = useMigrationCenter();

  const [notice, setNotice] = useState<StubNotice | null>(null);

  const showNotice = useCallback((payload: StubNotice) => {
    setNotice(payload);
  }, []);

  const handleSourceChange = useCallback(
    (source: MigrationSource) => {
      setMigrationSource(source);
    },
    [setMigrationSource]
  );

  const handleAction = useCallback(
    async (actionId: MigrationActionId) => {
      setBusy(true);
      try {
        if (actionId === "downloadTemplate") {
          downloadTemplate();
          showNotice({
            title: "Import template",
            message: "Learner/parent/class CSV template download started.",
          });
          return;
        }

        if (actionId === "createProject") {
          const data = await createProject();
          showNotice({
            title: "Migration project created",
            message: `Project ${data.projectId} is ready for ${selectedSchoolId ? "the selected school" : "import"}. Upload CSV files and run validation.`,
          });
          return;
        }

        if (actionId === "validateFiles") {
          const { report, fileName } = await validateFiles();
          showNotice({
            title: report.canImport ? "Validation passed" : "Validation needs fixes",
            message: `Validated ${fileName} for ${report.schoolName}.`,
            details: formatValidationReportSummary(report),
          });
          return;
        }

        if (actionId === "importStaging") {
          await importStaging();
          const preview = await previewStaging();
          showNotice({
            title: "Staged for import",
            message: `${preview.report?.rowCount ?? 0} rows staged. Review normalization below before Final Import.`,
            details: formatNormalizationPreview(preview.normalizationPreview || []),
            primaryAction: preview.canImport
              ? {
                  label: "Continue to Final Import",
                  onClick: () => {
                    setNotice(null);
                    void handleAction("finalImport");
                  },
                }
              : undefined,
          });
          return;
        }

        if (actionId === "finalImport") {
          if (!project?.report) {
            showNotice({
              title: "Final import",
              message: "Validate files and import to staging before final import.",
            });
            return;
          }

          if (project.report.warningCount > 0) {
            const preview = await previewStaging();
            showNotice({
              title: "Confirm import (warnings present)",
              message: `${project.report.warningCount} warning(s). Classroom names will be normalized as shown below.`,
              details: formatNormalizationPreview(preview.normalizationPreview || []),
              primaryAction: {
                label: "Confirm & Import",
                onClick: () => {
                  setNotice(null);
                  void (async () => {
                    setBusy(true);
                    try {
                      const result = await finalImport(true);
                      showNotice({
                        title: "Import complete",
                        message: `Imported ${result.imported?.learners ?? 0} learners, ${result.imported?.parents ?? 0} parents, ${result.imported?.classrooms ?? 0} classrooms.`,
                        details: `Project ${project.projectId} — use Rollback Last Import if you need to undo this batch.`,
                      });
                    } catch (e: unknown) {
                      const msg = e instanceof Error ? e.message : "Import failed";
                      showNotice({ title: "Import failed", message: msg });
                    } finally {
                      setBusy(false);
                    }
                  })();
                },
              },
            });
            return;
          }

          const preview = await previewStaging();
          showNotice({
            title: "Confirm final import",
            message: "No blocking errors. Classroom normalization preview:",
            details: formatNormalizationPreview(preview.normalizationPreview || []),
            primaryAction: {
              label: "Confirm & Import",
              onClick: () => {
                setNotice(null);
                void (async () => {
                  setBusy(true);
                  try {
                    const result = await finalImport(true);
                    showNotice({
                      title: "Import complete",
                      message: `Imported ${result.imported?.learners ?? 0} learners, ${result.imported?.parents ?? 0} parents, ${result.imported?.classrooms ?? 0} classrooms.`,
                    });
                  } catch (e: unknown) {
                    const msg = e instanceof Error ? e.message : "Import failed";
                    showNotice({ title: "Import failed", message: msg });
                  } finally {
                    setBusy(false);
                  }
                })();
              },
            },
          });
          return;
        }

        if (actionId === "rollbackImport") {
          const result = await rollbackImport();
          showNotice({
            title: "Rollback complete",
            message: "Last import batch removed from the school.",
            details: JSON.stringify(result.removed ?? {}, null, 2),
          });
          return;
        }

        if (actionId === "repairClassrooms") {
          const result = await repairClassrooms();
          showNotice({
            title: "Classroom repair complete",
            message: "Learner class names and duplicate classrooms were normalized for Teacher Portal and parent threads.",
            details: [
              `Learners updated: ${result.learnersUpdated}`,
              `Classrooms merged/renamed: ${result.classroomsMerged}`,
              `Parent threads synced: ${result.threadsSynced}`,
            ].join("\n"),
          });
          return;
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Action failed";
        showNotice({ title: "Migration action failed", message: msg });
      } finally {
        setBusy(false);
      }
    },
    [
      setBusy,
      createProject,
      validateFiles,
      importStaging,
      previewStaging,
      finalImport,
      rollbackImport,
      repairClassrooms,
      downloadTemplate,
      showNotice,
      selectedSchoolId,
      project,
    ]
  );

  return (
    <div className="sa-migration-page">
      <header className="sa-migration-header">
        <h1 className="page-title">Migration Center</h1>
        <p className="sa-migration-subtitle">
          {migrationSource === "kideesys"
            ? "Da Silva Academy Kid-e-Sys migration: upload XML exports, run a dry-run reconciliation, then import to staging and the live school when counts match."
            : "EduClear team migration control center. Import school data from external systems into EduClear. Learner, parent, and class imports only — billing and accounting are excluded from this pass."}
        </p>
        {project?.projectId ? (
          <p className="sa-migration-subtitle sa-migration-project-id">
            Active project: <strong>{project.projectId}</strong>
            {project.report
              ? ` · ${project.report.blockingErrorCount} blocking · ${project.report.warningCount} warnings`
              : ""}
          </p>
        ) : null}
      </header>

      <MigrationSummaryCards summary={summary} />

      <div className="sa-migration-layout">
        <div className="sa-migration-column sa-migration-column--primary">
          <MigrationSchoolSelect
            schools={schoolOptions}
            selectedSchoolId={selectedSchoolId}
            onSchoolChange={setSelectedSchoolId}
          />
          <MigrationSourceSelect
            value={migrationSource}
            onChange={handleSourceChange}
          />
          <MigrationFileUpload
            files={uploadedFiles}
            acceptedExtensions={acceptedExtensions}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            onClearFiles={clearFiles}
          />
          {migrationSource !== "kideesys" ? (
            <MigrationDataCategories selected={selectedCategories} onToggle={toggleCategory} />
          ) : null}
        </div>

        <div className="sa-migration-column sa-migration-column--secondary">
          <MigrationMappingTable rows={fieldMappings} hasUploadedFiles={hasUploadedFiles} />
          <MigrationIssuesTable issues={issues} />
          <MigrationActions onAction={handleAction} />
        </div>
      </div>

      {migrationSource === "kideesys" ? (
        <DaSilvaMigrationPanel
          schoolId={selectedSchoolId}
          disabled={!selectedSchoolId || busy}
          onNotice={showNotice}
        />
      ) : null}

      {notice ? <MigrationStubModal notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}
