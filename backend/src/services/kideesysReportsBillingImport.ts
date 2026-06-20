import path from "path";
import crypto from "crypto";

import { prisma } from "../prisma";
import {
  parseAgeAnalysisFileWithAudit,
  parseBillingPlanFile,
  parseEmployeesFile,
  type ParsedBillingAccount,
} from "./daSilvaMigration/parsers";
import { parseKideesysSpreadsheetFile, parseAmount, parseKidEsysDate } from "../utils/kideesysSpreadsheet";
import {
  upsertSchoolEntries,
  type BillingLedgerEntry,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import { upsertSchoolBillingPlans, type StoredBillingPlanItem, readSchoolBillingPlans } from "../utils/learnerBillingPlanStore";
import {
  upsertSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import { materializeKidesysDisplayHistory } from "./kidesysDisplayHistoryMaterializer";
import { normalizeKidesysBillingSection } from "./billingSummary";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import type { ParsedTransaction } from "./daSilvaMigration/parsers";

type ImportPaths = {
  ageAnalysisXls: string;
  billingPlanXls: string;
  transactionsXls: string;
  employeesXls: string;
};

export type KideesysReportsDryRunResult = {
  passed: boolean;
  issues: string[];
  counts: {
    ageAnalysisAccounts: number;
    billingPlanItems: number;
    transactionsInvoices: number;
    transactionsPayments: number;
    transactionsJournals: number;
    employees: number;
  };
  totals: {
    ageAnalysisOutstanding: number;
  };
  unmatched: {
    accounts: string[];
    billingPlanLearners: string[];
    transactionAccounts: string[];
  };
};

export type KideesysReportsImportResult = {
  imported: {
    accounts: number;
    billingPlans: number;
    invoices: number;
    payments: number;
    journals: number;
    employees: number;
  };
  statements: {
    withBalance: number;
    withLastInvoice: number;
    withLastPayment: number;
  };
  unmatchedAccounts: number;
  auditPassed: boolean;
};

function normalizeText(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function money(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
}

function sha1(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 20);
}

function buildLedgerId(kind: "invoice" | "payment" | "journal", schoolId: string, accountNo: string, txNo: string) {
  const base = `${kind}|${schoolId}|${String(accountNo || "").trim()}|${String(txNo || "").trim()}`;
  return `kidesys-${kind}-${sha1(base)}`;
}

type ParsedTx = {
  kind: "invoice" | "payment" | "journal";
  transactionNo: string;
  date: string;
  accountNo: string;
  fullName: string;
  notes: string;
  amountAbs: number;
  signedAmount: number;
};

function mapParsedTxToHistoryTransaction(t: ParsedTx, rowIndex: number): ParsedTransaction | null {
  if (t.kind !== "invoice" && t.kind !== "payment") return null;
  const accountNo = String(t.accountNo || "").trim().toUpperCase();
  if (!accountNo) return null;
  return {
    kind: t.kind,
    transactionNo: String(t.transactionNo || "").trim(),
    accountNo,
    date: String(t.date || "").trim(),
    amount: money(t.amountAbs),
    signedAmount: money(t.signedAmount),
    reference: `${t.kind.toUpperCase()} ${t.transactionNo}`.trim(),
    notes: String(t.notes || "").trim(),
    fullName: String(t.fullName || "").trim(),
    sourceFileRow: rowIndex,
    direction: t.kind === "payment" ? "credit" : "debit",
  };
}

function parseReportTransactionsWithJournals(filePath: string): ParsedTx[] {
  const sheet = parseKideesysSpreadsheetFile(filePath);
  let section: "invoice" | "payment" | "journal" | "" = "";
  const results: ParsedTx[] = [];

  const rowText = (row: string[], idx: number) => String(row[idx] ?? "").trim();
  const isNumericIndex = (v: string) => /^\d+$/.test(String(v || "").trim());

  for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
    const row = sheet.rows[rowIndex] || [];
    const c0 = rowText(row, 0);

    if (c0 === "Invoice") {
      section = "invoice";
      continue;
    }
    if (c0 === "Payment") {
      section = "payment";
      continue;
    }
    if (c0 === "Journal") {
      section = "journal";
      continue;
    }
    if (!section || !isNumericIndex(c0)) continue;

    const ref = rowText(row, 1);
    const rawDate = rowText(row, 2);
    const accountNo = rowText(row, 3);
    const fullName = rowText(row, 4);
    const notes = rowText(row, 5);
    const amt = parseAmount(rowText(row, 6));

    if (!ref || !rawDate || !accountNo) continue;

    const m = ref.match(/^(Invoice|Payment|Journal)\s+(\d+)$/i);
    const transactionNo = m?.[2] ? String(m[2]) : ref.replace(/[^0-9]/g, "") || ref;

    const date = parseKidEsysDate(rawDate) || rawDate;
    const amountAbs = Math.abs(money(amt));
    if (!amountAbs) continue;

    const inferredKind = (m?.[1] || section).toLowerCase() as "invoice" | "payment" | "journal";
    const signedAmount =
      inferredKind === "payment" ? -amountAbs : inferredKind === "journal" ? money(amt) : amountAbs;

    results.push({
      kind: inferredKind,
      transactionNo,
      date,
      accountNo,
      fullName,
      notes,
      amountAbs,
      signedAmount,
    });
  }

  return results;
}

async function buildLearnerIndexes(schoolId: string) {
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: { id: true, firstName: true, lastName: true, familyAccountId: true },
  });
  const byFullName = new Map<string, string[]>();
  for (const l of learners) {
    const key = normalizeText(`${l.firstName} ${l.lastName}`);
    const list = byFullName.get(key) || [];
    list.push(l.id);
    byFullName.set(key, list);
  }
  return { learners, byFullName };
}

async function resolveUniqueLearnerIdByName(
  byFullName: Map<string, string[]>,
  fullName: string
): Promise<string> {
  const key = normalizeText(fullName);
  const hits = byFullName.get(key) || [];
  return hits.length === 1 ? hits[0] : "";
}

export async function kideesysReportsDryRun(opts: {
  schoolId: string;
  paths: ImportPaths;
}): Promise<KideesysReportsDryRunResult> {
  const schoolId = String(opts.schoolId || "").trim();
  const issues: string[] = [];
  if (!schoolId) issues.push("Missing schoolId");

  const paths = {
    ageAnalysisXls: path.resolve(opts.paths.ageAnalysisXls),
    billingPlanXls: path.resolve(opts.paths.billingPlanXls),
    transactionsXls: path.resolve(opts.paths.transactionsXls),
    employeesXls: path.resolve(opts.paths.employeesXls),
  };

  const { accounts, audit } = parseAgeAnalysisFileWithAudit(paths.ageAnalysisXls);
  if (!audit.accountNumbersParsed) issues.push("Age analysis: no account numbers parsed");

  const billingItems = parseBillingPlanFile(paths.billingPlanXls);
  const txs = parseReportTransactionsWithJournals(paths.transactionsXls);
  const employees = parseEmployeesFile(paths.employeesXls);

  const invoiceCount = txs.filter((t) => t.kind === "invoice").length;
  const paymentCount = txs.filter((t) => t.kind === "payment").length;
  const journalCount = txs.filter((t) => t.kind === "journal").length;

  const { byFullName } = await buildLearnerIndexes(schoolId);

  const unmatchedAccounts: string[] = [];
  for (const a of accounts) {
    const learnerId = await resolveUniqueLearnerIdByName(byFullName, a.fullName);
    if (!learnerId) unmatchedAccounts.push(a.accountNo);
  }

  const unmatchedBillingLearners = new Set<string>();
  for (const item of billingItems) {
    const learnerId = await resolveUniqueLearnerIdByName(byFullName, item.fullName);
    if (!learnerId) unmatchedBillingLearners.add(item.fullName);
  }

  const unmatchedTxAccounts = new Set<string>();
  for (const t of txs) {
    const learnerId = await resolveUniqueLearnerIdByName(byFullName, t.fullName);
    if (!learnerId) unmatchedTxAccounts.add(t.accountNo);
  }

  const ageAnalysisOutstanding = money(accounts.reduce((s, a) => s + money(a.balance), 0));

  const passed = issues.length === 0;
  return {
    passed,
    issues,
    counts: {
      ageAnalysisAccounts: accounts.length,
      billingPlanItems: billingItems.length,
      transactionsInvoices: invoiceCount,
      transactionsPayments: paymentCount,
      transactionsJournals: journalCount,
      employees: employees.length,
    },
    totals: {
      ageAnalysisOutstanding,
    },
    unmatched: {
      accounts: unmatchedAccounts.sort(),
      billingPlanLearners: Array.from(unmatchedBillingLearners).sort(),
      transactionAccounts: Array.from(unmatchedTxAccounts).sort(),
    },
  };
}

async function upsertFamilyAccountsFromAgeAnalysis(opts: {
  schoolId: string;
  accounts: ParsedBillingAccount[];
  byFullName: Map<string, string[]>;
  dryRun: boolean;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  const importedAt = new Date().toISOString();
  const snapshots: Record<string, FamilyAccountAgeAnalysisSnapshot> = {};

  let imported = 0;
  for (const account of opts.accounts) {
    const accountRef = String(account.accountNo || "").trim().toUpperCase();
    if (!accountRef) continue;
    const accountHolder = String(account.fullName || "").trim() || accountRef;

    snapshots[accountRef] = {
      schoolId,
      accountRef,
      accountHolder,
      kidesysSection: normalizeKidesysBillingSection(account.section),
      balance: money(account.balance),
      buckets: {
        current: money(account.current),
        d30: money(account.d30),
        d60: money(account.d60),
        d90: money(account.d90),
        d120: money(account.d120),
      },
      source: "kideesys-age-analysis",
      importedAt,
    };

    if (opts.dryRun) {
      imported += 1;
      continue;
    }

    const existing = await prisma.familyAccount.findFirst({
      where: { schoolId, accountRef },
      select: { id: true },
    });
    const familyAccount = existing
      ? await prisma.familyAccount.update({
          where: { id: existing.id },
          data: { familyName: accountHolder },
          select: { id: true },
        })
      : await prisma.familyAccount.create({
          data: {
            schoolId,
            accountRef,
            familyName: accountHolder,
          },
          select: { id: true },
        });
    imported += 1;

    const learnerId = await resolveUniqueLearnerIdByName(opts.byFullName, accountHolder);
    if (learnerId) {
      const learner = await prisma.learner.findUnique({
        where: { id: learnerId },
        select: { id: true, familyAccountId: true },
      });
      if (learner && !learner.familyAccountId) {
        // Only link when learner currently has no family account.
        await prisma.learner.update({
          where: { id: learnerId },
          data: {
            familyAccountId: familyAccount.id,
          },
          select: { id: true },
        });
      }
    }
  }

  if (!opts.dryRun) {
    upsertSchoolFamilyAccountAgeAnalysisSnapshots(schoolId, snapshots);
  }

  return { imported, snapshotsCount: Object.keys(snapshots).length };
}

async function upsertBillingPlans(opts: {
  schoolId: string;
  billingItems: Array<{ fullName: string; feeDescription: string; amount: number }>;
  byFullName: Map<string, string[]>;
  dryRun: boolean;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  const existing = readSchoolBillingPlans(schoolId);

  const byLearnerId: Record<string, StoredBillingPlanItem[]> = {};
  const itemKey = (x: { feeDescription: string; amount: number }) =>
    `${normalizeText(x.feeDescription)}|${money(x.amount).toFixed(2)}`;

  for (const item of opts.billingItems) {
    const learnerId = await resolveUniqueLearnerIdByName(opts.byFullName, item.fullName);
    if (!learnerId) continue;
    if (!byLearnerId[learnerId]) byLearnerId[learnerId] = [];
    byLearnerId[learnerId].push({
      feeDescription: String(item.feeDescription || "").trim(),
      amount: money(item.amount),
    });
  }

  // Idempotent: merge by (feeDescription, amount) within each learner.
  for (const [learnerId, items] of Object.entries(byLearnerId)) {
    const prev = Array.isArray(existing[learnerId]) ? existing[learnerId] : [];
    const mergedMap = new Map<string, StoredBillingPlanItem>();
    for (const it of prev) mergedMap.set(itemKey(it), it);
    for (const it of items) mergedMap.set(itemKey(it), it);
    byLearnerId[learnerId] = Array.from(mergedMap.values());
  }

  if (!opts.dryRun) {
    upsertSchoolBillingPlans(schoolId, byLearnerId);
  }

  return { learnersTouched: Object.keys(byLearnerId).length };
}

async function upsertLedgerTransactions(opts: {
  schoolId: string;
  transactions: ParsedTx[];
  byFullName: Map<string, string[]>;
  dryRun: boolean;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  const now = new Date().toISOString();

  const entries: BillingLedgerEntry[] = [];
  let invoices = 0;
  let payments = 0;
  let journals = 0;

  for (const t of opts.transactions) {
    const learnerId = await resolveUniqueLearnerIdByName(opts.byFullName, t.fullName);
    const accountNo = String(t.accountNo || "").trim().toUpperCase();
    const id = buildLedgerId(t.kind, schoolId, accountNo, t.transactionNo);

    if (t.kind === "invoice") invoices += 1;
    else if (t.kind === "payment") payments += 1;
    else journals += 1;

    const isJournal = t.kind === "journal";
    const entryType =
      t.kind === "invoice"
        ? "invoice"
        : t.kind === "payment"
          ? "payment"
          : t.signedAmount < 0
            ? "credit"
            : "invoice";

    entries.push({
      id,
      schoolId,
      learnerId: learnerId || "",
      accountNo,
      type: entryType,
      amount: money(t.amountAbs),
      date: String(t.date || "").trim(),
      reference: `${t.kind.toUpperCase()} ${t.transactionNo}`.trim(),
      description: (String(t.notes || "").trim() || (isJournal ? "Journal" : t.kind)).trim(),
      source: isJournal ? "kideesys-journal" : "kideesys-transaction",
      createdAt: now,
    });
  }

  if (!opts.dryRun && entries.length) {
    upsertSchoolEntries(schoolId, entries);
  }

  return { invoices, payments, journals, ledgerEntries: entries.length };
}

async function upsertEmployees(opts: {
  schoolId: string;
  employees: Array<{ fullName: string; firstName: string; lastName: string; mobileNumber: string; email: string; physicalAddress: string }>;
  dryRun: boolean;
}) {
  const schoolId = String(opts.schoolId || "").trim();
  let imported = 0;

  for (const e of opts.employees) {
    const firstName = String(e.firstName || "").trim() || String(e.fullName || "").trim();
    const lastName = String(e.lastName || "").trim() || "-";
    const email = String(e.email || "").trim().toLowerCase() || null;
    const mobile = String(e.mobileNumber || "").trim() || null;
    const fullName = String(e.fullName || "").trim() || `${firstName} ${lastName}`.trim();

    if (opts.dryRun) {
      imported += 1;
      continue;
    }

    const existing =
      (email
        ? await prisma.employee.findFirst({
            where: { schoolId, email },
            select: { id: true },
          })
        : null) ||
      (mobile
        ? await prisma.employee.findFirst({
            where: { schoolId, mobileNumber: mobile },
            select: { id: true },
          })
        : null) ||
      (fullName
        ? await prisma.employee.findFirst({
            where: { schoolId, fullName },
            select: { id: true },
          })
        : null);

    if (existing) {
      await prisma.employee.update({
        where: { id: existing.id },
        data: {
          firstName,
          lastName,
          fullName,
          email: email || undefined,
          mobileNumber: mobile || undefined,
          physicalAddress: String(e.physicalAddress || "").trim() || undefined,
          isActive: true,
        },
        select: { id: true },
      });
      imported += 1;
      continue;
    }

    await prisma.employee.create({
      data: {
        schoolId,
        firstName,
        lastName,
        fullName,
        email: email || undefined,
        mobileNumber: mobile || undefined,
        physicalAddress: String(e.physicalAddress || "").trim() || undefined,
        isActive: true,
      },
      select: { id: true },
    });
    imported += 1;
  }

  return { imported };
}

export async function kideesysReportsImportAndAudit(opts: {
  schoolId: string;
  paths: ImportPaths;
  dryRun: boolean;
}): Promise<{
  dryRun: KideesysReportsDryRunResult;
  import?: KideesysReportsImportResult;
}> {
  const schoolId = String(opts.schoolId || "").trim();
  const dryRun = await kideesysReportsDryRun({ schoolId, paths: opts.paths });
  if (!dryRun.passed) return { dryRun };

  if (opts.dryRun) return { dryRun };

  const { byFullName } = await buildLearnerIndexes(schoolId);

  const ageParsed = parseAgeAnalysisFileWithAudit(path.resolve(opts.paths.ageAnalysisXls));
  const planItems = parseBillingPlanFile(path.resolve(opts.paths.billingPlanXls));
  const txs = parseReportTransactionsWithJournals(path.resolve(opts.paths.transactionsXls));
  const employees = parseEmployeesFile(path.resolve(opts.paths.employeesXls));

  const ageResult = await upsertFamilyAccountsFromAgeAnalysis({
    schoolId,
    accounts: ageParsed.accounts,
    byFullName,
    dryRun: false,
  });

  const planResult = await upsertBillingPlans({
    schoolId,
    billingItems: planItems,
    byFullName,
    dryRun: false,
  });

  const txResult = await upsertLedgerTransactions({
    schoolId,
    transactions: txs,
    byFullName,
    dryRun: false,
  });

  const historyTransactions = txs
    .map((t, i) => mapParsedTxToHistoryTransaction(t, i + 1))
    .filter((t): t is ParsedTransaction => Boolean(t));
  materializeKidesysDisplayHistory({
    schoolId,
    transactions: historyTransactions,
    dryRun: false,
  });

  const empResult = await upsertEmployees({
    schoolId,
    employees,
    dryRun: false,
  });

  const statements = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const statementsWithBalance = statements.filter((s) => money(s.balance) !== 0).length;
  const statementsWithLastInvoice = statements.filter(
    (s) => Boolean(String(s.lastInvoiceDate || "").trim()) || Boolean(s.lastInvoiceLabel)
  ).length;
  const statementsWithLastPayment = statements.filter((s) =>
    Boolean(String(s.lastPaymentDate || "").trim())
  ).length;

  const imported = {
    accounts: ageResult.imported,
    billingPlans: planResult.learnersTouched,
    invoices: txResult.invoices,
    payments: txResult.payments,
    journals: txResult.journals,
    employees: empResult.imported,
  };

  const auditPassed = dryRun.passed;
  return {
    dryRun,
    import: {
      imported,
      statements: {
        withBalance: statementsWithBalance,
        withLastInvoice: statementsWithLastInvoice,
        withLastPayment: statementsWithLastPayment,
      },
      unmatchedAccounts: dryRun.unmatched.accounts.length,
      auditPassed,
    },
  };
}

