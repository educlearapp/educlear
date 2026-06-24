import { API_URL } from "../api";

export type FeeCategoryKey =
  | "registration"
  | "school_fees"
  | "transport"
  | "leadership_camp"
  | "uniform"
  | "stationery"
  | "aftercare"
  | "other_fees"
  | "account_credit";

export type AllocationLine = {
  invoiceId?: string;
  feeCategory?: FeeCategoryKey;
  allocatedAmount: number;
};

export type AllocationTargetInvoice = {
  id: string;
  reference: string;
  description: string;
  date: string;
  dueDate: string;
  amount: number;
  unpaid: number;
  overdue: boolean;
  categories: FeeCategoryKey[];
};

export type AllocationTargetCategory = {
  feeCategory: FeeCategoryKey;
  label: string;
  outstanding: number;
  overdue: number;
};

export type AllocationTargets = {
  paymentAmount: number;
  invoices: AllocationTargetInvoice[];
  categories: AllocationTargetCategory[];
  totalOutstanding: number;
  accountCredit: number;
};

export type PaymentAllocationRow = {
  id: string;
  paymentId: string;
  invoiceId: string | null;
  feeCategory: FeeCategoryKey | null;
  feeCategoryLabel: string;
  allocatedAmount: number;
};

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const msg = String((data as any)?.error || (data as any)?.message || "Request failed");
    throw new Error(msg);
  }
  return data;
}

export async function fetchAllocationTargets(params: {
  schoolId: string;
  learnerId: string;
  accountNo: string;
  paymentAmount: number;
  paymentId?: string;
}) {
  const q = new URLSearchParams({
    schoolId: params.schoolId,
    learnerId: params.learnerId,
    accountNo: params.accountNo,
    paymentAmount: String(params.paymentAmount),
  });
  if (params.paymentId) q.set("paymentId", params.paymentId);
  const data = await parseJson(
    await fetch(`${API_URL}/api/payment-allocations/targets?${q.toString()}`)
  );
  return data as {
    targets: AllocationTargets;
    needsAllocation: boolean;
    existingAllocations: PaymentAllocationRow[];
    balance: number;
    accountCredit: number;
  };
}

export async function suggestPaymentAllocations(payload: {
  schoolId: string;
  learnerId: string;
  accountNo: string;
  paymentAmount: number;
}) {
  const data = await parseJson(
    await fetch(`${API_URL}/api/payment-allocations/suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return data as { suggestions: AllocationLine[]; targets: AllocationTargets };
}

export async function savePaymentAllocations(
  paymentId: string,
  payload: {
    schoolId: string;
    learnerId: string;
    accountNo: string;
    paymentAmount: number;
    lines: AllocationLine[];
    allocatedBy?: string;
  }
) {
  const data = await parseJson(
    await fetch(`${API_URL}/api/payment-allocations/${encodeURIComponent(paymentId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  );
  return data;
}

export async function clearPaymentAllocations(schoolId: string, paymentId: string) {
  await parseJson(
    await fetch(
      `${API_URL}/api/payment-allocations/${encodeURIComponent(paymentId)}?schoolId=${encodeURIComponent(schoolId)}`,
      { method: "DELETE" }
    )
  );
}

export function receiptPdfUrl(schoolId: string, paymentId: string): string {
  return `${API_URL}/api/payment-allocations/${encodeURIComponent(paymentId)}/receipt/pdf?schoolId=${encodeURIComponent(schoolId)}`;
}

export async function sendPaymentReceiptEmail(schoolId: string, paymentId: string) {
  const data = await parseJson(
    await fetch(`${API_URL}/api/payments/${encodeURIComponent(paymentId)}/send-receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ schoolId }),
    })
  );
  return data as {
    success: boolean;
    message?: string;
    messageId?: string;
    to?: string;
    receiptNumber?: string;
  };
}
