/**
 * Dry-run planner for historical family-account merge audits → PostgreSQL lifecycle fields.
 *
 * DOES NOT WRITE. Do not run against production. MOT682 is out of scope.
 *
 * Reversals are resolved in chronological order so LEK003→MOR013 followed by
 * MOR013→LEK003 yields the canonical final state MOR013 retired into LEK003.
 */

export const MOT682_OUT_OF_SCOPE_ACCOUNT_REF = "MOT682";

export type MergeAuditLike = {
  schoolId: string;
  action?: string;
  createdAt: string;
  sourceFamilyAccountId?: string | null;
  targetFamilyAccountId?: string | null;
  sourceAccountRef?: string | null;
  targetAccountRef?: string | null;
};

export type FamilyAccountBackfillRow = {
  id: string;
  schoolId: string;
  accountRef: string;
  retiredAt: Date | string | null;
  mergedIntoFamilyAccountId: string | null;
  learnerCount: number;
};

export type BackfillProposal = {
  familyAccountId: string;
  accountRef: string;
  schoolId: string;
  retiredAt: string;
  mergedIntoFamilyAccountId: string;
  mergedIntoAccountRef: string;
  reason: string;
};

export type BackfillSkip = {
  familyAccountId?: string;
  accountRef?: string;
  schoolId?: string;
  reason: string;
};

export type BackfillPlan = {
  schoolId: string;
  proposals: BackfillProposal[];
  skipped: BackfillSkip[];
  reversalsDetected: number;
  chainsResolved: number;
  financialChanges: 0;
};

function upperRef(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function resolveAccount(
  rows: FamilyAccountBackfillRow[],
  schoolId: string,
  id?: string | null,
  accountRef?: string | null
): FamilyAccountBackfillRow | null {
  const sid = String(schoolId || "").trim();
  const wantedId = String(id || "").trim();
  const wantedRef = upperRef(accountRef);
  if (wantedId) {
    const byId = rows.find((row) => row.id === wantedId);
    if (byId) return byId;
  }
  if (wantedRef) {
    return (
      rows.find((row) => row.schoolId === sid && upperRef(row.accountRef) === wantedRef) || null
    );
  }
  return null;
}

/**
 * Pure dry-run. Zero database / snapshot / ledger writes.
 */
export function planFamilyAccountMergeLifecycleBackfill(opts: {
  schoolId: string;
  audits: MergeAuditLike[];
  familyAccounts: FamilyAccountBackfillRow[];
}): BackfillPlan {
  const schoolId = String(opts.schoolId || "").trim();
  const skipped: BackfillSkip[] = [];
  const proposals: BackfillProposal[] = [];
  let reversalsDetected = 0;
  let chainsResolved = 0;

  if (!schoolId) {
    return {
      schoolId,
      proposals: [],
      skipped: [{ reason: "Missing schoolId" }],
      reversalsDetected: 0,
      chainsResolved: 0,
      financialChanges: 0,
    };
  }

  const merges = (opts.audits || [])
    .filter((entry) => String(entry.action || "merge").toLowerCase() === "merge")
    .filter((entry) => String(entry.schoolId || "").trim() === schoolId)
    .slice()
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  type State = { mergedIntoId: string; retiredAt: string; reason: string };
  const state = new Map<string, State>();

  for (const merge of merges) {
    const source = resolveAccount(
      opts.familyAccounts,
      schoolId,
      merge.sourceFamilyAccountId,
      merge.sourceAccountRef
    );
    const target = resolveAccount(
      opts.familyAccounts,
      schoolId,
      merge.targetFamilyAccountId,
      merge.targetAccountRef
    );

    if (!source || !target) {
      skipped.push({
        familyAccountId: source?.id || target?.id,
        accountRef: source?.accountRef || target?.accountRef || merge.sourceAccountRef || merge.targetAccountRef || undefined,
        schoolId,
        reason: "Could not resolve source or target FamilyAccount for this school",
      });
      continue;
    }

    if (source.schoolId !== schoolId || target.schoolId !== schoolId || source.schoolId !== target.schoolId) {
      skipped.push({
        familyAccountId: source.id,
        accountRef: source.accountRef,
        schoolId,
        reason: "Cross-school merge audit is not eligible for backfill",
      });
      continue;
    }

    if (
      upperRef(source.accountRef) === MOT682_OUT_OF_SCOPE_ACCOUNT_REF ||
      upperRef(target.accountRef) === MOT682_OUT_OF_SCOPE_ACCOUNT_REF
    ) {
      skipped.push({
        familyAccountId: source.id,
        accountRef: source.accountRef,
        schoolId,
        reason: "MOT682 is out of scope and must not be backfilled",
      });
      continue;
    }

    if (source.id === target.id) {
      skipped.push({
        familyAccountId: source.id,
        accountRef: source.accountRef,
        schoolId,
        reason: "Self-merge audit ignored",
      });
      continue;
    }

    const priorTargetOfSource = state.get(source.id)?.mergedIntoId;
    if (priorTargetOfSource && priorTargetOfSource === target.id) {
      continue;
    }

    const targetWasRetiredIntoSource = state.get(target.id)?.mergedIntoId === source.id;
    if (targetWasRetiredIntoSource) {
      reversalsDetected += 1;
    }

    state.delete(target.id);

    const retiredAt = String(merge.createdAt || "").trim() || new Date().toISOString();
    state.set(source.id, {
      mergedIntoId: target.id,
      retiredAt,
      reason: targetWasRetiredIntoSource
        ? "Reversal resolved; final survivor is the later merge target"
        : "Historical merge source retired into surviving account",
    });

    for (const rec of state.values()) {
      if (rec.mergedIntoId === source.id) {
        rec.mergedIntoId = target.id;
        rec.reason = "Merge chain collapsed onto final surviving account";
        chainsResolved += 1;
      }
    }
    for (const [id, rec] of [...state.entries()]) {
      if (rec.mergedIntoId === id) {
        state.delete(id);
      }
    }
  }

  const byId = new Map(opts.familyAccounts.map((row) => [row.id, row]));

  for (const [id, rec] of state) {
    const source = byId.get(id);
    const target = byId.get(rec.mergedIntoId);
    if (!source || !target) {
      skipped.push({
        familyAccountId: id,
        schoolId,
        reason: "Resolved merge target no longer exists",
      });
      continue;
    }

    if (upperRef(source.accountRef) === MOT682_OUT_OF_SCOPE_ACCOUNT_REF) {
      skipped.push({
        familyAccountId: source.id,
        accountRef: source.accountRef,
        schoolId,
        reason: "MOT682 is out of scope and must not be backfilled",
      });
      continue;
    }

    if (source.learnerCount > 0) {
      skipped.push({
        familyAccountId: source.id,
        accountRef: source.accountRef,
        schoolId,
        reason: `Ambiguous: ${source.accountRef} still has ${source.learnerCount} learner(s); will not retire from audit history alone`,
      });
      continue;
    }

    if (source.retiredAt && String(source.mergedIntoFamilyAccountId || "") === target.id) {
      skipped.push({
        familyAccountId: source.id,
        accountRef: source.accountRef,
        schoolId,
        reason: "Already retired into the canonical surviving account",
      });
      continue;
    }

    if (source.mergedIntoFamilyAccountId && source.mergedIntoFamilyAccountId !== target.id) {
      skipped.push({
        familyAccountId: source.id,
        accountRef: source.accountRef,
        schoolId,
        reason: "Ambiguous: FamilyAccount already retired into a different survivor",
      });
      continue;
    }

    proposals.push({
      familyAccountId: source.id,
      accountRef: source.accountRef,
      schoolId,
      retiredAt: rec.retiredAt,
      mergedIntoFamilyAccountId: target.id,
      mergedIntoAccountRef: target.accountRef,
      reason: rec.reason,
    });
  }

  return {
    schoolId,
    proposals,
    skipped,
    reversalsDetected,
    chainsResolved,
    financialChanges: 0,
  };
}
