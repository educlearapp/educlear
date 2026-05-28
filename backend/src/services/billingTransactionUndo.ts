import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import { isEduClearUndoableLedgerEntry } from "../utils/billingDisplayRules";
import {
  readSchoolLedger,
  removeSchoolEntry,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { clearPaymentAllocations } from "../utils/paymentAllocationStore";

export type UndoBillingTransactionInput = {
  schoolId: string;
  transactionId: string;
  accountNo?: string;
  auditNo?: string | number;
};

export type UndoBillingTransactionResult = {
  removed: BillingLedgerEntry;
  accounts: Awaited<ReturnType<typeof buildAccountsFromAgeAnalysisSnapshots>>;
};

function resolveLedgerEntry(
  entries: BillingLedgerEntry[],
  transactionId: string,
  accountNo: string,
  auditNo?: string | number
): BillingLedgerEntry | null {
  const id = String(transactionId || "").trim();
  if (!id) return null;

  const byId = entries.find((e) => e.id === id);
  if (byId) return byId;

  if (id.startsWith("posting-")) {
    const ledgerId = id.slice("posting-".length);
    const match = entries.find((e) => e.id === ledgerId);
    if (match) return match;
  }

  const accountRef = String(accountNo || "").trim().toUpperCase();
  const scoped = accountRef
    ? entries.filter((e) => String(e.accountNo || "").trim().toUpperCase() === accountRef)
    : entries;

  if (auditNo !== undefined && auditNo !== null && String(auditNo).trim() !== "") {
    const auditNum = Number(auditNo);
    if (Number.isFinite(auditNum) && auditNum > 0) {
      const sorted = [...scoped].sort(
        (a, b) =>
          new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
      );
      const candidate = sorted[auditNum - 1];
      if (candidate) return candidate;
    }
  }

  return null;
}

export async function undoBillingTransaction(
  input: UndoBillingTransactionInput
): Promise<UndoBillingTransactionResult> {
  const schoolId = String(input.schoolId || "").trim();
  const transactionId = String(input.transactionId || "").trim();
  if (!schoolId || !transactionId) {
    throw new Error("Missing schoolId or transaction id");
  }

  const ledger = readSchoolLedger(schoolId);
  const entry = resolveLedgerEntry(
    ledger,
    transactionId,
    String(input.accountNo || ""),
    input.auditNo
  );
  if (!entry) {
    throw new Error("Transaction not found");
  }

  if (!isEduClearUndoableLedgerEntry(entry)) {
    throw new Error("Imported Kid-e-Sys history cannot be undone.");
  }

  const removed = removeSchoolEntry(schoolId, entry.id);
  if (!removed) {
    throw new Error("Transaction not found");
  }

  if (removed.type === "payment") {
    clearPaymentAllocations(schoolId, removed.id);
  }

  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  return { removed, accounts };
}
