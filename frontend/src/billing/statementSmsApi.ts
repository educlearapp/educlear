import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";

export type StatementSmsContact = {
  parentId: string;
  displayName: string;
  relationship: string;
  mobileMasked: string;
  mobileLast4: string;
  score: number;
  recommended: boolean;
};

export type StatementSmsPreview = {
  success: true;
  familyAccountId: string;
  accountRef: string;
  accountNo: string;
  description: string;
  schoolName: string;
  balance: number;
  balanceClass: "outstanding" | "settled" | "credit";
  defaultMessage: string;
  contacts: StatementSmsContact[];
  recommendedParentId: string | null;
  smsReady: boolean;
  outboundDisabled: boolean;
  canSend: boolean;
};

/** Auth/route failure body for sms-preview (not part of the success contract). */
export type StatementSmsPreviewError = {
  success?: false;
  error?: string;
  /** Present on statements.send auth denials (mirrors `error`). */
  message?: string;
  code?: string | null;
  simulated?: false;
};

export type StatementSmsSendResponse = {
  success: boolean;
  ok?: boolean;
  simulated?: boolean;
  summary?: string;
  sentCount?: number;
  failedCount?: number;
  destinationCount?: number;
  deduplicated?: boolean;
  results?: Array<{
    parentIds: string[];
    displayNames: string[];
    mobileMasked: string;
    status: "sent" | "failed";
    error: string | null;
  }>;
  error?: string;
  code?: string;
  message?: string;
};

function qs(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  return search.toString();
}

export async function fetchStatementSmsPreview(input: {
  schoolId: string;
  familyAccountId?: string;
  accountRef?: string;
  accountNo?: string;
  learnerId?: string;
}): Promise<StatementSmsPreview> {
  const query = qs({
    schoolId: input.schoolId,
    familyAccountId: input.familyAccountId,
    accountRef: input.accountRef,
    accountNo: input.accountNo,
    learnerId: input.learnerId,
  });
  const res = await fetch(`${API_URL}/api/statements/sms-preview?${query}`, {
    headers: { ...staffAuthHeaders() },
  });
  const json = (await res.json().catch(() => ({}))) as
    | StatementSmsPreview
    | StatementSmsPreviewError;
  if (!res.ok || json.success !== true) {
    throw new Error(statementSmsPreviewErrorMessage(json));
  }
  return json;
}

function statementSmsPreviewErrorMessage(
  body: StatementSmsPreview | StatementSmsPreviewError
): string {
  if (body.success === true) {
    return "Could not load SMS statement recipients.";
  }
  return body.error || body.message || "Could not load SMS statement recipients.";
}

export async function sendStatementSmsRequest(input: {
  schoolId: string;
  familyAccountId?: string;
  accountRef?: string;
  accountNo?: string;
  learnerId?: string;
  selectionMode: "all" | "parentIds";
  parentIds?: string[];
  message: string;
}): Promise<StatementSmsSendResponse> {
  const res = await fetch(`${API_URL}/api/statements/send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...staffAuthHeaders(),
    },
    body: JSON.stringify({
      schoolId: input.schoolId,
      familyAccountId: input.familyAccountId || undefined,
      accountRef: input.accountRef || undefined,
      accountNo: input.accountNo || undefined,
      learnerId: input.learnerId || undefined,
      selectionMode: input.selectionMode,
      parentIds: input.parentIds || [],
      message: input.message,
    }),
  });
  const json = (await res.json().catch(() => ({}))) as StatementSmsSendResponse;
  if (!res.ok && !json.success) {
    throw new Error(json.error || json.message || "SMS send failed.");
  }
  return json;
}

export const STATEMENT_SMS_MAX_CHARS = 480;
export const STATEMENT_SMS_SEGMENT_CHARS = 160;

export function estimateStatementSmsSegments(text: string): number {
  const len = String(text || "").length;
  if (len <= 0) return 0;
  return Math.max(1, Math.ceil(len / STATEMENT_SMS_SEGMENT_CHARS));
}
