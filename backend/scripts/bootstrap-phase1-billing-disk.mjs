/**
 * Optional Phase-1 billing disk seeder (early npm start step).
 *
 * This script must NOT act as the billing integrity gate.
 * Integrity remains enforced by:
 *   - scripts/verify-runtime-assets.mjs
 *   - scripts/verify-billing-persistent-disk.mjs
 *
 * Seeding runs ONLY when AUTO_SEED_PHASE1_BILLING_DISK=true (intentional trigger).
 * Normal production boots must never be blocked merely because age snapshot
 * count drifted from the historical Phase-1 exact value (344 → 345 after
 * MAS009 / finance repairs), or because live undo-correction rows exist.
 *
 * Set AUTO_SEED_PHASE1_BILLING_DISK=true on Render for empty-disk activation only.
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

/** Keep in sync with verify-runtime-assets.mjs age-analysis allowed counts. */
const HEALTHY_AGE_COUNTS = new Set([344, 345]);
const MIN_LIVE_LEDGER_ENTRIES = 337;

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

function readLedgerEntryCount() {
  const ledgerPath = path.join(BACKEND_ROOT, "data", "billing-ledger.json");
  if (!fs.existsSync(ledgerPath)) return 0;
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    const entries = parsed?.[SCHOOL_ID];
    return Array.isArray(entries) ? entries.length : 0;
  } catch {
    return 0;
  }
}

function ageHasForbiddenAccounts() {
  const forbidden = ["JAC001", "LET007"];
  const agePath = path.join(BACKEND_ROOT, "data", "family-account-age-analysis.json");
  if (!fs.existsSync(agePath)) return false;
  try {
    const school = JSON.parse(fs.readFileSync(agePath, "utf8"))?.[SCHOOL_ID] || {};
    return forbidden.some((ref) => ref in school);
  } catch {
    return true;
  }
}

function runSeed() {
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

function main() {
  const auto = String(process.env[AUTO_ENV] || "").trim().toLowerCase() === "true";
  const count = readAgeSnapshotCount();
  const hasForbidden = ageHasForbiddenAccounts();
  const undoCorr = ledgerHasUndoCorrection();
  const ledgerCount = readLedgerEntryCount();
  const healthyBaseline = HEALTHY_AGE_COUNTS.has(count) && !hasForbidden;
  const looksLikeLiveDisk =
    undoCorr || ledgerCount >= MIN_LIVE_LEDGER_ENTRIES || healthyBaseline;

  if (auto) {
    if (undoCorr) {
      console.error(
        `[bootstrap-phase1] Refusing ${AUTO_ENV}=true because live undo-correction ledger rows are present. Seed would overwrite repaired production data.`
      );
      process.exit(1);
    }
    if (healthyBaseline) {
      console.log(
        `[bootstrap-phase1] OK age snapshots=${count}, forbidden=${hasForbidden}, undoCorr=${undoCorr} — already healthy; skip seed`
      );
      return;
    }
    runSeed();
    return;
  }

  // Normal startup: never seed without the explicit env trigger.
  if (healthyBaseline) {
    console.log(
      `[bootstrap-phase1] OK age snapshots=${count}, forbidden=${hasForbidden}, undoCorr=${undoCorr}, ledger=${ledgerCount} — skip seed`
    );
    return;
  }

  if (looksLikeLiveDisk) {
    // Production already repaired (e.g. 345 accounts + MAS009 + undo corrections).
    // Do not demand a Phase-1 reseed; verify-runtime-assets enforces integrity next.
    console.log(
      `[bootstrap-phase1] INFO live/repaired billing disk detected (age=${count}, forbidden=${hasForbidden}, undoCorr=${undoCorr}, ledger=${ledgerCount}) — skip seed; integrity scripts will validate`
    );
    return;
  }

  // Empty / non-live disk without intentional seed trigger.
  console.error(
    `[bootstrap-phase1] Billing disk does not look seeded (age=${count}, forbidden=${hasForbidden}, undoCorr=${undoCorr}, ledger=${ledgerCount}). Set ${AUTO_ENV}=true for intentional Phase-1 seed, or restore billing JSON onto the persistent disk.`
  );
  process.exit(1);
}

main();
