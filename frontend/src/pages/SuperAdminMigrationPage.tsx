import { useCallback, useState } from "react";
import { apiFetch } from "../api";
import MigrationActions from "../superAdmin/components/migration/MigrationActions";
import MigrationDataCategories from "../superAdmin/components/migration/MigrationDataCategories";
import MigrationFileUpload from "../superAdmin/components/migration/MigrationFileUpload";
import MigrationIssuesTable from "../superAdmin/components/migration/MigrationIssuesTable";
import MigrationMappingTable from "../superAdmin/components/migration/MigrationMappingTable";
import MigrationSchoolSelect from "../superAdmin/components/migration/MigrationSchoolSelect";
import MigrationSourceSelect from "../superAdmin/components/migration/MigrationSourceSelect";
import MigrationStubModal, { type StubNotice } from "../superAdmin/components/migration/MigrationStubModal";
import MigrationSummaryCards from "../superAdmin/components/migration/MigrationSummaryCards";
import { useMigrationCenter } from "../superAdmin/hooks/useMigrationCenter";
import type { MigrationActionId, MigrationSource } from "../superAdmin/types/migration";
import "./SuperAdminMigrationPage.css";

const ACTION_MESSAGES: Record<MigrationActionId, { title: string; message: string }> = {
  createProject: {
    title: "Create Migration Project",
    message: "Migration project creation will be available when the Super Admin migration API is connected.",
  },
  validateFiles: {
    title: "Validate Files",
    message: "File validation and field mapping will run here once the migration service is connected.",
  },
  importStaging: {
    title: "Import to Staging",
    message: "Staging import will load validated data into a preview environment before final import.",
  },
  finalImport: {
    title: "Final Import",
    message: "Final import will commit approved migration data into the selected school once validation passes.",
  },
  downloadTemplate: {
    title: "Download Import Template",
    message: "EduClear import templates will be available for download when the migration API is connected.",
  },
};

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
  } = useMigrationCenter();

  const [notice, setNotice] = useState<StubNotice | null>(null);

  const showStub = useCallback((title: string, message: string) => {
    setNotice({ title, message });
  }, []);

  const handleSourceChange = useCallback(
    (source: MigrationSource) => {
      setMigrationSource(source);
    },
    [setMigrationSource]
  );

  const handleAction = useCallback(
    async (actionId: MigrationActionId) => {
      if (actionId === "finalImport" && selectedSchoolId) {
        try {
          const result = await apiFetch("/api/parent-portal/migration/onboarding", {
            method: "POST",
            body: JSON.stringify({ schoolId: selectedSchoolId }),
          });
          showStub(
            "Parent onboarding started",
            `Created portal invitations for ${result.invited ?? 0} parents at ${result.schoolName || "the school"}. SMS/email/WhatsApp messages are queued (provider configuration required).`
          );
          return;
        } catch (e: any) {
          showStub("Parent onboarding failed", e?.message || "Could not run parent onboarding.");
          return;
        }
      }
      const payload = ACTION_MESSAGES[actionId];
      showStub(payload.title, payload.message);
    },
    [showStub, selectedSchoolId]
  );

  return (
    <div className="sa-migration-page">
      <header className="sa-migration-header">
        <h1 className="page-title">Migration Center</h1>
        <p className="sa-migration-subtitle">
          EduClear team migration control center. Import school data from external systems into EduClear.
        </p>
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
          <MigrationDataCategories selected={selectedCategories} onToggle={toggleCategory} />
        </div>

        <div className="sa-migration-column sa-migration-column--secondary">
          <MigrationMappingTable rows={fieldMappings} hasUploadedFiles={hasUploadedFiles} />
          <MigrationIssuesTable issues={issues} />
          <MigrationActions onAction={handleAction} />
        </div>
      </div>

      {notice ? <MigrationStubModal notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}
