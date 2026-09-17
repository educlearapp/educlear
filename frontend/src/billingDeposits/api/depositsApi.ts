import { apiFetch, authenticatedFetch } from "../../api";
import type { DepositRecord, OpenInvoice } from "../types/deposit";

export async function fetchDeposits(
  schoolId: string,
  params?: { search?: string; status?: string }
): Promise<DepositRecord[]> {
  const query = new URLSearchParams({ schoolId });
  if (params?.search) query.set("search", params.search);
  if (params?.status) query.set("status", params.status);
  const data = await apiFetch(`/api/deposits?${query.toString()}`);
  return Array.isArray(data.deposits) ? data.deposits : [];
}

export async function fetchDepositDetail(
  schoolId: string,
  depositId: string
): Promise<{ deposit: DepositRecord; openInvoices: OpenInvoice[] }> {
  const query = new URLSearchParams({ schoolId });
  const data = await apiFetch(`/api/deposits/${depositId}?${query.toString()}`);
  return {
    deposit: data.deposit as DepositRecord,
    openInvoices: Array.isArray(data.openInvoices) ? data.openInvoices : [],
  };
}

export async function createDeposit(payload: Record<string, unknown>): Promise<DepositRecord> {
  const data = await apiFetch("/api/deposits", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return data.deposit as DepositRecord;
}

export async function updateDeposit(
  depositId: string,
  payload: Record<string, unknown>
): Promise<{ deposit: DepositRecord; openInvoices: OpenInvoice[] }> {
  const data = await apiFetch(`/api/deposits/${depositId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return {
    deposit: data.deposit as DepositRecord,
    openInvoices: Array.isArray(data.openInvoices) ? data.openInvoices : [],
  };
}

export async function fetchLearnersForDeposits(schoolId: string) {
  const response = await authenticatedFetch(
    `/api/learners?schoolId=${encodeURIComponent(schoolId)}`
  );
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  const rows = Array.isArray(data) ? data : Array.isArray(data?.learners) ? data.learners : [];
  return rows;
}
