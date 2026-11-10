/**
 * Request-scoped bulk statement context — load school data once, reuse for every family.
 * Financial helpers remain the existing statementPeriod / transaction builders.
 */
import { prisma } from "../prisma";
import { matchLearnersToAccountHolder } from "./familyAccountMembers";
import { normaliseEduClearAccountNo } from "./familyAccountNumber";
import { readSchoolFamilyAccountAgeAnalysisSnapshots } from "../utils/familyAccountAgeAnalysisStore";
import {
  collectAccountRefLedgerEntries,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { readSchoolKidesysHistory, type KidesysHistoryEntry } from "../utils/kidesysTransactionHistoryStore";
import { loadSchoolLogoBuffer } from "../utils/schoolLogo";
import { buildStatementTransactions } from "./statementTransactionBuilder";
import {
  computeStatementClosingBalance,
  computeStatementOpeningBalance,
  filterLedgerByStatementPeriod,
  formatStatementPeriodHeaderLabel,
  normalizeStatementPeriod,
  type StatementPeriodOption,
} from "../utils/statementPeriod";
import type {
  StatementPdfContact,
  StatementPdfInput,
  StatementPdfSchoolBranding,
} from "./statementPdfTypes";

async function loadSchoolBranding(schoolId: string): Promise<StatementPdfSchoolBranding> {
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      name: true,
      email: true,
      phone: true,
      cellNo: true,
      address: true,
      postalAddress: true,
      logoUrl: true,
    },
  });
  return {
    name: String(school?.name || "School").trim() || "School",
    email: String(school?.email || "").trim() || undefined,
    phone: String(school?.phone || "").trim() || undefined,
    cellNo: String(school?.cellNo || "").trim() || undefined,
    address: String(school?.address || "").trim() || undefined,
    postalAddress: String(school?.postalAddress || "").trim() || undefined,
    logoUrl: String(school?.logoUrl || "").trim() || undefined,
  };
}

type LearnerRow = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  familyAccountId: string | null;
  familyAccount: { id: string; accountRef: string; familyName: string | null; accountNo: string | null } | null;
};

type FamilyRow = {
  id: string;
  accountRef: string;
  accountNo: string | null;
  familyName: string | null;
};

type ParentLinkRow = {
  learnerId: string;
  isPrimary: boolean;
  isPayingPerson: boolean;
  billingStatement: boolean;
  relation: string | null;
  parent: {
    id: string;
    firstName: string | null;
    surname: string | null;
    email: string | null;
    cellNo: string | null;
  };
};

export type BulkStatementSchoolContext = {
  schoolId: string;
  branding: StatementPdfSchoolBranding;
  logoBuffer: Buffer | null;
  ledger: BillingLedgerEntry[];
  kidesysHistory: KidesysHistoryEntry[];
  familiesById: Map<string, FamilyRow>;
  familyByAccountRef: Map<string, FamilyRow>;
  familyByAccountNo: Map<string, FamilyRow>;
  learners: LearnerRow[];
  learnersByFamilyId: Map<string, LearnerRow[]>;
  parentLinks: ParentLinkRow[];
  ageAnalysisSnapshots: ReturnType<typeof readSchoolFamilyAccountAgeAnalysisSnapshots>;
};

function parentDisplayName(parent: { firstName?: string | null; surname?: string | null }): string {
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "Parent / Guardian";
}

function displayContactScore(link: { isPrimary?: boolean; isPayingPerson?: boolean }) {
  let score = 0;
  if (link.isPrimary) score += 10;
  if (link.isPayingPerson) score += 6;
  return score;
}

function normalizeKidRef(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function mergeUniqueLearners(rows: LearnerRow[]): LearnerRow[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export async function loadBulkStatementSchoolContext(
  schoolId: string,
  opts: {
    ledger: BillingLedgerEntry[];
    branding?: StatementPdfSchoolBranding;
    logoBuffer?: Buffer | null;
    kidesysHistory?: KidesysHistoryEntry[];
  }
): Promise<BulkStatementSchoolContext> {
  const sid = String(schoolId || "").trim();
  if (!sid) throw new Error("Missing schoolId for bulk statement context");

  const branding = opts.branding ?? (await loadSchoolBranding(sid));
  const logoBuffer =
    opts.logoBuffer !== undefined ? opts.logoBuffer : await loadSchoolLogoBuffer(branding.logoUrl);
  const kidesysHistory = opts.kidesysHistory ?? readSchoolKidesysHistory(sid);

  const [families, learners, parentLinks] = await Promise.all([
    prisma.familyAccount.findMany({
      where: { schoolId: sid },
      select: { id: true, accountRef: true, accountNo: true, familyName: true },
    }),
    prisma.learner.findMany({
      where: { schoolId: sid },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        grade: true,
        familyAccountId: true,
        familyAccount: {
          select: { id: true, accountRef: true, familyName: true, accountNo: true },
        },
      },
      orderBy: { lastName: "asc" },
    }),
    prisma.parentLearnerLink.findMany({
      where: { schoolId: sid },
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
            email: true,
            cellNo: true,
          },
        },
      },
    }),
  ]);

  const familiesById = new Map<string, FamilyRow>();
  const familyByAccountRef = new Map<string, FamilyRow>();
  const familyByAccountNo = new Map<string, FamilyRow>();
  for (const family of families as FamilyRow[]) {
    familiesById.set(family.id, family);
    const ref = normalizeKidRef(family.accountRef);
    if (ref) familyByAccountRef.set(ref, family);
    const no = normaliseEduClearAccountNo(family.accountNo || "") || normalizeKidRef(family.accountNo);
    if (no) familyByAccountNo.set(no, family);
  }

  const learnerRows = learners as LearnerRow[];
  const learnersByFamilyId = new Map<string, LearnerRow[]>();
  for (const learner of learnerRows) {
    const fid = String(learner.familyAccountId || learner.familyAccount?.id || "").trim();
    if (!fid) continue;
    const bucket = learnersByFamilyId.get(fid) || [];
    bucket.push(learner);
    learnersByFamilyId.set(fid, bucket);
  }

  return {
    schoolId: sid,
    branding,
    logoBuffer,
    ledger: opts.ledger,
    kidesysHistory,
    familiesById,
    familyByAccountRef,
    familyByAccountNo,
    learners: learnerRows,
    learnersByFamilyId,
    parentLinks: parentLinks as ParentLinkRow[],
    ageAnalysisSnapshots: readSchoolFamilyAccountAgeAnalysisSnapshots(sid),
  };
}

function resolveFamilyFromContext(
  ctx: BulkStatementSchoolContext,
  accountNo?: string,
  learnerId?: string
): FamilyRow | null {
  const rawAccountNo = String(accountNo || "").trim();
  const lid = String(learnerId || "").trim();

  if (rawAccountNo) {
    const kid = normaliseEduClearAccountNo(rawAccountNo) || normalizeKidRef(rawAccountNo);
    const byNo = kid ? ctx.familyByAccountNo.get(kid) : undefined;
    if (byNo) return byNo;
    const byRef = ctx.familyByAccountRef.get(normalizeKidRef(rawAccountNo));
    if (byRef) return byRef;
  }

  if (lid) {
    const learner = ctx.learners.find((row) => row.id === lid);
    const fid = String(learner?.familyAccountId || learner?.familyAccount?.id || "").trim();
    if (fid) return ctx.familiesById.get(fid) || null;
  }

  return null;
}

function resolveLearnersForAccount(ctx: BulkStatementSchoolContext, accountRef: string): LearnerRow[] {
  const joinKey = String(accountRef || "").trim();
  if (!joinKey || joinKey === "-") return [];

  const family =
    ctx.familyByAccountRef.get(normalizeKidRef(joinKey)) ||
    ctx.familyByAccountNo.get(normaliseEduClearAccountNo(joinKey) || normalizeKidRef(joinKey)) ||
    null;

  let group: LearnerRow[] = [];
  if (family) {
    group = mergeUniqueLearners(ctx.learnersByFamilyId.get(family.id) || []);
  } else {
    group = mergeUniqueLearners(
      ctx.learners.filter((l) => normalizeKidRef(l.familyAccount?.accountRef) === normalizeKidRef(joinKey))
    );
  }

  const snapKey = String(family?.accountRef || joinKey).trim();
  const snapshots = ctx.ageAnalysisSnapshots;
  const accountHolder = String(
    snapshots[snapKey]?.accountHolder || snapshots[snapKey.toUpperCase()]?.accountHolder || ""
  ).trim();
  if (accountHolder) {
    const matched = matchLearnersToAccountHolder(ctx.learners, accountHolder, {
      familyAccountId: family?.id,
    }) as LearnerRow[];
    group = mergeUniqueLearners([...group, ...matched]);
  }

  if (!group.length && family) {
    group = mergeUniqueLearners(ctx.learnersByFamilyId.get(family.id) || []);
  }
  return group;
}

function resolveContactFromContext(
  ctx: BulkStatementSchoolContext,
  learnerIds: string[],
  accountNo: string
): StatementPdfContact | null {
  const ids = new Set(learnerIds.filter(Boolean));
  if (!ids.size) return null;

  const candidates = ctx.parentLinks.filter((row) => ids.has(row.learnerId));
  if (!candidates.length) return null;

  const withBilling = candidates.filter((row) => row.billingStatement !== false);
  const pool = withBilling.length ? withBilling : candidates;

  const seenParentIds = new Set<string>();
  const unique: ParentLinkRow[] = [];
  for (const row of pool) {
    const parentId = String(row.parent.id || "").trim();
    if (parentId && seenParentIds.has(parentId)) continue;
    if (parentId) seenParentIds.add(parentId);
    unique.push(row);
  }

  unique.sort((a, b) => displayContactScore(b) - displayContactScore(a));
  const names = [...new Set(unique.map((c) => parentDisplayName(c.parent)).filter(Boolean))];
  const best = unique[0];
  return {
    name: names.join(" · ") || parentDisplayName(best.parent),
    email: String(best.parent.email || "").trim() || undefined,
    cellphone: String(best.parent.cellNo || "").trim() || undefined,
    relationship: String(best.relation || "Parent"),
    accountNo: accountNo || "—",
  };
}

/**
 * Build one statement PDF input using bulk-loaded school data.
 * Uses the same opening/closing/transaction helpers as individual statements.
 */
export function buildStatementPdfInputFromBulkContext(
  ctx: BulkStatementSchoolContext,
  opts: {
    accountNo?: string;
    learnerId?: string;
    period: StatementPeriodOption | string;
    statementNote?: string;
  }
): StatementPdfInput {
  const period = normalizeStatementPeriod(opts.period);
  const family = resolveFamilyFromContext(ctx, opts.accountNo, opts.learnerId);
  const accountRef =
    String(family?.accountRef || opts.accountNo || "").trim() ||
    String(opts.accountNo || "").trim();
  if (!accountRef) throw new Error("Account not found for statement PDF");

  const learners = resolveLearnersForAccount(ctx, accountRef);
  const familyId = String(family?.id || learners[0]?.familyAccountId || "").trim();
  const isFamilyAccount = learners.length !== 1 || Boolean(familyId);
  const learnerIds = learners.map((l) => l.id);

  const scopedEntries = collectAccountRefLedgerEntries(ctx.ledger, accountRef);
  const filtered = filterLedgerByStatementPeriod(scopedEntries, period);
  const openingBalance = computeStatementOpeningBalance(scopedEntries, period);
  // Invoice-run bulk always uses period-ledger closing balances.
  const balance = computeStatementClosingBalance(scopedEntries, period);

  const nameByLearnerId = new Map(
    learners.map((l) => [l.id, `${l.firstName} ${l.lastName}`.trim()])
  );
  const anchor = learners[0];
  const accountLabel =
    !anchor || isFamilyAccount
      ? `Family Account ${accountRef || "—"}`
      : `${anchor.firstName} ${anchor.lastName}`.trim();

  const contact = resolveContactFromContext(ctx, learnerIds, accountRef || "—");
  const transactions = buildStatementTransactions({
    schoolId: ctx.schoolId,
    accountRef,
    ledgerEntries: filtered,
    period,
    openingBalance,
    nameByLearnerId,
    kidesysHistory: ctx.kidesysHistory,
  });

  return {
    school: ctx.branding,
    accountNo: accountRef || "—",
    accountLabel,
    children: learners.map((l) => ({
      name: `${l.firstName} ${l.lastName}`.trim(),
      grade: l.grade || "—",
    })),
    contact,
    period: formatStatementPeriodHeaderLabel(period),
    statementDate: new Date().toLocaleDateString("en-ZA"),
    balance,
    transactions,
    statementNote: opts.statementNote,
    isFamilyAccount,
  };
}
