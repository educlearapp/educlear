import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";

export type AdmissionsRequiredDocumentCondition = {
  type: "learner_citizenship_not_south_african";
};

export type AdmissionsRequiredDocument = {
  key: string;
  label: string;
  required: boolean;
  allowMultiple: boolean;
  maxCount: number;
  condition: AdmissionsRequiredDocumentCondition | null;
};

export type AdmissionsSettings = {
  id: string | null;
  schoolId: string;
  enabled: boolean;
  publicSlug: string | null;
  applicationsOpenAt: string | null;
  applicationsCloseAt: string | null;
  intakeYear: number | null;
  acceptedGrades: string[];
  admissionFeeRequired: boolean;
  defaultAdmissionFeeAmount: string | null;
  currency: string;
  proofOfPaymentRequired: boolean;
  paymentVerificationRequired: boolean;
  requirePaymentVerifiedBeforeAccept: boolean;
  bankName: string | null;
  accountHolder: string | null;
  accountNumber: string | null;
  branchCode: string | null;
  accountType: string | null;
  paymentInstructions: string | null;
  admissionContactEmail: string | null;
  admissionContactPhone: string | null;
  requiredDocuments: AdmissionsRequiredDocument[];
  applicationQuestions: unknown[];
  notificationRecipientUserIds: string[];
  privacyNoticeVersion: string | null;
  declarationText: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  financialDocuments?: Array<{
    id: string;
    kind: "FINANCIAL_POLICY" | "FINANCIAL_DECLARATION";
    title: string;
    version: string;
    contentSha256: string;
    body: string;
  }>;
};

type SettingsResponse = {
  success: boolean;
  settings?: AdmissionsSettings;
  error?: string;
  code?: string;
};

async function request(method: "GET" | "PUT", body?: Record<string, unknown>) {
  const res = await fetch(`${API_URL}/api/admissions/settings`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...staffAuthHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as SettingsResponse;
  if (!res.ok) {
    throw new Error(String(data.error || `Request failed (${res.status})`));
  }
  if (!data.settings) {
    throw new Error("Missing admissions settings in response");
  }
  return data.settings;
}

/** Tenant comes from JWT — do not pass schoolId. */
export function fetchAdmissionsSettings() {
  return request("GET");
}

export function saveAdmissionsSettings(payload: Partial<AdmissionsSettings>) {
  return request("PUT", payload as Record<string, unknown>);
}

export async function publishAdmissionsLegalDocument(input: {
  kind: "FINANCIAL_POLICY" | "FINANCIAL_DECLARATION";
  versionLabel: string;
  title: string;
  body: string;
}) {
  const res = await fetch(`${API_URL}/api/admissions/settings/legal-documents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...staffAuthHeaders(),
    },
    body: JSON.stringify(input),
  });
  const data = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    error?: string;
    document?: {
      id: string;
      kind: "FINANCIAL_POLICY" | "FINANCIAL_DECLARATION";
      title: string;
      version: string;
      contentSha256: string;
      body: string;
    };
  };
  if (!res.ok || !data.success || !data.document) {
    throw new Error(String(data.error || `Request failed (${res.status})`));
  }
  return data.document;
}
