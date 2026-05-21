import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  calculateBalanceFromEntries,
  collectFamilyAccountEntries,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import type {
  BuildStatementPdfOptions,
  StatementPdfContact,
  StatementPdfInput,
  StatementPdfTransaction,
} from "./statementPdfTypes";
import { generateStatementPdfBuffer, statementPdfFilename } from "./statementPdfService";

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

function resolveEntryLearnerLabel(
  entry: { learnerId: string; type: string },
  nameByLearnerId: Map<string, string>,
  accountRef: string
): string {
  const learnerId = String(entry.learnerId || "").trim();
  const ref = String(accountRef || "").trim();
  if (learnerId && nameByLearnerId.has(learnerId)) {
    return nameByLearnerId.get(learnerId) || "";
  }
  if (entry.type === "payment" && (!learnerId || (ref && learnerId === ref))) {
    return "Family account";
  }
  return "";
}

function filterLedgerByPeriod(entries: BillingLedgerEntry[], period: string): BillingLedgerEntry[] {
  const p = String(period || "All Time").trim();
  if (p === "All Time") return entries;

  const sorted = [...entries].sort(
    (a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
  );

  if (p === "Last 10 Transactions") {
    return sorted.slice(0, 10).reverse();
  }

  const now = new Date();
  let cutoff: Date | null = null;

  if (p === "This Year") {
    cutoff = new Date(now.getFullYear(), 0, 1);
  } else {
    const monthsMap: Record<string, number> = {
      "Last 3 Months": 3,
      "Last 6 Months": 6,
      "Last 9 Months": 9,
      "Last 12 Months": 12,
      "Last 18 Months": 18,
      "Last 24 Months": 24,
    };
    const months = monthsMap[p];
    if (months) {
      cutoff = new Date(now);
      cutoff.setMonth(cutoff.getMonth() - months);
    }
  }

  if (!cutoff) return entries;

  return entries.filter((entry) => {
    const entryDate = new Date(entry.date || entry.createdAt);
    return !Number.isNaN(entryDate.getTime()) && entryDate >= cutoff;
  });
}

function mapTransactions(
  entries: BillingLedgerEntry[],
  nameByLearnerId: Map<string, string>,
  accountRef: string
): StatementPdfTransaction[] {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.date || a.createdAt).getTime() - new Date(b.date || b.createdAt).getTime()
  );
  let running = 0;
  return sorted.map((entry) => {
    const amount = normaliseAmount(entry.amount);
    const isDebit = entry.type === "invoice" || entry.type === "penalty";
    running += isDebit ? amount : -amount;
    const typeLabel =
      entry.type === "invoice"
        ? "Invoice"
        : entry.type === "penalty"
          ? "Penalty"
          : entry.type === "credit"
            ? "Credit"
            : "Payment";
    return {
      date: entry.date || "—",
      type: typeLabel,
      reference: entry.reference || "",
      description: entry.description || "",
      amountIn: isDebit ? amount : 0,
      amountOut: !isDebit ? amount : 0,
      balance: running,
      learner: resolveEntryLearnerLabel(entry, nameByLearnerId, accountRef),
    };
  });
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

export async function resolveStatementBillingContact(
  schoolId: string,
  learnerIds: string[]
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
    select: { name: true, email: true, phone: true, address: true, logoUrl: true },
  });
  return {
    name: String(school?.name || "School").trim() || "School",
    email: String(school?.email || "").trim() || undefined,
    phone: String(school?.phone || "").trim() || undefined,
    address: String(school?.address || "").trim() || undefined,
    logoUrl: String(school?.logoUrl || "").trim() || undefined,
  };
}

export async function buildStatementPdfInput(
  options: BuildStatementPdfOptions
): Promise<StatementPdfInput> {
  const schoolId = String(options.schoolId || "").trim();
  const learnerId = String(options.learnerId || "").trim();
  const period = String(options.period || "All Time").trim() || "All Time";

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
  const filtered = filterLedgerByPeriod(scopedEntries, period);
  const balance = calculateBalanceFromEntries(filtered);

  const nameByLearnerId = new Map(
    scope.learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()])
  );

  const anchor = scope.learners.find((l) => l.id === learnerId) || scope.learners[0];
  const accountLabel = scope.isFamilyAccount
    ? `Family account ${scope.accountRef || "—"}`
    : `${anchor.firstName} ${anchor.lastName}`.trim();

  const contact = await resolveStatementBillingContact(schoolId, scope.learnerIds);
  const school = await loadSchoolBranding(schoolId);

  return {
    school,
    accountNo: scope.accountRef || "—",
    accountLabel,
    children: scope.learners.map((l) => ({
      name: `${l.firstName} ${l.lastName}`.trim(),
      grade: l.grade || "—",
    })),
    contact,
    period,
    statementDate: new Date().toLocaleDateString("en-ZA"),
    balance,
    transactions: mapTransactions(filtered, nameByLearnerId, scope.accountRef),
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
