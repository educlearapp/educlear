import { useCallback, useRef, useState } from "react";
import type { UniversalMigrationFileCategory } from "../../superAdmin/utils/universalMigrationUpload";
import UniversalMigrationFilePreview from "./UniversalMigrationFilePreview";
import UniversalMigrationTemplateLoadModal from "./UniversalMigrationTemplateLoadModal";
import UniversalMigrationTemplateSaveModal from "./UniversalMigrationTemplateSaveModal";
import UniversalMigrationReadinessGuidance from "../../components/migration/UniversalMigrationReadinessGuidance";
import UniversalMigrationAdapterTestPanel from "../../components/migration/UniversalMigrationAdapterTestPanel";
import KidESysMigrationReadinessPanel from "../../components/migration/KidESysMigrationReadinessPanel";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

const ACCEPTED_EXTENSIONS = [".csv", ".xls", ".xlsx"];

const CATEGORY_LABELS: Record<UniversalMigrationFileCategory, string> = {
  learners: "Learners",
  parents: "Parents",
  billing: "Billing",
  transactions: "Transactions",
  staff: "Staff",
  historical: "Historical",
  unknown: "Unknown",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function mimeLabel(mimeType: string, filename: string): string {
  const lower = mimeType.toLowerCase();
  if (lower.includes("csv") || filename.toLowerCase().endsWith(".csv")) return "CSV";
  if (lower.includes("spreadsheetml") || filename.toLowerCase().endsWith(".xlsx")) return "XLSX";
  if (lower.includes("excel") || filename.toLowerCase().endsWith(".xls")) return "XLS";
  return mimeType.split("/").pop()?.toUpperCase() || "FILE";
}

export default function UniversalMigrationUpload() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const {
    uploadedFiles,
    previews,
    mappingSuggestions,
    mappingOverrides,
    effectiveMappings,
    previewBusy,
    mappingBusy,
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
    adapterTestBusy,
    adapterTestResult,
    canTestAdapter,
    rulesForSave,
    handleMappingOverride,
    handleTestAdapter,
    clearAll,
    handleApplyTemplate,
    uploadFiles,
    kidESysReadiness,
    kidESysReadinessBusy,
    kidESysReadinessError,
  } = useUniversalMigrationWorkflow();

  const isKidESys = sourceSystem.trim() === "kideesys";

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0 && !busy) {
        void uploadFiles(e.dataTransfer.files);
      }
    },
    [busy, uploadFiles]
  );

  return (
    <div className="uc-migration-upload">
      {registrySystemsToast ? (
        <p className="uc-migration-upload-error uc-migration-registry-toast" role="alert">
          {registrySystemsToast}
        </p>
      ) : null}

      <div className="uc-migration-upload-source-row">
        <label className="uc-migration-staging-source-label">
          Source system
          <select
            className="uc-migration-staging-source-input"
            value={sourceSystem}
            onChange={(e) => setSourceSystem(e.target.value)}
            disabled={busy || registrySystemsLoading || Boolean(registrySystemsError)}
          >
            {registrySystemsLoading ? (
              <option value={sourceSystem}>Loading source systems…</option>
            ) : registrySystemsError ? (
              <option value={sourceSystem}>Could not load source systems</option>
            ) : (
              registrySystems.map((s) => (
                <option key={s.systemId} value={s.systemId}>
                  {s.systemName}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      {registrySystemsError ? (
        <p className="uc-migration-upload-error" role="alert">
          {registrySystemsError}
        </p>
      ) : null}

      <UniversalMigrationReadinessGuidance
        template={readinessTemplate}
        templateLoading={readinessLoading}
        uploadedFiles={uploadedFiles}
        mappings={effectiveMappings}
      />

      <div className="uc-migration-adapter-test-actions">
        <button
          type="button"
          className="uc-migration-template-toolbar-btn uc-migration-template-toolbar-btn--secondary"
          onClick={() => void handleTestAdapter()}
          disabled={busy || previewBusy || mappingBusy || adapterTestBusy || !canTestAdapter}
        >
          {adapterTestBusy ? "Testing adapter…" : "Test Adapter Readiness"}
        </button>
        {!canTestAdapter ? (
          <p className="uc-migration-dry-run-hint" role="note">
            Select a source system, upload files, and wait for previews before running the adapter test.
          </p>
        ) : null}
      </div>

      <UniversalMigrationAdapterTestPanel result={adapterTestResult} busy={adapterTestBusy} />

      {isKidESys ? (
        <KidESysMigrationReadinessPanel
          result={kidESysReadiness}
          busy={kidESysReadinessBusy}
          error={kidESysReadinessError}
        />
      ) : null}

      <div
        className={`uc-migration-center-dropzone uc-migration-upload-dropzone${dragOver ? " uc-migration-upload-dropzone--active" : ""}${busy ? " uc-migration-upload-dropzone--busy" : ""}`}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onClick={() => {
          if (!busy) inputRef.current?.click();
        }}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload migration export files"
        aria-busy={busy}
      >
        <input
          ref={inputRef}
          type="file"
          className="uc-migration-upload-input"
          accept={ACCEPTED_EXTENSIONS.join(",")}
          multiple
          disabled={busy}
          onChange={(e) => {
            if (e.target.files?.length) void uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="uc-migration-center-dropzone-icon" aria-hidden="true">
          ⬆
        </span>
        <p className="uc-migration-center-dropzone-title">Drag and drop export files</p>
        <p className="uc-migration-center-dropzone-text">
          CSV, XLS, XLSX — multi-file supported. Files are stored untouched in migration staging.
        </p>
        {uploadProgress != null ? (
          <p className="uc-migration-upload-progress" aria-live="polite">
            Uploading… {uploadProgress}%
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="uc-migration-upload-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="uc-migration-upload-list-wrap">
        <div className="uc-migration-upload-list-header">
          <h3 className="uc-migration-upload-list-title">Uploaded files</h3>
          {uploadedFiles.length > 0 ? (
            <button type="button" className="uc-migration-upload-clear" onClick={clearAll} disabled={busy}>
              Clear list
            </button>
          ) : null}
        </div>

        {uploadedFiles.length === 0 ? (
          <p className="uc-migration-upload-empty">No files uploaded yet.</p>
        ) : (
          <ul className="uc-migration-upload-list">
            {uploadedFiles.map((file) => (
              <li key={file.id} className="uc-migration-upload-item">
                <div className="uc-migration-upload-item-main">
                  <span className="uc-migration-upload-filename">{file.filename}</span>
                  <span className="uc-migration-upload-meta">{formatBytes(file.size)}</span>
                </div>
                <div className="uc-migration-upload-item-badges">
                  <span
                    className={`uc-migration-upload-badge uc-migration-upload-badge--category uc-migration-upload-badge--${file.category}`}
                  >
                    {CATEGORY_LABELS[file.category]}
                  </span>
                  <span className="uc-migration-upload-badge uc-migration-upload-badge--type">
                    {mimeLabel(file.mimeType, file.filename)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {templateNotice ? (
        <p className="uc-migration-template-notice" role="status">
          {templateNotice}
        </p>
      ) : null}

      {previews.length > 0 ? (
        <div className="uc-migration-preview-section">
          <div className="uc-migration-preview-section-header">
            <h3 className="uc-migration-upload-list-title">File previews &amp; mapping</h3>
            <div className="uc-migration-preview-section-actions">
              <button
                type="button"
                className="uc-migration-template-toolbar-btn"
                onClick={() => setSaveTemplateOpen(true)}
                disabled={busy || previewBusy || mappingBusy || mappingSuggestions.length === 0}
              >
                Save as Template
              </button>
              <button
                type="button"
                className="uc-migration-template-toolbar-btn uc-migration-template-toolbar-btn--secondary"
                onClick={() => setLoadTemplateOpen(true)}
                disabled={busy || previewBusy || mappingBusy}
              >
                Load Template
              </button>
              {previewBusy || mappingBusy ? (
                <span className="uc-migration-preview-loading" aria-live="polite">
                  {previewBusy ? "Loading preview…" : "Suggesting mappings…"}
                </span>
              ) : null}
            </div>
          </div>
          <div className="uc-migration-preview-cards">
            {previews.map((preview) => {
              const suggestion = mappingSuggestions.find((s) => s.fileId === preview.fileId);
              return (
                <UniversalMigrationFilePreview
                  key={preview.fileId}
                  preview={preview}
                  mappingSuggestion={suggestion}
                  mappingOverrides={mappingOverrides[preview.fileId] ?? {}}
                  onMappingOverrideChange={(sourceColumn, target) =>
                    handleMappingOverride(preview.fileId, sourceColumn, target)
                  }
                />
              );
            })}
          </div>
        </div>
      ) : null}

      {saveTemplateOpen ? (
        <UniversalMigrationTemplateSaveModal
          mappings={rulesForSave}
          onClose={() => setSaveTemplateOpen(false)}
          onSaved={() => {
            setTemplateNotice("Mapping template saved.");
            setSaveTemplateOpen(false);
          }}
        />
      ) : null}

      {loadTemplateOpen ? (
        <UniversalMigrationTemplateLoadModal
          onClose={() => setLoadTemplateOpen(false)}
          onApply={handleApplyTemplate}
        />
      ) : null}
    </div>
  );
}
