import { useCallback, useRef, useState } from "react";
import type { UploadedMigrationFile } from "../../types/migration";

type Props = {
  files: UploadedMigrationFile[];
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

export default function MigrationFileUpload({
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
    <section className="sa-migration-section">
      <h2 className="sa-migration-section-title">3. Upload Files</h2>
      <p className="sa-migration-section-hint">
        Accepted: {acceptedExtensions.join(", ")}
      </p>

      <div
        className={`sa-migration-dropzone${dragOver ? " sa-migration-dropzone--active" : ""}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Upload migration files"
      >
        <input
          ref={inputRef}
          type="file"
          className="sa-migration-file-input"
          accept={acceptAttr}
          multiple
          onChange={(e) => {
            if (e.target.files?.length) onAddFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <span className="sa-migration-dropzone-icon" aria-hidden="true">
          ⬆
        </span>
        <p className="sa-migration-dropzone-title">Drag and drop files here</p>
        <p className="sa-migration-dropzone-text">or click to browse</p>
      </div>

      <div className="sa-migration-file-list-wrap">
        <div className="sa-migration-file-list-header">
          <h3 className="sa-migration-file-list-title">Uploaded files</h3>
          {files.length > 0 ? (
            <button type="button" className="sa-migration-link-btn" onClick={onClearFiles}>
              Clear all
            </button>
          ) : null}
        </div>
        {files.length === 0 ? (
          <p className="sa-migration-file-list-empty">No files uploaded yet.</p>
        ) : (
          <ul className="sa-migration-file-list">
            {files.map((file) => (
              <li key={file.id} className="sa-migration-file-item">
                <span className="sa-migration-file-name">{file.name}</span>
                <span className="sa-migration-file-meta">{formatBytes(file.size)}</span>
                <button
                  type="button"
                  className="sa-migration-file-remove"
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
