/**
 * Build-time: copy committed backend/data support JSON into storage templates.
 * Runtime repair reads templates when disk mount hides git-bundled data/.
 */
import path from "path";
import { fileURLToPath } from "url";
import { stageSupportTemplatesFromRepoData } from "./lib/billingDiskSupportFiles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const result = stageSupportTemplatesFromRepoData(BACKEND_ROOT);
console.log(`[billing-disk-templates] Staged ${result.staged.length} file(s) → ${result.templateDir}`);
for (const row of result.staged) {
  const detail = row.bytes ? `${row.bytes} bytes` : row.source;
  console.log(`[billing-disk-templates]   ${row.file} (${detail})`);
}
if (result.missing.length) {
  console.warn(
    `[billing-disk-templates] WARN repo missing (used empty default): ${result.missing.join(", ")}`
  );
}
