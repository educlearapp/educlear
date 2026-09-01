import { prisma } from "../prisma";

export const FAMILY_ACCOUNT_MERGED_ERROR_CODE = "FAMILY_ACCOUNT_MERGED";

export type FamilyAccountLifecycleFields = {
  id?: string;
  schoolId?: string;
  accountRef?: string;
  retiredAt?: Date | string | null;
  mergedIntoFamilyAccountId?: string | null;
};

export function isFamilyAccountRetired(
  account: FamilyAccountLifecycleFields | null | undefined
): boolean {
  if (!account) return false;
  if (account.retiredAt) return true;
  return Boolean(String(account.mergedIntoFamilyAccountId || "").trim());
}

export function isFamilyAccountActive(
  account: FamilyAccountLifecycleFields | null | undefined
): boolean {
  if (!account) return true;
  return !isFamilyAccountRetired(account);
}

export class FamilyAccountMergedError extends Error {
  readonly errorCode = FAMILY_ACCOUNT_MERGED_ERROR_CODE;
  readonly schoolId: string;
  readonly accountRef: string;
  readonly familyAccountId: string | null;
  readonly survivingAccountRef: string | null;
  readonly survivingFamilyAccountId: string | null;

  constructor(opts: {
    schoolId: string;
    accountRef: string;
    familyAccountId?: string | null;
    survivingAccountRef?: string | null;
    survivingFamilyAccountId?: string | null;
  }) {
    const survivor = String(opts.survivingAccountRef || "").trim();
    const message = survivor
      ? `Family account ${opts.accountRef} was merged into ${survivor} and cannot receive new billing writes`
      : `Family account ${opts.accountRef} was merged and cannot receive new billing writes`;
    super(message);
    this.name = "FamilyAccountMergedError";
    this.schoolId = opts.schoolId;
    this.accountRef = opts.accountRef;
    this.familyAccountId = opts.familyAccountId || null;
    this.survivingAccountRef = survivor || null;
    this.survivingFamilyAccountId = opts.survivingFamilyAccountId || null;
  }
}

export function familyAccountMergedHttpStatus(): number {
  return 409;
}

export function familyAccountMergedPayload(error: FamilyAccountMergedError) {
  return {
    success: false as const,
    error: error.message,
    errorCode: error.errorCode,
    accountRef: error.accountRef,
    survivingAccountRef: error.survivingAccountRef,
    survivingFamilyAccountId: error.survivingFamilyAccountId,
  };
}

const lifecycleSelect = {
  id: true,
  schoolId: true,
  accountRef: true,
  familyName: true,
  retiredAt: true,
  mergedIntoFamilyAccountId: true,
  mergedInto: { select: { id: true, accountRef: true, schoolId: true } },
} as const;

export async function loadFamilyAccountLifecycleByRef(
  schoolId: string,
  accountRef: string
) {
  const sid = String(schoolId || "").trim();
  const ref = String(accountRef || "").trim().toUpperCase();
  if (!sid || !ref) return null;
  return prisma.familyAccount.findFirst({
    where: { schoolId: sid, accountRef: ref },
    select: lifecycleSelect,
  });
}

export async function loadFamilyAccountLifecycleById(
  schoolId: string,
  familyAccountId: string
) {
  const sid = String(schoolId || "").trim();
  const id = String(familyAccountId || "").trim();
  if (!sid || !id) return null;
  return prisma.familyAccount.findFirst({
    where: { id, schoolId: sid },
    select: lifecycleSelect,
  });
}

export async function loadRetiredAccountRefsForSchool(
  schoolId: string,
  accountRefs?: string[]
): Promise<Set<string>> {
  const sid = String(schoolId || "").trim();
  const retired = new Set<string>();
  if (!sid) return retired;

  const refs = (accountRefs || [])
    .map((r) => String(r || "").trim().toUpperCase())
    .filter(Boolean);

  const rows = await prisma.familyAccount.findMany({
    where: {
      schoolId: sid,
      OR: [{ retiredAt: { not: null } }, { mergedIntoFamilyAccountId: { not: null } }],
      ...(refs.length ? { accountRef: { in: refs } } : {}),
    },
    select: { accountRef: true, retiredAt: true, mergedIntoFamilyAccountId: true },
  });

  for (const row of rows) {
    if (!isFamilyAccountRetired(row)) continue;
    const ref = String(row.accountRef || "").trim().toUpperCase();
    if (ref) retired.add(ref);
  }
  return retired;
}

/**
 * Reject NEW financial writes to a retired/merged FamilyAccount.
 * Accounts with no FamilyAccount row (unmatched snapshots / ledger-only refs) are not blocked.
 */
export async function assertFamilyAccountAcceptsNewBillingWrites(opts: {
  schoolId: string;
  accountRef?: string;
  familyAccountId?: string;
}): Promise<void> {
  const schoolId = String(opts.schoolId || "").trim();
  const accountRef = String(opts.accountRef || "").trim().toUpperCase();
  const familyAccountId = String(opts.familyAccountId || "").trim();
  if (!schoolId) return;

  const account = familyAccountId
    ? await loadFamilyAccountLifecycleById(schoolId, familyAccountId)
    : accountRef
      ? await loadFamilyAccountLifecycleByRef(schoolId, accountRef)
      : null;

  if (!account || !isFamilyAccountRetired(account)) return;

  const survivingSameSchool =
    account.mergedInto && account.mergedInto.schoolId === schoolId
      ? account.mergedInto
      : null;

  throw new FamilyAccountMergedError({
    schoolId,
    accountRef: String(account.accountRef || accountRef || "").trim() || "(unknown)",
    familyAccountId: account.id,
    survivingAccountRef: survivingSameSchool?.accountRef || null,
    survivingFamilyAccountId: survivingSameSchool?.id || null,
  });
}

export type FamilyAccountListRow = {
  id: string;
  schoolId: string;
  accountRef: string;
  familyName: string;
  lifecycleStatus: "active" | "retired";
  retiredAt: string | null;
  mergedIntoFamilyAccountId: string | null;
  mergedIntoAccountRef: string | null;
};

function mapFamilyAccountListRow(row: {
  id: string;
  schoolId: string;
  accountRef: string;
  familyName: string;
  retiredAt: Date | null;
  mergedIntoFamilyAccountId: string | null;
  mergedInto: { accountRef: string; schoolId: string } | null;
}): FamilyAccountListRow {
  const retired = isFamilyAccountRetired(row);
  const survivingSameSchool =
    row.mergedInto && row.mergedInto.schoolId === row.schoolId ? row.mergedInto : null;
  return {
    id: row.id,
    schoolId: row.schoolId,
    accountRef: row.accountRef,
    familyName: row.familyName,
    lifecycleStatus: retired ? "retired" : "active",
    retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
    mergedIntoFamilyAccountId: row.mergedIntoFamilyAccountId,
    mergedIntoAccountRef: survivingSameSchool?.accountRef || null,
  };
}

const listSelect = {
  id: true,
  schoolId: true,
  accountRef: true,
  familyName: true,
  retiredAt: true,
  mergedIntoFamilyAccountId: true,
  mergedInto: { select: { accountRef: true, schoolId: true } },
} as const;

/** Active billing choices: retired predecessors are omitted. Zero-learner accounts remain if not merged. */
export async function listActiveFamilyAccountsForSchool(schoolId: string) {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];
  const rows = await prisma.familyAccount.findMany({
    where: { schoolId: sid, retiredAt: null, mergedIntoFamilyAccountId: null },
    select: listSelect,
    orderBy: { accountRef: "asc" },
  });
  return rows.map(mapFamilyAccountListRow);
}

/** Audit/history listing. Not for payment/invoice account pickers. */
export async function listRetiredFamilyAccountsForSchool(schoolId: string) {
  const sid = String(schoolId || "").trim();
  if (!sid) return [];
  const rows = await prisma.familyAccount.findMany({
    where: {
      schoolId: sid,
      OR: [{ retiredAt: { not: null } }, { mergedIntoFamilyAccountId: { not: null } }],
    },
    select: listSelect,
    orderBy: { accountRef: "asc" },
  });
  return rows.filter(isFamilyAccountRetired).map(mapFamilyAccountListRow);
}
