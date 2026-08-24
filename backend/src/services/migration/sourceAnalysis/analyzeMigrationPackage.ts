/**
 * Phase 1E — analyse a multi-file migration package (ZERO school writes).
 */

import { createHash, randomUUID } from "crypto";
import { detectMigrationCategory } from "../core/detectMigrationCategory";
import {
  MAPPED_CONFIDENCE_THRESHOLD,
  suggestColumnMappings,
} from "../core/suggestColumnMappings";
import { detectSourceSystemFromFiles } from "../migrationFileDetector";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import {
  MIGRATION_SOURCE_ANALYSIS_VERSION,
  type AnalyzeMigrationPackageInput,
  type AnalysedSourceFile,
  type DetectedSourceSystemId,
  type DiscoveredSourceField,
  type EntityGroupSummary,
  type MappingConfidenceBand,
  type MigrationSourceAnalysis,
  type MigrationSourceAnalysisSummary,
  type SourceEntityKind,
  type SourceFieldStatus,
} from "./MigrationSourceAnalysis";
import { detectCrossFileRelationships } from "./detectRelationships";

const FINANCE_TARGETS = new Set<string>([
  "openingBalance",
  "currentBalance",
  "feeAmount",
  "billingPlan",
  "transactionDate",
  "transactionType",
  "debit",
  "credit",
  "amount",
  "balance",
  "accountNumber",
  "accountName",
]);

const AMBIGUOUS_FINANCE_HEADERS = [
  "balance",
  "amount",
  "total",
  "owing",
  "due",
  "payment",
  "paid",
  "credit",
  "debit",
];

function compact(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function headerFingerprint(filename: string, columns: string[], worksheetName?: string): string {
  const payload = `${filename}|${worksheetName || ""}|${columns.map((c) => String(c).trim()).join("\u0001")}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 24);
}

function bandFromScore(score: number, mapped: boolean): MappingConfidenceBand {
  if (!mapped || score < 45) return "LOW";
  if (score >= MAPPED_CONFIDENCE_THRESHOLD) return "HIGH";
  return "MEDIUM";
}

function statusFromSuggestion(opts: {
  suggestedTarget: MigrationTargetField | null;
  confidence: number;
  financeAmbiguous: boolean;
  invalidHeader: boolean;
}): SourceFieldStatus {
  if (opts.invalidHeader) return "INVALID";
  if (opts.financeAmbiguous) return "CONFIRM_MAPPING";
  if (opts.suggestedTarget && opts.confidence >= MAPPED_CONFIDENCE_THRESHOLD) {
    return "AUTO_MAPPED";
  }
  if (opts.suggestedTarget && opts.confidence >= 45) return "CONFIRM_MAPPING";
  if (!opts.suggestedTarget) {
    // Preserve unknown source fields — never silent discard
    return "SOURCE_ONLY_PRESERVED";
  }
  return "UNSUPPORTED";
}

function inferType(samples: string[]): DiscoveredSourceField["inferredType"] {
  if (samples.length === 0) return "empty";
  let num = 0;
  let date = 0;
  for (const s of samples) {
    if (!s) continue;
    if (/^-?\d+(\.\d+)?$/.test(s.replace(/[\s,]/g, ""))) num += 1;
    else if (/^\d{4}-\d{2}-\d{2}/.test(s) || /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(s))
      date += 1;
  }
  if (num === samples.length) return "number";
  if (date === samples.length) return "date";
  if (num > 0 || date > 0) return "mixed";
  return "string";
}

function categoryToEntity(category: string): SourceEntityKind {
  switch (category) {
    case "learners":
      return "learners";
    case "parents":
      return "parents";
    case "billing":
      return "family_accounts";
    case "transactions":
      return "transactions_payments";
    case "staff":
      return "employees";
    case "historical":
      return "other";
    case "payment-receive-list":
      return "family_accounts";
    default:
      return "other";
  }
}

function labelForSystem(id: DetectedSourceSystemId): string {
  switch (id) {
    case "kideesys":
      return "Kid-e-Sys (detected)";
    case "sasams":
      return "SA-SAMS (detected)";
    case "generic-excel-csv":
    case "generic-csv":
    case "generic-excel":
      return "Generic spreadsheet";
    default:
      return "Unknown source — continuing with generic analysis";
  }
}

function normalizeDetectedSystem(raw: string): DetectedSourceSystemId {
  const v = String(raw || "").trim().toLowerCase();
  if (v === "kideesys") return "kideesys";
  if (v === "sasams") return "sasams";
  if (v === "generic-excel-csv") return "generic-excel-csv";
  if (v === "generic-csv") return "generic-csv";
  if (v === "generic-excel") return "generic-excel";
  return "unknown";
}

function uniqueClassrooms(sampleRows: Record<string, unknown>[], columns: string[]): number {
  const classCols = columns.filter((c) =>
    /class|classroom|register|homeroom|gradeclass/i.test(compact(c))
  );
  if (classCols.length === 0) return 0;
  const set = new Set<string>();
  for (const row of sampleRows) {
    for (const col of classCols) {
      const v = String(row[col] ?? "").trim();
      if (v) set.add(v.toLowerCase());
    }
  }
  return set.size;
}

function buildSummary(
  fields: DiscoveredSourceField[],
  files: AnalysedSourceFile[],
  entityGroups: EntityGroupSummary[],
  relationshipCount: number
): MigrationSourceAnalysisSummary {
  const byEntity = (e: SourceEntityKind) =>
    entityGroups.find((g) => g.entity === e)?.estimatedRows ?? 0;
  return {
    fileCount: files.length,
    totalRows: files.reduce((n, f) => n + f.rowCount, 0),
    totalFields: fields.length,
    autoMapped: fields.filter((f) => f.status === "AUTO_MAPPED").length,
    confirmMapping: fields.filter((f) => f.status === "CONFIRM_MAPPING").length,
    unsupported: fields.filter((f) => f.status === "UNSUPPORTED").length,
    sourceOnlyPreserved: fields.filter((f) => f.status === "SOURCE_ONLY_PRESERVED").length,
    invalid: fields.filter((f) => f.status === "INVALID").length,
    estimatedLearners: byEntity("learners"),
    estimatedParents: byEntity("parents"),
    estimatedClassrooms: byEntity("classrooms"),
    estimatedFamilyAccounts: byEntity("family_accounts"),
    relationshipCount,
  };
}

/**
 * Analyse uploaded export files as one migration package.
 * Pure / local — does not write school business data.
 */
export function analyzeMigrationPackage(input: AnalyzeMigrationPackageInput): MigrationSourceAnalysis {
  const targetSchoolId = String(input.targetSchoolId || "").trim();
  if (!targetSchoolId) {
    throw new Error("targetSchoolId is required for source analysis");
  }
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw new Error("At least one file is required for source analysis");
  }

  const filenames = input.files.map((f) => f.filename);
  const columnsByFile = new Map(
    input.files.map((f) => [f.filename, f.columns || []] as const)
  );
  const detectedRaw =
    String(input.systemIdHint || "").trim() ||
    detectSourceSystemFromFiles(filenames, columnsByFile);
  const detectedSourceSystem = normalizeDetectedSystem(detectedRaw);

  const analysedFiles: AnalysedSourceFile[] = [];
  const discoveredFields: DiscoveredSourceField[] = [];
  const entityAcc = new Map<SourceEntityKind, { fileIds: Set<string>; rows: number }>();

  for (const file of input.files) {
    const fileId = String(file.fileId || "").trim() || randomUUID();
    const filename = String(file.filename || "").trim() || "unknown.csv";
    const columns = (file.columns || []).map((c) => String(c ?? "").trim());
    const category =
      String(file.category || "").trim() || detectMigrationCategory(filename);
    const sampleRows = Array.isArray(file.sampleRows) ? file.sampleRows : [];
    const rowCount = Math.max(0, Number(file.rowCount) || sampleRows.length || 0);
    const sheetNames = Array.isArray(file.sheetNames)
      ? file.sheetNames.map(String)
      : file.worksheetName
        ? [String(file.worksheetName)]
        : [];
    const fingerprint = headerFingerprint(filename, columns, file.worksheetName);
    const sheetRole = String(file.sheetRole || "DATA").toUpperCase();
    const countsTowardEntities = sheetRole !== "SUMMARY" && sheetRole !== "SUPPORTING";

    analysedFiles.push({
      fileId,
      filename,
      category,
      rowCount,
      columnCount: columns.length,
      sheetNames,
      path: file.path,
      headerFingerprint: fingerprint,
    });

    const entity = categoryToEntity(category);
    if (countsTowardEntities) {
      const bucket = entityAcc.get(entity) || { fileIds: new Set<string>(), rows: 0 };
      bucket.fileIds.add(fileId);
      bucket.rows += rowCount;
      entityAcc.set(entity, bucket);

      if (category === "learners") {
        const classCount = uniqueClassrooms(sampleRows as Record<string, unknown>[], columns);
        if (classCount > 0) {
          const cBucket = entityAcc.get("classrooms") || {
            fileIds: new Set<string>(),
            rows: 0,
          };
          cBucket.fileIds.add(fileId);
          cBucket.rows = Math.max(cBucket.rows, classCount);
          entityAcc.set("classrooms", cBucket);
        }
      }
    }

    const suggestions = suggestColumnMappings({
      fileId,
      filename,
      category,
      columns,
      worksheetName: file.worksheetName || sheetNames[0],
      systemId:
        detectedSourceSystem === "unknown"
          ? "generic-excel-csv"
          : detectedSourceSystem === "generic-csv" || detectedSourceSystem === "generic-excel"
            ? "generic-excel-csv"
            : detectedSourceSystem,
    });

    const suggestionByCol = new Map(
      suggestions.mappings.map((m) => [m.sourceColumn, m] as const)
    );

    for (const col of columns) {
      const invalidHeader = !col;
      const sug = suggestionByCol.get(col);
      const suggestedTarget = (sug?.suggestedTarget ?? null) as MigrationTargetField | null;
      const confidenceScore = Number(sug?.confidence) || 0;
      const hay = compact(col);
      const financeAmbiguous =
        AMBIGUOUS_FINANCE_HEADERS.some((h) => hay === compact(h) || hay.includes(compact(h))) &&
        (!suggestedTarget ||
          FINANCE_TARGETS.has(suggestedTarget) ||
          confidenceScore < MAPPED_CONFIDENCE_THRESHOLD);

      let status = statusFromSuggestion({
        suggestedTarget,
        confidence: confidenceScore,
        financeAmbiguous,
        invalidHeader,
      });

      // Soften: known custom columns with no target → SOURCE_ONLY_PRESERVED (already)
      // Explicit unsupported only when we know it's unmappable medical/etc. without destination
      if (
        !suggestedTarget &&
        /medical|allergy|emergencycontact|bloodtype|religion/.test(hay)
      ) {
        status = "UNSUPPORTED";
      }

      const samples = sampleRows
        .slice(0, 5)
        .map((r) => String((r as Record<string, unknown>)[col] ?? "").trim())
        .filter(Boolean);

      const fieldKey = `${fileId}::${col}`;
      const prior = input.priorConfirmedMappings?.[fieldKey];
      const priorFp = input.priorHeaderFingerprints?.[fileId];
      const fingerprintOk = !priorFp || priorFp === fingerprint;

      let confirmedTarget: MigrationTargetField | null | undefined;
      let operatorAction: DiscoveredSourceField["operatorAction"];
      if (prior && fingerprintOk) {
        operatorAction = prior.action;
        confirmedTarget = prior.target;
        if (prior.action === "UNSUPPORTED") status = "UNSUPPORTED";
        else if (prior.action === "ACCEPT" || prior.action === "CHOOSE") {
          status = prior.target ? "AUTO_MAPPED" : "SOURCE_ONLY_PRESERVED";
        }
      } else if (prior && !fingerprintOk) {
        // Stale — return to confirmation
        status =
          suggestedTarget && confidenceScore >= MAPPED_CONFIDENCE_THRESHOLD
            ? "AUTO_MAPPED"
            : suggestedTarget
              ? "CONFIRM_MAPPING"
              : "SOURCE_ONLY_PRESERVED";
      }

      discoveredFields.push({
        fieldKey,
        fileId,
        filename,
        sheetName: sheetNames[0],
        sourceColumn: col || "(empty header)",
        sampleValues: samples,
        inferredType: inferType(samples),
        status,
        confidence: bandFromScore(confidenceScore, Boolean(suggestedTarget)),
        suggestedTarget,
        confirmedTarget,
        operatorAction: operatorAction ?? null,
        reason:
          financeAmbiguous && status === "CONFIRM_MAPPING"
            ? "Finance-like column — confirm whether this is an opening balance, payment, or other amount before import."
            : sug?.reason ||
              (status === "SOURCE_ONLY_PRESERVED"
                ? "No confident EduClear destination — preserved in analysis report."
                : status === "UNSUPPORTED"
                  ? "EduClear cannot store this field yet — reported as unsupported."
                  : "Needs operator review."),
        entityHint: entity,
        financeRequiresConfirmation: financeAmbiguous || undefined,
      });
    }
  }

  const entityGroups: EntityGroupSummary[] = [...entityAcc.entries()].map(
    ([entity, data]) => ({
      entity,
      fileIds: [...data.fileIds],
      estimatedRows: data.rows,
      reason: `Detected from file category / column signals (${entity})`,
    })
  );

  const relationshipCandidates = detectCrossFileRelationships({
    files: analysedFiles,
    fields: discoveredFields,
  });

  const stageId = input.stageId ? String(input.stageId).trim() : null;
  const migrationRunId =
    String(input.migrationRunId || "").trim() ||
    stageId ||
    `analysis_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  const now = new Date().toISOString();
  const confirmedMappings = { ...(input.priorConfirmedMappings || {}) };

  // Drop confirmations for fields no longer present or fingerprint-stale
  for (const key of Object.keys(confirmedMappings)) {
    if (!discoveredFields.some((f) => f.fieldKey === key)) {
      delete confirmedMappings[key];
    }
  }

  const summary = buildSummary(
    discoveredFields,
    analysedFiles,
    entityGroups,
    relationshipCandidates.length
  );

  return {
    analysisId: randomUUID(),
    analysisVersion: MIGRATION_SOURCE_ANALYSIS_VERSION,
    createdAt: now,
    updatedAt: now,
    migrationRunId,
    stageId,
    targetSchoolId,
    targetSchoolName: input.targetSchoolName,
    detectedSourceSystem,
    detectedSourceSystemLabel: labelForSystem(detectedSourceSystem),
    files: analysedFiles,
    discoveredFields,
    entityGroups,
    relationshipCandidates,
    summary,
    confirmedMappings,
  };
}

export function applyOperatorFieldDecision(
  analysis: MigrationSourceAnalysis,
  fieldKey: string,
  action: "ACCEPT" | "CHOOSE" | "UNSUPPORTED",
  target?: MigrationTargetField | null
): MigrationSourceAnalysis {
  const field = analysis.discoveredFields.find((f) => f.fieldKey === fieldKey);
  if (!field) {
    throw new Error("Field not found in analysis");
  }
  const nextTarget =
    action === "UNSUPPORTED"
      ? null
      : action === "ACCEPT"
        ? field.suggestedTarget
        : target ?? null;

  if (action === "CHOOSE" && !nextTarget) {
    throw new Error("Choose another field requires a target");
  }

  const updatedAt = new Date().toISOString();
  const confirmedMappings = {
    ...analysis.confirmedMappings,
    [fieldKey]: { target: nextTarget, action, updatedAt },
  };

  const discoveredFields = analysis.discoveredFields.map((f) => {
    if (f.fieldKey !== fieldKey) return f;
    let status: SourceFieldStatus = f.status;
    if (action === "UNSUPPORTED") status = "UNSUPPORTED";
    else if (nextTarget) status = "AUTO_MAPPED";
    else status = "SOURCE_ONLY_PRESERVED";
    return {
      ...f,
      status,
      confirmedTarget: nextTarget,
      operatorAction: action,
      confidence: nextTarget ? ("HIGH" as const) : f.confidence,
    };
  });

  const summary = buildSummary(
    discoveredFields,
    analysis.files,
    analysis.entityGroups,
    analysis.relationshipCandidates.length
  );

  return {
    ...analysis,
    updatedAt,
    discoveredFields,
    confirmedMappings,
    summary,
  };
}
