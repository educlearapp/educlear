import { prisma } from "../prisma";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import { resolveBillingAccountRef } from "./resolveBillingAccountRef";
import {
  calculateBalanceFromEntries,
  collectFamilyAccountEntries,
  normaliseAmount,
  readSchoolLedger,
} from "../utils/billingLedgerStore";
import type {
  BuildStatementPdfOptions,
  StatementPdfContact,
  StatementPdfInput,
} from "./statementPdfTypes";
import { generateStatementPdfBuffer, statementPdfFilename } from "./statementPdfService";
import { buildStatementTransactions } from "./statementTransactionBuilder";
import {
  DEFAULT_STATEMENT_PERIOD,
  filterLedgerByStatementPeriod,
  formatStatementPeriodHeaderLabel,
  normalizeStatementPeriod,
} from "../utils/statementPeriod";

type LearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  familyAccountId: string | null;
  familyAccount: { id: string; accountRef: string; familyName: string | null } | null;
};

function formatMoney(value: number): string {
  return `R ${normaliseAmount(value).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parentDisplayName(parent: {
  firstName?: string | null;
  surname?: string | null;
}): string {
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "Parent / Guardian";
}

const KIDEESYS_ACCOUNT_REF_RE = /^[A-Z]{2,5}\d{2,5}$/;

function normalizeKidESysAccountRef(value: unknown): string {
  const ref = String(value ?? "").trim().toUpperCase();
  if (!ref || ref === "-" || ref.startsWith("KID-MISSING-")) return "";
  if (!KIDEESYS_ACCOUNT_REF_RE.test(ref)) return "";
  return ref;
}

function isSasamsNumericAccount(value: unknown): boolean {
  const v = String(value ?? "").trim();
  if (!v || normalizeKidESysAccountRef(v)) return false;
  return /^\d{4,}$/.test(v);
}

function buildAccountScopeFromLearners(learners: LearnerRow[], accountRef: string) {
  const ref = normalizeKidESysAccountRef(accountRef);
  if (!ref) return null;
  const group = learners.filter(
    (l) => normalizeKidESysAccountRef(l.familyAccount?.accountRef) === ref
  );
  if (!group.length) return null;
  const familyId = String(group[0]?.familyAccountId || group[0]?.familyAccount?.id || "").trim();
  return {
    accountRef: ref,
    learners: group,
    learnerIds: group.map((l) => l.id),
    isFamilyAccount: group.length > 1 || Boolean(familyId),
  };
}

const learnerSelectForStatement = {
  id: true,
  firstName: true,
  lastName: true,
  grade: true,
  familyAccountId: true,
  familyAccount: { select: { id: true, accountRef: true, familyName: true } },
} as const;

async function loadLearnersForAccountRef(schoolId: string, accountRef: string): Promise<LearnerRow[]> {
  const ref = normalizeKidESysAccountRef(accountRef);
  if (!ref) return [];
  const rows = await prisma.learner.findMany({
    where: { schoolId, familyAccount: { accountRef: ref } },
    select: learnerSelectForStatement,
    orderBy: { lastName: "asc" },
  });
  if (rows.length) return rows as LearnerRow[];
  const family = await prisma.familyAccount.findFirst({
    where: { schoolId, accountRef: ref },
    select: { id: true },
  });
  if (!family) return [];
  const byFamilyId = await prisma.learner.findMany({
    where: { schoolId, familyAccountId: family.id },
    select: learnerSelectForStatement,
    orderBy: { lastName: "asc" },
  });
  return byFamilyId as LearnerRow[];
}

/** Resolve Kid-e-Sys billing identity (FamilyAccount.accountRef) — never admissionNo / idNumber. */
async function resolveStatementAccountRef(
  schoolId: string,
  opts: { accountNo?: string; learnerId?: string }
): Promise<string | null> {
  const rawAccountNo = String(opts.accountNo || "").trim();
  const learnerId = String(opts.learnerId || "").trim();

  if (rawAccountNo && !isSasamsNumericAccount(rawAccountNo)) {
    const fromKidESysRef = normalizeKidESysAccountRef(rawAccountNo);
    if (fromKidESysRef) return fromKidESysRef;
    const resolved = await resolveBillingAccountRef(schoolId, rawAccountNo);
    if (resolved?.accountRef) return normalizeKidESysAccountRef(resolved.accountRef) || null;
  }

  if (learnerId) {
    const learner = await prisma.learner.findFirst({
      where: { id: learnerId, schoolId },
      select: {
        familyAccount: { select: { accountRef: true } },
      },
    });
    const fromLearner = normalizeKidESysAccountRef(learner?.familyAccount?.accountRef);
    if (fromLearner) return fromLearner;
  }

  if (rawAccountNo && !isSasamsNumericAccount(rawAccountNo)) {
    const resolved = await resolveBillingAccountRef(schoolId, rawAccountNo);
    if (resolved?.accountRef) return normalizeKidESysAccountRef(resolved.accountRef) || null;
  }

  return null;
}

function isStatementBillingContact(
  parent: {
    email?: string | null;
    communicationBilling?: boolean | null;
    communicationByEmail?: boolean | null;
  },
  link: {
    billingStatement?: boolean | null;
  }
): boolean {
  if (link.billingStatement === false) return false;
  if (parent.communicationBilling === false) return false;
  if (parent.communicationByEmail === false) return false;
  return Boolean(String(parent.email || "").trim());
}

function contactScore(link: { isPrimary?: boolean; isPayingPerson?: boolean }, parent: { communicationBilling?: boolean | null }) {
  let score = 0;
  if (link.isPrimary) score += 10;
  if (link.isPayingPerson) score += 6;
  if (parent.communicationBilling !== false) score += 2;
  return score;
}

function displayContactScore(link: { isPrimary?: boolean; isPayingPerson?: boolean }) {
  let score = 0;
  if (link.isPrimary) score += 10;
  if (link.isPayingPerson) score += 6;
  return score;
}

type StatementContactCandidate = {
  parent: {
    id: string;
    firstName: string | null;
    surname: string | null;
    email: string | null;
    cellNo: string | null;
  };
  link: {
    learnerId: string;
    isPrimary: boolean;
    isPayingPerson: boolean;
    billingStatement: boolean;
    relation: string | null;
  };
};

function collectStatementContactCandidates(
  links: Array<{
    learnerId: string;
    isPrimary: boolean;
    isPayingPerson: boolean;
    billingStatement: boolean;
    relation: string | null;
    parent: StatementContactCandidate["parent"];
  }>,
  learnerIds: string[],
  requireBillingStatement: boolean
): StatementContactCandidate[] {
  const ids = new Set(learnerIds);
  const seenParentIds = new Set<string>();
  const candidates: StatementContactCandidate[] = [];

  for (const row of links) {
    if (!ids.has(row.learnerId)) continue;
    if (requireBillingStatement && row.billingStatement === false) continue;
    const parentId = String(row.parent.id || "").trim();
    if (parentId && seenParentIds.has(parentId)) continue;
    if (parentId) seenParentIds.add(parentId);
    candidates.push({ parent: row.parent, link: row });
  }

  return candidates;
}

function buildStatementContactFromCandidates(
  candidates: StatementContactCandidate[],
  accountNo: string
): StatementPdfContact | null {
  if (!candidates.length) return null;

  candidates.sort((a, b) => displayContactScore(b.link) - displayContactScore(a.link));

  const names = candidates.map((c) => parentDisplayName(c.parent));
  const uniqueNames = [...new Set(names.filter(Boolean))];
  const best = candidates[0];
  const email = String(best.parent.email || "").trim() || undefined;
  const cellphone = String(best.parent.cellNo || "").trim() || undefined;

  return {
    name: uniqueNames.join(" · ") || parentDisplayName(best.parent),
    email,
    cellphone,
    relationship: String(best.link.relation || "Parent"),
    accountNo: accountNo || "—",
  };
}

/** Parent/guardian for PDF display (does not require email). */
export async function resolveStatementContactForDisplay(
  schoolId: string,
  learnerIds: string[],
  accountNo: string
): Promise<StatementPdfContact | null> {
  const ids = learnerIds.filter(Boolean);
  if (!ids.length) return null;

  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId, learnerId: { in: ids } },
    include: {
      parent: {
        select: {
          id: true,
          firstName: true,
          surname: true,
          email: true,
          cellNo: true,
        },
      },
    },
  });

  const withBilling = collectStatementContactCandidates(links, ids, true);
  const contact =
    buildStatementContactFromCandidates(withBilling, accountNo) ||
    buildStatementContactFromCandidates(collectStatementContactCandidates(links, ids, false), accountNo);

  return contact;
}

export async function resolveStatementBillingContact(
  schoolId: string,
  learnerIds: string[]
): Promise<Pick<StatementPdfContact, "name" | "email" | "relationship"> | null> {
  const ids = learnerIds.filter(Boolean);
  if (!ids.length) return null;

  const parents = await prisma.parent.findMany({
    where: { schoolId },
    include: {
      links: {
        where: { learnerId: { in: ids } },
        select: {
          learnerId: true,
          isPrimary: true,
          isPayingPerson: true,
          billingStatement: true,
          relation: true,
        },
      },
    },
  });

  const candidates: {
    parent: (typeof parents)[0];
    link: (typeof parents)[0]["links"][0];
  }[] = [];

  for (const parent of parents) {
    for (const link of parent.links) {
      if (!ids.includes(link.learnerId)) continue;
      if (!isStatementBillingContact(parent, link)) continue;
      candidates.push({ parent, link });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const scoreA = contactScore(a.link, a.parent);
    const scoreB = contactScore(b.link, b.parent);
    return scoreB - scoreA;
  });

  const best = candidates[0];
  return {
    name: parentDisplayName(best.parent),
    email: String(best.parent.email || "").trim(),
    relationship: String(best.link.relation || "Parent"),
  };
}

async function loadSchoolBranding(schoolId: string) {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { name: true, email: true, phone: true, cellNo: true, address: true, logoUrl: true },
  });
  return {
    name: String(school?.name || "School").trim() || "School",
    email: String(school?.email || "").trim() || undefined,
    phone: String(school?.phone || "").trim() || undefined,
    cellNo: String(school?.cellNo || "").trim() || undefined,
    address: String(school?.address || "").trim() || undefined,
    logoUrl: String(school?.logoUrl || "").trim() || undefined,
  };
}

export async function buildStatementPdfInput(
  options: BuildStatementPdfOptions
): Promise<StatementPdfInput> {
  const schoolId = String(options.schoolId || "").trim();
  const learnerId = String(options.learnerId || "").trim();
  const accountNo = String((options as any)?.accountNo || "").trim();
  const period = normalizeStatementPeriod(options.period || DEFAULT_STATEMENT_PERIOD);

  if (!schoolId || (!accountNo && !learnerId)) {
    throw new Error("Missing schoolId and accountNo or learnerId for statement PDF");
  }

  const accountRef = await resolveStatementAccountRef(schoolId, { accountNo, learnerId });
  if (!accountRef) throw new Error("Account not found for statement PDF");

  const learners = await loadLearnersForAccountRef(schoolId, accountRef);
  const scope = buildAccountScopeFromLearners(learners, accountRef);
  if (!scope) throw new Error("Account not found for statement PDF");

  const ledger = readSchoolLedger(schoolId);
  const scopedEntries = collectFamilyAccountEntries(ledger, {
    accountRef: scope.accountRef,
    learnerIds: scope.learnerIds,
  });
  const filtered = filterLedgerByStatementPeriod(scopedEntries, period);
  // Balance source of truth: Age Analysis (Kid-e-Sys accountRef) snapshot.
  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const snapshot = accounts.find((row: any) => String(row?.accountNo || "").trim() === scope.accountRef);
  const balance = snapshot ? normaliseAmount((snapshot as any).balance) : calculateBalanceFromEntries(filtered);

  const nameByLearnerId = new Map(
    scope.learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()])
  );

  const anchor = scope.learners[0];
  const accountLabel = scope.isFamilyAccount
    ? `Family account ${scope.accountRef || "—"}`
    : `${anchor.firstName} ${anchor.lastName}`.trim();

  const contact = await resolveStatementContactForDisplay(
    schoolId,
    scope.learnerIds,
    scope.accountRef || "—"
  );
  const school = await loadSchoolBranding(schoolId);

  const transactions = buildStatementTransactions({
    schoolId,
    accountRef: scope.accountRef,
    ledgerEntries: filtered,
    period,
    nameByLearnerId,
  });

  return {
    school,
    accountNo: scope.accountRef || "—",
    accountLabel,
    children: scope.learners.map((l) => ({
      name: `${l.firstName} ${l.lastName}`.trim(),
      grade: l.grade || "—",
    })),
    contact,
    period: formatStatementPeriodHeaderLabel(period),
    statementDate: new Date().toLocaleDateString("en-ZA"),
    balance,
    transactions,
    statementNote: options.statementNote,
    isFamilyAccount: scope.isFamilyAccount,
  };
}

export async function buildAndGenerateStatementPdf(options: BuildStatementPdfOptions): Promise<{
  buffer: Buffer;
  filename: string;
  input: StatementPdfInput;
}> {
  const input = await buildStatementPdfInput(options);
  const buffer = await generateStatementPdfBuffer(input);
  return {
    buffer,
    filename: statementPdfFilename(input.accountNo),
    input,
  };
}

/** @deprecated unused export kept for tests — formatMoney exposed for parity */
export { formatMoney };
