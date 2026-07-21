/**
 * Optional startup backfill for finance account baselines on the persistent disk.
 * Runs only when CONFIRM_FINANCE_BASELINE_BACKFILL is set to a school id.
 *
 * Set on Render for a single deploy/restart, then remove the env var.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const ENV_KEY = "CONFIRM_FINANCE_BASELINE_BACKFILL";

function readSnapshotCount(schoolId) {
  const agePath = path.join(BACKEND_ROOT, "data", "family-account-age-analysis.json");
  if (!fs.existsSync(agePath)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(agePath, "utf8"));
    const school = parsed?.[schoolId];
    return school && typeof school === "object" ? Object.keys(school).length : 0;
  } catch {
    return 0;
  }
}

function main() {
  const schoolId = String(process.env[ENV_KEY] || "").trim();
  if (!schoolId) return;

  const agePath = path.join(BACKEND_ROOT, "data", "family-account-age-analysis.json");
  const backupPath = path.join(
    BACKEND_ROOT,
    "data",
    `family-account-age-analysis.pre-finance-backfill-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}Z.json`
  );

  const beforeCount = readSnapshotCount(schoolId);
  const hasMas009 = (() => {
    try {
      const parsed = JSON.parse(fs.readFileSync(agePath, "utf8"));
      return Boolean(parsed?.[schoolId]?.MAS009);
    } catch {
      return false;
    }
  })();

  console.log(
    `[bootstrap-finance-backfill] schoolId=${schoolId} snapshots=${beforeCount} hasMAS009=${hasMas009}`
  );

  if (hasMas009) {
    console.log("[bootstrap-finance-backfill] MAS009 baseline already present — skip");
    return;
  }

  if (fs.existsSync(agePath)) {
    fs.copyFileSync(agePath, backupPath);
    console.log(`[bootstrap-finance-backfill] backup=${backupPath}`);
  }

  const dry = spawnSync(
    "npx",
    ["tsx", "scripts/backfill-finance-account-baselines.ts", schoolId],
    { cwd: BACKEND_ROOT, stdio: "inherit", env: process.env }
  );
  if (dry.status !== 0) {
    console.error("[bootstrap-finance-backfill] dry-run failed");
    process.exit(dry.status || 1);
  }

  const apply = spawnSync(
    "npx",
    ["tsx", "scripts/backfill-finance-account-baselines.ts", schoolId, "--apply"],
    { cwd: BACKEND_ROOT, stdio: "inherit", env: process.env }
  );
  if (apply.status !== 0) {
    console.error("[bootstrap-finance-backfill] apply failed");
    process.exit(apply.status || 1);
  }

  const afterCount = readSnapshotCount(schoolId);
  const hasMas009After = (() => {
    try {
      const parsed = JSON.parse(fs.readFileSync(agePath, "utf8"));
      return Boolean(parsed?.[schoolId]?.MAS009);
    } catch {
      return false;
    }
  })();

  console.log(
    `[bootstrap-finance-backfill] complete snapshots ${beforeCount} -> ${afterCount} hasMAS009=${hasMas009After}`
  );

  if (!hasMas009After) {
    console.error("[bootstrap-finance-backfill] apply completed but MAS009 missing — abort start");
    process.exit(1);
  }
}

main();
