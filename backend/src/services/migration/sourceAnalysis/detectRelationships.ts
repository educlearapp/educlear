/**
 * Safe cross-file relationship candidates (no joins written — analysis only).
 */

import type {
  AnalysedSourceFile,
  DiscoveredSourceField,
  MappingConfidenceBand,
  RelationshipCandidate,
} from "./MigrationSourceAnalysis";

function compact(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

type KeyKind = RelationshipCandidate["keyKind"];

function classifyKey(column: string, target: string | null | undefined): KeyKind | null {
  const hay = compact(column);
  const t = String(target || "");
  if (t === "learnerNumber" || /admission|learnerno|studentnumber|pupilid|learnerid/.test(hay)) {
    return /admission/.test(hay) ? "admission_number" : "learner_number";
  }
  if (t === "idNumber" || (/idnumber|nationalid|passport/.test(hay) && !/parent|guardian/.test(hay))) {
    return "learner_sa_id";
  }
  if (t === "parentIdNumber" || /parentid|guardianid/.test(hay)) return "parent_sa_id";
  if (t === "accountNumber" || /accountno|accountnumber|accno|familycode|familyaccount/.test(hay)) {
    return /family/.test(hay) ? "family_code" : "account_number";
  }
  if (t === "classroom" || /classroom|classcode|registerclass/.test(hay)) return "classroom_code";
  return null;
}

function confidenceFor(kind: KeyKind): MappingConfidenceBand {
  switch (kind) {
    case "learner_sa_id":
    case "parent_sa_id":
    case "account_number":
      return "HIGH";
    case "learner_number":
    case "admission_number":
    case "family_code":
      return "MEDIUM";
    default:
      return "LOW";
  }
}

export function detectCrossFileRelationships(opts: {
  files: AnalysedSourceFile[];
  fields: DiscoveredSourceField[];
}): RelationshipCandidate[] {
  const byFile = new Map<string, DiscoveredSourceField[]>();
  for (const f of opts.fields) {
    const list = byFile.get(f.fileId) || [];
    list.push(f);
    byFile.set(f.fileId, list);
  }

  const keysByFile = new Map<string, Array<{ column: string; kind: KeyKind }>>();
  for (const file of opts.files) {
    const fields = byFile.get(file.fileId) || [];
    const keys: Array<{ column: string; kind: KeyKind }> = [];
    for (const field of fields) {
      const kind = classifyKey(field.sourceColumn, field.suggestedTarget || field.confirmedTarget);
      if (kind) keys.push({ column: field.sourceColumn, kind });
    }
    keysByFile.set(file.fileId, keys);
  }

  const out: RelationshipCandidate[] = [];
  for (let i = 0; i < opts.files.length; i++) {
    for (let j = i + 1; j < opts.files.length; j++) {
      const left = opts.files[i]!;
      const right = opts.files[j]!;
      const leftKeys = keysByFile.get(left.fileId) || [];
      const rightKeys = keysByFile.get(right.fileId) || [];
      for (const lk of leftKeys) {
        for (const rk of rightKeys) {
          if (lk.kind !== rk.kind) continue;
          out.push({
            leftFileId: left.fileId,
            rightFileId: right.fileId,
            leftColumn: lk.column,
            rightColumn: rk.column,
            keyKind: lk.kind,
            confidence: confidenceFor(lk.kind),
            reason: `Both files expose a ${lk.kind.replace(/_/g, " ")} column — likely join key.`,
          });
        }
      }
    }
  }
  return out;
}
