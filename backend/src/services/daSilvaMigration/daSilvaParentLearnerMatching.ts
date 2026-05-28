import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import { normalizeMatchText } from "../../utils/kideesysSpreadsheet";
import { normalizeSaPhone } from "../parentPortalService";
import type { SasamsParsedParent } from "./sasamsParsers";

export type DbLearnerForParentMatch = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  admissionNo: string | null;
  idNumber: string | null;
};

export type ParentLearnerMatchResult = {
  learnerId: string | null;
  strategy: string | null;
  ambiguous: boolean;
  candidateIds: string[];
};

export type ParentMatchAuditRow = {
  parentFirstName: string;
  parentSurname: string;
  learnerAdmissionNo: string | null;
  learnerIdNumber: string | null;
  learnerName: string | null;
  learnerClassName: string | null;
  matched: boolean;
  strategy: string | null;
  ambiguous: boolean;
  archived: boolean;
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

function nameOnlyKey(firstName: string, lastName: string): string {
  return `${normName(lastName)}|${normName(firstName)}`;
}

export function buildLearnerMatchIndexes(learners: DbLearnerForParentMatch[]): {
  byAdmission: Map<string, string[]>;
  byIdNumber: Map<string, string[]>;
  byNameClass: Map<string, string[]>;
  byNameOnly: Map<string, string[]>;
} {
  const byAdmission = new Map<string, string[]>();
  const byIdNumber = new Map<string, string[]>();
  const byNameClass = new Map<string, string[]>();
  const byNameOnly = new Map<string, string[]>();

  for (const l of learners) {
    const adm = normId(l.admissionNo);
    if (adm) {
      const list = byAdmission.get(adm) || [];
      list.push(l.id);
      byAdmission.set(adm, list);
    }
    const idn = normId(l.idNumber);
    if (idn.length >= 6) {
      const list = byIdNumber.get(idn) || [];
      list.push(l.id);
      byIdNumber.set(idn, list);
    }
    const key = `${normName(l.firstName)}|${normName(l.lastName)}|${normClass(l.className)}`;
    const list = byNameClass.get(key) || [];
    list.push(l.id);
    byNameClass.set(key, list);

    const nameKey = nameOnlyKey(l.firstName, l.lastName);
    const nameList = byNameOnly.get(nameKey) || [];
    nameList.push(l.id);
    byNameOnly.set(nameKey, nameList);
  }
  return { byAdmission, byIdNumber, byNameClass, byNameOnly };
}

function pickUnique(candidates: string[]): { id: string | null; ambiguous: boolean } {
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { id: unique[0], ambiguous: false };
  if (unique.length === 0) return { id: null, ambiguous: false };
  return { id: null, ambiguous: true };
}

export function matchParentToLearner(
  parent: SasamsParsedParent,
  indexes: ReturnType<typeof buildLearnerMatchIndexes>,
  learnersById: Map<string, DbLearnerForParentMatch>
): ParentLearnerMatchResult {
  const strategies: Array<{ name: string; ids: string[] }> = [];

  const lid = normId(parent.learnerIdNumber);
  if (lid.length >= 6) {
    strategies.push({ name: "learner_id_number", ids: indexes.byIdNumber.get(lid) || [] });
  }

  const adm = normId(parent.learnerAdmissionNo);
  if (adm) {
    strategies.push({ name: "learner_admission_no", ids: indexes.byAdmission.get(adm) || [] });
  }

  if (parent.learnerFirstName && parent.learnerLastName && parent.learnerClassName) {
    const key = `${normName(parent.learnerFirstName)}|${normName(parent.learnerLastName)}|${normClass(parent.learnerClassName)}`;
    strategies.push({ name: "learner_name_class", ids: indexes.byNameClass.get(key) || [] });
  }

  if (parent.learnerFirstName && parent.learnerLastName) {
    const nameKey = nameOnlyKey(parent.learnerFirstName, parent.learnerLastName);
    strategies.push({ name: "learner_surname_first_name", ids: indexes.byNameOnly.get(nameKey) || [] });
  }

  const parentPhone = normId(parent.cellNo || parent.homeNo);
  if (parentPhone.length >= 9 && parent.learnerFirstName && parent.learnerLastName) {
    const phoneHits: string[] = [];
    for (const learner of learnersById.values()) {
      if (
        normName(learner.firstName) === normName(parent.learnerFirstName) &&
        normName(learner.lastName) === normName(parent.learnerLastName)
      ) {
        phoneHits.push(learner.id);
      }
    }
    if (phoneHits.length) {
      strategies.push({ name: "parent_phone_with_learner_name", ids: phoneHits });
    }
  }

  for (const s of strategies) {
    const { id, ambiguous } = pickUnique(s.ids);
    if (id) {
      return { learnerId: id, strategy: s.name, ambiguous: false, candidateIds: s.ids };
    }
    if (ambiguous) {
      return { learnerId: null, strategy: s.name, ambiguous: true, candidateIds: s.ids };
    }
  }

  return { learnerId: null, strategy: null, ambiguous: false, candidateIds: [] };
}

export function auditParentMatches(
  parents: SasamsParsedParent[],
  learners: DbLearnerForParentMatch[]
): {
  rows: ParentMatchAuditRow[];
  unmatchedParents: ParentMatchAuditRow[];
  duplicateMatches: ParentMatchAuditRow[];
} {
  const indexes = buildLearnerMatchIndexes(learners);
  const learnersById = new Map(learners.map((l) => [l.id, l]));
  const rows: ParentMatchAuditRow[] = [];
  const unmatchedParents: ParentMatchAuditRow[] = [];
  const duplicateMatches: ParentMatchAuditRow[] = [];

  for (const parent of parents) {
    const match = matchParentToLearner(parent, indexes, learnersById);
    const row: ParentMatchAuditRow = {
      parentFirstName: parent.firstName,
      parentSurname: parent.surname,
      learnerAdmissionNo: parent.learnerAdmissionNo,
      learnerIdNumber: parent.learnerIdNumber,
      learnerName:
        parent.learnerFirstName && parent.learnerLastName
          ? `${parent.learnerFirstName} ${parent.learnerLastName}`
          : null,
      learnerClassName: parent.learnerClassName,
      matched: Boolean(match.learnerId),
      strategy: match.strategy,
      ambiguous: match.ambiguous,
      archived: parent.archived,
    };
    rows.push(row);
    if (!match.learnerId) unmatchedParents.push(row);
    if (match.ambiguous) duplicateMatches.push(row);
  }

  return { rows, unmatchedParents, duplicateMatches };
}
