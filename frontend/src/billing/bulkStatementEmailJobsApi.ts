import { API_URL } from "../api";
import { staffAuthHeaders } from "../auth/staffAuthHeaders";

export type BulkStatementEmailJobRecipient = {
  id: string;
  accountNo: string;
  learnerId?: string;
  learnerName?: string;
  parentId?: string;
  contactName?: string;
  relationship?: string;
  email: string;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED" | string;
  failureReason?: string | null;
  providerMessageId?: string | null;
  attemptCount?: number;
  lastAttemptAt?: string | null;
  sentAt?: string | null;
};

export type BulkStatementEmailJob = {
  id: string;
  schoolId: string;
  subject: string;
  messagePlain?: string;
  statementPeriod: string;
  status: string;
  totalRecipients: number;
  pendingCount: number;
  sendingCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  continuesAfterLogout?: boolean;
  recipients?: BulkStatementEmailJobRecipient[];
};

async function parseJobResponse(res: Response): Promise<BulkStatementEmailJob> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((body as { error?: string }).error || "Bulk statement email job request failed"));
  }
  return (body as { job: BulkStatementEmailJob }).job;
}

export async function createBulkStatementEmailJob(input: {
  schoolId: string;
  subject: string;
  html: string;
  messagePlain?: string;
  statementPeriod: string;
  filterSnapshot?: Record<string, unknown>;
  recipients: Array<{
    accountNo: string;
    learnerId?: string;
    learnerName?: string;
    parentId?: string;
    contactName?: string;
    relationship?: string;
    email: string;
    skipped?: boolean;
    skipReason?: string;
  }>;
}): Promise<BulkStatementEmailJob> {
  const res = await fetch(`${API_URL}/api/bulk-statement-email-jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...staffAuthHeaders() },
    body: JSON.stringify(input),
  });
  return parseJobResponse(res);
}

export async function fetchBulkStatementEmailJob(
  jobId: string,
  schoolId: string
): Promise<BulkStatementEmailJob> {
  const q = new URLSearchParams({ schoolId });
  const res = await fetch(
    `${API_URL}/api/bulk-statement-email-jobs/${encodeURIComponent(jobId)}?${q}`,
    { headers: { ...staffAuthHeaders() } }
  );
  return parseJobResponse(res);
}

export async function listBulkStatementEmailJobs(
  schoolId: string,
  limit = 10
): Promise<BulkStatementEmailJob[]> {
  const q = new URLSearchParams({ schoolId, limit: String(limit) });
  const res = await fetch(`${API_URL}/api/bulk-statement-email-jobs?${q}`, {
    headers: { ...staffAuthHeaders() },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((body as { error?: string }).error || "Failed to list jobs"));
  }
  return ((body as { jobs?: BulkStatementEmailJob[] }).jobs || []) as BulkStatementEmailJob[];
}

export async function retryFailedBulkStatementEmailJob(input: {
  jobId: string;
  schoolId: string;
  recipientIds?: string[];
}): Promise<BulkStatementEmailJob> {
  const res = await fetch(
    `${API_URL}/api/bulk-statement-email-jobs/${encodeURIComponent(input.jobId)}/retry-failed`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...staffAuthHeaders() },
      body: JSON.stringify({
        schoolId: input.schoolId,
        recipientIds: input.recipientIds,
      }),
    }
  );
  return parseJobResponse(res);
}
