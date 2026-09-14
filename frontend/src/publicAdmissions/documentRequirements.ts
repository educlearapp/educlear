/**
 * Supporting-document helpers for public admissions DRAFT applications (OA-06D).
 * Excludes proof_of_payment — that is post-submission only.
 */
import type {
  ApplicantDocumentView,
  PublicAdmissionsConfig,
  PublicRequiredDocumentConfig,
} from "./publicAdmissionsTypes";

export const ADMISSIONS_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const ADMISSIONS_ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";
export const ADMISSIONS_ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png"] as const;
export const ADMISSIONS_ALLOWED_MIMES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
] as const;

const FALLBACK_LABELS: Record<string, string> = {
  birth_certificate: "Birth certificate",
  learner_id: "Learner ID / passport",
  parent_id: "Parent ID / passport",
  guardian_id: "Guardian ID / passport",
  previous_school_report: "Previous school report",
  transfer_document: "Transfer document",
  proof_of_residence: "Proof of residence",
  medical_document: "Medical document",
  supporting_document: "Supporting document",
};

export function humanizeDocumentType(documentType: string): string {
  const key = String(documentType || "").trim();
  if (!key) return "Document";
  if (FALLBACK_LABELS[key]) return FALLBACK_LABELS[key];
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function parseRequiredDocumentsConfig(
  requiredDocuments: unknown
): PublicRequiredDocumentConfig[] {
  if (!Array.isArray(requiredDocuments)) return [];
  const out: PublicRequiredDocumentConfig[] = [];
  const seen = new Set<string>();
  for (const item of requiredDocuments) {
    if (!item || typeof item !== "object") continue;
    const row = item as { key?: unknown; label?: unknown; required?: unknown };
    const key = String(row.key || "").trim();
    if (!key || key === "proof_of_payment" || seen.has(key)) continue;
    seen.add(key);
    const labelRaw = String(row.label || "").trim();
    out.push({
      key,
      label: labelRaw || null,
      required: row.required === true,
    });
  }
  return out;
}

/**
 * Build supporting-doc requirement rows from config + list API keys.
 * Prefer config labels/required; include list-only keys as optional.
 */
export function buildSupportingDocumentRequirements(input: {
  config: PublicAdmissionsConfig | null;
  listRequiredDocumentTypes: string[];
}): PublicRequiredDocumentConfig[] {
  const fromConfig = parseRequiredDocumentsConfig(input.config?.requiredDocuments);
  const byKey = new Map(fromConfig.map((r) => [r.key, r]));
  for (const raw of input.listRequiredDocumentTypes || []) {
    const key = String(raw || "").trim();
    if (!key || key === "proof_of_payment" || byKey.has(key)) continue;
    byKey.set(key, { key, label: null, required: false });
  }
  return Array.from(byKey.values());
}

export function labelForDocumentType(
  documentType: string,
  requirements: PublicRequiredDocumentConfig[]
): string {
  const key = String(documentType || "").trim();
  const match = requirements.find((r) => r.key === key);
  if (match?.label) return match.label;
  return humanizeDocumentType(key);
}

export function currentDocumentForType(
  documents: ApplicantDocumentView[],
  documentType: string
): ApplicantDocumentView | null {
  const key = String(documentType || "").trim();
  const matches = (documents || []).filter(
    (d) =>
      d &&
      !d.isProofOfPayment &&
      d.documentType !== "proof_of_payment" &&
      String(d.documentType) === key
  );
  if (!matches.length) return null;
  return [...matches].sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))[0];
}

export function supportingDocumentsOnly(
  documents: ApplicantDocumentView[]
): ApplicantDocumentView[] {
  return (documents || []).filter(
    (d) => d && !d.isProofOfPayment && d.documentType !== "proof_of_payment"
  );
}

export function deriveSupportingDocumentCompleteness(input: {
  requirements: PublicRequiredDocumentConfig[];
  documents: ApplicantDocumentView[];
}): {
  requiredTotal: number;
  requiredUploaded: number;
  missingKeys: string[];
  summary: string | null;
} {
  const required = input.requirements.filter((r) => r.required);
  const missingKeys: string[] = [];
  let requiredUploaded = 0;
  for (const req of required) {
    if (currentDocumentForType(input.documents, req.key)) {
      requiredUploaded += 1;
    } else {
      missingKeys.push(req.key);
    }
  }
  const requiredTotal = required.length;
  const summary =
    requiredTotal > 0
      ? `${requiredUploaded} of ${requiredTotal} required document${requiredTotal === 1 ? "" : "s"} uploaded`
      : null;
  return { requiredTotal, requiredUploaded, missingKeys, summary };
}

export type ClientFileValidationResult =
  | { ok: true }
  | { ok: false; code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE"; message: string };

export function validateAdmissionsFileClient(file: File | null | undefined): ClientFileValidationResult {
  if (!file) {
    return { ok: false, code: "EMPTY_FILE", message: "Please choose a file to upload." };
  }
  if (!file.size) {
    return { ok: false, code: "EMPTY_FILE", message: "The selected file is empty." };
  }
  if (file.size > ADMISSIONS_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: "File is too large. Maximum size is 8 MB.",
    };
  }
  const name = String(file.name || "").toLowerCase();
  const extOk = ADMISSIONS_ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const mime = String(file.type || "").toLowerCase();
  const mimeOk =
    !mime ||
    (ADMISSIONS_ALLOWED_MIMES as readonly string[]).includes(mime) ||
    mime === "image/jpg";
  if (!extOk && !mimeOk) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Please upload a PDF, JPEG, or PNG file.",
    };
  }
  if (!extOk) {
    return {
      ok: false,
      code: "UNSUPPORTED_FILE_TYPE",
      message: "Please upload a PDF, JPEG, or PNG file.",
    };
  }
  return { ok: true };
}
