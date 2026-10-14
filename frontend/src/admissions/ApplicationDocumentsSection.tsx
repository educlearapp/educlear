import { useEffect, useRef, useState } from "react";
import {
  documentTypeDisplay,
  formatFileSize,
} from "./admissionsDocumentActions";
import {
  fetchApplicationCombinedPdfFile,
  fetchApplicationDocumentFile,
  fetchApplicationDocumentsZipFile,
  fetchApplicationPackZipFile,
  fetchApplicationPdfFile,
  type StaffAdmissionsFile,
} from "./staffAdmissionsApi";
import type { StaffApplicationDetail } from "./staffAdmissionsTypes";

type Props = {
  detail: Pick<StaffApplicationDetail, "id" | "documents">;
  canDownloadFullApplication: boolean;
};

/** Object URLs are revoked shortly after use so no long-lived links remain. */
const OBJECT_URL_TTL_MS = 60_000;

function formatUploaded(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function saveFile(file: StaffAdmissionsFile, urls: Set<string>) {
  const url = URL.createObjectURL(file.blob);
  urls.add(url);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    urls.delete(url);
  }, OBJECT_URL_TTL_MS);
}

export default function ApplicationDocumentsSection({ detail, canDownloadFullApplication }: Props) {
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const urlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      urls.clear();
    };
  }, []);

  const run = async (key: string, task: () => Promise<void>) => {
    if (busyKey) return;
    setBusyKey(key);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The download could not be prepared. Please try again.");
    } finally {
      setBusyKey(null);
    }
  };

  /** Opens a tab synchronously (avoids pop-up blockers), then loads the authorised blob into it. */
  const openInNewTab = async (key: string, load: () => Promise<StaffAdmissionsFile>, label: string) => {
    if (busyKey) return;
    const win = window.open("", "_blank");
    await run(key, async () => {
      try {
        const file = await load();
        const url = URL.createObjectURL(file.blob);
        urlsRef.current.add(url);
        window.setTimeout(() => {
          URL.revokeObjectURL(url);
          urlsRef.current.delete(url);
        }, OBJECT_URL_TTL_MS);
        if (win && !win.closed) {
          win.location.href = url;
          setNotice(`${label} opened in a new tab.`);
        } else {
          saveFile(file, urlsRef.current);
          setNotice(`Pop-ups are blocked, so ${label.toLowerCase()} was downloaded instead.`);
        }
      } catch (err) {
        if (win && !win.closed) win.close();
        throw err;
      }
    });
  };

  const download = (key: string, load: () => Promise<StaffAdmissionsFile>) =>
    run(key, async () => {
      saveFile(await load(), urlsRef.current);
    });

  const docs = detail.documents;
  const busy = busyKey !== null;
  const label = (key: string, idle: string, working: string) => (busyKey === key ? working : idle);

  return (
    <section
      className="admissions-staff-card admissions-staff-docs-section"
      aria-labelledby="admissions-app-docs-heading"
      data-testid="admissions-application-documents"
    >
      <h2 id="admissions-app-docs-heading" className="admissions-staff-card-title">
        Application documents
      </h2>
      <p className="admissions-staff-docs-note">
        Viewing, printing and downloading never change the application or payment status. Each download is recorded in the audit trail.
      </p>

      {canDownloadFullApplication ? (
        <div className="admissions-staff-docs-toolbar" role="group" aria-label="Application print and download">
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--gold"
            disabled={busy}
            onClick={() => void openInNewTab("print", () => fetchApplicationPdfFile(detail.id), "Application PDF")}
          >
            {label("print", "Print application", "Preparing…")}
          </button>
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={busy}
            onClick={() => void download("pdf", () => fetchApplicationPdfFile(detail.id))}
          >
            {label("pdf", "Download application PDF", "Preparing…")}
          </button>
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={busy}
            onClick={() =>
              void openInNewTab("combined", () => fetchApplicationCombinedPdfFile(detail.id), "Complete printable PDF")
            }
          >
            {label("combined", "Print with attachments", "Preparing…")}
          </button>
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={busy || docs.length === 0}
            onClick={() => void download("zip", () => fetchApplicationDocumentsZipFile(detail.id))}
          >
            {label("zip", "Download all documents", "Preparing ZIP…")}
          </button>
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={busy}
            onClick={() => void download("pack", () => fetchApplicationPackZipFile(detail.id))}
          >
            {label("pack", "Download complete application pack", "Preparing pack…")}
          </button>
        </div>
      ) : (
        <p className="admissions-staff-docs-note">
          Printing the full application and downloading packs requires admissions edit access.
        </p>
      )}

      {busy ? (
        <div className="admissions-staff-docs-status" role="status" aria-live="polite">
          Preparing your file — large applications can take a few seconds…
        </div>
      ) : null}
      {error ? (
        <div className="admissions-staff-alert admissions-staff-alert--error" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="admissions-staff-alert admissions-staff-alert--success" role="status">
          {notice}
        </div>
      ) : null}

      {docs.length === 0 ? (
        <p className="admissions-staff-docs-note" style={{ marginTop: 12 }}>
          No documents have been uploaded for this application.
        </p>
      ) : (
        <ul className="admissions-staff-docs-list">
          {docs.map((doc) => (
            <li key={doc.id} className="admissions-staff-docs-item">
              <div className="admissions-staff-docs-meta">
                <strong>{documentTypeDisplay(doc.documentType)}</strong>
                <span className="admissions-staff-docs-file">{doc.originalFileName}</span>
                <span className="admissions-staff-docs-sub">
                  {doc.contentType} · {formatFileSize(doc.byteSize)} · uploaded {formatUploaded(doc.uploadedAt)}
                </span>
              </div>
              <div className="admissions-staff-docs-actions">
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--outline"
                  disabled={busy}
                  aria-label={`View ${documentTypeDisplay(doc.documentType)}`}
                  onClick={() =>
                    void openInNewTab(
                      `view-${doc.id}`,
                      () => fetchApplicationDocumentFile(detail.id, doc.id, "view"),
                      documentTypeDisplay(doc.documentType)
                    )
                  }
                >
                  {label(`view-${doc.id}`, "View", "Opening…")}
                </button>
                <button
                  type="button"
                  className="admissions-staff-btn admissions-staff-btn--outline"
                  disabled={busy}
                  aria-label={`Download ${documentTypeDisplay(doc.documentType)}`}
                  onClick={() =>
                    void download(`dl-${doc.id}`, () => fetchApplicationDocumentFile(detail.id, doc.id, "download"))
                  }
                >
                  {label(`dl-${doc.id}`, "Download", "Preparing…")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
