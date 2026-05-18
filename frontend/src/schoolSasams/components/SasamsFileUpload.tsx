import { useCallback, useRef, useState } from "react";
import type { UploadedSasamsFile } from "../types/sasamsReport";

type Props = {
  files: UploadedSasamsFile[];
  acceptedExtensions: string[];
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveFile: (id: string) => void;
  onClearFiles: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatFileType(mimeType: string, fileName: string): string {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "CSV";
  if (lower.endsWith(".xlsx")) return "XLSX";
  if (lower.endsWith(".xls")) return "XLS";
  if (mimeType.includes("csv")) return "CSV";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "Spreadsheet";
  return mimeType.split("/").pop()?.toUpperCase() || "File";
}

function formatUploadedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SasamsFileUpload({
  files,
  acceptedExtensions,
  onAddFiles,
  onRemoveFile,
  onClearFiles,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const acceptAttr = acceptedExtensions.join(",");

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        onAddFiles(e.dataTransfer.files);
      }
    },
    [onAddFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  return (
    <section className="sasams-report-section">
      <h2 className="sasams-report-section-title">1. Upload SASAMS File</h2>
      <p className="sasams-report-section-hint">
        Upload SASAMS learner/report export files to prepare EduClear digital reports.
      </p>
      <p className="sasams-report-section-meta">
        Accepted formats: {acceptedExtensions.join(", ")}
      </p>

      <div
        className={`sasams-report-dropzone${dragOver ? " sasams-report-dropzone--active" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="region"
        aria-label="SASAMS file drop zone"
      >
        <input
          ref={inputRef}
          type="file"
          className="sasams-report-file-input"
          accept={acceptAttr}
          multiple
          onChange={(e) => {
            if (e.target.files?.length) onAddFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="sasams-report-dropzone-icon" aria-hidden="true">
          ⬆
        </span>
        <p className="sasams-report-dropzone-title">Drag and drop files here</p>
        <button
          type="button"
          className="sasams-report-btn sasams-report-btn--gold"
          onClick={() => inputRef.current?.click()}
        >
          Choose File
        </button>
      </div>

      <div className="sasams-report-file-list-wrap">
        <div className="sasams-report-file-list-header">
          <h3 className="sasams-report-file-list-title">Uploaded files</h3>
          {files.length > 0 ? (
            <button type="button" className="sasams-report-link-btn" onClick={onClearFiles}>
              Clear all
            </button>
          ) : null}
        </div>
        {files.length === 0 ? (
          <p className="sasams-report-file-list-empty">No files uploaded yet.</p>
        ) : (
          <ul className="sasams-report-file-list">
            {files.map((file) => (
              <li key={file.id} className="sasams-report-file-item">
                <div className="sasams-report-file-info">
                  <span className="sasams-report-file-name">{file.name}</span>
                  <span className="sasams-report-file-meta">
                    {formatBytes(file.size)} · {formatFileType(file.type, file.name)} ·{" "}
                    {formatUploadedAt(file.uploadedAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="sasams-report-file-remove"
                  onClick={() => onRemoveFile(file.id)}
                  aria-label={`Remove ${file.name}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
