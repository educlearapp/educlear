import { readMigrationFileRows } from "./readMigrationFileRows";
import type { MigrationFile } from "../types/MigrationFile";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";
import type { MigrationTargetField } from "../types/MigrationTargetField";
import type {
  KidESysCrossValidationWarning,
  KidESysMigrationReadinessResult,
  KidESysReadinessCategory,
  KidESysReadinessCategoryKey,
} from "../types/MigrationKidESysReadiness";

export type BuildKidESysMigrationReadinessInput = {
  uploadedFiles?: MigrationFile[];
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  /** When true, cross-validation reads every row from staged paths (still no DB writes). */
  fullFileChecks?: boolean;
  filePaths?: Record<string, string>;
};

const CATEGORY_DEFS: {
  key: KidESysReadinessCategoryKey;
  label: string;
  required: boolean;
  entityLabel?: string;
}[] = [
  { key: "learners", label: "Learners", required: true, entityLabel: "learners" },
  { key: "parents", label: "Parents", required: true, entityLabel: "parents" },
  { key: "billing", label: "Billing", required: false },
  { key: "transactions", label: "Transactions", required: false },
  { key: "staff", label: "Staff", required: false, entityLabel: "staff" },
];

function cellString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function isNumericValue(value: unknown): boolean {
  const s = cellString(value);
  if (!s) return true;
  const normalized = s.replace(/[\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
  if (normalized === "-" || normalized === "+") return false;
  const n = Number(normalized);
  return Number.isFinite(n);
}

function buildTargetToSource(
  mappings: MigrationFileColumnMappings["mappings"]
): Map<MigrationTargetField, string> {
  const map = new Map<MigrationTargetField, string>();
  for (const m of mappings) {
    const target = String(m.targetField || "").trim() as MigrationTargetField;
    const source = String(m.sourceColumn || "").trim();
    if (target && source) map.set(target, source);
  }
  return map;
}

function getMappedValue(
  row: Record<string, unknown>,
  targetToSource: Map<MigrationTargetField, string>,
  field: MigrationTargetField
): unknown {
  const source = targetToSource.get(field);
  if (!source) return undefined;
  return row[source];
}

function learnerDisplayName(
  row: Record<string, unknown>,
  targetToSource: Map<MigrationTargetField, string>
): string {
  const full = cellString(getMappedValue(row, targetToSource, "fullName"));
  if (full) return full.toLowerCase();
  const first = cellString(getMappedValue(row, targetToSource, "firstName"));
  const last = cellString(getMappedValue(row, targetToSource, "lastName"));
  return `${first} ${last}`.trim().toLowerCase();
}

function learnerClassroom(
  row: Record<string, unknown>,
  targetToSource: Map<MigrationTargetField, string>
): string {
  const classroom = cellString(getMappedValue(row, targetToSource, "classroom"));
  if (classroom) return classroom.toLowerCase();
  return cellString(getMappedValue(row, targetToSource, "grade")).toLowerCase();
}

function parentContactKey(
  row: Record<string, unknown>,
  targetToSource: Map<MigrationTargetField, string>
): string {
  const name = cellString(getMappedValue(row, targetToSource, "parentName")).toLowerCase();
  const phone = cellString(getMappedValue(row, targetToSource, "parentPhone")).replace(/\D/g, "");
  const email = cellString(getMappedValue(row, targetToSource, "parentEmail")).toLowerCase();
  if (phone || email) return `${name}|${phone}|${email}`;
  return name;
}

function formatCount(n: number): string {
  return n.toLocaleString("en-ZA");
}

function buildDetailLine(
  def: (typeof CATEGORY_DEFS)[number],
  fileCount: number,
  rowCount: number,
  entityCount?: number
): string {
  const parts: string[] = [];
  if (fileCount > 0) {
    parts.push(`${fileCount} file${fileCount === 1 ? "" : "s"}`);
  }
  if (def.entityLabel && entityCount != null && entityCount > 0) {
    parts.push(`${formatCount(entityCount)} ${def.entityLabel}`);
  } else if (rowCount > 0 && def.key === "transactions") {
    parts.push(`${formatCount(rowCount)} rows`);
  } else if (rowCount > 0 && !def.entityLabel) {
    parts.push(`${formatCount(rowCount)} rows`);
  }
  return parts.join(" / ") || (def.required ? "Missing" : "Not uploaded");
}

function buildCategoryRows(
  previews: MigrationFilePreview[],
  uploadedFiles: MigrationFile[]
): KidESysReadinessCategory[] {
  const categoriesPresent = new Set<string>();
  for (const f of uploadedFiles) {
    if (f.category && f.category !== "unknown") categoriesPresent.add(f.category);
  }
  for (const p of previews) {
    if (p.category && p.category !== "unknown") categoriesPresent.add(p.category);
  }

  return CATEGORY_DEFS.map((def) => {
    const filePreviews = previews.filter((p) => p.category === def.key);
    const uploadCount = uploadedFiles.filter((f) => f.category === def.key).length;
    const fileCount = Math.max(filePreviews.length, uploadCount);
    const rowCount = filePreviews.reduce((sum, p) => sum + (Number(p.rowCount) || 0), 0);
    const found = categoriesPresent.has(def.key) && fileCount > 0;
    const entityCount = def.entityLabel ? rowCount : undefined;

    let statusBadge: KidESysReadinessCategory["statusBadge"] = "optional";
    if (def.required) {
      statusBadge = found ? "ready" : "missing";
    } else if (found) {
      statusBadge = "ready";
    }

    return {
      key: def.key,
      label: def.label,
      required: def.required,
      status: found ? "found" : "missing",
      fileCount,
      rowCount,
      ...(def.entityLabel ? { entityLabel: def.entityLabel, entityCount } : {}),
      statusBadge,
      detailLine: buildDetailLine(def, fileCount, rowCount, entityCount),
    };
  });
}

function findDuplicateKeys(
  keys: { key: string; label: string }[]
): { key: string; count: number; label: string }[] {
  const byKey = new Map<string, { count: number; label: string }>();
  for (const entry of keys) {
    if (!entry.key) continue;
    const existing = byKey.get(entry.key);
    if (existing) {
      existing.count += 1;
    } else {
      byKey.set(entry.key, { count: 1, label: entry.label });
    }
  }
  const dupes: { key: string; count: number; label: string }[] = [];
  for (const [key, meta] of byKey) {
    if (meta.count > 1) dupes.push({ key, count: meta.count, label: meta.label });
  }
  return dupes;
}

async function loadRowsForPreview(
  preview: MigrationFilePreview,
  filePaths: Record<string, string>,
  fullFileChecks: boolean
): Promise<Record<string, unknown>[]> {
  if (!fullFileChecks) {
    return preview.sampleRows ?? [];
  }
  const path =
    String(preview.path || "").trim() ||
    String(filePaths[preview.fileId] || "").trim();
  if (!path) {
    return preview.sampleRows ?? [];
  }
  const file: MigrationFile = {
    id: preview.fileId,
    filename: preview.filename,
    mimeType: "application/octet-stream",
    size: 0,
    uploadedAt: new Date(),
    category: preview.category as MigrationFile["category"],
    path,
  };
  const full = await readMigrationFileRows(file);
  return full.rows;
}

async function runCrossValidation(input: BuildKidESysMigrationReadinessInput): Promise<{
  warnings: KidESysCrossValidationWarning[];
  scope: "preview_sample" | "full_file";
}> {
  const previews = Array.isArray(input.previews) ? input.previews : [];
  const mappingsList = Array.isArray(input.mappings) ? input.mappings : [];
  const filePaths = input.filePaths ?? {};
  const fullFileChecks = Boolean(input.fullFileChecks);
  const mappingsByFile = new Map(
    mappingsList.map((m) => [String(m.fileId || "").trim(), m])
  );

  const warnings: KidESysCrossValidationWarning[] = [];
  const scope: "preview_sample" | "full_file" = fullFileChecks ? "full_file" : "preview_sample";

  for (const preview of previews) {
    const category = String(preview.category || "");
    const fileMappings = mappingsByFile.get(preview.fileId);
    const targetToSource = buildTargetToSource(fileMappings?.mappings ?? []);
    const rows = await loadRowsForPreview(preview, filePaths, fullFileChecks);

    if (category === "learners") {
      const keys = rows.map((row) => {
        const name = learnerDisplayName(row, targetToSource);
        const classroom = learnerClassroom(row, targetToSource);
        const key = name && classroom ? `${name}@@${classroom}` : name || classroom;
        const label = [cellString(getMappedValue(row, targetToSource, "fullName")), classroom]
          .filter(Boolean)
          .join(" · ");
        return { key, label: label || key };
      });
      const dupes = findDuplicateKeys(keys);
      if (dupes.length > 0) {
        const totalDupRows = dupes.reduce((s, d) => s + d.count, 0);
        warnings.push({
          checkId: "learner_duplicate_name_classroom",
          category: "learners",
          message: `Duplicate learners by name + classroom (${scope === "full_file" ? "full file" : "preview sample"})`,
          count: totalDupRows,
          samples: dupes.slice(0, 5).map((d) => d.label || d.key),
        });
      }
    }

    if (category === "parents") {
      const keys = rows.map((row) => {
        const key = parentContactKey(row, targetToSource);
        const label = cellString(getMappedValue(row, targetToSource, "parentName")) || key;
        return { key, label };
      });
      const dupes = findDuplicateKeys(keys);
      if (dupes.length > 0) {
        const totalDupRows = dupes.reduce((s, d) => s + d.count, 0);
        warnings.push({
          checkId: "parent_duplicate_contacts",
          category: "parents",
          message: `Duplicate parent contacts (${scope === "full_file" ? "full file" : "preview sample"})`,
          count: totalDupRows,
          samples: dupes.slice(0, 5).map((d) => d.label || d.key),
        });
      }
    }

    if (category === "billing" && targetToSource.has("accountNumber")) {
      let missing = 0;
      const samples: string[] = [];
      for (const row of rows) {
        const acc = cellString(getMappedValue(row, targetToSource, "accountNumber"));
        if (!acc) {
          missing += 1;
          if (samples.length < 5) {
            const name = cellString(getMappedValue(row, targetToSource, "accountName"));
            samples.push(name || "(no account number)");
          }
        }
      }
      if (missing > 0) {
        warnings.push({
          checkId: "billing_missing_account_number",
          category: "billing",
          message: "Billing rows with missing account numbers",
          count: missing,
          samples,
        });
      }
    }

    if (category === "transactions") {
      let missingAccount = 0;
      let invalidAmount = 0;
      const accountSamples: string[] = [];
      const amountSamples: string[] = [];
      const hasAccountMapping = targetToSource.has("accountNumber");
      const amountFields: MigrationTargetField[] = ["amount", "debit", "credit"];

      for (const row of rows) {
        if (hasAccountMapping) {
          const acc = cellString(getMappedValue(row, targetToSource, "accountNumber"));
          if (!acc) {
            missingAccount += 1;
            if (accountSamples.length < 5) {
              accountSamples.push(
                cellString(getMappedValue(row, targetToSource, "reference")) || "(no account ref)"
              );
            }
          }
        }
        for (const field of amountFields) {
          if (!targetToSource.has(field)) continue;
          const raw = getMappedValue(row, targetToSource, field);
          const s = cellString(raw);
          if (s && !isNumericValue(raw)) {
            invalidAmount += 1;
            if (amountSamples.length < 5) amountSamples.push(s);
            break;
          }
        }
      }

      if (missingAccount > 0) {
        warnings.push({
          checkId: "transaction_missing_account_reference",
          category: "transactions",
          message: "Transaction rows with missing account references",
          count: missingAccount,
          samples: accountSamples,
        });
      }
      if (invalidAmount > 0) {
        warnings.push({
          checkId: "transaction_invalid_amount",
          category: "transactions",
          message: "Transaction rows with invalid amount values",
          count: invalidAmount,
          samples: amountSamples,
        });
      }
    }
  }

  return { warnings, scope };
}

/**
 * Kid-e-Sys adapter readiness + migration validation (read-only).
 * No staging, apply, Prisma, or live import.
 */
export async function buildKidESysMigrationReadiness(
  input: BuildKidESysMigrationReadinessInput
): Promise<KidESysMigrationReadinessResult> {
  const uploadedFiles = Array.isArray(input.uploadedFiles) ? input.uploadedFiles : [];
  const previews = Array.isArray(input.previews) ? input.previews : [];
  const categories = buildCategoryRows(previews, uploadedFiles);

  const learners = categories.find((c) => c.key === "learners");
  const parents = categories.find((c) => c.key === "parents");
  const readyForMigration =
    learners?.status === "found" && parents?.status === "found";

  const proceedStatus = readyForMigration ? "ready" : "missing_required";
  const proceedMessage = readyForMigration
    ? "Ready for migration"
    : "Missing required files";

  const billing = categories.find((c) => c.key === "billing");
  const transactions = categories.find((c) => c.key === "transactions");
  const staff = categories.find((c) => c.key === "staff");

  const { warnings: crossValidationWarnings, scope: crossValidationScope } =
    await runCrossValidation(input);

  return {
    systemId: "kideesys",
    readyForMigration,
    proceedStatus,
    proceedMessage,
    categories,
    totals: {
      learners: learners?.entityCount ?? learners?.rowCount ?? 0,
      parents: parents?.entityCount ?? parents?.rowCount ?? 0,
      staff: staff?.entityCount ?? staff?.rowCount ?? 0,
      billingRows: billing?.rowCount ?? 0,
      transactionRows: transactions?.rowCount ?? 0,
    },
    crossValidationWarnings,
    crossValidationScope,
    evaluatedAt: new Date().toISOString(),
  };
}
