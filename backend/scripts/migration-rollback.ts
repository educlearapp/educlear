/**
 * Roll back an import batch, optionally restore from pre-import backup.
 *
 * Usage:
 *   npx tsc
 *   npx tsx scripts/migration-rollback.ts --schoolId <id> --projectId <id> --batchId <batchId>
 *   npx tsx scripts/migration-rollback.ts --schoolId <id> --projectId <id> --restoreFromBackup true
 */
import { runMigrationRollback } from "../src/services/migration/migrationRollback";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v ? String(v).trim() : null;
}

async function main(): Promise<void> {
  const schoolId = arg("schoolId");
  const projectId = arg("projectId");
  const batchId = arg("batchId") || undefined;
  const restoreFromBackup = arg("restoreFromBackup") === "true";
  const backupFilename = arg("backupFilename") || undefined;

  if (!schoolId || !projectId) {
    console.error("Missing required args: --schoolId and --projectId");
    process.exit(1);
  }

  const result = await runMigrationRollback({
    schoolId,
    projectId,
    batchId,
    restoreFromBackup,
    backupFilename,
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

