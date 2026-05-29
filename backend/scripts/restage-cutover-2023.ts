/**
 * Rebuild a saved migration stage with a new cutover date (Da Silva Kid-e-Sys test).
 * Usage: npx tsx scripts/restage-cutover-2023.ts [sourceStageId] [cutoverDate]
 */
import fs from "fs";
import path from "path";
import { readMigrationFileRows } from "../src/services/migration/core/readMigrationFileRows";
import {
  buildMigrationStage,
  enrichKidESysTransactionDateMappings,
} from "../src/services/migration/staging/buildMigrationStage";
import { createStage } from "../src/services/migration/staging/migrationStageStore";
import type { MigrationFile } from "../src/services/migration/types/MigrationFile";
import type { MigrationFilePreview } from "../src/services/migration/types/MigrationFilePreview";
import type { MigrationStage } from "../src/services/migration/types/MigrationStage";

const sourceStageId =
  process.argv[2] || "841890ba-f9be-4563-9927-4781e335c1b7";
const cutoverDate = process.argv[3] || "2023-01-01";

function warningsForFilename(filename: string, stageWarnings: string[]): string[] {
  const prefix = `${filename}:`;
  const out: string[] = [];
  for (const w of stageWarnings) {
    if (w.startsWith(prefix)) {
      out.push(w.slice(prefix.length).trim());
    }
  }
  return out;
}

async function loadRows(stage: MigrationStage): Promise<{
  previews: MigrationFilePreview[];
  rowsByFileId: Map<string, Record<string, unknown>[]>;
}> {
  const previews: MigrationFilePreview[] = [];
  const rowsByFileId = new Map<string, Record<string, unknown>[]>();

  const stageWarnings = stage.warnings ?? [];

  for (const file of stage.files) {
    previews.push({
      fileId: file.fileId,
      filename: file.filename,
      category: file.category as MigrationFilePreview["category"],
      columns: [],
      sampleRows: [],
      rowCount: file.rowCount,
      warnings: warningsForFilename(file.filename, stageWarnings),
      path: file.path,
    });

    if (file.path && fs.existsSync(file.path)) {
      const mf: MigrationFile = {
        id: file.fileId,
        filename: file.filename,
        mimeType: "application/vnd.ms-excel",
        size: 0,
        uploadedAt: new Date(),
        category: file.category as MigrationFile["category"],
        path: file.path,
      };
      const parsed = await readMigrationFileRows(mf, { sourceSystem: stage.sourceSystem });
      rowsByFileId.set(file.fileId, parsed.rows);
    } else {
      rowsByFileId.set(file.fileId, []);
    }
  }

  return { previews, rowsByFileId };
}

async function main(): Promise<void> {
  const stagePath = path.join(
    process.cwd(),
    "storage",
    "migration-stages",
    `${sourceStageId}.json`
  );
  if (!fs.existsSync(stagePath)) {
    console.error(`Stage not found: ${stagePath}`);
    process.exit(1);
  }

  const old = JSON.parse(fs.readFileSync(stagePath, "utf8")) as MigrationStage;
  const { previews, rowsByFileId } = await loadRows(old);
  const mappings = enrichKidESysTransactionDateMappings(previews, old.mappings);

  const stage = buildMigrationStage({
    sourceSystem: old.sourceSystem,
    previews,
    mappings,
    validationSummary: old.validationSummary,
    cutoverDate,
    rowsByFileId,
  });

  createStage(stage);

  const txFile = old.files.find((f) => /transaction/i.test(f.filename));
  let txDateRange: { min: string | null; max: string | null; rowCount: number } | null =
    null;
  if (txFile?.path && fs.existsSync(txFile.path)) {
    const rows = rowsByFileId.get(txFile.fileId) ?? [];
    let min: string | null = null;
    let max: string | null = null;
    for (const row of rows) {
      const d = row.Date ?? row.date ?? row["Transaction Date"];
      const s = String(d ?? "").trim();
      if (!s) continue;
      if (!min || s < min) min = s;
      if (!max || s > max) max = s;
    }
    txDateRange = { min, max, rowCount: rows.length };
  }

  console.log(
    JSON.stringify(
      {
        sourceStageId,
        newStageId: stage.stageId,
        cutoverDate: stage.cutoverDate,
        previousTransactionReadiness: old.transactionReadiness,
        transactionReadiness: stage.transactionReadiness,
        txDateRange,
        canApply: stage.canApply,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
