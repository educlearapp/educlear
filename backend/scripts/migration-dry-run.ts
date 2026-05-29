/**
 * Universal migration dry run (project-staged uploads).
 *
 * Usage:
 *   npx tsc
 *   npx tsx scripts/migration-dry-run.ts --schoolId <id> --projectId <id> --source <sasams|kideesys|generic-excel|generic-csv|unknown>
 */
import { runMigrationDryRun } from "../src/services/migration/migrationDryRun";

function arg(name: string): string | null {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v ? String(v).trim() : null;
}

async function main(): Promise<void> {
  const schoolId = arg("schoolId");
  const projectId = arg("projectId");
  const source = (arg("source") ?? "unknown").trim();
  const cutoverDate = arg("cutoverDate");
  if (!schoolId || !projectId) {
    console.error("Missing required args: --schoolId and --projectId");
    process.exit(1);
  }

  const result = await runMigrationDryRun({
    schoolId,
    projectId,
    source: source as any,
    cutoverDate: cutoverDate || null,
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

