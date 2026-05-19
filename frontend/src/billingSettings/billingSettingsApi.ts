import { API_URL } from "../api";
import type { BillingSettingsState } from "./types/billingSettings";

const BASE = `${API_URL}/api/billing-settings`;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { error?: string })?.error || `Request failed (${res.status})`));
  }
  return data as T;
}

type SettingsResponse = {
  success: boolean;
  settings: BillingSettingsState;
};

export async function fetchBillingSettings(schoolId: string): Promise<BillingSettingsState> {
  const data = await request<SettingsResponse>(
    `/settings?schoolId=${encodeURIComponent(schoolId)}`
  );
  return data.settings;
}

export async function saveBillingSettings(
  schoolId: string,
  settings: BillingSettingsState
): Promise<BillingSettingsState> {
  const data = await request<SettingsResponse>("/settings", {
    method: "PUT",
    body: JSON.stringify({ schoolId, settings }),
  });
  return data.settings;
}

export async function resetBillingSettings(schoolId: string): Promise<BillingSettingsState> {
  const data = await request<SettingsResponse>("/settings/reset", {
    method: "POST",
    body: JSON.stringify({ schoolId }),
  });
  return data.settings;
}
