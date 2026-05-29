/**
 * Post-fix transaction readiness investigation for a saved migration stage.
 * Usage: npx tsx scripts/tx-readiness-investigation.ts [stageId]
 */
import fs from "fs";
import path from "path";
import { readMigrationFileRows } from "../src/services/migration/core/readMigrationFileRows";
import { investigateTransactionReadiness } from "../src/services/migration/core/computeTransactionReadiness";
import { enrichKidESysTransactionDateMappings } from "../src/services/migration/staging/buildMigrationStage";
import type { MigrationFilePreview } from "../src/services/migration/types/MigrationFilePreview";
import type { MigrationStage } from "../src/services/migration/types/MigrationStage";

const stageId = process.argv[2] || "119e592c-75f1-4197-a74c-20703df28cce";
const stagePath = path.join(
  process.cwd(),
  "storage",
  "migration-stages",
  `${stageId}.json`
);

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

async function main(): Promise<void> {
  if (!fs.existsSync(stagePath)) {
    console.error(`Stage not found: ${stagePath}`);
    process.exit(1);
  }

  const stage = JSON.parse(fs.readFileSync(stagePath, "utf8")) as MigrationStage;
  const stageWarnings = stage.warnings ?? [];

  const previews: MigrationFilePreview[] = [];
  const rowsByFileId = new Map<string, Record<string, unknown>[]>();

  for (const file of stage.files) {
    const warnings = warningsForFilename(file.filename, stageWarnings);
    previews.push({
      fileId: file.fileId,
      filename: file.filename,
      category: file.category,
      rowCount: file.rowCount,
      columns: [],
      sampleRows: [],
      warnings,
      path: file.path,
    });

    if (file.path && fs.existsSync(file.path)) {
      const parsed = await readMigrationFileRows({
        id: file.fileId,
        filename: file.filename,
        mimeType: "application/vnd.ms-excel",
        size: 0,
        uploadedAt: new Date(),
        category: file.category as MigrationStage["files"][0]["category"],
        path: file.path,
      }, { sourceSystem: stage.sourceSystem });
      rowsByFileId.set(file.fileId, parsed.rows);
    } else {
      console.warn(`Missing file path for ${file.filename}`);
      rowsByFileId.set(file.fileId, []);
    }
  }

  const mappings = enrichKidESysTransactionDateMappings(previews, stage.mappings);

  const report = investigateTransactionReadiness({
    previews,
    mappings,
    rowsByFileId,
    cutoverDate: stage.cutoverDate ?? null,
    sampleLimit: 5,
  });

  const { counts } = report;
  const summary = {
    learnerIndexTotal: report.learnerIndexTotal,
    learnerIndexActive: report.learnerIndexActive,
    learnerIndexUnknown: report.learnerIndexUnknown,
    eligibleActive: counts.eligibleActiveTransactions,
    blocked: counts.blockedTransactions,
    historicalOnly: counts.historicalOnlyTransactions,
    unmatched: counts.unmatchedTransactions,
    sampleEligibleRows: report.sampleEligibleRows,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
