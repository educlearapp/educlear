import { prisma } from "../prisma";
import { buildAccountsFromAgeAnalysisSnapshots } from "./statementAccounts";
import {
  calculateBalanceFromEntries,
  readSchoolLedger,
} from "../utils/billingLedgerStore";

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
  const ref = String(accountRef || "").trim().toUpperCase();
  if (!ref) return 0;

  const accounts = await buildAccountsFromAgeAnalysisSnapshots(schoolId);
  const row = accounts.find((a) => String(a.accountNo || "").trim().toUpperCase() === ref);
  if (row) return Math.round(row.balance * 100) / 100;

  const ledger = readSchoolLedger(schoolId);
  const entries = ledger.filter((e) => String(e.accountNo || "").trim().toUpperCase() === ref);
  return Math.round(calculateBalanceFromEntries(entries) * 100) / 100;
}

type FamilyAccountBundle = {
  familyAccountId: string | null;
  accountRef: string;
  familyName: string | null;
  learners: Map<string, FeeCheckLearnerRow>;
};

export async function lookupParentFeesBySaId(rawId: string): Promise<ParentFeeCheckResponse> {
  const normalizedId = normalizeSaIdNumber(rawId);
  if (!normalizedId || normalizedId.length < 6) {
    return {
      found: false,
      normalizedId,
      results: [],
      totalOutstanding: 0,
      status: "GREEN",
    };
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
    const parentName = parentDisplayName(parent);
    const schoolId = String(parent.schoolId || "").trim();
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
        const name = learnerDisplayName(learner);
        existing.learners.set(learner.id, { id: learner.id, name: name || "Learner" });
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
      if (accountRef) {
        const cacheKey = `${schoolId}:${accountRef.toUpperCase()}`;
        if (!balanceCache.has(cacheKey)) {
          balanceCache.set(cacheKey, await resolveFamilyAccountBalance(schoolId, accountRef));
        }
        outstanding = balanceCache.get(cacheKey) ?? 0;
      } else {
        outstanding = Math.round((Number(parent.outstandingAmount) || 0) * 100) / 100;
      }

      const status = feeStatusFromOutstanding(outstanding);
      const learners = Array.from(bundle.learners.values());

      const row: FeeCheckResultRow = {
        parentName,
        schoolId,
        schoolName,
        familyAccountNumber: accountRef || "—",
        familyAccountId: bundle.familyAccountId,
        outstandingAmount: outstanding,
        status,
        learners,
      };

      const existing = resultMap.get(resultKey);
      if (!existing) {
        resultMap.set(resultKey, row);
        continue;
      }

      for (const learner of learners) {
        if (!existing.learners.some((l) => l.id === learner.id)) {
          existing.learners.push(learner);
        }
      }
      if (outstanding > existing.outstandingAmount) {
        existing.outstandingAmount = outstanding;
        existing.status = status;
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
