import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import {
  addLearnerToFamilyIndex,
  splitMergedAccountNames,
  type FamilyAccountIndex,
} from "./daSilvaMergedFamily";
import type { ParsedBillingAccount, ParsedLearner } from "./parsers";
import { buildLearnerMatchKey } from "./parsers";
import {
  applySecondPassBillingMatch,
  type KideesysBillingReconciliationReport,
  type SecondPassBillingMatchInput,
} from "./daSilvaKideesysBillingMatchSecondPass";

export type DbLearnerForBillingMatch = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  matchKey: string;
  idNumber?: string | null;
  admissionNo?: string | null;
};

export type BillingAccountMatchRow = {
  accountNo: string;
  fullName: string;
  learnerId: string | null;
  matchKey: string | null;
  strategy: string | null;
  ambiguous: boolean;
  siblingGroupKey: string | null;
};

export type BillingMatchAudit = {
  matched: BillingAccountMatchRow[];
  unmatchedAccounts: BillingAccountMatchRow[];
  duplicateMatches: BillingAccountMatchRow[];
  unmatchedLearners: Array<{ learnerId: string; fullName: string; className: string | null }>;
};

function normName(value: string): string {
  return normalizeMatchText(value);
}

function normClass(value: string | null | undefined): string {
  const norm = normalizeClassroomInput(String(value || ""));
  return norm.matchKey || normName(String(value || ""));
}

function normId(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

/** Kid-e-Sys billing names are often `First Middle Surname` (last token = surname). */
function parseBillingDisplayName(fullName: string): { firstName: string; lastName: string } {
  const cleaned = String(fullName || "")
    .replace(/\n/g, " ")
    .replace(/ref:\s*\([^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return { firstName: parts[0] || "", lastName: "" };
  }
  return {
    firstName: parts[0],
    lastName: parts[parts.length - 1],
  };
}

type BillingLearnerIndexes = {
  byMatchKey: Map<string, string[]>;
  byIdNumber: Map<string, string[]>;
  byAdmission: Map<string, string[]>;
  byNameClass: Map<string, string[]>;
  byNameOnly: Map<string, string[]>;
  bySurname: Map<string, string[]>;
};

function buildBillingLearnerIndexes(learners: DbLearnerForBillingMatch[]): BillingLearnerIndexes {
  const byMatchKey = new Map<string, string[]>();
  const byIdNumber = new Map<string, string[]>();
  const byAdmission = new Map<string, string[]>();
  const byNameClass = new Map<string, string[]>();
  const byNameOnly = new Map<string, string[]>();
  const bySurname = new Map<string, string[]>();

  for (const l of learners) {
    const keys = new Set<string>();
    keys.add(l.matchKey);
    keys.add(buildLearnerMatchKey(`${l.firstName} ${l.lastName}`, l.className || ""));

    for (const key of keys) {
      const list = byMatchKey.get(key) || [];
      list.push(l.id);
      byMatchKey.set(key, list);
    }

    const idn = normId(l.idNumber);
    if (idn.length >= 6) {
      const list = byIdNumber.get(idn) || [];
      list.push(l.id);
      byIdNumber.set(idn, list);
    }

    const adm = normId(l.admissionNo);
    if (adm) {
      const list = byAdmission.get(adm) || [];
      list.push(l.id);
      byAdmission.set(adm, list);
    }

    const nameClassKey = `${normName(l.firstName)}|${normName(l.lastName)}|${normClass(l.className)}`;
    const ncList = byNameClass.get(nameClassKey) || [];
    ncList.push(l.id);
    byNameClass.set(nameClassKey, ncList);

    const nameOnlyKey = `${normName(l.lastName)}|${normName(l.firstName)}`;
    const noList = byNameOnly.get(nameOnlyKey) || [];
    noList.push(l.id);
    byNameOnly.set(nameOnlyKey, noList);

    const surKey = normName(l.lastName);
    const sList = bySurname.get(surKey) || [];
    sList.push(l.id);
    bySurname.set(surKey, sList);
  }

  return { byMatchKey, byIdNumber, byAdmission, byNameClass, byNameOnly, bySurname };
}

function pickUnique(candidates: string[]): { id: string | null; ambiguous: boolean } {
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { id: unique[0], ambiguous: false };
  if (unique.length === 0) return { id: null, ambiguous: false };
  return { id: null, ambiguous: true };
}

function matchNameToLearner(
  displayName: string,
  classHint: string | null,
  indexes: BillingLearnerIndexes,
  classByKey: Map<string, ParsedLearner>
): { learnerId: string | null; matchKey: string | null; strategy: string | null; ambiguous: boolean } {
  const { firstName, lastName } = parseBillingDisplayName(displayName);
  if (!firstName || !lastName) {
    return { learnerId: null, matchKey: null, strategy: null, ambiguous: false };
  }

  const className = classHint || classByKey.get(buildLearnerMatchKey(displayName, ""))?.className || "";
  const matchKey = buildLearnerMatchKey(`${firstName} ${lastName}`, className);

  const strategies: Array<{ name: string; ids: string[] }> = [
    { name: "match_key", ids: indexes.byMatchKey.get(matchKey) || [] },
  ];

  if (className) {
    const nameClassKey = `${normName(firstName)}|${normName(lastName)}|${normClass(className)}`;
    strategies.push({ name: "surname_first_name_class", ids: indexes.byNameClass.get(nameClassKey) || [] });
  }

  const nameOnlyKey = `${normName(lastName)}|${normName(firstName)}`;
  strategies.push({ name: "surname_first_name", ids: indexes.byNameOnly.get(nameOnlyKey) || [] });

  const fromClass = classByKey.get(matchKey);
  if (fromClass?.idNumber) {
    const idn = normId(fromClass.idNumber);
    if (idn.length >= 6) {
      strategies.push({ name: "class_list_id_number", ids: indexes.byIdNumber.get(idn) || [] });
    }
  }
  if (fromClass?.admissionNo) {
    const adm = normId(fromClass.admissionNo);
    if (adm) {
      strategies.push({ name: "class_list_admission_no", ids: indexes.byAdmission.get(adm) || [] });
    }
  }

  for (const s of strategies) {
    const { id, ambiguous } = pickUnique(s.ids);
    if (id) {
      return { learnerId: id, matchKey, strategy: s.name, ambiguous: false };
    }
    if (ambiguous) {
      return { learnerId: null, matchKey, strategy: s.name, ambiguous: true };
    }
  }

  return { learnerId: null, matchKey, strategy: null, ambiguous: false };
}

function matchByFamilySurname(
  names: string[],
  indexes: BillingLearnerIndexes
): { learnerIds: string[]; strategy: string } | null {
  if (names.length < 2) return null;
  const surnames = names.map((n) => normName(parseBillingDisplayName(n).lastName)).filter(Boolean);
  if (new Set(surnames).size !== 1) return null;
  const sur = surnames[0];
  const candidates = indexes.bySurname.get(sur) || [];
  if (!candidates.length) return null;
  const hits: string[] = [];
  for (const name of names) {
    const { firstName, lastName } = parseBillingDisplayName(name);
    const key = `${normName(lastName)}|${normName(firstName)}`;
    const ids = indexes.byNameOnly.get(key) || [];
    if (ids.length === 1) hits.push(ids[0]);
  }
  if (hits.length === names.length) {
    return { learnerIds: hits, strategy: "sibling_family_surname" };
  }
  return null;
}

export function matchKideesysBillingAccounts(opts: {
  accounts: ParsedBillingAccount[];
  dbLearners: DbLearnerForBillingMatch[];
  classListLearners: ParsedLearner[];
  mergedFamilyAccountNos: string[];
}): BillingMatchAudit {
  const learnerIndex = buildBillingLearnerIndexes(opts.dbLearners);
  const classByKey = new Map(opts.classListLearners.map((l) => [l.matchKey, l]));

  for (const row of opts.classListLearners) {
    const dbHit = opts.dbLearners.find(
      (d) =>
        normName(d.firstName) === normName(row.firstName) &&
        normName(d.lastName) === normName(row.lastName)
    );
    if (!dbHit) continue;
    const idn = normId(row.idNumber);
    const adm = normId(row.admissionNo);
    if (idn.length >= 6) {
      const list = learnerIndex.byIdNumber.get(idn) || [];
      if (!list.includes(dbHit.id)) list.push(dbHit.id);
      learnerIndex.byIdNumber.set(idn, list);
    }
    if (adm) {
      const list = learnerIndex.byAdmission.get(adm) || [];
      if (!list.includes(dbHit.id)) list.push(dbHit.id);
      learnerIndex.byAdmission.set(adm, list);
    }
  }

  const familyIndex: FamilyAccountIndex = {
    learnerNameToAccount: new Map(),
    accountToLearnerNames: new Map(),
  };
  for (const account of opts.accounts) {
    const names = account.learnerNames?.length
      ? account.learnerNames
      : splitMergedAccountNames(account.fullName);
    for (const name of names.length ? names : [account.fullName]) {
      addLearnerToFamilyIndex(familyIndex, account.accountNo, name);
    }
  }

  const matched: BillingAccountMatchRow[] = [];
  const unmatchedAccounts: BillingAccountMatchRow[] = [];
  const duplicateMatches: BillingAccountMatchRow[] = [];
  const matchedLearnerIds = new Set<string>();

  for (const account of opts.accounts) {
    const names = account.learnerNames?.length
      ? account.learnerNames
      : splitMergedAccountNames(account.fullName);
    const displayNames = names.length ? names : [account.fullName];
    const siblingGroupKey =
      displayNames.length > 1 ? `siblings:${normName(account.accountNo)}` : null;

    const classHint =
      account.section && !/^general$/i.test(account.section) ? account.section : null;

    let learnerId: string | null = null;
    let matchKey: string | null = null;
    let strategy: string | null = null;
    let ambiguous = false;

    const familyMatch = matchByFamilySurname(displayNames, learnerIndex);
    if (familyMatch && familyMatch.learnerIds.length === 1) {
      learnerId = familyMatch.learnerIds[0];
      strategy = familyMatch.strategy;
    } else if (familyMatch && familyMatch.learnerIds.length > 1) {
      learnerId = familyMatch.learnerIds[0];
      strategy = familyMatch.strategy;
    }

    if (!learnerId) {
      for (const name of displayNames) {
        const hit = matchNameToLearner(name, classHint, learnerIndex, classByKey);
        if (hit.learnerId) {
          learnerId = hit.learnerId;
          matchKey = hit.matchKey;
          strategy = hit.strategy;
          ambiguous = hit.ambiguous;
          break;
        }
        if (hit.ambiguous) {
          ambiguous = true;
          strategy = hit.strategy;
          break;
        }
      }
    }

    if (!learnerId && displayNames.length === 1) {
      const sur = normName(parseBillingDisplayName(displayNames[0]).lastName);
      const surHits = learnerIndex.bySurname.get(sur) || [];
      if (surHits.length === 1) {
        learnerId = surHits[0];
        strategy = "unique_surname_fallback";
      }
    }

    const row: BillingAccountMatchRow = {
      accountNo: account.accountNo,
      fullName: account.fullName,
      learnerId,
      matchKey,
      strategy,
      ambiguous,
      siblingGroupKey,
    };

    if (learnerId) {
      matched.push(row);
      matchedLearnerIds.add(learnerId);
      if (ambiguous) duplicateMatches.push(row);
    } else {
      unmatchedAccounts.push(row);
      if (ambiguous) duplicateMatches.push(row);
    }
  }

  const unmatchedLearners = opts.dbLearners
    .filter((l) => !matchedLearnerIds.has(l.id))
    .map((l) => ({
      learnerId: l.id,
      fullName: `${l.firstName} ${l.lastName}`,
      className: l.className,
    }));

  return { matched, unmatchedAccounts, duplicateMatches, unmatchedLearners };
}

export type { KideesysBillingReconciliationReport, SecondPassBillingMatchInput };

export function matchKideesysBillingAccountsWithSecondPass(
  opts: SecondPassBillingMatchInput & {
    mergedFamilyAccountNos: string[];
    classListLearners: ParsedLearner[];
  }
): { audit: BillingMatchAudit; report: KideesysBillingReconciliationReport } {
  const firstPass = matchKideesysBillingAccounts({
    accounts: opts.accounts,
    dbLearners: opts.dbLearners,
    classListLearners: opts.classListLearners,
    mergedFamilyAccountNos: opts.mergedFamilyAccountNos,
  });
  const accountBalances = new Map(opts.accounts.map((a) => [a.accountNo, a.balance]));
  return applySecondPassBillingMatch(firstPass, opts, accountBalances);
}

/** Apply sibling family grouping: learners sharing an account keep one FamilyAccount ref. */
export function groupSiblingAccounts(
  matched: BillingAccountMatchRow[]
): Map<string, string[]> {
  const byAccount = new Map<string, string[]>();
  for (const row of matched) {
    if (!row.learnerId) continue;
    const list = byAccount.get(row.accountNo) || [];
    list.push(row.learnerId);
    byAccount.set(row.accountNo, list);
  }
  return byAccount;
}
