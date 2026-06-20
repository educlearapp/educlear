import { prisma } from "../../../prisma";
import type { MigrationImportReportRow } from "../types/MigrationApply";
import type {
  MigrationParentReconciliationParent,
  MigrationParentReconciliationSuggestion,
  MigrationParentReconciliationSummary,
} from "../types/MigrationReconciliation";

export type ParentForReconciliation = {
  id: string;
  firstName: string;
  surname: string;
  relationship: string | null;
  cellNo: string;
  email: string | null;
  links: {
    learner: {
      firstName: string;
      lastName: string;
    };
  }[];
};

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePhone(value: unknown): string {
  return cleanString(value).replace(/\D/g, "");
}

function normalizeEmail(value: unknown): string {
  return cleanString(value).toLowerCase();
}

function normalizeRelationship(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/\s+/g, " ") || "parent";
}

function normalizeNamePart(value: unknown): string {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fullName(parent: ParentForReconciliation): string {
  return [parent.firstName, parent.surname].map(cleanString).filter(Boolean).join(" ");
}

function namesAreSimilar(a: ParentForReconciliation, b: ParentForReconciliation): boolean {
  const aFirst = normalizeNamePart(a.firstName);
  const bFirst = normalizeNamePart(b.firstName);
  const aSurname = normalizeNamePart(a.surname);
  const bSurname = normalizeNamePart(b.surname);

  if (!aFirst || !bFirst || !aSurname || !bSurname) return false;
  if (aFirst === bFirst && aSurname === bSurname) return true;
  if (aSurname !== bSurname) return false;
  return aFirst[0] === bFirst[0];
}

function toReconciliationParent(
  parent: ParentForReconciliation
): MigrationParentReconciliationParent {
  return {
    parentId: parent.id,
    name: fullName(parent) || "Parent Guardian",
    relationship: cleanString(parent.relationship) || null,
    cellphone: cleanString(parent.cellNo) || null,
    email: cleanString(parent.email) || null,
    learnerNames: parent.links
      .map((link) =>
        [link.learner.firstName, link.learner.lastName].map(cleanString).filter(Boolean).join(" ")
      )
      .filter(Boolean),
  };
}

function suggestionSignals(
  a: ParentForReconciliation,
  b: ParentForReconciliation
): MigrationParentReconciliationSuggestion["matchSignals"] {
  const signals: MigrationParentReconciliationSuggestion["matchSignals"] = [];
  const samePhone = normalizePhone(a.cellNo) && normalizePhone(a.cellNo) === normalizePhone(b.cellNo);
  const sameEmail =
    normalizeEmail(a.email) && normalizeEmail(a.email) === normalizeEmail(b.email);
  const sameRelationship =
    normalizeRelationship(a.relationship) === normalizeRelationship(b.relationship);
  const similarNames = namesAreSimilar(a, b);

  if (samePhone) signals.push("same_cellphone");
  if (sameEmail) signals.push("same_email");
  if (sameRelationship) signals.push("same_relationship");
  if (similarNames) signals.push("similar_names");

  return signals;
}

function shouldSuggestMerge(
  signals: MigrationParentReconciliationSuggestion["matchSignals"]
): boolean {
  return (
    signals.includes("same_relationship") &&
    signals.includes("similar_names") &&
    (signals.includes("same_cellphone") || signals.includes("same_email"))
  );
}

function confidenceForSignals(
  signals: MigrationParentReconciliationSuggestion["matchSignals"]
): MigrationParentReconciliationSuggestion["confidence"] {
  return signals.includes("same_cellphone") && signals.includes("same_email")
    ? "high"
    : "medium";
}

export async function buildParentReconciliationCentre(input: {
  targetSchoolId: string;
  reportRows: MigrationImportReportRow[];
}): Promise<MigrationParentReconciliationSummary> {
  const batchParentIds = new Set(
    input.reportRows
      .filter((row) => row.entityType === "parent" && cleanString(row.recordId))
      .map((row) => cleanString(row.recordId))
  );

  if (batchParentIds.size === 0) {
    return {
      totalSuggestedMerges: 0,
      suggestions: [],
      note:
        "No imported parent records were available for duplicate reconciliation suggestions.",
    };
  }

  const parents = await prisma.parent.findMany({
    where: { schoolId: input.targetSchoolId },
    select: {
      id: true,
      firstName: true,
      surname: true,
      relationship: true,
      cellNo: true,
      email: true,
      links: {
        select: {
          learner: {
            select: {
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    },
    orderBy: [{ surname: "asc" }, { firstName: "asc" }, { id: "asc" }],
  });

  const suggestions = buildParentReconciliationSuggestionsForParents({
    parents,
    batchParentIds,
  });

  return {
    totalSuggestedMerges: suggestions.length,
    suggestions,
    note:
      "Parent Reconciliation Centre suggests likely duplicate parents after migration; schools must choose whether to merge or ignore each suggestion.",
  };
}

export function buildParentReconciliationSuggestionsForParents(input: {
  parents: ParentForReconciliation[];
  batchParentIds: Set<string>;
}): MigrationParentReconciliationSuggestion[] {
  const suggestions: MigrationParentReconciliationSuggestion[] = [];
  const seenPairs = new Set<string>();

  for (let i = 0; i < input.parents.length; i++) {
    for (let j = i + 1; j < input.parents.length; j++) {
      const a = input.parents[i];
      const b = input.parents[j];
      if (!input.batchParentIds.has(a.id) && !input.batchParentIds.has(b.id)) continue;

      const signals = suggestionSignals(a, b);
      if (!shouldSuggestMerge(signals)) continue;

      const pairKey = [a.id, b.id].sort().join("|");
      if (seenPairs.has(pairKey)) continue;
      seenPairs.add(pairKey);

      suggestions.push({
        suggestionId: `parent-merge:${pairKey}`,
        status: "suggested",
        confidence: confidenceForSignals(signals),
        matchSignals: signals,
        primaryParent: toReconciliationParent(a),
        duplicateParent: toReconciliationParent(b),
        action: "review_merge_or_ignore",
        note:
          "Suggested only. Migration imported both parent records because duplicate identity was not proven during import.",
      });
    }
  }

  return suggestions;
}
