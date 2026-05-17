import {
  applyDescriptionTemplate,
  COA_CODES,
  getExpenseDebitAccountCode,
  getRule,
  isBankChargeCategory,
  type AutoPostingTransactionType,
} from "./accountingAutoPostingRules";
import {
  appendAudit,
  findJournalByFingerprint,
  journalTotals,
  loadActiveCoaAccounts,
  loadJournalStore,
  nextJournalNo,
  roundMoney,
  saveJournalStore,
  uid,
  type Journal,
  type JournalLine,
  type JournalSourceModule,
} from "./accountingJournalStorage";

export type AutoJournalResult =
  | { ok: true; journalNo: string; journalId: string; duplicate?: false }
  | { ok: false; duplicate: true; journalNo?: string; reason: string }
  | { ok: false; duplicate?: false; skipped: true; reason: string };

export type SourceFingerprintInput = {
  sourceType: string;
  sourceId: string;
  amount: number;
  date: string;
};

export function buildSourceFingerprint(input: SourceFingerprintInput): string {
  return [
    String(input.sourceType || "").trim(),
    String(input.sourceId || "").trim(),
    String(roundMoney(input.amount)),
    String(input.date || "").trim().slice(0, 10),
  ].join("::");
}

export function hasDuplicateAutoJournal(schoolId: string, fingerprint: string): boolean {
  const store = loadJournalStore(schoolId);
  return Boolean(findJournalByFingerprint(store, fingerprint));
}

export function createJournalLine(input: {
  accountCode: string;
  accountName: string;
  debit?: number;
  credit?: number;
  memo?: string;
}): JournalLine {
  return {
    id: uid("jl"),
    accountCode: String(input.accountCode || "").trim(),
    accountName: String(input.accountName || "").trim(),
    debit: roundMoney(input.debit ?? 0),
    credit: roundMoney(input.credit ?? 0),
    memo: String(input.memo || "").trim(),
  };
}

type CoaLookup = { code: string; name: string } | null;

function resolveCoaAccount(schoolId: string, code: string): CoaLookup {
  const account = loadActiveCoaAccounts(schoolId).find((a) => a.code === code);
  if (!account) return null;
  return { code: account.code, name: account.name };
}

function logAutoPostWarning(message: string, context?: Record<string, unknown>) {
  console.warn("[EduClear AutoJournal]", message, context || "");
}

export type CreateAutoJournalInput = {
  schoolId: string;
  date: string;
  description: string;
  reference: string;
  notes?: string;
  sourceModule: JournalSourceModule;
  sourceId: string;
  sourceFingerprint: string;
  createdBy?: string;
  lines: JournalLine[];
};

export function createAutoJournal(input: CreateAutoJournalInput): AutoJournalResult {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    return { ok: false, skipped: true, reason: "Missing schoolId" };
  }

  const fingerprint = String(input.sourceFingerprint || "").trim();
  if (fingerprint && hasDuplicateAutoJournal(schoolId, fingerprint)) {
    const existing = findJournalByFingerprint(loadJournalStore(schoolId), fingerprint);
    logAutoPostWarning("Duplicate auto-journal skipped", { fingerprint, journalNo: existing?.journalNo });
    return {
      ok: false,
      duplicate: true,
      journalNo: existing?.journalNo,
      reason: "Auto journal already exists for this source transaction",
    };
  }

  if (!input.lines.length) {
    return { ok: false, skipped: true, reason: "Journal has no lines" };
  }

  const coa = loadActiveCoaAccounts(schoolId);
  if (!coa.length) {
    logAutoPostWarning("Chart of Accounts missing — auto journal skipped", {
      sourceModule: input.sourceModule,
      sourceId: input.sourceId,
    });
    return { ok: false, skipped: true, reason: "Chart of Accounts not configured" };
  }

  for (const line of input.lines) {
    if (!resolveCoaAccount(schoolId, line.accountCode)) {
      logAutoPostWarning(`Account ${line.accountCode} missing in COA — auto journal skipped`, {
        sourceModule: input.sourceModule,
        sourceId: input.sourceId,
      });
      return {
        ok: false,
        skipped: true,
        reason: `Account ${line.accountCode} not found in Chart of Accounts`,
      };
    }
  }

  const normalizedLines = input.lines.map((l) => ({
    ...l,
    debit: roundMoney(l.debit),
    credit: roundMoney(l.credit),
  }));

  const totals = normalizedLines.reduce(
    (acc, l) => ({
      debit: roundMoney(acc.debit + l.debit),
      credit: roundMoney(acc.credit + l.credit),
    }),
    { debit: 0, credit: 0 }
  );

  if (Math.abs(totals.debit - totals.credit) >= 0.01) {
    return { ok: false, skipped: true, reason: "Auto journal lines are not balanced" };
  }

  const now = new Date().toISOString();
  const date = String(input.date || "").trim().slice(0, 10) || now.slice(0, 10);
  const store = loadJournalStore(schoolId);
  const journalNo = nextJournalNo(store.journals, date);
  const createdBy = String(input.createdBy || "System").trim() || "System";

  const journal: Journal = {
    id: uid("jn"),
    journalNo,
    date,
    description: String(input.description || "").trim(),
    reference: String(input.reference || "").trim(),
    notes: String(input.notes || "Auto-generated journal").trim(),
    status: "Posted",
    lines: normalizedLines,
    createdBy,
    createdAt: now,
    updatedAt: now,
    postedAt: now,
    origin: "AUTO",
    sourceModule: input.sourceModule,
    sourceId: String(input.sourceId || "").trim(),
    sourceFingerprint: fingerprint,
    autoGenerated: true,
  };

  const audit = appendAudit(store.audit, {
    journalNo: journal.journalNo,
    action: "AutoPosted",
    user: createdBy,
    details: `Auto journal created · ${input.sourceModule} · ${journal.description} · ${now}`,
  });

  saveJournalStore(schoolId, {
    journals: [journal, ...store.journals],
    audit,
  });

  console.info("[EduClear AutoJournal] Posted", {
    journalNo,
    sourceModule: input.sourceModule,
    sourceId: input.sourceId,
    fingerprint,
    debit: journalTotals(journal).debit,
  });

  return { ok: true, journalNo, journalId: journal.id };
}

function postFromRule(
  schoolId: string,
  transactionType: AutoPostingTransactionType,
  input: {
    sourceModule: JournalSourceModule;
    sourceId: string;
    amount: number;
    date: string;
    reference: string;
    descriptionVars: Record<string, string>;
    debitCode: string;
    creditCode: string;
    createdBy?: string;
    notes?: string;
  }
): AutoJournalResult {
  const rule = getRule(transactionType);
  if (!rule?.enabled) {
    return { ok: false, skipped: true, reason: `Auto-posting disabled for ${transactionType}` };
  }

  const amount = roundMoney(input.amount);
  if (amount <= 0) {
    return { ok: false, skipped: true, reason: "Amount must be greater than zero" };
  }

  const debitAcct = resolveCoaAccount(schoolId, input.debitCode);
  const creditAcct = resolveCoaAccount(schoolId, input.creditCode);
  if (!debitAcct || !creditAcct) {
    logAutoPostWarning("Required accounts missing for auto-post", {
      debitCode: input.debitCode,
      creditCode: input.creditCode,
      transactionType,
    });
    return {
      ok: false,
      skipped: true,
      reason: "Required Chart of Accounts codes are missing",
    };
  }

  const description = applyDescriptionTemplate(rule.descriptionTemplate, input.descriptionVars);
  const fingerprint = buildSourceFingerprint({
    sourceType: transactionType,
    sourceId: input.sourceId,
    amount,
    date: input.date,
  });

  return createAutoJournal({
    schoolId,
    date: input.date,
    description,
    reference: input.reference,
    notes: input.notes,
    sourceModule: input.sourceModule,
    sourceId: input.sourceId,
    sourceFingerprint: fingerprint,
    createdBy: input.createdBy,
    lines: [
      createJournalLine({
        accountCode: debitAcct.code,
        accountName: debitAcct.name,
        debit: amount,
        memo: description,
      }),
      createJournalLine({
        accountCode: creditAcct.code,
        accountName: creditAcct.name,
        credit: amount,
        memo: description,
      }),
    ],
  });
}

export function postBillingPaymentJournal(input: {
  schoolId: string;
  sourceId: string;
  amount: number;
  date: string;
  accountNo: string;
  reference?: string;
  createdBy?: string;
}): AutoJournalResult {
  const accountNo = String(input.accountNo || "").trim() || "—";
  const reference = String(input.reference || accountNo).trim();
  return postFromRule(input.schoolId, "billing_payment", {
    sourceModule: "Billing",
    sourceId: input.sourceId,
    amount: input.amount,
    date: input.date,
    reference,
    descriptionVars: { accountNo, reference },
    debitCode: COA_CODES.bank,
    creditCode: COA_CODES.schoolFeesIncome,
    createdBy: input.createdBy || "Billing",
    notes: "Auto-posted from Billing payment",
  });
}

export function postExpenseApprovalJournal(input: {
  schoolId: string;
  sourceId: string;
  amount: number;
  date: string;
  category: string;
  reference?: string;
  createdBy?: string;
}): AutoJournalResult {
  if (isBankChargeCategory(input.category)) {
    return postBankChargeJournal({
      schoolId: input.schoolId,
      sourceId: input.sourceId,
      amount: input.amount,
      date: input.date,
      reference: input.reference || input.category,
      createdBy: input.createdBy,
    });
  }

  const category = String(input.category || "Other").trim();
  const debitCode = getExpenseDebitAccountCode(category);
  const reference = String(input.reference || category).trim();

  return postFromRule(input.schoolId, "expense_approval", {
    sourceModule: "Expenses",
    sourceId: input.sourceId,
    amount: input.amount,
    date: input.date,
    reference,
    descriptionVars: { category, reference },
    debitCode,
    creditCode: COA_CODES.bank,
    createdBy: input.createdBy || "Expenses",
    notes: "Auto-posted from approved expense",
  });
}

export function postBankChargeJournal(input: {
  schoolId: string;
  sourceId: string;
  amount: number;
  date: string;
  reference?: string;
  createdBy?: string;
}): AutoJournalResult {
  const reference = String(input.reference || "Bank charge").trim();
  return postFromRule(input.schoolId, "bank_charge", {
    sourceModule: "Banking",
    sourceId: input.sourceId,
    amount: input.amount,
    date: input.date,
    reference,
    descriptionVars: { reference },
    debitCode: COA_CODES.bankChargesExpense,
    creditCode: COA_CODES.bank,
    createdBy: input.createdBy || "Banking",
    notes: "Auto-posted bank charge",
  });
}

export function postSupplierPaymentPlaceholder(): AutoJournalResult {
  console.info(
    "[EduClear AutoJournal] Supplier payment automatic journal posting will be connected later."
  );
  return {
    ok: false,
    skipped: true,
    reason: "Supplier payment automatic journal posting will be connected later.",
  };
}
