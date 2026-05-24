import { execSync } from "child_process";
import path from "path";

import { prisma } from "../prisma";

function getBackendRoot(): string {
  return path.resolve(__dirname, "../..");
}

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
  logs: string | null;
};

function logsIndicateFailedMigration(logs: string | null): boolean {
  if (logs == null || logs.trim() === "") {
    return true;
  }
  const lower = logs.toLowerCase();
  return (
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("exception") ||
    lower.includes("migrate failed") ||
    lower.includes("p3018")
  );
}

/** Rows in _prisma_migrations that never finished and are not yet marked rolled back. */
function isUnresolvedFailedMigration(row: MigrationRow): boolean {
  if (row.finished_at != null) return false;
  if (row.rolled_back_at != null) return false;
  return logsIndicateFailedMigration(row.logs);
}

async function findFailedMigrations(): Promise<string[]> {
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, rolled_back_at, logs
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL
      AND rolled_back_at IS NULL
    ORDER BY migration_name
  `;
  return rows.filter(isUnresolvedFailedMigration).map((r) => r.migration_name);
}

function markMigrationRolledBack(migrationName: string): void {
  const backendRoot = getBackendRoot();
  console.log(
    `[startup] Resolving failed migration (rolled-back): ${migrationName}`
  );
  const output = execSync(
    `npx prisma migrate resolve --rolled-back ${migrationName}`,
    {
      cwd: backendRoot,
      encoding: "utf-8",
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  const trimmed = output.trim();
  if (trimmed) console.log(trimmed);
  console.log(`[startup] Migration resolved: ${migrationName}`);
}

function resolveFailedMigration(migrationName: string): void {
  try {
    markMigrationRolledBack(migrationName);
  } catch (error: unknown) {
    const err = error as { message?: string; stderr?: string; stdout?: string };
    const combined = `${err?.message || ""}\n${err?.stderr || ""}\n${err?.stdout || ""}`;
    console.log(
      `[startup] migrate resolve --rolled-back skipped for ${migrationName} (no failed record or already resolved)`
    );
    const trimmed = combined.trim();
    if (trimmed) console.log(trimmed);
  }
}

/** Resolves every failed migration in _prisma_migrations before deploy. */
async function resolveAllFailedMigrationsBeforeDeploy(): Promise<void> {
  const failed = await findFailedMigrations();
  if (failed.length === 0) {
    console.log("[startup] No failed migrations in _prisma_migrations");
    return;
  }
  console.log(
    `[startup] Found ${failed.length} failed migration(s): ${failed.join(", ")}`
  );
  for (const migrationName of failed) {
    resolveFailedMigration(migrationName);
  }
}

function runMigrateDeploy(): string {
  const backendRoot = getBackendRoot();
  console.log("[startup] Running prisma migrate deploy...");
  const output = execSync("npx prisma migrate deploy", {
    cwd: backendRoot,
    encoding: "utf-8",
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const trimmed = output.trim();
  if (trimmed) console.log(trimmed);
  console.log("[startup] prisma migrate deploy completed");
  return trimmed;
}

function isP3009Error(combined: string): boolean {
  return combined.includes("P3009");
}

function logDeployFailure(
  label: string,
  error: unknown,
  err: { message?: string; stdout?: string; stderr?: string }
): void {
  console.error(`[startup] ${label}:`, err?.message || error);
  const stdout = String(err?.stdout || "").trim();
  const stderr = String(err?.stderr || "").trim();
  if (stdout) console.error(stdout);
  if (stderr) console.error(stderr);
}

/** Resolves all failed migrations, then migrate deploy; retries once if P3009 or failures remain. */
export async function runPrismaMigrateDeployWithRecovery(): Promise<void> {
  await resolveAllFailedMigrationsBeforeDeploy();

  try {
    runMigrateDeploy();
  } catch (error: unknown) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    const combined = `${err?.message || ""}\n${err?.stderr || ""}\n${err?.stdout || ""}`;
    const stillFailed = await findFailedMigrations();
    const shouldRetry =
      isP3009Error(combined) || stillFailed.length > 0;

    if (shouldRetry) {
      try {
        console.log(
          `[startup] Migration deploy blocked — resolving ${stillFailed.length || "any"} failed migration(s) and retrying deploy once…`
        );
        await resolveAllFailedMigrationsBeforeDeploy();
        runMigrateDeploy();
        return;
      } catch (retryError: unknown) {
        const retryErr = retryError as {
          message?: string;
          stdout?: string;
          stderr?: string;
        };
        logDeployFailure(
          "prisma migrate deploy failed after resolve",
          retryError,
          retryErr
        );
        return;
      }
    }

    logDeployFailure(
      "prisma migrate deploy failed (continuing startup)",
      error,
      err
    );
  }
}
