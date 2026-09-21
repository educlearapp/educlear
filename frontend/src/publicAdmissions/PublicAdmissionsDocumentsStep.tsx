import { useEffect, useId, useRef, useState } from "react";
import {
  ADMISSIONS_ACCEPT_ATTR,
  buildSupportingDocumentRequirements,
  currentDocumentForType,
  deriveSupportingDocumentCompleteness,
  documentsForType,
  evaluateRequirementApplicability,
  labelForDocumentType,
  supportingDocumentsOnly,
  validateAdmissionsFileClient,
} from "./documentRequirements";
import {
  deletePublicApplicantDocument,
  downloadPublicApplicantDocumentBlob,
  listPublicApplicantDocuments,
  PublicAdmissionsApiError,
  uploadPublicApplicantDocument,
} from "./publicAdmissionsApi";
import type {
  ApplicantDocumentView,
  PublicAdmissionsConfig,
  PublicRequiredDocumentConfig,
} from "./publicAdmissionsTypes";

type Props = {
  publicSlug: string;
  publicAccessId: string;
  accessToken: string;
  config: PublicAdmissionsConfig | null;
  learnerCitizenship?: string | null;
  onSessionInvalid: () => void;
  onBackToDetails: () => void;
};

type RowBusy = {
  uploading?: boolean;
  deleting?: boolean;
  downloading?: boolean;
  error?: string | null;
};

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * OA-06D supporting documents step (DRAFT only). No payment / POP.
 */
export default function PublicAdmissionsDocumentsStep({
  publicSlug,
  publicAccessId,
  accessToken,
  config,
  learnerCitizenship,
  onSessionInvalid,
  onBackToDetails,
}: Props) {
  const baseId = useId();
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ApplicantDocumentView[]>([]);
  const [requirements, setRequirements] = useState<PublicRequiredDocumentConfig[]>([]);
  const [busy, setBusy] = useState<Record<string, RowBusy>>({});
  const [statusLive, setStatusLive] = useState("");
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const loadGen = useRef(0);

  function patchBusy(documentType: string, next: Partial<RowBusy>) {
    setBusy((prev) => ({
      ...prev,
      [documentType]: { ...prev[documentType], ...next },
    }));
  }

  function handleAuthFailure(err: unknown): boolean {
    if (err instanceof PublicAdmissionsApiError && err.status === 404) {
      onSessionInvalid();
      return true;
    }
    return false;
  }

  async function refreshDocuments() {
    const gen = ++loadGen.current;
    const listed = await listPublicApplicantDocuments(
      publicSlug,
      publicAccessId,
      accessToken
    );
    if (gen !== loadGen.current) return;
    const docs = supportingDocumentsOnly(listed.documents);
    setDocuments(docs);
    setRequirements(
      buildSupportingDocumentRequirements({
        config,
        listRequiredDocumentTypes: listed.requiredDocumentTypes,
      })
    );
  }

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setListError(null);
    void (async () => {
      try {
        await refreshDocuments();
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (cancelled) return;
        if (handleAuthFailure(err)) return;
        setListError(
          "We could not load your documents right now. Please try again shortly."
        );
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when identity changes
  }, [publicSlug, publicAccessId, accessToken, config]);

  async function handleUpload(documentType: string, file: File | null) {
    const validation = validateAdmissionsFileClient(file);
    if (!validation.ok || !file) {
      patchBusy(documentType, {
        error: validation.ok ? "Please choose a file to upload." : validation.message,
      });
      return;
    }

    patchBusy(documentType, { uploading: true, error: null });
    setStatusLive(`Uploading ${labelForDocumentType(documentType, requirements)}…`);
    try {
      await uploadPublicApplicantDocument(publicSlug, publicAccessId, accessToken, {
        documentType,
        file,
      });
      await refreshDocuments();
      patchBusy(documentType, { uploading: false, error: null });
      setStatusLive(
        `${labelForDocumentType(documentType, requirements)} uploaded successfully.`
      );
    } catch (err) {
      if (handleAuthFailure(err)) return;
      patchBusy(documentType, {
        uploading: false,
        error:
          err instanceof PublicAdmissionsApiError
            ? "Upload failed. Please try again with a PDF, JPEG, or PNG under 8 MB."
            : "Upload failed. Please try again.",
      });
      setStatusLive("Upload failed.");
    } finally {
      const input = fileInputs.current[documentType];
      if (input) input.value = "";
    }
  }

  async function handleDelete(documentType: string, document: ApplicantDocumentView) {
    const label = labelForDocumentType(documentType, requirements);
    if (
      !window.confirm(
        `Remove “${document.originalFileName}” for ${label}? You can upload a new file afterwards.`
      )
    ) {
      return;
    }

    patchBusy(documentType, { deleting: true, error: null });
    try {
      await deletePublicApplicantDocument(
        publicSlug,
        publicAccessId,
        accessToken,
        document.id
      );
      await refreshDocuments();
      patchBusy(documentType, { deleting: false, error: null });
      setStatusLive(`${label} removed.`);
    } catch (err) {
      if (handleAuthFailure(err)) return;
      patchBusy(documentType, {
        deleting: false,
        error: "Could not delete this document. Please try again.",
      });
    }
  }

  async function handleDownload(documentType: string, document: ApplicantDocumentView) {
    patchBusy(documentType, { downloading: true, error: null });
    let objectUrl: string | null = null;
    try {
      const result = await downloadPublicApplicantDocumentBlob(
        publicSlug,
        publicAccessId,
        accessToken,
        document.id
      );
      objectUrl = URL.createObjectURL(result.blob);
      const a = window.document.createElement("a");
      a.href = objectUrl;
      a.download = result.fileName || document.originalFileName || "document";
      a.rel = "noopener";
      window.document.body.appendChild(a);
      a.click();
      a.remove();
      patchBusy(documentType, { downloading: false, error: null });
    } catch (err) {
      if (handleAuthFailure(err)) return;
      patchBusy(documentType, {
        downloading: false,
        error: "Could not download this document. Please try again.",
      });
    } finally {
      if (objectUrl) {
        window.setTimeout(() => URL.revokeObjectURL(objectUrl!), 1000);
      }
    }
  }

  const completeness = deriveSupportingDocumentCompleteness({
    requirements,
    documents,
    learnerCitizenship,
  });
  const visibleRequirements = requirements.filter(
    (requirement) =>
      evaluateRequirementApplicability(requirement, learnerCitizenship) !== "not_applicable"
  );

  if (loading) {
    return (
      <section className="pa-card" aria-busy="true" aria-live="polite">
        <h2 className="pa-section-title">Documents</h2>
        <p className="pa-body">Loading your documents…</p>
      </section>
    );
  }

  if (listError) {
    return (
      <section className="pa-card">
        <h2 className="pa-section-title">Documents</h2>
        <p className="pa-banner-error" role="alert">
          {listError}
        </p>
        <div className="pa-cta-row pa-cta-row--stack">
          <button
            type="button"
            className="pa-cta"
            onClick={() => {
              setLoading(true);
              setListError(null);
              void refreshDocuments()
                .then(() => setLoading(false))
                .catch((err) => {
                  if (handleAuthFailure(err)) return;
                  setListError(
                    "We could not load your documents right now. Please try again shortly."
                  );
                  setLoading(false);
                });
            }}
          >
            Try again
          </button>
          <button type="button" className="pa-secondary-btn" onClick={onBackToDetails}>
            Back to details
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="pa-docs" data-testid="pa-documents-step">
      <div className="pa-sr-only" aria-live="polite">
        {statusLive}
      </div>

      <section className="pa-card">
        <h2 className="pa-section-title">Documents</h2>
        <p className="pa-body">
          Upload the supporting documents requested by the school. Accepted files: PDF, JPEG,
          or PNG up to 8 MB.
        </p>
        {completeness.summary ? (
          <p className="pa-docs-summary" data-testid="pa-docs-completeness">
            {completeness.summary}
          </p>
        ) : (
          <p className="pa-body">
            {visibleRequirements.length === 0
              ? "No supporting documents are currently required for this school."
              : "Upload any optional documents listed below."}
          </p>
        )}
      </section>

      {visibleRequirements.length === 0 ? (
        <section className="pa-card">
          <p className="pa-body">You can continue with your application details for now.</p>
        </section>
      ) : (
        visibleRequirements.map((req) => {
          const currentDocuments = documentsForType(documents, req.key);
          const current = currentDocumentForType(documents, req.key);
          const row = busy[req.key] || {};
          const label = labelForDocumentType(req.key, requirements);
          const inputId = `${baseId}-${req.key}`;
          const applicability = evaluateRequirementApplicability(req, learnerCitizenship);
          const atMaximum =
            req.allowMultiple && currentDocuments.length >= req.maxCount;
          const statusLabel =
            applicability === "unresolved"
              ? "Required if learner is not South African"
              : currentDocuments.length
                ? req.allowMultiple
                  ? `${currentDocuments.length} uploaded`
                  : req.required
                    ? "Required — Uploaded"
                    : "Optional — Uploaded"
                : req.required
                  ? "Required — Missing"
                  : "Optional — Not uploaded";

          return (
            <section
              key={req.key}
              className="pa-card pa-doc-card"
              data-testid={`pa-doc-card-${req.key}`}
              aria-labelledby={`${inputId}-title`}
            >
              <div className="pa-doc-card-head">
                <h3 id={`${inputId}-title`} className="pa-subsection-title">
                  {label}
                </h3>
                <span
                  className={`pa-doc-status ${
                    current
                      ? "pa-doc-status--ok"
                      : applicability === "unresolved"
                        ? "pa-doc-status--optional"
                        : req.required
                          ? "pa-doc-status--missing"
                          : "pa-doc-status--optional"
                  }`}
                  data-testid={`pa-doc-status-${req.key}`}
                >
                  {row.uploading ? "Uploading…" : statusLabel}
                </span>
              </div>

              {currentDocuments.length ? (
                currentDocuments.map((document) => (
                  <div
                    key={document.id}
                    className="pa-doc-current"
                    data-testid={`pa-doc-current-${req.key}`}
                  >
                    <p className="pa-doc-filename">{document.originalFileName}</p>
                    <p className="pa-body">
                      {[formatBytes(document.byteSize), formatUploadedAt(document.uploadedAt)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    <div className="pa-doc-actions">
                      <button
                        type="button"
                        className="pa-secondary-btn"
                        disabled={Boolean(row.uploading || row.deleting || row.downloading)}
                        onClick={() => void handleDownload(req.key, document)}
                      >
                        {row.downloading ? "Downloading…" : "Download"}
                      </button>
                      <button
                        type="button"
                        className="pa-link-button"
                        disabled={Boolean(row.uploading || row.deleting)}
                        onClick={() => void handleDelete(req.key, document)}
                      >
                        {row.deleting ? "Removing…" : "Delete"}
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="pa-body">No file uploaded yet.</p>
              )}

              {row.error ? (
                <p className="pa-field-error" role="alert">
                  {row.error}
                </p>
              ) : null}

              <input
                id={inputId}
                ref={(el) => {
                  fileInputs.current[req.key] = el;
                }}
                className="pa-file-input"
                type="file"
                accept={ADMISSIONS_ACCEPT_ATTR}
                disabled={Boolean(row.uploading || row.deleting || atMaximum)}
                aria-label={`${
                  req.allowMultiple && current ? "Add another" : current ? "Replace" : "Upload"
                } ${label}`}
                onChange={(e) => {
                  const file = e.target.files?.[0] || null;
                  void handleUpload(req.key, file);
                }}
              />

              <div className="pa-doc-actions">
                {!atMaximum ? (
                  <label htmlFor={inputId} className="pa-secondary-btn pa-file-label">
                    {row.uploading
                      ? "Uploading…"
                      : req.allowMultiple && current
                        ? "Add another file"
                        : current
                          ? "Replace file"
                          : "Choose file"}
                  </label>
                ) : (
                  <span className="pa-body">Maximum of {req.maxCount} files uploaded.</span>
                )}
              </div>
            </section>
          );
        })
      )}

      <section className="pa-card">
        <p className="pa-body">
          Payment instructions and proof of payment become available after you submit your
          application in a later step.
        </p>
        <div className="pa-cta-row pa-cta-row--stack">
          <button type="button" className="pa-secondary-btn" onClick={onBackToDetails}>
            Back to details
          </button>
        </div>
      </section>
    </div>
  );
}
