import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
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

function resolveAccountScope(learners: LearnerRow[], anchorLearnerId: string) {
  const anchor = learners.find((l) => l.id === anchorLearnerId);
  if (!anchor) return null;

  const familyId = String(anchor.familyAccountId || anchor.familyAccount?.id || "").trim();
  const accountRef = resolveLearnerAccountNo(anchor);

  let group: LearnerRow[] = [anchor];
  if (familyId) {
    group = learners.filter((l) => String(l.familyAccountId || l.familyAccount?.id || "") === familyId);
  } else if (accountRef) {
    group = learners.filter((l) => resolveLearnerAccountNo(l) === accountRef);
  }

  return {
    accountRef,
    learners: group,
    learnerIds: group.map((l) => l.id),
    isFamilyAccount: group.length > 1 || Boolean(familyId),
  };
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

/** Parent/guardian for PDF display (does not require email). */
export async function resolveStatementContactForDisplay(
  schoolId: string,
  learnerIds: string[],
  accountNo: string
): Promise<StatementPdfContact | null> {
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

  const seenParentIds = new Set<string>();
  const candidates: {
    parent: (typeof parents)[0];
    link: (typeof parents)[0]["links"][0];
  }[] = [];

  for (const parent of parents) {
    for (const link of parent.links) {
      if (!ids.includes(link.learnerId)) continue;
      if (link.billingStatement === false) continue;
      const parentId = String(parent.id || "").trim();
      if (parentId && seenParentIds.has(parentId)) continue;
      if (parentId) seenParentIds.add(parentId);
      candidates.push({ parent, link });
    }
  }

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
  const period = normalizeStatementPeriod(options.period || DEFAULT_STATEMENT_PERIOD);

  if (!schoolId || !learnerId) {
    throw new Error("Missing schoolId or learnerId for statement PDF");
  }

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      grade: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true, familyName: true } },
    },
    orderBy: { lastName: "asc" },
  });

  const scope = resolveAccountScope(learners as LearnerRow[], learnerId);
  if (!scope) throw new Error("Learner not found for statement PDF");

  const ledger = readSchoolLedger(schoolId);
  const scopedEntries = collectFamilyAccountEntries(ledger, {
    accountRef: scope.accountRef,
    learnerIds: scope.learnerIds,
  });
  const filtered = filterLedgerByStatementPeriod(scopedEntries, period);
  const balance = calculateBalanceFromEntries(filtered);

  const nameByLearnerId = new Map(
    scope.learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()])
  );

  const anchor = scope.learners.find((l) => l.id === learnerId) || scope.learners[0];
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
