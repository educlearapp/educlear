import { API_URL } from "../api";

const BASE = `${API_URL}/api/communication-engine`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as any)?.error || `Request failed (${res.status})`));
  }
  return data as T;
}

export type EngineMessage = {
  id: string;
  schoolId: string;
  campaignId: string | null;
  learnerId: string | null;
  parentId: string | null;
  category: string;
  channel: string;
  templateKey: string | null;
  subject: string;
  body: string;
  recipient: string | null;
  status: string;
  queuedAt: string;
  sentAt: string | null;
  failedAt: string | null;
  error: string | null;
  retryCount: number;
  parent?: { firstName: string; surname: string; email: string | null; cellNo: string } | null;
  learner?: { firstName: string; lastName: string } | null;
};

export async function fetchEngineMessages(
  schoolId: string,
  opts?: { status?: string; channel?: string; limit?: number; offset?: number }
) {
  const q = new URLSearchParams({ schoolId });
  if (opts?.status) q.set("status", opts.status);
  if (opts?.channel) q.set("channel", opts.channel);
  if (opts?.limit != null) q.set("limit", String(opts.limit));
  if (opts?.offset != null) q.set("offset", String(opts.offset));
  return request<{ success: boolean; items: EngineMessage[]; total: number }>(`/messages?${q.toString()}`);
}

export async function fetchEngineStats(schoolId: string) {
  const q = new URLSearchParams({ schoolId });
  return request<{
    success: boolean;
    byStatus: Record<string, number>;
    byChannel: Record<string, number>;
    byCategory: Record<string, number>;
  }>(`/messages/stats?${q.toString()}`);
}

export async function fetchEngineCampaigns(schoolId: string) {
  const q = new URLSearchParams({ schoolId });
  return request<{ success: boolean; campaigns: any[] }>(`/campaigns?${q.toString()}`);
}

export async function retryEngineMessage(messageId: string) {
  return request<{ success: boolean }>(`/messages/${encodeURIComponent(messageId)}/retry`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
}

export async function processEngineQueue() {
  return request<{ success: boolean; processed: number; results: { id: string; status: string }[] }>(
    "/queue/process",
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) }
  );
}

export async function fetchProviderSettings(schoolId: string) {
  const q = new URLSearchParams({ schoolId });
  return request<{ success: boolean; settings: any }>(`/provider-settings?${q.toString()}`);
}

export async function saveProviderSettings(payload: {
  schoolId: string;
  smtp?: unknown;
  smsProvider?: unknown;
  whatsappProvider?: unknown;
  pushProvider?: unknown;
  senderDisplayName?: string;
  replyToEmail?: string;
}) {
  return request<{ success: boolean; settings: any }>("/provider-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
