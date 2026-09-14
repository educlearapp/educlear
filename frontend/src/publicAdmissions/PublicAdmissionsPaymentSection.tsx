import { useEffect, useId, useRef, useState } from "react";
import {
  ADMISSIONS_ACCEPT_ATTR,
  ADMISSIONS_MAX_UPLOAD_BYTES,
  validateAdmissionsFileClient,
} from "./documentRequirements";
import {
  downloadPublicApplicantDocumentBlob,
  fetchPublicApplicantPayment,
  PublicAdmissionsApiError,
  uploadPublicPaymentProof,
} from "./publicAdmissionsApi";
import {
  formatFeeDisplay,
  isPaymentEligibleApplicationStatus,
  parentFacingPaymentStatusTitle,
  shouldEncouragePopUpload,
} from "./paymentStatus";
import type { ApplicantPaymentView } from "./publicAdmissionsTypes";

type Props = {
  publicSlug: string;
  publicAccessId: string;
  accessToken: string;
  applicationStatus: string;
  onSessionInvalid: () => void;
};

function display(value: string | null | undefined): string {
  const v = String(value || "").trim();
  return v || "—";
}

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

async function copyText(value: string): Promise<boolean> {
  const text = String(value || "").trim();
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  return false;
}

/**
 * Post-submit admission fee + proof of payment (OA-06F).
 * Never called for DRAFT. Application-scoped fee only — no finance posting.
 */
export default function PublicAdmissionsPaymentSection({
  publicSlug,
  publicAccessId,
  accessToken,
  applicationStatus,
  onSessionInvalid,
}: Props) {
  const baseId = useId();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [payment, setPayment] = useState<ApplicantPaymentView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [statusLive, setStatusLive] = useState("");
  const [copyFlash, setCopyFlash] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const loadGen = useRef(0);

  const eligible = isPaymentEligibleApplicationStatus(applicationStatus);

  async function loadPayment() {
    const gen = ++loadGen.current;
    setLoading(true);
    setLoadError(null);
    try {
      const next = await fetchPublicApplicantPayment(publicSlug, publicAccessId, accessToken);
      if (gen !== loadGen.current) return;
      setPayment(next);
    } catch (err) {
      if (gen !== loadGen.current) return;
      if (err instanceof PublicAdmissionsApiError && err.status === 404) {
        onSessionInvalid();
        return;
      }
      if (err instanceof PublicAdmissionsApiError && err.code === "PAYMENT_REQUIRES_SUBMISSION") {
        setPayment(null);
        setLoadError(null);
        return;
      }
      setLoadError(
        err instanceof PublicAdmissionsApiError
          ? "We could not load payment details right now. Please try again shortly."
          : "We could not load payment details right now. Please try again shortly."
      );
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!eligible) {
      setPayment(null);
      setLoading(false);
      setLoadError(null);
      return;
    }
    void loadPayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when identity/status changes
  }, [publicSlug, publicAccessId, accessToken, applicationStatus, eligible]);

  async function handleCopy(label: string, value: string) {
    const ok = await copyText(value);
    setCopyFlash(ok ? `${label} copied` : `Could not copy ${label}`);
    window.setTimeout(() => setCopyFlash(null), 2000);
  }

  async function handleDownloadProof() {
    const doc = payment?.proofOfPayment?.document;
    if (!doc?.id || downloading) return;
    setDownloading(true);
    setUploadError(null);
    try {
      const { blob, fileName } = await downloadPublicApplicantDocumentBlob(
        publicSlug,
        publicAccessId,
        accessToken,
        doc.id
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName || doc.originalFileName || "proof-of-payment";
      a.click();
      URL.revokeObjectURL(url);
      setStatusLive("Proof of payment download started");
    } catch (err) {
      if (err instanceof PublicAdmissionsApiError && err.status === 404) {
        onSessionInvalid();
        return;
      }
      setUploadError("We could not download your proof of payment right now.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleUpload(file: File | null | undefined) {
    if (uploading) return;
    setUploadError(null);
    const validated = validateAdmissionsFileClient(file);
    if (!validated.ok) {
      setUploadError(validated.message);
      return;
    }
    if (!file) return;

    setUploading(true);
    setStatusLive("Uploading proof of payment…");
    try {
      await uploadPublicPaymentProof(publicSlug, publicAccessId, accessToken, file);
      setStatusLive("Proof of payment uploaded. Refreshing payment status…");
      await loadPayment();
      setStatusLive("Proof of payment received");
    } catch (err) {
      if (err instanceof PublicAdmissionsApiError && err.status === 404) {
        onSessionInvalid();
        return;
      }
      if (
        err instanceof PublicAdmissionsApiError &&
        (err.code === "POP_REQUIRES_SUBMISSION" ||
          err.code === "APPLICATION_TERMINAL" ||
          err.code === "PAYMENT_LOCKED" ||
          err.code === "FEE_NOT_REQUIRED")
      ) {
        setUploadError(
          "Proof of payment cannot be uploaded for this application right now. Refreshing status…"
        );
        await loadPayment();
        return;
      }
      if (err instanceof PublicAdmissionsApiError) {
        const code = String(err.code || "");
        if (code === "FILE_TOO_LARGE" || code === "UNSUPPORTED_FILE_TYPE" || code === "INVALID_FILE") {
          setUploadError(err.message || "Please upload a valid PDF, JPEG, or PNG (max 8 MB).");
          return;
        }
      }
      setUploadError(
        "We could not upload your proof of payment. Please try again with a clear PDF, JPEG, or PNG."
      );
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  if (!eligible) return null;

  if (loading && !payment) {
    return (
      <section className="pa-card" data-testid="pa-payment-section">
        <h3 className="pa-subsection-title">Admission fee</h3>
        <p className="pa-body">Loading payment details…</p>
      </section>
    );
  }

  if (loadError && !payment) {
    return (
      <section className="pa-card" data-testid="pa-payment-section">
        <h3 className="pa-subsection-title">Admission fee</h3>
        <p className="pa-banner-error" role="alert">
          {loadError}
        </p>
        <button type="button" className="pa-secondary-btn" onClick={() => void loadPayment()}>
          Retry
        </button>
      </section>
    );
  }

  if (!payment) return null;

  const status = String(payment.paymentStatus || "").toUpperCase();
  const showUpload = shouldEncouragePopUpload(payment, applicationStatus);
  const isPendingReview = status === "PROOF_UPLOADED" || status === "UNDER_VERIFICATION";
  const proofDoc = payment.proofOfPayment?.document;
  const rejectionMessage =
    status === "REJECTED"
      ? payment.guidance?.message ||
        "Your proof of payment could not be verified. Please upload a new copy."
      : null;

  return (
    <section className="pa-card pa-payment" data-testid="pa-payment-section" aria-live="polite">
      <h3 className="pa-subsection-title">Admission fee</h3>
      <p className="pa-payment-status" data-testid="pa-payment-status-title">
        {parentFacingPaymentStatusTitle(payment.paymentStatus)}
      </p>
      {payment.guidance?.message ? (
        <p className="pa-body" data-testid="pa-payment-guidance">
          {payment.guidance.message}
        </p>
      ) : null}

      {status === "NOT_REQUIRED" || !payment.feeRequired ? (
        <p className="pa-body" data-testid="pa-fee-not-required">
          No admission fee required
        </p>
      ) : null}

      {payment.feeRequired && status !== "NOT_REQUIRED" ? (
        <dl className="pa-review-dl">
          <div>
            <dt>Amount</dt>
            <dd data-testid="pa-fee-amount">
              {formatFeeDisplay(payment.feeAmount, payment.currency)}
            </dd>
          </div>
          <div>
            <dt>Payment status</dt>
            <dd data-testid="pa-payment-status-code">{status}</dd>
          </div>
          {payment.paymentReference ? (
            <div className="pa-review-full pa-copy-row">
              <dt>Payment reference</dt>
              <dd>
                <span data-testid="pa-payment-reference">{display(payment.paymentReference)}</span>
                <button
                  type="button"
                  className="pa-secondary-btn pa-copy-btn"
                  onClick={() => void handleCopy("Payment reference", payment.paymentReference || "")}
                >
                  Copy
                </button>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {payment.bankConfigurationIncomplete ? (
        <p className="pa-body" role="status">
          Payment instructions are not available yet. Please contact the school for how to pay.
        </p>
      ) : null}

      {payment.bank && payment.paymentInstructionsAvailable ? (
        <div className="pa-bank" data-testid="pa-bank-details">
          <h4 className="pa-subsection-title">Bank details</h4>
          <dl className="pa-review-dl">
            <div>
              <dt>Bank</dt>
              <dd>{display(payment.bank.bankName)}</dd>
            </div>
            <div>
              <dt>Account holder</dt>
              <dd>{display(payment.bank.accountHolder)}</dd>
            </div>
            <div className="pa-copy-row">
              <dt>Account number</dt>
              <dd>
                <span data-testid="pa-account-number">{display(payment.bank.accountNumber)}</span>
                <button
                  type="button"
                  className="pa-secondary-btn pa-copy-btn"
                  onClick={() => void handleCopy("Account number", payment.bank!.accountNumber)}
                >
                  Copy
                </button>
              </dd>
            </div>
            <div className="pa-copy-row">
              <dt>Branch code</dt>
              <dd>
                <span data-testid="pa-branch-code">{display(payment.bank.branchCode)}</span>
                <button
                  type="button"
                  className="pa-secondary-btn pa-copy-btn"
                  onClick={() => void handleCopy("Branch code", payment.bank!.branchCode)}
                >
                  Copy
                </button>
              </dd>
            </div>
            {payment.bank.accountType ? (
              <div>
                <dt>Account type</dt>
                <dd>{display(payment.bank.accountType)}</dd>
              </div>
            ) : null}
            {payment.bank.paymentInstructions ? (
              <div className="pa-review-full">
                <dt>Instructions</dt>
                <dd>{display(payment.bank.paymentInstructions)}</dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}

      {rejectionMessage ? (
        <div className="pa-payment-rejected" data-testid="pa-payment-rejected" role="alert">
          <p className="pa-body">{rejectionMessage}</p>
        </div>
      ) : null}

      {isPendingReview ? (
        <p className="pa-body" data-testid="pa-payment-waiting">
          Please wait while the school verifies your proof of payment. Uploading another copy is
          not needed unless you are asked to.
        </p>
      ) : null}

      {status === "VERIFIED" || status === "WAIVED" ? (
        <p className="pa-body" data-testid="pa-payment-satisfied">
          {status === "WAIVED"
            ? "The admission fee has been waived for this application."
            : "Your admission fee payment has been verified."}
        </p>
      ) : null}

      {proofDoc ? (
        <div className="pa-proof-meta" data-testid="pa-proof-meta">
          <p className="pa-body">
            Current proof: <strong>{display(proofDoc.originalFileName)}</strong>
            {proofDoc.uploadedAt ? ` · ${formatUploadedAt(proofDoc.uploadedAt) || ""}` : ""}
            {proofDoc.byteSize ? ` · ${formatBytes(proofDoc.byteSize)}` : ""}
          </p>
          <button
            type="button"
            className="pa-secondary-btn"
            disabled={downloading}
            onClick={() => void handleDownloadProof()}
            data-testid="pa-download-proof"
          >
            {downloading ? "Downloading…" : "Download proof"}
          </button>
        </div>
      ) : null}

      {showUpload ? (
        <div className="pa-pop-upload" data-testid="pa-pop-upload">
          <label className="pa-label" htmlFor={`${baseId}-pop-file`}>
            {status === "REJECTED" ? "Upload a new proof of payment" : "Upload proof of payment"}
          </label>
          <p className="pa-hint">
            PDF, JPEG, or PNG · max {Math.round(ADMISSIONS_MAX_UPLOAD_BYTES / (1024 * 1024))} MB
          </p>
          <input
            ref={fileInputRef}
            id={`${baseId}-pop-file`}
            type="file"
            className="pa-file-input"
            accept={ADMISSIONS_ACCEPT_ATTR}
            disabled={uploading}
            onChange={(e) => void handleUpload(e.target.files?.[0])}
            data-testid="pa-pop-file-input"
          />
          <button
            type="button"
            className="pa-primary-btn"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            data-testid="pa-pop-choose"
          >
            {uploading ? "Uploading…" : status === "REJECTED" ? "Choose replacement proof" : "Choose proof"}
          </button>
        </div>
      ) : null}

      {uploadError ? (
        <p className="pa-banner-error" role="alert" data-testid="pa-pop-error">
          {uploadError}
        </p>
      ) : null}
      {copyFlash ? (
        <p className="pa-hint" role="status">
          {copyFlash}
        </p>
      ) : null}
      <span className="pa-sr-only" aria-live="polite">
        {statusLive}
      </span>

      <p className="pa-hint">
        Admission fee payment is tracked on this application only. It is not automatically applied
        to a learner school fee account.
      </p>
    </section>
  );
}
