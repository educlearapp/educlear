import { API_URL } from "../../api";
import type { DepositRecord, OpenInvoice } from "../types/deposit";

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((data as { error?: string })?.error || `Request failed (${response.status})`));
  }
  return data;
}

export async function fetchDeposits(
  schoolId: string,
  params?: { search?: string; status?: string }
): Promise<DepositRecord[]> {
  const query = new URLSearchParams({ schoolId });
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  const data = await parseJson(await fetch(`${API_URL}/api/deposits?${query.toString()}`));
  return Array.isArray(data.deposits) ? data.deposits : [];
}

export async function fetchDepositDetail(
  schoolId: string,
  depositId: string
): Promise<{ deposit: DepositRecord; openInvoices: OpenInvoice[] }> {
  const query = new URLSearchParams({ schoolId });
  const data = await parseJson(await fetch(`${API_URL}/api/deposits/${depositId}?${query.toString()}`));
  return {
    deposit: data.deposit as DepositRecord,
    openInvoices: Array.isArray(data.openInvoices) ? data.openInvoices : [],
  };
}

export async function createDeposit(payload: Record<string, unknown>): Promise<DepositRecord> {
  const data = await parseJson(
    await fetch(`${API_URL}/api/deposits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return data.deposit as DepositRecord;
}

export async function updateDeposit(
  depositId: string,
  payload: Record<string, unknown>
): Promise<{ deposit: DepositRecord; openInvoices: OpenInvoice[] }> {
  const data = await parseJson(
    await fetch(`${API_URL}/api/deposits/${depositId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return {
    deposit: data.deposit as DepositRecord,
    openInvoices: Array.isArray(data.openInvoices) ? data.openInvoices : [],
  };
}

export async function fetchLearnersForDeposits(schoolId: string) {
  const response = await fetch(`${API_URL}/api/learners?schoolId=${encodeURIComponent(schoolId)}`);
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  const rows = Array.isArray(data) ? data : Array.isArray(data?.learners) ? data.learners : [];
  return rows;
}
