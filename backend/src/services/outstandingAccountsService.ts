/**
 * Outstanding Accounts report — read-only.
 * Balance source: buildAccountsFromAgeAnalysisSnapshots (authoritative).
 * Inclusion: authoritative balance > 0 only. One row per family account.
 */
import { prisma } from "../prisma";
import {
  buildAccountsFromAgeAnalysisSnapshots,
  roundStatementMoney,
  type BillingStatementAccountRow,
} from "./statementAccounts";
import {
  isInvoicePastDue,
  listOverdueInvoicesForAccount,
  readSchoolLedger,
  resolveEntryDueDate,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";

export type OutstandingAccountContact = {
  parentId: string | null;
  name: string | null;
  primaryCellphone: string | null;
  alternateContact: string | null;
  email: string | null;
  relationship: string | null;
};

export type OutstandingAccountRow = {
  familyAccountId: string | null;
  /** Ledger / age-analysis join key (FamilyAccount.accountRef). */
  accountRef: string;
  /** Staff-visible account number (EduClear accountNo when assigned, else Kid-e-Sys accountRef). */
  accountNumber: string;
  learnerNames: string[];
  memberLearnerIds: string[];
  grades: string[];
  classes: string[];
  outstandingBalance: number;
  parentGuardianName: string | null;
  primaryCellphone: string | null;
  alternateContact: string | null;
  email: string | null;
  lastPaymentDate: string | null;
  lastPaymentAmount: number | null;
  /** Calendar days from oldest past-due invoice due date to asOf; null when unknown. */
  daysOverdue: number | null;
  oldestDueDate: string | null;
};

export type OutstandingAccountsSummary = {
  totalOutstanding: number;
  outstandingAccountCount: number;
  learnersAffected: number;
};

export type OutstandingAccountsReport = {
  schoolId: string;
  asOfDate: string;
  summary: OutstandingAccountsSummary;
  accounts: OutstandingAccountRow[];
};

type ParentContactRecord = {
  id: string;
  firstName: string;
  surname: string;
  cellNo: string | null;
  workNo: string | null;
  homeNo: string | null;
  email: string | null;
  communicationBilling: boolean | null;
};

type ParentLinkRecord = {
  learnerId: string;
  isPrimary: boolean;
  isPayingPerson: boolean;
  billingStatement: boolean;
  relation: string | null;
  parent: ParentContactRecord;
};

import {
  parentDisplayName,
  pickAlternateContact,
  scoreDisplayContact,
} from "../utils/displayContactRanking";

/** @deprecated Prefer scoreDisplayContact — identical weights preserved for OA API stability. */
export function scoreOutstandingDisplayContact(input: {
  isPrimary?: boolean | null;
  isPayingPerson?: boolean | null;
  communicationBilling?: boolean | null;
}): number {
  return scoreDisplayContact(input);
}

export { parentDisplayName, pickAlternateContact };

export function selectOutstandingBillingContact(
  links: ParentLinkRecord[],
  memberLearnerIds: string[],
  familyParents: ParentContactRecord[] = []
): OutstandingAccountContact {
  const memberSet = new Set(memberLearnerIds.map((id) => String(id || "").trim()).filter(Boolean));
  type Candidate = {
    parent: ParentContactRecord;
    score: number;
    relation: string | null;
  };
  const byParentId = new Map<string, Candidate>();

  for (const link of links) {
    if (!memberSet.has(String(link.learnerId || "").trim())) continue;
    const parent = link.parent;
    if (!parent?.id) continue;
    const score = scoreOutstandingDisplayContact({
      isPrimary: link.isPrimary,
      isPayingPerson: link.isPayingPerson,
      communicationBilling: parent.communicationBilling,
    });
    const existing = byParentId.get(parent.id);
    if (!existing || score > existing.score) {
      byParentId.set(parent.id, {
        parent,
        score,
        relation: link.relation || null,
      });
    }
  }

  for (const parent of familyParents) {
    if (!parent?.id || byParentId.has(parent.id)) continue;
    byParentId.set(parent.id, {
      parent,
      score: scoreOutstandingDisplayContact({
        isPrimary: false,
        isPayingPerson: false,
        communicationBilling: parent.communicationBilling,
      }),
      relation: null,
    });
  }

  const ranked = Array.from(byParentId.values()).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) {
    return {
      parentId: null,
      name: null,
      primaryCellphone: null,
      alternateContact: null,
      email: null,
      relationship: null,
    };
  }

  const cell = String(best.parent.cellNo || "").trim();
  const email = String(best.parent.email || "").trim();
  return {
    parentId: best.parent.id,
    name: parentDisplayName(best.parent) || null,
    primaryCellphone: cell || null,
    alternateContact: pickAlternateContact(best.parent),
    email: email || null,
    relationship: best.relation,
  };
}

/** ISO date calendar-day difference (to - from). */
export function calendarDaysBetween(fromIso: string, toIso: string): number | null {
  const from = String(fromIso || "").trim().slice(0, 10);
  const to = String(toIso || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Oldest past-due invoice due date via existing ledger helpers.
 * Does not use lastInvoiceDate. Returns null when no reliable past-due due date exists.
 */
export function resolveOldestPastDue(
  ledger: BillingLedgerEntry[],
  accountRef: string,
  memberLearnerIds: string[],
  asOfDate: string,
  runDueDates: Record<string, string> = {}
): { daysOverdue: number | null; oldestDueDate: string | null } {
  const ref = String(accountRef || "").trim();
  if (!ref) return { daysOverdue: null, oldestDueDate: null };
  const asOf = String(asOfDate || "").trim().slice(0, 10);

  const overdueByAccount = listOverdueInvoicesForAccount(ledger, "", ref, asOf, runDueDates);
  const seen = new Set(overdueByAccount.map((row) => row.id));
  const combined = [...overdueByAccount];

  for (const learnerId of memberLearnerIds) {
    const lid = String(learnerId || "").trim();
    if (!lid) continue;
    for (const row of listOverdueInvoicesForAccount(ledger, lid, ref, asOf, runDueDates)) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      combined.push(row);
    }
  }

  if (!combined.length) {
    // Extra safety: scan account-scoped invoices with resolveEntryDueDate directly
    // (same rules) in case learner-only rows were missed with empty learnerId.
    const accountInvoices = ledger.filter(
      (e) =>
        e.type === "invoice" &&
        String(e.accountNo || "").trim().toUpperCase() === ref.toUpperCase()
    );
    let oldest: string | null = null;
    for (const entry of accountInvoices) {
      const due = resolveEntryDueDate(entry, runDueDates);
      if (!due || !isInvoicePastDue(due, asOf)) continue;
      if (!oldest || due < oldest) oldest = due;
    }
    if (!oldest) return { daysOverdue: null, oldestDueDate: null };
    const days = calendarDaysBetween(oldest, asOf);
    return {
      daysOverdue: days != null && days > 0 ? days : null,
      oldestDueDate: oldest,
    };
  }

  combined.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const oldestDueDate = combined[0].dueDate;
  const days = calendarDaysBetween(oldestDueDate, asOf);
  return {
    daysOverdue: days != null && days > 0 ? days : null,
    oldestDueDate,
  };
}

export function uniqueSortedLabels(values: Array<string | null | undefined>): string[] {
  const set = new Set<string>();
  for (const v of values) {
    const s = String(v || "").trim();
    if (s) set.add(s);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function buildOutstandingSummary(rows: OutstandingAccountRow[]): OutstandingAccountsSummary {
  const learnerIds = new Set<string>();
  let total = 0;
  for (const row of rows) {
    total += roundStatementMoney(row.outstandingBalance);
    for (const id of row.memberLearnerIds) {
      const lid = String(id || "").trim();
      if (lid) learnerIds.add(lid);
    }
  }
  return {
    totalOutstanding: roundStatementMoney(total),
    outstandingAccountCount: rows.length,
    learnersAffected: learnerIds.size,
  };
}

export function filterPositiveBalanceAccounts(
  accounts: BillingStatementAccountRow[]
): BillingStatementAccountRow[] {
  return accounts.filter((row) => roundStatementMoney(row.balance) > 0);
}

export function resolveDisplayAccountNumber(row: BillingStatementAccountRow): string {
  const edu = String(row.eduClearAccountNo || "").trim();
  if (edu) return edu;
  const source = String(row.sourceAccountRef || "").trim();
  if (source) return source;
  return String(row.accountNo || "").trim() || "-";
}

type LearnerGradeClass = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
};

/** Display name from batch-loaded Learner fields (no invented placeholders). */
export function formatOutstandingLearnerName(learner: {
  firstName?: string | null;
  lastName?: string | null;
}): string {
  return `${learner.firstName || ""} ${learner.lastName || ""}`.trim();
}

/**
 * Resolve display names for family members from membership IDs + batch-loaded learners.
 * Preserves membership order, dedupes by learner id, skips unresolvable IDs.
 * Does not rely on incomplete statement memberNames.
 */
export function resolveOutstandingLearnerNames(
  memberLearnerIds: string[],
  learnersById: Map<string, LearnerGradeClass>
): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const rawId of memberLearnerIds) {
    const id = String(rawId || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const learner = learnersById.get(id);
    if (!learner) continue;
    const name = formatOutstandingLearnerName(learner);
    if (!name) continue;
    names.push(name);
  }
  return names;
}

/** Pure mapper used by service + tests (no DB). */
export function mapOutstandingRows(input: {
  statementAccounts: BillingStatementAccountRow[];
  learnersById: Map<string, LearnerGradeClass>;
  links: ParentLinkRecord[];
  parentsByFamilyId: Map<string, ParentContactRecord[]>;
  ledger: BillingLedgerEntry[];
  asOfDate: string;
  runDueDates?: Record<string, string>;
}): OutstandingAccountRow[] {
  const positive = filterPositiveBalanceAccounts(input.statementAccounts);
  const runDueDates = input.runDueDates || {};

  return positive.map((account) => {
    const memberLearnerIds = Array.from(
      new Set(
        (account.memberLearnerIds || []).map((id) => String(id || "").trim()).filter(Boolean)
      )
    );
    const learnerNames = resolveOutstandingLearnerNames(memberLearnerIds, input.learnersById);

    const grades: string[] = [];
    const classes: string[] = [];
    for (const id of memberLearnerIds) {
      const learner = input.learnersById.get(id);
      if (!learner) continue;
      if (learner.grade) grades.push(learner.grade);
      if (learner.className) classes.push(learner.className);
    }

    const familyParents = account.familyAccountId
      ? input.parentsByFamilyId.get(account.familyAccountId) || []
      : [];
    const contact = selectOutstandingBillingContact(input.links, memberLearnerIds, familyParents);
    const overdue = resolveOldestPastDue(
      input.ledger,
      String(account.accountNo || "").trim(),
      memberLearnerIds,
      input.asOfDate,
      runDueDates
    );

    const lastPaymentAmount = Number(account.lastPayment);
    const lastPaymentDate = String(account.lastPaymentDate || "").trim();

    return {
      familyAccountId: account.familyAccountId || null,
      accountRef: String(account.accountNo || "").trim(),
      accountNumber: resolveDisplayAccountNumber(account),
      learnerNames,
      memberLearnerIds,
      grades: uniqueSortedLabels(grades),
      classes: uniqueSortedLabels(classes),
      outstandingBalance: roundStatementMoney(account.balance),
      parentGuardianName: contact.name,
      primaryCellphone: contact.primaryCellphone,
      alternateContact: contact.alternateContact,
      email: contact.email,
      lastPaymentDate: lastPaymentDate || null,
      lastPaymentAmount: Number.isFinite(lastPaymentAmount) ? roundStatementMoney(lastPaymentAmount) : null,
      daysOverdue: overdue.daysOverdue,
      oldestDueDate: overdue.oldestDueDate,
    };
  });
}

async function batchLoadLearnersAndContacts(
  schoolId: string,
  accounts: BillingStatementAccountRow[]
): Promise<{
  learnersById: Map<string, LearnerGradeClass>;
  links: ParentLinkRecord[];
  parentsByFamilyId: Map<string, ParentContactRecord[]>;
}> {
  const memberIds = Array.from(
    new Set(
      accounts.flatMap((a) => (a.memberLearnerIds || []).map((id) => String(id || "").trim()).filter(Boolean))
    )
  );
  const familyIds = Array.from(
    new Set(accounts.map((a) => String(a.familyAccountId || "").trim()).filter(Boolean))
  );

  const [learners, links, familyParents] = await Promise.all([
    memberIds.length
      ? prisma.learner.findMany({
          where: { schoolId, id: { in: memberIds } },
          select: { id: true, firstName: true, lastName: true, grade: true, className: true },
        })
      : Promise.resolve([]),
    memberIds.length
      ? prisma.parentLearnerLink.findMany({
          where: { schoolId, learnerId: { in: memberIds } },
          select: {
            learnerId: true,
            isPrimary: true,
            isPayingPerson: true,
            billingStatement: true,
            relation: true,
            parent: {
              select: {
                id: true,
                firstName: true,
                surname: true,
                cellNo: true,
                workNo: true,
                homeNo: true,
                email: true,
                communicationBilling: true,
              },
            },
          },
        })
      : Promise.resolve([]),
    familyIds.length
      ? prisma.parent.findMany({
          where: { schoolId, familyAccountId: { in: familyIds } },
          select: {
            id: true,
            familyAccountId: true,
            firstName: true,
            surname: true,
            cellNo: true,
            workNo: true,
            homeNo: true,
            email: true,
            communicationBilling: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const learnersById = new Map<string, LearnerGradeClass>();
  for (const l of learners) {
    learnersById.set(l.id, {
      id: l.id,
      firstName: String(l.firstName || "").trim(),
      lastName: String(l.lastName || "").trim(),
      grade: String(l.grade || "").trim(),
      className: l.className ? String(l.className).trim() : null,
    });
  }

  const parentsByFamilyId = new Map<string, ParentContactRecord[]>();
  for (const p of familyParents) {
    const fid = String(p.familyAccountId || "").trim();
    if (!fid) continue;
    const list = parentsByFamilyId.get(fid) || [];
    list.push({
      id: p.id,
      firstName: p.firstName,
      surname: p.surname,
      cellNo: p.cellNo,
      workNo: p.workNo,
      homeNo: p.homeNo,
      email: p.email,
      communicationBilling: p.communicationBilling,
    });
    parentsByFamilyId.set(fid, list);
  }

  return {
    learnersById,
    links: links as ParentLinkRecord[],
    parentsByFamilyId,
  };
}

/**
 * Build the Outstanding Accounts report for an authorized school.
 * Always uses authorizedSchoolId from auth — never trusts a foreign schoolId as authority.
 */
export async function buildOutstandingAccountsReport(input: {
  schoolId: string;
  asOfDate?: string;
  ledger?: BillingLedgerEntry[];
  statementAccounts?: BillingStatementAccountRow[];
  runDueDates?: Record<string, string>;
}): Promise<OutstandingAccountsReport> {
  const schoolId = String(input.schoolId || "").trim();
  if (!schoolId) {
    return {
      schoolId: "",
      asOfDate: "",
      summary: { totalOutstanding: 0, outstandingAccountCount: 0, learnersAffected: 0 },
      accounts: [],
    };
  }

  const asOfDate =
    String(input.asOfDate || "").trim().slice(0, 10) || new Date().toISOString().slice(0, 10);
  const ledger = input.ledger ?? readSchoolLedger(schoolId);
  const statementAccounts =
    input.statementAccounts ?? (await buildAccountsFromAgeAnalysisSnapshots(schoolId, { ledger }));
  const positive = filterPositiveBalanceAccounts(statementAccounts);

  const { learnersById, links, parentsByFamilyId } = await batchLoadLearnersAndContacts(
    schoolId,
    positive
  );

  const accounts = mapOutstandingRows({
    statementAccounts: positive,
    learnersById,
    links,
    parentsByFamilyId,
    ledger,
    asOfDate,
    runDueDates: input.runDueDates,
  });

  // Stable sort: highest outstanding first, then account number
  accounts.sort((a, b) => {
    if (b.outstandingBalance !== a.outstandingBalance) {
      return b.outstandingBalance - a.outstandingBalance;
    }
    return a.accountNumber.localeCompare(b.accountNumber);
  });

  return {
    schoolId,
    asOfDate,
    summary: buildOutstandingSummary(accounts),
    accounts,
  };
}
