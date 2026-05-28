import { readMigrationFileRows } from "./core/readMigrationFileRows";
import { validateMigration } from "./validation/validateMigrationPreview";
import type { MigrationFile } from "./types/MigrationFile";
import type { MigrationFilePreview } from "./types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "./types/MigrationValidation";
import type {
  MigrationFieldMappingReport,
  MigrationSourceSystem,
  MigrationValidationReport,
} from "./migrationTypes";
import type { MigrationDataGroup } from "./migrationTypes";
import { dataGroupToFileCategory } from "./migrationFileDetector";

function sumBalanceFromRows(
  rows: Record<string, unknown>[],
  mappings: MigrationFileColumnMappings | undefined
): number {
  if (!mappings?.mappings?.length) return 0;
  const balanceTargets = new Set(["openingBalance", "currentBalance", "balance"]);
  const sourceCols = mappings.mappings
    .filter((m) => balanceTargets.has(String(m.targetField)))
    .map((m) => m.sourceColumn);
  if (!sourceCols.length) return 0;
  let total = 0;
  for (const row of rows) {
    for (const col of sourceCols) {
      const raw = String(row[col] ?? "").replace(/[\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
      const n = Number(raw);
      if (Number.isFinite(n)) total += n;
    }
  }
  return total;
}

export async function buildMigrationValidationReport(input: {
  schoolId: string;
  projectId: string;
  source: MigrationSourceSystem;
  previews: MigrationFilePreview[];
  mappings: MigrationFileColumnMappings[];
  fieldReports: MigrationFieldMappingReport[];
  files: MigrationFile[];
  dataGroupsByFileId: Map<string, MigrationDataGroup>;
  mode?: "preview" | "full";
  cutoverDate?: string | null;
}): Promise<MigrationValidationReport> {
  const mode = input.mode ?? "full";
  const filePaths: Record<string, string> = {};
  for (const f of input.files) filePaths[f.id] = f.path;

  const validation = await validateMigration({
    previews: input.previews,
    mappings: input.mappings,
    mode,
    filePaths: mode === "full" ? filePaths : undefined,
    cutoverDate: input.cutoverDate,
  });

  const counts = {
    learners: 0,
    parents: 0,
    parentLinks: 0,
    accounts: 0,
    invoices: 0,
    payments: 0,
    journals: 0,
    transactions: 0,
  };

  for (const preview of input.previews) {
    const group = input.dataGroupsByFileId.get(preview.fileId) ?? "unknown";
    const rows = Math.max(0, Number(preview.rowCount) || 0);
    switch (group) {
      case "classrooms":
      case "learners":
        counts.learners += rows;
        break;
      case "parents":
        counts.parents += rows;
        break;
      case "parent_learner_links":
        counts.parentLinks += rows;
        break;
      case "accounts":
      case "billing_plans":
      case "balances":
        counts.accounts += rows;
        break;
      case "invoices":
        counts.invoices += rows;
        break;
      case "payments":
        counts.payments += rows;
        break;
      case "journals":
        counts.journals += rows;
        break;
      case "transaction_history":
        counts.transactions += rows;
        break;
      default:
        break;
    }
  }

  const duplicateWarnings = validation.issues
    .filter((i) => /duplicate/i.test(i.message))
    .slice(0, 50)
    .map((i) => `${i.filename} row ${i.rowNumber}: ${i.message}`);

  const blockingErrors = validation.issues
    .filter((i) => i.severity === "error")
    .slice(0, 30)
    .map((i) => `${i.filename} row ${i.rowNumber}: ${i.message}`);

  for (const report of input.fieldReports) {
    if (report.missingTargets.length > 0) {
      blockingErrors.push(
        `${report.filename}: missing critical mappings (${report.missingTargets.join(", ")})`
      );
    }
  }

  let balanceReconciliationPreview: MigrationValidationReport["balanceReconciliationPreview"];
  const balanceFiles = input.previews.filter((p) => {
    const g = input.dataGroupsByFileId.get(p.fileId);
    return g === "balances" || g === "accounts";
  });
  if (balanceFiles.length > 0 && mode === "full") {
    let totalOpeningBalance = 0;
    for (const preview of balanceFiles) {
      const file = input.files.find((f) => f.id === preview.fileId);
      if (!file) continue;
      const mappings = input.mappings.find((m) => m.fileId === preview.fileId);
      const rows = await readMigrationFileRows(file, { sourceSystem: input.source });
      totalOpeningBalance += sumBalanceFromRows(rows.rows as Record<string, unknown>[], mappings);
    }
    balanceReconciliationPreview = {
      totalOpeningBalance,
      fileCount: balanceFiles.length,
    };
  }

  const criticalMissing = input.fieldReports.some((r) => r.missingTargets.length > 0);
  const canProceed =
    validation.summary.canProceed && !criticalMissing && blockingErrors.length === 0;

  return {
    projectId: input.projectId,
    schoolId: input.schoolId,
    source: input.source,
    generatedAt: new Date().toISOString(),
    filesDetected: input.files.map((f) => ({
      fileId: f.id,
      schoolId: input.schoolId,
      projectId: input.projectId,
      originalFilename: f.filename,
      storedPath: f.path,
      fileKind: "unknown",
      sourceSystem: input.source,
      dataGroup: input.dataGroupsByFileId.get(f.id) ?? "unknown",
      category: f.category,
      columns: [],
      rowCount: 0,
      sampleRows: [],
      uploadedAt: f.uploadedAt.toISOString(),
      sizeBytes: f.size,
    })),
    fieldMappings: input.fieldReports,
    validationSummary: validation.summary,
    issues: validation.issues,
    counts,
    unmatched: {
      learners: validation.issues.filter((i) => /unmatched learner/i.test(i.message)).length,
      parents: validation.issues.filter((i) => /unmatched parent/i.test(i.message)).length,
      accounts: validation.issues.filter((i) => /unmatched account/i.test(i.message)).length,
    },
    duplicateWarnings,
    balanceReconciliationPreview,
    canProceed,
    blockingErrors,
  };
}

export function previewsToMigrationFiles(
  previews: MigrationFilePreview[],
  pathsByFileId: Map<string, string>,
  schoolId: string,
  projectId: string,
  source: MigrationSourceSystem,
  dataGroups: Map<string, MigrationDataGroup>
): MigrationFile[] {
  return previews.map((p) => ({
    id: p.fileId,
    filename: p.filename,
    mimeType: "application/octet-stream",
    size: 0,
    uploadedAt: new Date(),
    category: (dataGroups.has(p.fileId)
      ? dataGroupToFileCategory(dataGroups.get(p.fileId)!)
      : p.category) as MigrationFile["category"],
    path: pathsByFileId.get(p.fileId) ?? "",
  }));
}
