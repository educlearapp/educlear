import { API_URL } from "../api";
import type {
  ApplicantApplicationResponse,
  ApplicantApplicationView,
  ApplicantDocumentUploadResponse,
  ApplicantDocumentsListResponse,
  ApplicantDocumentView,
  ApplicantPaymentProofUploadResponse,
  ApplicantPaymentResponse,
  ApplicantPaymentView,
  CreateDraftApplicationBody,
  CreateDraftApplicationResponse,
  PublicAdmissionsConfig,
  PublicAdmissionsConfigResponse,
  PublicValidationDetail,
  SubmitApplicationResponse,
  UpdateDraftApplicationBody,
} from "./publicAdmissionsTypes";

export class PublicAdmissionsApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly details: PublicValidationDetail[];

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    details: PublicValidationDetail[] = []
  ) {
    super(message);
    this.name = "PublicAdmissionsApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function normalizeSlug(publicSlug: string): string {
  return String(publicSlug || "")
    .trim()
    .toLowerCase();
}

function applicantAuthHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Admissions-Access-Token": String(accessToken || "").trim(),
  };
}

/** Auth header for multipart uploads — do not set Content-Type (browser boundary). */
function applicantTokenOnlyHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Admissions-Access-Token": String(accessToken || "").trim(),
  };
}

async function parseJson(res: Response): Promise<Record<string, unknown>> {
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

function parseDetails(payload: Record<string, unknown>): PublicValidationDetail[] {
  const raw = payload.details;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d) => d && typeof d === "object")
    .map((d) => {
      const row = d as { field?: unknown; message?: unknown };
      return {
        field: String(row.field || ""),
        message: String(row.message || "Please review this field"),
      };
    })
    .filter((d) => d.field || d.message);
}

function throwFromPayload(res: Response, payload: Record<string, unknown>, fallback: string): never {
  throw new PublicAdmissionsApiError(
    String(payload.error || fallback),
    res.status,
    payload.code ? String(payload.code) : null,
    parseDetails(payload)
  );
}

/**
 * Fetch public admissions config for a school slug.
 * Must NOT send staff JWT / staffAuthHeaders.
 */
export async function fetchPublicAdmissionsConfig(
  publicSlug: string
): Promise<PublicAdmissionsConfig> {
  const slug = normalizeSlug(publicSlug);
  if (!slug) {
    throw new PublicAdmissionsApiError("Admissions not found", 404, "ADMISSIONS_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/config`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const payload = (await parseJson(res)) as PublicAdmissionsConfigResponse;

  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Admissions unavailable");
  }

  if (!payload?.success || !payload.config) {
    throw new PublicAdmissionsApiError("Admissions unavailable", 500, "INVALID_RESPONSE");
  }

  return payload.config;
}

/**
 * Create a DRAFT application. Call only after explicit applicant action.
 * Returns plaintext access token once — store locally for resume.
 */
export async function createPublicDraftApplication(
  publicSlug: string,
  body: CreateDraftApplicationBody = {}
): Promise<{
  application: ApplicantApplicationView;
  accessToken: string;
  accessTokenExpiresAt: string | null;
}> {
  const slug = normalizeSlug(publicSlug);
  if (!slug) {
    throw new PublicAdmissionsApiError("Admissions not found", 404, "ADMISSIONS_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/applications`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  const payload = (await parseJson(res)) as CreateDraftApplicationResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not start application");
  }
  if (!payload.success || !payload.application || !payload.accessToken) {
    throw new PublicAdmissionsApiError("Could not start application", 500, "INVALID_RESPONSE");
  }

  return {
    application: payload.application,
    accessToken: String(payload.accessToken),
    accessTokenExpiresAt: payload.accessTokenExpiresAt
      ? String(payload.accessTokenExpiresAt)
      : null,
  };
}

export async function fetchPublicDraftApplication(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string
): Promise<ApplicantApplicationView> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/applications/${encodeURIComponent(accessId)}`,
    {
      method: "GET",
      headers: applicantAuthHeaders(token),
    }
  );

  const payload = (await parseJson(res)) as ApplicantApplicationResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Application not found");
  }
  if (!payload.success || !payload.application) {
    throw new PublicAdmissionsApiError("Application not found", 500, "INVALID_RESPONSE");
  }
  return payload.application;
}

export async function updatePublicDraftApplication(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string,
  body: UpdateDraftApplicationBody
): Promise<ApplicantApplicationView> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const res = await fetch(
    `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/applications/${encodeURIComponent(accessId)}`,
    {
      method: "PATCH",
      headers: applicantAuthHeaders(token),
      body: JSON.stringify(body),
    }
  );

  const payload = (await parseJson(res)) as ApplicantApplicationResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not save application");
  }
  if (!payload.success || !payload.application) {
    throw new PublicAdmissionsApiError("Could not save application", 500, "INVALID_RESPONSE");
  }
  return payload.application;
}

function applicationsBase(slug: string, publicAccessId: string): string {
  return `${API_URL}/api/public/admissions/${encodeURIComponent(slug)}/applications/${encodeURIComponent(publicAccessId)}`;
}

export async function listPublicApplicantDocuments(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string
): Promise<{ documents: ApplicantDocumentView[]; requiredDocumentTypes: string[] }> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const res = await fetch(`${applicationsBase(slug, accessId)}/documents`, {
    method: "GET",
    headers: applicantAuthHeaders(token),
  });
  const payload = (await parseJson(res)) as ApplicantDocumentsListResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not load documents");
  }
  if (!payload.success) {
    throw new PublicAdmissionsApiError("Could not load documents", 500, "INVALID_RESPONSE");
  }
  return {
    documents: Array.isArray(payload.documents) ? payload.documents : [],
    requiredDocumentTypes: Array.isArray(payload.requiredDocumentTypes)
      ? payload.requiredDocumentTypes.map((t) => String(t))
      : [],
  };
}

export async function signPublicFinancialAgreement(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string,
  input: {
    policyAccepted: boolean;
    declarationAccepted: boolean;
    typedSignerName: string;
    strokeCount: number;
    signature: Blob;
  }
): Promise<ApplicantApplicationView> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token || !input.signature) {
    throw new PublicAdmissionsApiError("Could not sign financial agreement", 400, "INVALID_SIGNATURE");
  }
  const body = new FormData();
  body.append("file", input.signature, "signature.png");
  body.append("policyAccepted", input.policyAccepted ? "true" : "false");
  body.append("declarationAccepted", input.declarationAccepted ? "true" : "false");
  body.append("typedSignerName", input.typedSignerName);
  body.append("strokeCount", String(input.strokeCount));
  const res = await fetch(`${applicationsBase(slug, accessId)}/financial-agreement`, {
    method: "POST",
    headers: applicantTokenOnlyHeaders(token),
    body,
  });
  const payload = (await parseJson(res)) as Record<string, unknown>;
  if (!res.ok) {
    throwFromPayload(res, payload, "Could not sign financial agreement");
  }
  const application = payload.application as ApplicantApplicationView | undefined;
  if (!payload.success || !application) {
    throw new PublicAdmissionsApiError("Could not sign financial agreement", 500, "INVALID_RESPONSE");
  }
  return application;
}

export async function uploadPublicApplicantDocument(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string,
  input: { documentType: string; file: File }
): Promise<ApplicantDocumentView> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  const documentType = String(input.documentType || "").trim();
  if (!slug || !accessId || !token || !documentType || !input.file) {
    throw new PublicAdmissionsApiError("Could not upload document", 400, "INVALID_UPLOAD");
  }

  const body = new FormData();
  body.append("file", input.file);
  body.append("documentType", documentType);

  const res = await fetch(`${applicationsBase(slug, accessId)}/documents`, {
    method: "POST",
    headers: applicantTokenOnlyHeaders(token),
    body,
  });
  const payload = (await parseJson(res)) as ApplicantDocumentUploadResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not upload document");
  }
  if (!payload.success || !payload.document) {
    throw new PublicAdmissionsApiError("Could not upload document", 500, "INVALID_RESPONSE");
  }
  return payload.document;
}

export async function deletePublicApplicantDocument(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string,
  documentId: string
): Promise<void> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  const docId = String(documentId || "").trim();
  if (!slug || !accessId || !token || !docId) {
    throw new PublicAdmissionsApiError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const res = await fetch(
    `${applicationsBase(slug, accessId)}/documents/${encodeURIComponent(docId)}`,
    {
      method: "DELETE",
      headers: applicantAuthHeaders(token),
    }
  );
  const payload = await parseJson(res);
  if (!res.ok) {
    throwFromPayload(res, payload, "Could not delete document");
  }
}

/**
 * Authenticated download — returns a Blob. Caller creates/revokes object URLs.
 * Never puts the access token in a URL.
 */
export async function downloadPublicApplicantDocumentBlob(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string,
  documentId: string
): Promise<{ blob: Blob; contentType: string; fileName: string | null }> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  const docId = String(documentId || "").trim();
  if (!slug || !accessId || !token || !docId) {
    throw new PublicAdmissionsApiError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }

  const res = await fetch(
    `${applicationsBase(slug, accessId)}/documents/${encodeURIComponent(docId)}/download`,
    {
      method: "GET",
      headers: {
        Accept: "*/*",
        "X-Admissions-Access-Token": token,
      },
    }
  );

  if (!res.ok) {
    const payload = await parseJson(res).catch(() => ({}));
    throwFromPayload(res, payload, "Could not download document");
  }

  const blob = await res.blob();
  const contentType = res.headers.get("Content-Type") || blob.type || "application/octet-stream";
  const disposition = res.headers.get("Content-Disposition") || "";
  const match = /filename="([^"]+)"/i.exec(disposition);
  return {
    blob,
    contentType,
    fileName: match?.[1] || null,
  };
}

/**
 * GET applicant payment instructions (post-submit only).
 * Bank details only after formal submission — never call for DRAFT.
 */
export async function fetchPublicApplicantPayment(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string
): Promise<ApplicantPaymentView> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const res = await fetch(`${applicationsBase(slug, accessId)}/payment`, {
    method: "GET",
    headers: applicantAuthHeaders(token),
  });
  const payload = (await parseJson(res)) as ApplicantPaymentResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not load payment details");
  }
  if (!payload.success || !payload.payment) {
    throw new PublicAdmissionsApiError("Could not load payment details", 500, "INVALID_RESPONSE");
  }
  return payload.payment;
}

/**
 * POST proof of payment (multipart field: file). Does not mark payment VERIFIED.
 */
export async function uploadPublicPaymentProof(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string,
  file: File
): Promise<{ document: ApplicantDocumentView; paymentStatus: string }> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const form = new FormData();
  form.append("file", file);

  const res = await fetch(`${applicationsBase(slug, accessId)}/payment-proof`, {
    method: "POST",
    headers: applicantTokenOnlyHeaders(token),
    body: form,
  });
  const payload = (await parseJson(res)) as ApplicantPaymentProofUploadResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not upload proof of payment");
  }
  if (!payload.success || !payload.document || !payload.paymentStatus) {
    throw new PublicAdmissionsApiError(
      "Could not upload proof of payment",
      500,
      "INVALID_RESPONSE"
    );
  }
  return {
    document: payload.document,
    paymentStatus: String(payload.paymentStatus),
  };
}

/**
 * Formal submit DRAFT → SUBMITTED. Idempotent for already-submitted apps.
 * Does not return bank details.
 */
export async function submitPublicApplication(
  publicSlug: string,
  publicAccessId: string,
  accessToken: string
): Promise<{
  application: ApplicantApplicationView;
  paymentInstructionsAvailable: boolean;
  bankConfigurationIncomplete: boolean;
}> {
  const slug = normalizeSlug(publicSlug);
  const accessId = String(publicAccessId || "").trim();
  const token = String(accessToken || "").trim();
  if (!slug || !accessId || !token) {
    throw new PublicAdmissionsApiError("Application not found", 404, "APPLICATION_NOT_FOUND");
  }

  const res = await fetch(`${applicationsBase(slug, accessId)}/submit`, {
    method: "POST",
    headers: applicantAuthHeaders(token),
    body: JSON.stringify({}),
  });

  const payload = (await parseJson(res)) as SubmitApplicationResponse;
  if (!res.ok) {
    throwFromPayload(res, payload as Record<string, unknown>, "Could not submit application");
  }
  if (!payload.success || !payload.application) {
    throw new PublicAdmissionsApiError("Could not submit application", 500, "INVALID_RESPONSE");
  }

  return {
    application: payload.application,
    paymentInstructionsAvailable: Boolean(payload.paymentInstructionsAvailable),
    bankConfigurationIncomplete: Boolean(payload.bankConfigurationIncomplete),
  };
}
