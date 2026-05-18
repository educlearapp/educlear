import { useCallback, useState } from "react";
import { useSchoolId } from "../useSchoolId";
import SasamsFileUpload from "../schoolSasams/components/SasamsFileUpload";
import SasamsReportActions from "../schoolSasams/components/SasamsReportActions";
import SasamsStubModal from "../schoolSasams/components/SasamsStubModal";
import SasamsSummaryCards from "../schoolSasams/components/SasamsSummaryCards";
import SasamsUploadTypeSelect from "../schoolSasams/components/SasamsUploadTypeSelect";
import SasamsValidationTable from "../schoolSasams/components/SasamsValidationTable";
import { downloadSasamsCsvTemplate } from "../schoolSasams/components/sasamsConstants";
import { buildSasamsReportApiPath, useSasamsReportUpload } from "../schoolSasams/hooks/useSasamsReportUpload";
import type { SasamsModalState, SasamsReportActionId } from "../schoolSasams/types/sasamsReport";
import "./SchoolSasamsReportUploadPage.css";

const COMING_SOON_MODAL: SasamsModalState = {
  title: "Coming Soon",
  message: "Report upload engine coming soon.",
};

export default function SchoolSasamsReportUploadPage() {
  const schoolId = useSchoolId();
  const {
    summary,
    uploadType,
    setUploadType,
    uploadedFiles,
    hasUploadedFiles,
    addFiles,
    removeFile,
    clearFiles,
    validationRows,
    acceptedExtensions,
    apiContext,
  } = useSasamsReportUpload(schoolId);

  const [modal, setModal] = useState<SasamsModalState>(null);

  const handleAction = useCallback(
    (actionId: SasamsReportActionId) => {
      void buildSasamsReportApiPath(actionId, apiContext);

      if (actionId === "downloadTemplate") {
        downloadSasamsCsvTemplate();
        return;
      }

      if (actionId === "validateFile") {
        if (!hasUploadedFiles) {
          setModal({
            title: "Upload Required",
            message: "Please upload a SASAMS file first.",
          });
          return;
        }

        setModal({
          title: "Validation Ready",
          message: "Validation engine ready for backend integration.",
        });
        return;
      }

      setModal(COMING_SOON_MODAL);
    },
    [apiContext, hasUploadedFiles]
  );

  if (!schoolId) {
    return (
      <div className="sasams-report-page">
        <h1 className="page-title">SASAMS Report Upload</h1>
        <p className="sasams-report-subtitle">Loading school context…</p>
      </div>
    );
  }

  return (
    <div className="sasams-report-page">
      <header className="sasams-report-header">
        <h1 className="page-title">SASAMS Report Upload</h1>
        <p className="sasams-report-subtitle">
          Upload SASAMS exports for your school to validate learner data and prepare digital reports.
        </p>
      </header>

      <SasamsSummaryCards summary={summary} />

      <div className="sasams-report-layout">
        <div className="sasams-report-column sasams-report-column--primary">
          <SasamsFileUpload
            files={uploadedFiles}
            acceptedExtensions={acceptedExtensions}
            onAddFiles={addFiles}
            onRemoveFile={removeFile}
            onClearFiles={clearFiles}
          />
          <SasamsUploadTypeSelect value={uploadType} onChange={setUploadType} />
        </div>

        <div className="sasams-report-column sasams-report-column--secondary">
          <SasamsValidationTable rows={validationRows} hasUploadedFiles={hasUploadedFiles} />
          <SasamsReportActions onAction={handleAction} />
        </div>
      </div>

      {modal ? (
        <SasamsStubModal title={modal.title} message={modal.message} onClose={() => setModal(null)} />
      ) : null}
    </div>
  );
}
