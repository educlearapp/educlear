import { execSync } from "child_process";
import path from "path";

import { ensureDaSilvaAcademySubscription } from "./activateDaSilvaSubscription";
import { isDaSilvaFinalImportEnvConfirmed } from "./daSilvaMigration/daSilvaFinalImportGate";
import { ensureEduClearPackages } from "./ensureEduClearPackages";

function getBackendRoot(): string {
  return path.resolve(__dirname, "../..");
}

/** Runs `prisma migrate deploy` without aborting the process on failure. */
export function runPrismaMigrateDeployOnStartup(): void {
  const backendRoot = getBackendRoot();
  try {
    console.log("[startup] Running prisma migrate deploy...");
    const output = execSync("npx prisma migrate deploy", {
      cwd: backendRoot,
      encoding: "utf-8",
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const trimmed = output.trim();
    if (trimmed) {
      console.log(trimmed);
    }
    console.log("[startup] prisma migrate deploy completed");
  } catch (error: unknown) {
    const err = error as { message?: string; stdout?: string; stderr?: string };
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

/**
 * Production boot tasks before HTTP listen: migrations, package seeds, optional Da Silva activation.
 */
export async function runProductionStartup(): Promise<void> {
  runPrismaMigrateDeployOnStartup();

  try {
    const codes = await ensureEduClearPackages();
    console.log(`[startup] EduClear packages ensured: ${codes.join(", ")}`);
  } catch (error) {
    console.error("[startup] ensureEduClearPackages failed:", error);
  }

  if (isDaSilvaFinalImportEnvConfirmed()) {
    try {
      await ensureDaSilvaAcademySubscription();
    } catch (error) {
      console.error("[startup] Da Silva subscription activation failed:", error);
    }
  } else {
    console.log(
      "[startup] Da Silva subscription activation skipped (CONFIRM_DA_SILVA_FINAL_IMPORT is not true)"
    );
  }
}
