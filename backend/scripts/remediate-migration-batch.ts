/**
 * Roll back records created by a universal migration import batch (report-driven).
 * Only deletes entities with status "created" in the batch report — pre-existing school data is untouched.
 *
 * Usage:
 *   npx tsc && node dist/scripts/remediate-migration-batch.js <batchId> [targetSchoolId]
 *
 * Example (Da Silva failed Kid-e-Sys apply):
 *   node dist/scripts/remediate-migration-batch.js e08780fd-84d1-4e97-a494-c0801a5d8b6f
 */
import { getImportBatch } from "../src/services/migration/core/migrationImportBatchStore";
import { rollbackMigrationBatch } from "../src/services/migration/core/rollbackMigrationBatch";

async function main(): Promise<void> {
  const batchId = String(process.argv[2] || "").trim();
  if (!batchId) {
    console.error("Usage: node dist/scripts/remediate-migration-batch.js <batchId>");
    process.exit(1);
  }

  const batch = getImportBatch(batchId);
  if (!batch) {
    console.error(`Batch not found: ${batchId}`);
    process.exit(1);
  }

  const targetSchoolId =
    String(process.argv[3] || "").trim() || batch.targetSchoolId;
  const confirmationText = batch.targetSchoolName;

  console.log(`Rolling back batch ${batchId} for school ${batch.targetSchoolName} (${targetSchoolId})…`);
  console.log(`Status: ${batch.status}`);
  console.log(
    `Created in batch: learners=${batch.createdCounts?.learners ?? 0}, ` +
      `parents=${batch.createdCounts?.parents ?? 0}, ` +
      `employees=${batch.createdCounts?.employees ?? 0}, ` +
      `billing=${batch.createdCounts?.billingAccounts ?? 0}`
  );

  const result = await rollbackMigrationBatch({
    batchId,
    targetSchoolId,
    confirmationText,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.success) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
