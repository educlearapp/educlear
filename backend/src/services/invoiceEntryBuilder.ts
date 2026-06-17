import { loadSchoolBillingSettings } from "../routes/billingSettings";
import {
  assertOfficialBillingAccountRef,
  resolveOfficialBillingAccountRef,
} from "./officialBillingAccountRef";
import {
  buildInvoiceReference,
  computeInvoiceDueDate,
  normaliseIsoDate,
  resolveInvoiceMessage,
} from "../utils/billingSettingsEngine";
import {
  buildInvoiceRunEntryId,
  normaliseAmount,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

export type InvoiceInputBody = Record<string, unknown>;

export type InvoiceBuildResult = {
  entry?: BillingLedgerEntry;
  error?: string;
  errorCode?: string;
};

/** Pure check used before posting manual invoices when both learnerId and accountNo are present. */
export function detectLearnerAccountMismatch(
  learnerResolvedRef: string,
  accountResolvedRef: string
): { mismatch: false } | { mismatch: true; message: string } {
  const fromLearner = String(learnerResolvedRef || "").trim().toUpperCase();
  const fromAccount = String(accountResolvedRef || "").trim().toUpperCase();
  if (!fromLearner || !fromAccount || fromLearner === fromAccount) {
    return { mismatch: false };
  }
  return {
    mismatch: true,
    message: `Billing account mismatch: learner resolves to ${fromLearner} but accountNo resolves to ${fromAccount}.`,
  };
}

export async function validateManualInvoiceLearnerAccount(
  schoolId: string,
  body: InvoiceInputBody
): Promise<{ ok: true } | { ok: false; error: string; errorCode: "LEARNER_ACCOUNT_MISMATCH" }> {
  const learnerId = String(body.learnerId || "").trim();
  const accountNo = String(body.accountNo || body.accountRef || "").trim();
  if (!learnerId || !accountNo) {
    return { ok: true };
  }

  const fromLearner = await resolveOfficialBillingAccountRef(schoolId, { learnerId });
  const fromAccount = await resolveOfficialBillingAccountRef(schoolId, { accountNo });
  const check = detectLearnerAccountMismatch(fromLearner, fromAccount);
  if (!check.mismatch) {
    return { ok: true };
  }

  return {
    ok: false,
    error: `${check.message} (learnerId=${learnerId}, accountNo=${accountNo})`,
    errorCode: "LEARNER_ACCOUNT_MISMATCH",
  };
}

export async function resolveInvoiceAccountNo(
  schoolId: string,
  body: InvoiceInputBody
): Promise<{ accountNo: string; error?: string }> {
  const learnerId = String(body.learnerId || "").trim();
  const accountNo = await resolveOfficialBillingAccountRef(schoolId, {
    learnerId,
    accountNo: String(body.accountNo || body.accountRef || "").trim(),
  });
  if (!accountNo) {
    return {
      accountNo: "",
      error:
        "Could not resolve an official billing account ref for this learner. Link the learner to a Kid-e-Sys family account before invoicing.",
    };
  }
  try {
    assertOfficialBillingAccountRef(schoolId, accountNo);
  } catch (guardError) {
    const message =
      guardError instanceof Error ? guardError.message : "Invalid billing account ref";
    return { accountNo: "", error: message };
  }
  return { accountNo };
}

export async function buildInvoiceEntry(
  schoolId: string,
  body: InvoiceInputBody,
  settings: Awaited<ReturnType<typeof loadSchoolBillingSettings>>,
  existingInvoiceCount: number,
  index = 0
): Promise<InvoiceBuildResult> {
  const learnerId = String(body.learnerId || "").trim();
  const amount = normaliseAmount(body.amount);
  if (!amount) {
    return { error: "Missing amount" };
  }

  const consistency = await validateManualInvoiceLearnerAccount(schoolId, body);
  if (!consistency.ok) {
    return { error: consistency.error, errorCode: consistency.errorCode };
  }

  const resolved = await resolveInvoiceAccountNo(schoolId, body);
  if (!resolved.accountNo) {
    return { error: resolved.error || "Invalid account" };
  }

  const invoiceDate =
    normaliseIsoDate(body.date || body.invoiceDate) || new Date().toISOString().slice(0, 10);
  const dueDate = computeInvoiceDueDate(
    invoiceDate,
    settings,
    normaliseIsoDate(body.dueDate) || undefined
  );

  const fallbackRef = String(body.reference || body.invoiceNumber || `INV-${Date.now()}`).trim();
  const reference = buildInvoiceReference(
    settings,
    invoiceDate,
    existingInvoiceCount + index + 1,
    fallbackRef
  );

  const description =
    String(body.description || "").trim() ||
    resolveInvoiceMessage(settings) ||
    "Invoice";

  const runId = body.runId ? String(body.runId).trim() : "";
  const lineKey = String(body.lineKey || body.lineId || "").trim();
  const invoicePeriod = String(body.invoicePeriod || "").trim() || undefined;
  const defaultId = runId
    ? buildInvoiceRunEntryId(runId, learnerId, resolved.accountNo, lineKey || String(index))
    : `invoice-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;

  const entry: BillingLedgerEntry = {
    id: String(body.id || defaultId).trim() || defaultId,
    schoolId,
    learnerId,
    accountNo: resolved.accountNo,
    type: "invoice",
    amount,
    date: invoiceDate,
    dueDate,
    reference,
    description,
    runId: runId || undefined,
    invoicePeriod,
    lineKey: lineKey || undefined,
    createdAt: new Date().toISOString(),
  };

  return { entry };
}
