/**
 * One-time bootstrap: seed Phase-1 billing JSON when persistent disk is empty/wrong.
 * Runs before verify-runtime-assets in npm start.
 *
 * Set AUTO_SEED_PHASE1_BILLING_DISK=true on Render for the disk-activation deploy only.
 * Remove after verify-phase1-billing-acceptance passes.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const AUTO_ENV = "AUTO_SEED_PHASE1_BILLING_DISK";

function readAgeSnapshotCount() {
  const agePath = path.join(BACKEND_ROOT, "data", "family-account-age-analysis.json");
  if (!fs.existsSync(agePath)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(agePath, "utf8"));
    const school = parsed?.[SCHOOL_ID];
    if (!school || typeof school !== "object") return 0;
    return Object.keys(school).length;
  } catch {
    return 0;
  }
}

function ledgerHasUndoCorrection() {
  const ledgerPath = path.join(BACKEND_ROOT, "data", "billing-ledger.json");
  if (!fs.existsSync(ledgerPath)) return false;
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    const entries = parsed?.[SCHOOL_ID];
    if (!Array.isArray(entries)) return false;
    return entries.some(
      (e) =>
        String(e?.source || "") === "educlear_undo_correction" ||
        String(e?.id || "").startsWith("undo-corr-")
    );
  } catch {
    return false;
  }
}

function main() {
  const auto = String(process.env[AUTO_ENV] || "").trim().toLowerCase() === "true";
  const count = readAgeSnapshotCount();
  const forbidden = ["JAC001", "LET007"];
  const agePath = path.join(BACKEND_ROOT, "data", "family-account-age-analysis.json");
  let hasForbidden = false;
  if (fs.existsSync(agePath)) {
    try {
      const school = JSON.parse(fs.readFileSync(agePath, "utf8"))?.[SCHOOL_ID] || {};
      hasForbidden = forbidden.some((ref) => ref in school);
    } catch {
      hasForbidden = true;
    }
  }

  const needsSeed = count !== 344 || hasForbidden || ledgerHasUndoCorrection();

  if (!needsSeed) {
    console.log(`[bootstrap-phase1] OK age snapshots=${count}, skip seed`);
    return;
  }

  if (!auto) {
    console.error(
      `[bootstrap-phase1] Billing data needs Phase-1 seed (age=${count}, forbidden=${hasForbidden}, undoCorr=${ledgerHasUndoCorrection()}). Set ${AUTO_ENV}=true or run seed-phase1-billing-disk.ts on Render Shell.`
    );
    process.exit(1);
  }

  console.log("[bootstrap-phase1] Seeding Phase-1 billing data onto persistent disk...");
  const result = spawnSync(
    "node",
    ["scripts/seed-phase1-billing-disk.mjs", "--apply", "--target", "data"],
    {
      cwd: BACKEND_ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        CONFIRM_PHASE1_BILLING_DISK_SEED: "true",
      },
    }
  );

  if (result.status !== 0) {
    console.error("[bootstrap-phase1] Seed failed");
    process.exit(result.status || 1);
  }

  console.log("[bootstrap-phase1] Seed complete");
}

main();
