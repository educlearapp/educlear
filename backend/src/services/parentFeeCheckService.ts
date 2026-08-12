import { prisma } from "../prisma";
import * as financeAuthority from "./financeAuthority/resolveAuthoritativeFamilyAccountBalance";

export type FeeCheckStatus = "GREEN" | "AMBER" | "RED";

export type FeeCheckLearnerRow = {
  id: string;
  name: string;
};

export type FeeCheckResultRow = {
  parentName: string;
  schoolId: string;
  schoolName: string;
  familyAccountNumber: string;
  familyAccountId: string | null;
  outstandingAmount: number;
  status: FeeCheckStatus;
  learners: FeeCheckLearnerRow[];
  /** True when this row belongs to the authenticated staff school (full PII). */
  isHomeSchool: boolean;
  /** Linked learner count (always present; names only for home school). */
  learnerCount: number;
  /**
   * Phase 1I — how outstanding was resolved.
   * AUTHORITATIVE_FAMILY_ACCOUNT = shared statement/Fee Check authority.
   * LEGACY_PARENT_OUTSTANDING = fallback when no family account ref exists.
   */
  balanceAuthority:
    | "AUTHORITATIVE_FAMILY_ACCOUNT"
    | "LEGACY_PARENT_OUTSTANDING";
};

export type ParentFeeCheckResponse = {
  found: boolean;
  normalizedId: string;
  results: FeeCheckResultRow[];
  totalOutstanding: number;
  /** Aggregate status across all matched accounts (worst case wins). */
  status: FeeCheckStatus;
};

export function normalizeSaIdNumber(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function feeStatusFromOutstanding(outstanding: number): FeeCheckStatus {
  const amount = Math.round((Number(outstanding) || 0) * 100) / 100;
  if (amount <= 0.01) return "GREEN";
  if (amount > 10000) return "RED";
  return "AMBER";
}

function worstStatus(statuses: FeeCheckStatus[]): FeeCheckStatus {
  if (statuses.some((s) => s === "RED")) return "RED";
  if (statuses.some((s) => s === "AMBER")) return "AMBER";
  return "GREEN";
}

function parentDisplayName(parent: { firstName: string; surname: string; title?: string | null }) {
  const title = String(parent.title || "").trim();
  const first = String(parent.firstName || "").trim();
  const surname = String(parent.surname || "").trim();
  return [title, first, surname].filter(Boolean).join(" ").trim() || "Parent";
}

/** Cross-school: confirm ID match without exposing full contact identity. */
function redactedParentDisplayName(parent: { firstName: string; surname: string }) {
  const first = String(parent.firstName || "").trim();
  const surname = String(parent.surname || "").trim();
  const initial = first ? `${first.charAt(0).toUpperCase()}.` : "";
  const label = [initial, surname].filter(Boolean).join(" ").trim();
  return label || "Guardian on file";
}

function learnerDisplayName(learner: { firstName: string; lastName: string }) {
  return [String(learner.firstName || "").trim(), String(learner.lastName || "").trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function resolveFamilyAccountBalance(
  schoolId: string,
  accountRef: string
): Promise<number> {
  // Phase 1I — same authority as statements / migration Finance Check.
  const auth = await financeAuthority.resolveAuthoritativeFamilyAccountBalance(schoolId, accountRef);
  return auth.balanceRand;
}

type FamilyAccountBundle = {
  familyAccountId: string | null;
  accountRef: string;
  familyName: string | null;
  learners: Map<string, FeeCheckLearnerRow>;
};

export type LookupParentFeesOptions = {
  /** Authenticated staff school — home-school rows keep full PII; others are minimized. */
  viewerSchoolId: string;
};

export async function lookupParentFeesBySaId(
  rawId: string,
  opts: LookupParentFeesOptions
): Promise<ParentFeeCheckResponse> {
  const normalizedId = normalizeSaIdNumber(rawId);
  const viewerSchoolId = String(opts.viewerSchoolId || "").trim();
  console.info("[fee-check] lookupParentFeesBySaId", {
    rawId: String(rawId || "").trim(),
    normalizedId,
    viewerSchoolId: viewerSchoolId || null,
  });
  if (!normalizedId || normalizedId.length < 6) {
    return {
      found: false,
      normalizedId,
      results: [],
      totalOutstanding: 0,
      status: "GREEN",
    };
  }
  if (!viewerSchoolId) {
    throw new Error("viewerSchoolId is required for Fee Check");
  }

  const parents = await prisma.parent.findMany({
    where: { idNumber: { not: null } },
    select: {
      id: true,
      schoolId: true,
      firstName: true,
      surname: true,
      title: true,
      idNumber: true,
      familyAccountId: true,
      outstandingAmount: true,
      school: { select: { id: true, name: true } },
      familyAccount: { select: { id: true, accountRef: true, familyName: true } },
      links: {
        select: {
          learner: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              familyAccountId: true,
              familyAccount: { select: { id: true, accountRef: true, familyName: true } },
            },
          },
        },
      },
    },
  });

  const matchingParents = parents.filter(
    (p) => normalizeSaIdNumber(p.idNumber) === normalizedId
  );

  if (!matchingParents.length) {
    return {
      found: false,
      normalizedId,
      results: [],
      totalOutstanding: 0,
      status: "GREEN",
    };
  }

  const balanceCache = new Map<string, number>();
  const resultMap = new Map<string, FeeCheckResultRow>();

  for (const parent of matchingParents) {
    const schoolId = String(parent.schoolId || "").trim();
    const isHomeSchool = schoolId === viewerSchoolId;
    const parentName = isHomeSchool
      ? parentDisplayName(parent)
      : redactedParentDisplayName(parent);
    const schoolName = String(parent.school?.name || "").trim() || "School";

    const bundles = new Map<string, FamilyAccountBundle>();

    const addBundle = (
      familyAccountId: string | null,
      accountRef: string,
      familyName: string | null,
      learner?: { id: string; firstName: string; lastName: string }
    ) => {
      const ref = String(accountRef || "").trim();
      const key = familyAccountId || (ref ? `ref:${ref}` : `parent:${parent.id}`);
      const existing = bundles.get(key) || {
        familyAccountId,
        accountRef: ref,
        familyName,
        learners: new Map<string, FeeCheckLearnerRow>(),
      };
      if (ref && !existing.accountRef) existing.accountRef = ref;
      if (familyName && !existing.familyName) existing.familyName = familyName;
      if (learner?.id) {
        if (isHomeSchool) {
          const name = learnerDisplayName(learner);
          existing.learners.set(learner.id, { id: learner.id, name: name || "Learner" });
        } else {
          // Cross-school: count only — never expose other-school learner names/ids.
          existing.learners.set(`count:${learner.id}`, { id: "", name: "" });
        }
      }
      bundles.set(key, existing);
    };

    if (parent.familyAccount) {
      addBundle(
        parent.familyAccount.id,
        parent.familyAccount.accountRef,
        parent.familyAccount.familyName
      );
    } else if (parent.familyAccountId) {
      addBundle(parent.familyAccountId, "", null);
    }

    for (const link of parent.links) {
      const learner = link.learner;
      if (!learner) continue;
      const fa = learner.familyAccount;
      if (fa) {
        addBundle(fa.id, fa.accountRef, fa.familyName, learner);
      } else if (learner.familyAccountId) {
        addBundle(learner.familyAccountId, "", null, learner);
      } else {
        addBundle(null, "", null, learner);
      }
    }

    if (!bundles.size) {
      bundles.set(`parent:${parent.id}`, {
        familyAccountId: null,
        accountRef: "",
        familyName: null,
        learners: new Map(),
      });
    }

    for (const bundle of bundles.values()) {
      const accountRef = String(bundle.accountRef || "").trim();
      const resultKey = `${schoolId}:${bundle.familyAccountId || accountRef || parent.id}`;

      let outstanding = 0;
      let balanceAuthority: FeeCheckResultRow["balanceAuthority"] =
        "LEGACY_PARENT_OUTSTANDING";
      if (accountRef) {
        const cacheKey = `${schoolId}:${accountRef.toUpperCase()}`;
        if (!balanceCache.has(cacheKey)) {
          balanceCache.set(cacheKey, await resolveFamilyAccountBalance(schoolId, accountRef));
        }
        outstanding = balanceCache.get(cacheKey) ?? 0;
        balanceAuthority = "AUTHORITATIVE_FAMILY_ACCOUNT";
      } else {
        // LEGACY/FALLBACK only — Parent.outstandingAmount is not authoritative when a
        // family account exists. Kept for accounts without accountRef linkage.
        outstanding = Math.round((Number(parent.outstandingAmount) || 0) * 100) / 100;
        balanceAuthority = "LEGACY_PARENT_OUTSTANDING";
      }

      const status = feeStatusFromOutstanding(outstanding);
      const learnerCount = bundle.learners.size;
      const learners: FeeCheckLearnerRow[] = isHomeSchool
        ? Array.from(bundle.learners.values())
        : learnerCount > 0
          ? [{ id: "", name: `${learnerCount} linked learner(s)` }]
          : [];

      const row: FeeCheckResultRow = {
        parentName,
        schoolId,
        schoolName,
        familyAccountNumber: accountRef || "—",
        familyAccountId: isHomeSchool ? bundle.familyAccountId : null,
        outstandingAmount: outstanding,
        status,
        learners,
        isHomeSchool,
        learnerCount,
        balanceAuthority,
      };

      const existing = resultMap.get(resultKey);
      if (!existing) {
        resultMap.set(resultKey, row);
        continue;
      }

      if (isHomeSchool) {
        for (const learner of learners) {
          if (!existing.learners.some((l) => l.id === learner.id)) {
            existing.learners.push(learner);
          }
        }
      } else {
        existing.learnerCount = Math.max(existing.learnerCount, learnerCount);
        existing.learners =
          existing.learnerCount > 0
            ? [{ id: "", name: `${existing.learnerCount} linked learner(s)` }]
            : [];
      }
      if (outstanding > existing.outstandingAmount) {
        existing.outstandingAmount = outstanding;
        existing.status = status;
        existing.balanceAuthority = balanceAuthority;
      }
    }
  }

  const results = Array.from(resultMap.values()).sort((a, b) =>
    a.schoolName.localeCompare(b.schoolName)
  );
  const totalOutstanding = Math.round(
    results.reduce((sum, row) => sum + row.outstandingAmount, 0) * 100
  ) / 100;
  const status = worstStatus(results.map((r) => r.status));

  return {
    found: results.length > 0,
    normalizedId,
    results,
    totalOutstanding,
    status,
  };
}
