import { relinkSchoolBillingLedger } from "./billingLedgerRelink";
import { buildBillingAccountPostResponse } from "./billingPostResponse";
import {
  resolveCapturePaymentFamilyAccount,
  type CapturePaymentFamilyDecision,
} from "./resolveCapturePaymentFamilyAccount";
import { parseCapturePaymentAmount } from "../utils/capturePaymentAmount";
import {
  appendSchoolEntrySafe,
  calculateBalanceFromEntries,
  computeOpenInvoiceLines,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import {
  isEduClearUndoCorrectionEntry,
  isUndoneLedgerEntry,
} from "../utils/billingDisplayRules";
import {
  writePaymentAllocations,
  type StoredPaymentAllocation,
} from "../utils/paymentAllocationStore";

export class CapturePaymentError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "CapturePaymentError";
    this.status = status;
    this.code = code;
  }
}

export type CapturePaymentAllocationLine = {
  invoiceId?: string;
  feeCategory?: string;
  allocatedAmount: number;
};

export type CapturePaymentFamilyResolver = (input: {
  familyAccountId: string;
  authorizedSchoolId: string;
}) => Promise<CapturePaymentFamilyDecision>;

let capturePaymentFamilyResolver: CapturePaymentFamilyResolver = resolveCapturePaymentFamilyAccount;

/** @internal Test hook — inject a FamilyAccount resolver without Prisma. */
export function setCapturePaymentFamilyResolverForTests(
  fn: CapturePaymentFamilyResolver | null
): void {
  capturePaymentFamilyResolver = fn || resolveCapturePaymentFamilyAccount;
}

export type CapturePaymentInput = {
  authorizedSchoolId: string;
  familyAccountId: string;
  amount: unknown;
  date?: unknown;
  method?: unknown;
  description?: unknown;
  bankReference?: unknown;
  idempotencyKey: string;
  capturedByUserId: string;
  capturedByEmail: string;
  capturedByName: string;
  allocationLines?: CapturePaymentAllocationLine[];
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function parsePaymentDate(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) {
    throw new CapturePaymentError(400, "INVALID_DATE", "Payment date must be yyyy-MM-dd");
  }
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function parseMethod(value: unknown): string {
  const method = String(value || "").trim();
  if (!method) {
    throw new CapturePaymentError(400, "MISSING_METHOD", "Payment method is required");
  }
  return method;
}

function requireIdempotencyKey(value: unknown): string {
  const key = String(value || "").trim();
  if (!key) {
    throw new CapturePaymentError(400, "MISSING_IDEMPOTENCY_KEY", "idempotencyKey is required");
  }
  if (key.length > 120) {
    throw new CapturePaymentError(400, "INVALID_IDEMPOTENCY_KEY", "idempotencyKey is too long");
  }
  return key;
}

function buildAllocationRows(input: {
  schoolId: string;
  paymentId: string;
  accountRef: string;
  paymentAmount: number;
  capturedBy: string;
  lines: CapturePaymentAllocationLine[];
}): StoredPaymentAllocation[] {
  const createdAt = new Date().toISOString();
  let allocatedTotal = 0;
  const stored: StoredPaymentAllocation[] = [];
  for (let i = 0; i < input.lines.length; i += 1) {
    const line = input.lines[i];
    const allocatedAmount = roundMoney(Number(line.allocatedAmount || 0));
    if (allocatedAmount <= 0.001) continue;
    allocatedTotal = roundMoney(allocatedTotal + allocatedAmount);
    stored.push({
      id: `palloc-${input.paymentId}-${i}`,
      paymentId: input.paymentId,
      schoolId: input.schoolId,
      accountRef: input.accountRef,
      invoiceId: line.invoiceId ? String(line.invoiceId).trim() : null,
      feeCategory: line.feeCategory ? String(line.feeCategory).trim() : null,
      allocatedAmount,
      allocatedBy: input.capturedBy,
      createdAt,
    });
  }
  if (allocatedTotal > input.paymentAmount + 0.01) {
    throw new CapturePaymentError(
      400,
      "ALLOCATION_EXCEEDS_PAYMENT",
      "Total allocation exceeds payment amount"
    );
  }
  return stored;
}

export async function captureManualPayment(input: CapturePaymentInput) {
  const schoolId = String(input.authorizedSchoolId || "").trim();
  if (!schoolId) {
    throw new CapturePaymentError(403, "MISSING_SCHOOL", "Missing school authorization");
  }

  const amountResult = parseCapturePaymentAmount(input.amount);
  if (!amountResult.ok) {
    throw new CapturePaymentError(400, amountResult.code, amountResult.error);
  }

  const idempotencyKey = requireIdempotencyKey(input.idempotencyKey);
  const paymentDate = parsePaymentDate(input.date);
  const paymentMethod = parseMethod(input.method);
  const paymentNote = String(input.description || "").trim() || "Payment";
  const bankReference = String(input.bankReference || "").trim();

  const familyDecision = await capturePaymentFamilyResolver({
    familyAccountId: input.familyAccountId,
    authorizedSchoolId: schoolId,
  });
  if (!familyDecision.ok) {
    throw new CapturePaymentError(familyDecision.status, familyDecision.code, familyDecision.error);
  }
  const family = familyDecision.family;

  const capturedAt = new Date().toISOString();
  const entry: BillingLedgerEntry = {
    id: "",
    schoolId,
    learnerId: "",
    accountNo: family.accountRef,
    type: "payment",
    amount: amountResult.amount,
    date: paymentDate,
    reference: paymentMethod,
    description: paymentNote,
    method: paymentMethod,
    source: "manual",
    createdAt: capturedAt,
    familyAccountId: family.id,
    idempotencyKey,
    capturedByUserId: String(input.capturedByUserId || "").trim() || undefined,
    capturedByEmail: String(input.capturedByEmail || "").trim() || undefined,
    capturedByName: String(input.capturedByName || "").trim() || undefined,
    bankReference: bankReference || undefined,
  };

  const appendResult = appendSchoolEntrySafe(schoolId, entry, {
    idempotencyKey,
    generatePaymentReference: true,
    skipPaymentFingerprint: true,
  });
  const savedEntry = appendResult.entry;

  let allocationSaved = true;
  let allocationError: string | null = null;
  const lines = Array.isArray(input.allocationLines) ? input.allocationLines : [];
  if (appendResult.created && lines.length) {
    try {
      const stored = buildAllocationRows({
        schoolId,
        paymentId: savedEntry.id,
        accountRef: family.accountRef,
        paymentAmount: amountResult.amount,
        capturedBy:
          String(input.capturedByEmail || input.capturedByName || "").trim() || "Billing",
        lines,
      });
      writePaymentAllocations(schoolId, savedEntry.id, stored);
    } catch (error) {
      allocationSaved = false;
      allocationError = error instanceof Error ? error.message : "Allocation write failed";
    }
  }

  let post;
  try {
    await relinkSchoolBillingLedger(schoolId);
    post = await buildBillingAccountPostResponse(schoolId, family.accountRef);
  } catch (error) {
    console.error("[capturePayment] post-write account rebuild failed:", error);
    const ledger = readSchoolLedger(schoolId);
    const scoped = ledger.filter((entry) => {
      if (String(entry.accountNo || "").trim().toUpperCase() !== String(family.accountRef || "").trim().toUpperCase()) {
        return false;
      }
      if (isUndoneLedgerEntry(entry)) return false;
      if (isEduClearUndoCorrectionEntry(entry)) return false;
      return true;
    });
    post = {
      balance: calculateBalanceFromEntries(scoped),
      account: null,
      ledgerEntries: ledger.filter(
        (entry) =>
          String(entry.accountNo || "").trim().toUpperCase() ===
          String(family.accountRef || "").trim().toUpperCase()
      ),
      openInvoices: computeOpenInvoiceLines(scoped, "", family.accountRef),
    };
  }

  return {
    success: true as const,
    duplicate: !appendResult.created,
    duplicateReason: appendResult.duplicateReason,
    allocationSaved,
    allocationError,
    payment: {
      ...savedEntry,
      message: savedEntry.description,
      note: savedEntry.description,
      notes: savedEntry.description,
      familyAccountId: family.id,
    },
    familyAccountId: family.id,
    accountRef: family.accountRef,
    balance: post.balance,
    account: post.account,
    lastPayment: post.account?.lastPayment ?? 0,
    lastPaymentDate: post.account?.lastPaymentDate ?? "",
    ledgerEntries: post.ledgerEntries,
    openInvoices: post.openInvoices,
    statements: post.account ? [post.account] : [],
  };
}
