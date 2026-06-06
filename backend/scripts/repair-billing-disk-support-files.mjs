/**
 * Runtime: create/copy missing billing support JSON on persistent disk.
 * Never modifies billing-ledger.json or family-account-age-analysis.json.
 *
 *   node scripts/repair-billing-disk-support-files.mjs
 *   node scripts/repair-billing-disk-support-files.mjs --overwrite-support
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CRITICAL_DATA_FILES,
  repairMissingSupportFiles,
} from "./lib/billingDiskSupportFiles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const overwrite = process.argv.includes("--overwrite-support");

const result = repairMissingSupportFiles(BACKEND_ROOT, { overwrite });

console.log(`[billing-disk-repair] dataDir=${result.dataDir}`);
console.log(`[billing-disk-repair] templateDir=${result.templateDir}`);
if (result.skipped.length) {
  console.log(`[billing-disk-repair] skipped (already present): ${result.skipped.join(", ")}`);
}
for (const row of result.created) {
  console.log(`[billing-disk-repair] created ${row.file} from ${row.source}`);
}
if (!result.created.length && result.skipped.length) {
  console.log("[billing-disk-repair] OK all support files present");
}

for (const critical of CRITICAL_DATA_FILES) {
  const p = path.join(result.dataDir, critical);
  if (!fs.existsSync(p)) {
    console.error(`[billing-disk-repair] FATAL missing critical file: ${critical}`);
    process.exit(1);
  }
}
