import { prisma } from "../prisma";
import { activeLearnerWhere } from "../utils/learnerEnrollment";
import {
  insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent,
  invalidateFamilyAccountAgeAnalysisFileCache,
  readSchoolFamilyAccountAgeAnalysisSnapshots,
  type FamilyAccountAgeAnalysisSnapshot,
} from "../utils/familyAccountAgeAnalysisStore";
import { invalidateOfficialBillingAccountRefsCache } from "./officialBillingAccountRef";

export type EnsureFinanceAccountBaselineInput = {
  schoolId: string;
  accountRef: string;
  accountHolder: string;
  createdAt?: Date | string;
};

export type EnsureFinanceAccountBaselineResult =
  | { status: "already_exists"; accountRef: string }
  | { status: "inserted"; accountRef: string; snapshot: FamilyAccountAgeAnalysisSnapshot }
  | { status: "error"; accountRef: string; error: string };

export class FinanceAccountBaselineError extends Error {
  readonly code = "FINANCE_BASELINE_FAILED" as const;
  readonly schoolId: string;
  readonly accountRef: string;
  readonly learnerId?: string;
  readonly familyAccountId?: string;

  constructor(
    message: string,
    ctx: { schoolId: string; accountRef: string; learnerId?: string; familyAccountId?: string }
  ) {
    super(message);
    this.name = "FinanceAccountBaselineError";
    this.schoolId = ctx.schoolId;
    this.accountRef = ctx.accountRef;
    this.learnerId = ctx.learnerId;
    this.familyAccountId = ctx.familyAccountId;
  }
}

const ZERO_BUCKETS = {
  current: 0,
  d30: 0,
  d60: 0,
  d90: 0,
  d120: 0,
} as const;

function normaliseAccountRef(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normaliseAccountHolder(value: unknown, fallbackRef: string): string {
  const holder = String(value ?? "").trim();
  return holder || fallbackRef;
}

function resolveImportedAt(createdAt?: Date | string): string {
  if (createdAt instanceof Date && !Number.isNaN(createdAt.getTime())) {
    return createdAt.toISOString();
  }
  const raw = String(createdAt ?? "").trim();
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function buildNativeZeroBaseline(
  input: EnsureFinanceAccountBaselineInput
): FamilyAccountAgeAnalysisSnapshot {
  const schoolId = String(input.schoolId || "").trim();
  const accountRef = normaliseAccountRef(input.accountRef);
  const accountHolder = normaliseAccountHolder(input.accountHolder, accountRef);

  return {
    schoolId,
    accountRef,
    accountHolder,
    balance: 0,
    buckets: { ...ZERO_BUCKETS },
    kidesysSection: "Paid Up",
    source: "educlear-registration",
    importedAt: resolveImportedAt(input.createdAt),
  };
}

/**
 * Ensures a native FamilyAccount is registered in the finance age-analysis index.
 *
 * Idempotent: never overwrites an existing snapshot (imported or native).
 * Recovery: if registration fails after Postgres writes, caller must roll back
 * the learner/family shell or re-run this function / the backfill command.
 */
export function ensureFinanceAccountBaseline(
  input: EnsureFinanceAccountBaselineInput
): EnsureFinanceAccountBaselineResult {
  const schoolId = String(input.schoolId || "").trim();
  const accountRef = normaliseAccountRef(input.accountRef);

  if (!schoolId || !accountRef) {
    return {
      status: "error",
      accountRef,
      error: "Missing schoolId or accountRef",
    };
  }

  try {
    const existing = readSchoolFamilyAccountAgeAnalysisSnapshots(schoolId);
    if (existing[accountRef]) {
      return { status: "already_exists", accountRef };
    }

    const snapshot = buildNativeZeroBaseline(input);
    const outcome = insertSchoolFamilyAccountAgeAnalysisSnapshotIfAbsent(
      schoolId,
      accountRef,
      snapshot
    );

    invalidateFamilyAccountAgeAnalysisFileCache();
    invalidateOfficialBillingAccountRefsCache(schoolId);

    if (outcome === "already_exists") {
      return { status: "already_exists", accountRef };
    }

    return { status: "inserted", accountRef, snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Finance baseline write failed";
    console.error(
      `[finance-baseline] ensure failed schoolId=${schoolId} accountRef=${accountRef}: ${message}`
    );
    return { status: "error", accountRef, error: message };
  }
}

export type MissingFinanceBaselineCandidate = {
  familyAccountId: string;
  accountRef: string;
  familyName: string;
  activeLearnerIds: string[];
  activeLearnerNames: string[];
};

export type OrphanFamilyAccountShell = {
  familyAccountId: string;
  accountRef: string;
  familyName: string;
  createdAt: Date;
};

export type FindMissingFinanceBaselinesResult = {
  candidates: MissingFinanceBaselineCandidate[];
  orphanShells: OrphanFamilyAccountShell[];
};

/** Find active linked family accounts missing from the finance snapshot index. */
export async function findMissingFinanceAccountBaselines(
  schoolId: string
): Promise<FindMissingFinanceBaselinesResult> {
  const sid = String(schoolId || "").trim();
  if (!sid) return { candidates: [], orphanShells: [] };

  const snapshots = readSchoolFamilyAccountAgeAnalysisSnapshots(sid);
  const snapshotRefs = new Set(Object.keys(snapshots || {}).map((r) => r.toUpperCase()));

  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId: sid },
    select: {
      id: true,
      accountRef: true,
      familyName: true,
      createdAt: true,
      learners: {
        where: activeLearnerWhere(sid),
        select: { id: true, firstName: true, lastName: true },
      },
    },
    orderBy: { accountRef: "asc" },
  });

  const candidates: MissingFinanceBaselineCandidate[] = [];
  const orphanShells: OrphanFamilyAccountShell[] = [];

  for (const fa of familyAccounts) {
    const accountRef = normaliseAccountRef(fa.accountRef);
    if (!accountRef) continue;

    const activeLearners = fa.learners || [];
    if (!activeLearners.length) {
      orphanShells.push({
        familyAccountId: fa.id,
        accountRef,
        familyName: String(fa.familyName || "").trim(),
        createdAt: fa.createdAt,
      });
      continue;
    }

    if (snapshotRefs.has(accountRef)) continue;

    candidates.push({
      familyAccountId: fa.id,
      accountRef,
      familyName: String(fa.familyName || "").trim(),
      activeLearnerIds: activeLearners.map((l) => l.id),
      activeLearnerNames: activeLearners.map(
        (l) => `${String(l.firstName || "").trim()} ${String(l.lastName || "").trim()}`.trim()
      ),
    });
  }

  return { candidates, orphanShells };
}

export type BackfillFinanceAccountBaselinesResult = {
  dryRun: boolean;
  candidates: MissingFinanceBaselineCandidate[];
  orphanShells: OrphanFamilyAccountShell[];
  inserted: string[];
  skipped: string[];
  errors: Array<{ accountRef: string; error: string }>;
};

/** Backfill zero-balance finance baselines for active linked accounts missing from snapshots. */
export async function backfillFinanceAccountBaselines(
  schoolId: string,
  opts: { dryRun?: boolean } = {}
): Promise<BackfillFinanceAccountBaselinesResult> {
  const dryRun = Boolean(opts.dryRun);
  const { candidates, orphanShells } = await findMissingFinanceAccountBaselines(schoolId);

  const inserted: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ accountRef: string; error: string }> = [];

  if (dryRun) {
    return { dryRun, candidates, orphanShells, inserted, skipped, errors };
  }

  for (const candidate of candidates) {
    const familyAccount = await prisma.familyAccount.findUnique({
      where: { id: candidate.familyAccountId },
      select: { createdAt: true, familyName: true },
    });
    if (!familyAccount) {
      errors.push({ accountRef: candidate.accountRef, error: "FamilyAccount not found" });
      continue;
    }

    const result = ensureFinanceAccountBaseline({
      schoolId,
      accountRef: candidate.accountRef,
      accountHolder: candidate.familyName || familyAccount.familyName,
      createdAt: familyAccount.createdAt,
    });

    if (result.status === "inserted") inserted.push(candidate.accountRef);
    else if (result.status === "already_exists") skipped.push(candidate.accountRef);
    else errors.push({ accountRef: candidate.accountRef, error: result.error });
  }

  return { dryRun, candidates, orphanShells, inserted, skipped, errors };
}

/**
 * Register finance baseline after learner/family shell creation.
 * Throws FinanceAccountBaselineError on failure so registration can roll back.
 */
export function registerFinanceAccountForLearner(input: {
  schoolId: string;
  learnerId: string;
  familyAccountId: string;
  accountRef: string;
  accountHolder: string;
  createdAt?: Date | string;
}): EnsureFinanceAccountBaselineResult {
  const result = ensureFinanceAccountBaseline({
    schoolId: input.schoolId,
    accountRef: input.accountRef,
    accountHolder: input.accountHolder,
    createdAt: input.createdAt,
  });

  if (result.status === "error") {
    console.error(
      `[finance-baseline] registration baseline failed schoolId=${input.schoolId} learnerId=${input.learnerId} familyAccountId=${input.familyAccountId} accountRef=${input.accountRef}: ${result.error}`
    );
    throw new FinanceAccountBaselineError(
      `Finance account baseline could not be created for ${input.accountRef}. Registration was rolled back. Re-run backfill-finance-account-baselines after fixing storage. Details: ${result.error}`,
      {
        schoolId: input.schoolId,
        accountRef: input.accountRef,
        learnerId: input.learnerId,
        familyAccountId: input.familyAccountId,
      }
    );
  }

  if (result.status === "inserted") {
    console.log(
      `[finance-baseline] inserted schoolId=${input.schoolId} learnerId=${input.learnerId} accountRef=${input.accountRef}`
    );
  }

  return result;
}
