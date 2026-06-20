import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import type { ParsedBillingPlanItem } from "../migration/adapters/kideesys/parseBillingPlanFile";
import type { StoredBillingPlanItem } from "../../utils/learnerBillingPlanStore";

export type DbLearnerForParentMatch = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  admissionNo: string | null;
  idNumber: string | null;
};

export type BillingPlanMatchRow = {
  billingMatchKey: string;
  fullName: string;
  className: string;
  feeLineCount: number;
  totalAmount: number;
  learnerId: string | null;
  strategy: string | null;
  ambiguous: boolean;
};

function normId(value: string | null | undefined): string {
  return String(value || "")
    .replace(/\D/g, "")
    .trim();
}

function normPersonText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[''`´]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

function normSurname(value: string): string {
  return normPersonText(value)
    .replace(/\b(van|der|de|du|le|da|den|di)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normClass(value: string | null | undefined): string {
  const norm = normalizeClassroomInput(String(value || ""));
  return norm.matchKey || normPersonText(String(value || ""));
}

function cleanBillingDisplayName(fullName: string): string {
  return String(fullName || "")
    .replace(/\n/g, " ")
    .replace(/ref:\s*\([^)]*\)/gi, "")
    .replace(/\bdsa\d+\b/gi, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function billingFirstLastTokens(fullName: string): { firstName: string; lastName: string } {
  const parts = cleanBillingDisplayName(fullName).split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lower = parts.map((p) => p.toLowerCase());
  const penultimate = lower[lower.length - 2];
  if (parts.length >= 3 && /^(van|de|du|der|le|da|den|di)$/.test(penultimate)) {
    return {
      firstName: parts.slice(0, -2).join(" "),
      lastName: parts.slice(-2).join(" "),
    };
  }
  return { firstName: parts[0], lastName: parts[parts.length - 1] };
}

function tokenizePersonName(value: string): string[] {
  return cleanBillingDisplayName(value)
    .split(/\s+/)
    .map((t) => normPersonText(t))
    .filter(Boolean);
}

function firstNamesCompatible(billingFirst: string, dbFirst: string): boolean {
  const a = normPersonText(billingFirst).replace(/\s+/g, "");
  const b = normPersonText(dbFirst).replace(/\s+/g, "");
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(b) || b.startsWith(a);
}

function surnamesCompatible(billingSurname: string, dbSurname: string): boolean {
  const a = normSurname(billingSurname);
  const b = normSurname(dbSurname);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 4;
  return false;
}

type BillingMatchIndexes = {
  byAdmission: Map<string, string[]>;
  byIdNumber: Map<string, string[]>;
  byNameClass: Map<string, string[]>;
  byNameOnly: Map<string, string[]>;
  bySurnameClass: Map<string, string[]>;
  learnersById: Map<string, DbLearnerForParentMatch>;
};

function pushIndex(map: Map<string, string[]>, key: string, id: string): void {
  if (!key) return;
  const list = map.get(key) || [];
  if (!list.includes(id)) list.push(id);
  map.set(key, list);
}

export function buildBillingPlanMatchIndexes(
  learners: DbLearnerForParentMatch[]
): BillingMatchIndexes {
  const byAdmission = new Map<string, string[]>();
  const byIdNumber = new Map<string, string[]>();
  const byNameClass = new Map<string, string[]>();
  const byNameOnly = new Map<string, string[]>();
  const bySurnameClass = new Map<string, string[]>();
  const learnersById = new Map<string, DbLearnerForParentMatch>();

  for (const l of learners) {
    learnersById.set(l.id, l);
    const admission = normId(l.admissionNo);
    const idNumber = normId(l.idNumber);
    const firstName = normPersonText(l.firstName);
    const lastName = normPersonText(l.lastName);
    const surname = normSurname(l.lastName);
    const classKey = normClass(l.className);
    if (admission) pushIndex(byAdmission, admission, l.id);
    if (idNumber.length >= 6) pushIndex(byIdNumber, idNumber, l.id);
    if (firstName && lastName && classKey) {
      pushIndex(byNameClass, `${firstName}|${lastName}|${classKey}`, l.id);
      pushIndex(byNameClass, `${normalizeMatchText(l.firstName)}|${normalizeMatchText(l.lastName)}|${classKey}`, l.id);
    }
    if (firstName && lastName) {
      pushIndex(byNameOnly, `${lastName}|${firstName}`, l.id);
      pushIndex(byNameOnly, `${normalizeMatchText(l.lastName)}|${normalizeMatchText(l.firstName)}`, l.id);
    }
    pushIndex(bySurnameClass, `${normSurname(l.lastName)}|${normClass(l.className)}`, l.id);
    if (surname && firstName) {
      pushIndex(byNameOnly, `${surname}|${firstName}`, l.id);
    }
  }

  return { byAdmission, byIdNumber, byNameClass, byNameOnly, bySurnameClass, learnersById };
}

function pickUnique(candidates: string[]): { id: string | null; ambiguous: boolean } {
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { id: unique[0], ambiguous: false };
  if (unique.length === 0) return { id: null, ambiguous: false };
  return { id: null, ambiguous: true };
}

function nameClassKey(firstName: string, lastName: string, className: string): string {
  return `${normPersonText(firstName)}|${normPersonText(lastName)}|${normClass(className)}`;
}

function nameClassLookupKeys(firstName: string, lastName: string, className: string): string[] {
  const cls = normClass(className);
  const keys = new Set<string>();
  keys.add(nameClassKey(firstName, lastName, className));
  keys.add(`${normalizeMatchText(firstName)}|${normalizeMatchText(lastName)}|${cls}`);
  return [...keys];
}

function tokensOverlapMatch(
  billingFullName: string,
  className: string,
  indexes: BillingMatchIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  const billingTokens = tokenizePersonName(billingFullName);
  if (billingTokens.length < 2) {
    return { learnerId: null, strategy: null, ambiguous: false };
  }
  const billingLast = billingTokens[billingTokens.length - 1];
  const cls = normClass(className);
  const hits: string[] = [];

  for (const l of indexes.learnersById.values()) {
    if (normClass(l.className) !== cls) continue;
    const dbTokens = [...tokenizePersonName(l.firstName), ...tokenizePersonName(l.lastName)];
    if (!dbTokens.length) continue;
    const surnameOk =
      surnamesCompatible(billingLast, dbTokens[dbTokens.length - 1]) ||
      surnamesCompatible(billingLast, l.lastName);
    if (!surnameOk) continue;

    const dbFirstTokens = tokenizePersonName(l.firstName);
    const firstOk =
      dbFirstTokens.some((dt) => billingTokens.some((bt) => firstNamesCompatible(bt, dt))) ||
      billingTokens.some((bt) => firstNamesCompatible(bt, l.firstName));
    if (firstOk) hits.push(l.id);
  }

  const hit = pickUnique(hits);
  if (hit.id || hit.ambiguous) {
    return { learnerId: hit.id, strategy: "token_overlap_class", ambiguous: hit.ambiguous };
  }
  return { learnerId: null, strategy: null, ambiguous: false };
}

function swappedNameMatch(
  billingFullName: string,
  className: string,
  indexes: BillingMatchIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  const parts = cleanBillingDisplayName(billingFullName).split(/\s+/).filter(Boolean);
  if (parts.length !== 2) {
    return { learnerId: null, strategy: null, ambiguous: false };
  }
  const swappedKey = nameClassKey(parts[1], parts[0], className);
  const hit = pickUnique(indexes.byNameClass.get(swappedKey) || []);
  if (hit.id || hit.ambiguous) {
    return { learnerId: hit.id, strategy: "swapped_first_surname", ambiguous: hit.ambiguous };
  }
  return { learnerId: null, strategy: null, ambiguous: false };
}

export function groupBillingPlanItems(
  items: ParsedBillingPlanItem[]
): Map<string, { fullName: string; className: string; items: StoredBillingPlanItem[] }> {
  const map = new Map<
    string,
    { fullName: string; className: string; items: StoredBillingPlanItem[] }
  >();
  for (const item of items) {
    const existing = map.get(item.matchKey);
    const list = existing?.items || [];
    list.push({ feeDescription: item.feeDescription, amount: item.amount });
    map.set(item.matchKey, {
      fullName: item.fullName,
      className: item.className,
      items: list,
    });
  }
  return map;
}

export function sumPlanAmount(items: StoredBillingPlanItem[]): number {
  return items.reduce((sum, it) => sum + Number(it.amount || 0), 0);
}

export function matchBillingPlanGroupToLearner(
  row: { fullName: string; className: string },
  indexes: BillingMatchIndexes
): { learnerId: string | null; strategy: string | null; ambiguous: boolean } {
  const tryPick = (
    ids: string[],
    strategy: string
  ): { learnerId: string | null; strategy: string | null; ambiguous: boolean } | null => {
    const hit = pickUnique(ids);
    if (hit.id || hit.ambiguous) {
      return { learnerId: hit.id, strategy, ambiguous: hit.ambiguous };
    }
    return null;
  };

  const billingTokens = tokenizePersonName(row.fullName);
  const billingDigits = normId(row.fullName);

  if (billingDigits.length >= 6) {
    const hit = tryPick(indexes.byIdNumber.get(billingDigits) || [], "id_number_in_name");
    if (hit) return hit;
  }

  for (const l of indexes.learnersById.values()) {
    const idn = normId(l.idNumber);
    const adm = normId(l.admissionNo);
    if (idn.length >= 6 && billingDigits.includes(idn)) {
      const hit = tryPick([l.id], "id_number");
      if (hit) return hit;
    }
    if (adm && billingDigits.includes(adm)) {
      const hit = tryPick([l.id], "admission_no");
      if (hit) return hit;
    }
  }

  const { firstName, lastName } = billingFirstLastTokens(row.fullName);
  const cls = normClass(row.className);

  for (const key of nameClassLookupKeys(firstName, lastName, row.className)) {
    const hit = tryPick(indexes.byNameClass.get(key) || [], "name_surname_classroom");
    if (hit) return hit;
  }

  const scKey = `${normSurname(lastName)}|${cls}`;
  const scHits = (indexes.bySurnameClass.get(scKey) || []).filter((id) => {
    const l = indexes.learnersById.get(id);
    return l ? firstNamesCompatible(firstName, l.firstName) : false;
  });
  const scHit = tryPick(scHits, "surname_classroom");
  if (scHit) return scHit;

  const nameOnlyKeys = [
    `${normPersonText(lastName)}|${normPersonText(firstName)}`,
    `${normalizeMatchText(lastName)}|${normalizeMatchText(firstName)}`,
  ];
  for (const key of nameOnlyKeys) {
    const hit = tryPick(indexes.byNameOnly.get(key) || [], "surname_first_name");
    if (hit) return hit;
  }

  let hit = tokensOverlapMatch(row.fullName, row.className, indexes);
  if (hit.learnerId || hit.ambiguous) return hit;

  hit = swappedNameMatch(row.fullName, row.className, indexes);
  if (hit.learnerId || hit.ambiguous) return hit;

  if (billingTokens.length >= 2) {
    const billingLast = billingTokens[billingTokens.length - 1];
    for (const l of indexes.learnersById.values()) {
      const idn = normId(l.idNumber);
      const adm = normId(l.admissionNo);
      if (idn.length >= 6) {
        const idHit = tryPick(indexes.byIdNumber.get(idn) || [], "id_number");
        if (
          idHit &&
          (normPersonText(l.firstName) === normPersonText(firstName) ||
            surnamesCompatible(lastName, l.lastName))
        ) {
          return idHit;
        }
      }
      if (adm) {
        const admHit = tryPick(indexes.byAdmission.get(adm) || [], "admission_no");
        if (
          admHit &&
          surnamesCompatible(billingLast, l.lastName) &&
          firstNamesCompatible(firstName, l.firstName)
        ) {
          return admHit;
        }
      }
    }
  }

  return { learnerId: null, strategy: null, ambiguous: false };
}
