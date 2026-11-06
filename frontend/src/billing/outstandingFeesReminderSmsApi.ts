import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";

export const NEW_CAMPAIGN_AUTHORIZATION_TEXT =
  "Start a new outstanding fees reminder. Do not retry the October statement SMS.";

export const OUTSTANDING_FEES_REMINDER_DEFAULT_TEMPLATE =
  "{{schoolName}}: Acc {{accountNo}} owes {{amount}}. Please pay outstanding fees.";

export const OUTSTANDING_FEES_REMINDER_TEMPLATE_MAX_CHARS = 306;

export type OutstandingFeesReminderPreview = {
  success: true;
  messageType: "outstanding_fees_reminder";
  selectedAccountCount: number;
  uniquePhones: number;
  totalSegments: number;
  totalCredits: number;
  messages: Array<{
    familyAccountId: string;
    accountNo: string;
    displayName: string;
    mobileMasked: string;
    message: string;
    encoding: "gsm" | "ucs2";
    units: number;
    segments: number;
    credits: number;
  }>;
  skipped: Array<{
    familyAccountId: string;
    accountNo: string;
    reason: string;
    detail: string;
    mobileMasked?: string;
  }>;
  requiresNewCampaignAuthorization: boolean;
  authorizationText: string | null;
  historicalStatementHold: boolean;
  historicalStatementNote: string | null;
  template: string;
  handsetDelivered: null;
};

export type OutstandingFeesReminderSendResult = {
  success?: boolean;
  ok?: boolean;
  status?: number;
  code?: string;
  error?: string;
  summary?: string;
  replayed?: boolean;
  accepted?: number;
  failed?: number;
  pending?: number;
  handsetDelivered: null;
  messages?: OutstandingFeesReminderPreview["messages"] &
    Array<{ providerStatus?: string; providerDetail?: string | null }>;
};

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...staffAuthHeaders() },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; success?: boolean };
  if (!res.ok || json.success === false) {
    throw new Error(json.error || "Outstanding fees reminder request failed.");
  }
  return json;
}

export function fetchOutstandingFeesReminderPreview(input: {
  schoolId: string;
  familyAccountIds: string[];
  messageTemplate: string;
}) {
  return postJson<OutstandingFeesReminderPreview>("/api/statements/outstanding-fees-reminder/preview", input);
}

export function sendOutstandingFeesReminderRequest(input: {
  schoolId: string;
  familyAccountIds: string[];
  sendInstanceId: string;
  messageTemplate: string;
  authorizationText?: string;
}) {
  return postJson<OutstandingFeesReminderSendResult>("/api/statements/outstanding-fees-reminder/send", input);
}
