import { execSync } from "child_process";
import path from "path";

import { prisma } from "../prisma";

const FAILED_DUE_DATES_MIGRATION =
  "20260427180000_add_due_dates_to_billing_plan_items_and_invoice_lines";

function getBackendRoot(): string {
  return path.resolve(__dirname, "../..");
}

type MigrationRow = {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
};

/**
 * Detects a failed Prisma migration record (P3009 precursor) and marks it rolled back
 * so `prisma migrate deploy` can proceed. Safe to call when no failed row exists.
 */
export async function resolveFailedDueDatesMigrationIfNeeded(): Promise<boolean> {
  const rows = await prisma.$queryRaw<MigrationRow[]>`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
    WHERE migration_name = ${FAILED_DUE_DATES_MIGRATION}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return false;
  if (row.finished_at) return false;
  if (row.rolled_back_at) return false;

  markMigrationRolledBack();
  return true;
}

function markMigrationRolledBack(): void {
  const backendRoot = getBackendRoot();
  console.log(
    `[startup] Resolving failed migration (rolled-back): ${FAILED_DUE_DATES_MIGRATION}`
  );
  const output = execSync(
    `npx prisma migrate resolve --rolled-back ${FAILED_DUE_DATES_MIGRATION}`,
    {
      cwd: backendRoot,
      encoding: "utf-8",
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
  const trimmed = output.trim();
  if (trimmed) console.log(trimmed);
  console.log(`[startup] Migration resolved: ${FAILED_DUE_DATES_MIGRATION}`);
}

/** Runs migrate deploy; on P3009 for the due-dates migration, resolves and retries once. */
export async function runPrismaMigrateDeployWithRecovery(): Promise<void> {
  const backendRoot = getBackendRoot();

  await resolveFailedDueDatesMigrationIfNeeded();

  try {
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
  } catch (error: unknown) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
    const combined = `${err?.message || ""}\n${err?.stderr || ""}\n${err?.stdout || ""}`;
    const isP3009 =
      combined.includes("P3009") &&
      combined.includes(FAILED_DUE_DATES_MIGRATION);

    if (isP3009) {
      try {
        console.log(
          `[startup] P3009 detected — resolving ${FAILED_DUE_DATES_MIGRATION} as rolled back…`
        );
        markMigrationRolledBack();
        const retryOutput = execSync("npx prisma migrate deploy", {
          cwd: backendRoot,
          encoding: "utf-8",
          env: process.env,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const retryTrimmed = retryOutput.trim();
        if (retryTrimmed) console.log(retryTrimmed);
        console.log("[startup] prisma migrate deploy completed");
        return;
      } catch (retryError: unknown) {
        const retryErr = retryError as {
          message?: string;
          stdout?: string;
          stderr?: string;
        };
        console.error(
          "[startup] prisma migrate deploy failed after resolve:",
          retryErr?.message || retryError
        );
        const stdout = String(retryErr?.stdout || "").trim();
        const stderr = String(retryErr?.stderr || "").trim();
        if (stdout) console.error(stdout);
        if (stderr) console.error(stderr);
        return;
      }
    }

    console.error(
      "[startup] prisma migrate deploy failed (continuing startup):",
      err?.message || error
    );
    const stdout = String(err?.stdout || "").trim();
    const stderr = String(err?.stderr || "").trim();
    if (stdout) console.error(stdout);
    if (stderr) console.error(stderr);
  }
}
