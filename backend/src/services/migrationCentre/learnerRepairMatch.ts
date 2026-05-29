import type { DbLearnerForParentMatch } from "../daSilvaMigration/daSilvaParentLearnerMatching";
import type { SasamsParsedLearner } from "../daSilvaMigration/sasamsParsers";
import {
  explainLearnerRepairRejection,
  firstNamesCompatible,
  LEARNER_REPAIR_FUZZY_MIN_RATIO,
  learnerNameSimilarityRatio,
  learnerRelaxedRepairSimilarity,
  normLearnerCompactName,
  normLearnerFullName,
  normLearnerFullNameFromString,
  normLearnerId,
  normLearnerPersonText,
  normLearnerRepairClass,
  normLearnerSurname,
  parseLearnerRepairName,
  similarityPercent,
} from "./learnerRepairNormalization";

export type LearnerRepairMatchResult = {
  learnerId: string | null;
  strategy: string | null;
  ambiguous: boolean;
};

export type LearnerRepairNoMatchDiagnostic = {
  closestLearnerId: string | null;
  closestLearnerName: string;
  similarityPercent: number;
  rejectionReason: string;
};

export type LearnerRepairMatchIndexes = {
  byAdmission: Map<string, string[]>;
  byIdNumber: Map<string, string[]>;
  byFullNameClass: Map<string, string[]>;
  byNameClass: Map<string, string[]>;
  byFullName: Map<string, string[]>;
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

function pickUnique(candidates: string[]): { id: string | null; ambiguous: boolean } {
  const unique = [...new Set(candidates)];
  if (unique.length === 1) return { id: unique[0], ambiguous: false };
  if (unique.length === 0) return { id: null, ambiguous: false };
  return { id: null, ambiguous: true };
}

function importedClassKey(imported: SasamsParsedLearner): string {
  return normLearnerRepairClass(
    imported.canonicalClassName || imported.className,
    imported.grade || null
  );
}

function importedNames(imported: SasamsParsedLearner): {
  firstName: string;
  lastName: string;
  fullName: string;
  fullNameCompact: string;
} {
  const firstName = normLearnerPersonText(imported.firstName);
  const lastName = normLearnerPersonText(imported.lastName);
  const fullName = imported.fullName
    ? normLearnerFullNameFromString(imported.fullName)
    : normLearnerFullName(imported.firstName, imported.lastName);
  const fullNameCompact = normLearnerCompactName(
    imported.fullName || `${imported.firstName} ${imported.lastName}`.trim()
  );
  return { firstName, lastName, fullName, fullNameCompact };
}

function dbFullName(learner: DbLearnerForParentMatch): string {
  return normLearnerFullName(learner.firstName, learner.lastName);
}

function dbFullNameCompact(learner: DbLearnerForParentMatch): string {
  return normLearnerCompactName(`${learner.firstName} ${learner.lastName}`.trim());
}

export function buildLearnerRepairIndexes(
  learners: DbLearnerForParentMatch[]
): LearnerRepairMatchIndexes {
  const byAdmission = new Map<string, string[]>();
  const byIdNumber = new Map<string, string[]>();
  const byFullNameClass = new Map<string, string[]>();
  const byNameClass = new Map<string, string[]>();
  const byFullName = new Map<string, string[]>();
  const byNameOnly = new Map<string, string[]>();
  const bySurnameClass = new Map<string, string[]>();
  const learnersById = new Map<string, DbLearnerForParentMatch>();

  for (const l of learners) {
    learnersById.set(l.id, l);

    const adm = normLearnerId(l.admissionNo);
    if (adm) pushIndex(byAdmission, adm, l.id);

    const idn = normLearnerId(l.idNumber);
    if (idn.length >= 6) pushIndex(byIdNumber, idn, l.id);

    const fn = normLearnerPersonText(l.firstName);
    const ln = normLearnerPersonText(l.lastName);
    const sn = normLearnerSurname(l.lastName);
    const cls = normLearnerRepairClass(l.className);
    const full = dbFullName(l);
    const fullCompact = dbFullNameCompact(l);

    if (cls) {
      pushIndex(byFullNameClass, `${full}|${cls}`, l.id);
      pushIndex(byFullNameClass, `${fullCompact}|${cls}`, l.id);
      pushIndex(byNameClass, `${fn}|${ln}|${cls}`, l.id);
      pushIndex(byNameClass, `${fn}|${sn}|${cls}`, l.id);
      pushIndex(bySurnameClass, `${sn}|${cls}`, l.id);
    }

    pushIndex(byFullName, full, l.id);
    pushIndex(byFullName, fullCompact, l.id);
    pushIndex(byNameOnly, `${ln}|${fn}`, l.id);
    pushIndex(byNameOnly, `${sn}|${fn}`, l.id);
  }

  return {
    byAdmission,
    byIdNumber,
    byFullNameClass,
    byNameClass,
    byFullName,
    byNameOnly,
    bySurnameClass,
    learnersById,
  };
}

function fuzzyNameMatch(
  imported: SasamsParsedLearner,
  indexes: LearnerRepairMatchIndexes
): LearnerRepairMatchResult | null {
  const names = importedNames(imported);
  if (!names.fullNameCompact && !names.firstName) return null;

  const cls = importedClassKey(imported);
  const importLabel = imported.fullName || `${imported.firstName} ${imported.lastName}`.trim();
  const hits: string[] = [];

  for (const l of indexes.learnersById.values()) {
    if (cls && normLearnerRepairClass(l.className) !== cls) continue;

    const dbLabel = `${l.firstName} ${l.lastName}`.trim();
    const ratio = Math.max(
      learnerNameSimilarityRatio(importLabel, dbLabel),
      learnerNameSimilarityRatio(names.fullNameCompact, dbFullNameCompact(l)),
      names.firstName && names.lastName
        ? learnerNameSimilarityRatio(
            `${names.firstName} ${names.lastName}`,
            dbLabel
          )
        : 0
    );

    if (ratio >= LEARNER_REPAIR_FUZZY_MIN_RATIO) hits.push(l.id);
  }

  const hit = pickUnique(hits);
  if (hit.id || hit.ambiguous) {
    return { learnerId: hit.id, strategy: "fuzzy_name", ambiguous: hit.ambiguous };
  }
  return null;
}

function partialRelaxedNameMatch(
  imported: SasamsParsedLearner,
  indexes: LearnerRepairMatchIndexes
): LearnerRepairMatchResult | null {
  const names = importedNames(imported);
  if (!names.fullNameCompact && !names.firstName) return null;

  const cls = importedClassKey(imported);
  const importLabel = imported.fullName || `${imported.firstName} ${imported.lastName}`.trim();
  const importParts = parseLearnerRepairName(
    imported.firstName,
    imported.lastName,
    imported.fullName
  );
  const hits: string[] = [];

  for (const l of indexes.learnersById.values()) {
    if (cls && normLearnerRepairClass(l.className) !== cls) continue;

    const dbLabel = `${l.firstName} ${l.lastName}`.trim();
    const dbParts = parseLearnerRepairName(l.firstName, l.lastName, dbLabel);
    const ratio = learnerRelaxedRepairSimilarity(importParts, dbParts, importLabel, dbLabel);

    if (ratio >= LEARNER_REPAIR_FUZZY_MIN_RATIO) hits.push(l.id);
  }

  const hit = pickUnique(hits);
  if (hit.id || hit.ambiguous) {
    return { learnerId: hit.id, strategy: "relaxed_name", ambiguous: hit.ambiguous };
  }
  return null;
}

/**
 * Closest live learner for preview when no auto-match (diagnostics only).
 */
export function diagnoseLearnerRepairNoMatch(
  imported: SasamsParsedLearner,
  indexes: LearnerRepairMatchIndexes
): LearnerRepairNoMatchDiagnostic {
  const importLabel = imported.fullName || `${imported.firstName} ${imported.lastName}`.trim();
  const importParts = parseLearnerRepairName(
    imported.firstName,
    imported.lastName,
    imported.fullName
  );
  const cls = importedClassKey(imported);

  let bestId: string | null = null;
  let bestName = "";
  let bestRatio = 0;
  let bestClassMismatch = false;
  const tiedIds: string[] = [];

  for (const l of indexes.learnersById.values()) {
    const dbLabel = `${l.firstName} ${l.lastName}`.trim();
    const dbParts = parseLearnerRepairName(l.firstName, l.lastName, dbLabel);
    const ratio = learnerRelaxedRepairSimilarity(importParts, dbParts, importLabel, dbLabel);
    const classMismatch = Boolean(cls && normLearnerRepairClass(l.className) !== cls);

    if (ratio > bestRatio) {
      bestRatio = ratio;
      bestId = l.id;
      bestName = dbLabel;
      bestClassMismatch = classMismatch;
      tiedIds.length = 0;
      tiedIds.push(l.id);
    } else if (ratio === bestRatio && ratio > 0) {
      tiedIds.push(l.id);
    }
  }

  const ambiguous =
    tiedIds.length > 1 &&
    bestRatio >= LEARNER_REPAIR_FUZZY_MIN_RATIO;
  const closest = bestId ? indexes.learnersById.get(bestId) : null;
  const dbParts = closest
    ? parseLearnerRepairName(closest.firstName, closest.lastName, bestName)
    : importParts;

  const rejectionReason = closest
    ? explainLearnerRepairRejection({
        similarity: bestRatio,
        ambiguous,
        classMismatch: bestClassMismatch,
        importParts,
        dbParts,
      })
    : "no live learners to compare";

  return {
    closestLearnerId: bestId,
    closestLearnerName: bestName,
    similarityPercent: similarityPercent(bestRatio),
    rejectionReason,
  };
}

/**
 * Match priority:
 * 1 SA ID → 2 admission → 3 full name + class → 4 first + surname + class
 * → 5 full name → 6 first + surname → 7 surname + class → 8 fuzzy (90%+)
 * → 9 relaxed partial (90%+, middle ignored / compound surname / reorder)
 */
export function matchImportedLearnerToLive(
  imported: SasamsParsedLearner,
  indexes: LearnerRepairMatchIndexes
): LearnerRepairMatchResult {
  const tryPick = (
    ids: string[],
    strategy: string
  ): LearnerRepairMatchResult | null => {
    const hit = pickUnique(ids);
    if (hit.id || hit.ambiguous) {
      return { learnerId: hit.id, strategy, ambiguous: hit.ambiguous };
    }
    return null;
  };

  const idn = normLearnerId(imported.idNumber);
  if (idn.length >= 6) {
    const hit = tryPick(indexes.byIdNumber.get(idn) || [], "id_number");
    if (hit) return hit;
  }

  const adm = normLearnerId(imported.admissionNo || imported.sasamsLearnerNo);
  if (adm) {
    const hit = tryPick(indexes.byAdmission.get(adm) || [], "admission_number");
    if (hit) return hit;
  }

  const names = importedNames(imported);
  const cls = importedClassKey(imported);
  const sn = normLearnerSurname(imported.lastName);

  if (names.fullName && cls) {
    for (const key of [names.fullName, names.fullNameCompact]) {
      const hit = tryPick(indexes.byFullNameClass.get(`${key}|${cls}`) || [], "full_name_classroom");
      if (hit) return hit;
    }
  }

  if (names.firstName && names.lastName && cls) {
    for (const ln of [names.lastName, sn]) {
      const hit = tryPick(
        indexes.byNameClass.get(`${names.firstName}|${ln}|${cls}`) || [],
        "name_surname_classroom"
      );
      if (hit) return hit;
    }
  }

  if (names.fullName) {
    for (const key of [names.fullName, names.fullNameCompact]) {
      const hit = tryPick(indexes.byFullName.get(key) || [], "full_name");
      if (hit) return hit;
    }
  }

  if (names.firstName && names.lastName) {
    for (const ln of [names.lastName, sn]) {
      const hit = tryPick(indexes.byNameOnly.get(`${ln}|${names.firstName}`) || [], "name_surname");
      if (hit) return hit;
    }
  }

  if (sn && cls) {
    const scHits = (indexes.bySurnameClass.get(`${sn}|${cls}`) || []).filter((id) => {
      const l = indexes.learnersById.get(id);
      return l ? firstNamesCompatible(imported.firstName, l.firstName) : false;
    });
    const scHit = tryPick(scHits, "surname_classroom");
    if (scHit) return scHit;
  }

  const fuzzy = fuzzyNameMatch(imported, indexes);
  if (fuzzy) return fuzzy;

  const relaxed = partialRelaxedNameMatch(imported, indexes);
  if (relaxed) return relaxed;

  return { learnerId: null, strategy: null, ambiguous: false };
}
