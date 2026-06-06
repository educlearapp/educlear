/**
 * Verify billing JSON stores for production boot.
 * Critical files must exist and pass validation.
 * Support files are repaired if missing (never overwrites existing).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  DA_SILVA_SCHOOL_ID,
  countSchoolArrayEntries,
  countSchoolObjectKeys,
  repairMissingSupportFiles,
} from "./lib/billingDiskSupportFiles.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");

const CRITICAL_FILES = [
  {
    rel: "data/billing-ledger.json",
    kind: "school-array",
    minCount: 337,
  },
  {
    rel: "data/family-account-age-analysis.json",
    kind: "school-object",
    minCount: 344,
    exactCount: 344,
    forbiddenAccountRefs: ["JAC001", "LET007"],
  },
];

const SUPPORT_FILES = [
  {
    rel: "data/kidesys-transaction-history.json",
    kind: "school-array",
    warnBelowCount: 40916,
  },
  {
    rel: "data/learner-billing-plans.json",
    kind: "school-object",
    warnBelowCount: 1,
  },
  {
    rel: "data/payment-allocations.json",
    kind: "school-object",
    warnBelowCount: 0,
  },
  {
    rel: "data/family-account-audit.json",
    kind: "json-object",
  },
  {
    rel: "data/banking-imports.json",
    kind: "json-object",
  },
  {
    rel: "data/user-access.json",
    kind: "user-access",
  },
  {
    rel: "data/legal-document-history.json",
    kind: "json-array",
  },
  {
    rel: "data/communication-store.json",
    kind: "json-object",
  },
  {
    rel: "uploads/school-logos/da-silva-academy-logo.png",
    kind: "binary",
    minBytes: 1024,
  },
];

function fail(message) {
  console.error(`[runtime-assets] FAIL: ${message}`);
  process.exit(1);
}

function readJson(absPath) {
  try {
    return JSON.parse(fs.readFileSync(absPath, "utf8"));
  } catch (error) {
    fail(`${path.relative(BACKEND_ROOT, absPath)} is not valid JSON (${error.message})`);
  }
}

function verifyCriticalFile(spec) {
  const absPath = path.join(BACKEND_ROOT, spec.rel);
  if (!fs.existsSync(absPath)) {
    fail(`missing critical ${spec.rel} (expected at ${absPath})`);
  }

  const parsed = readJson(absPath);
  const count =
    spec.kind === "school-array"
      ? countSchoolArrayEntries(parsed)
      : countSchoolObjectKeys(parsed);

  if (count < spec.minCount) {
    fail(`${spec.rel} school ${DA_SILVA_SCHOOL_ID} count=${count}, expected >= ${spec.minCount}`);
  }
  if (spec.exactCount != null && count !== spec.exactCount) {
    fail(
      `${spec.rel} school ${DA_SILVA_SCHOOL_ID} count=${count}, expected exactly ${spec.exactCount}`
    );
  }
  if (Array.isArray(spec.forbiddenAccountRefs) && spec.kind === "school-object") {
    const payload = parsed?.[DA_SILVA_SCHOOL_ID];
    const forbidden = spec.forbiddenAccountRefs.filter(
      (ref) => payload && typeof payload === "object" && ref in payload
    );
    if (forbidden.length) {
      fail(`${spec.rel} must not contain excluded account(s): ${forbidden.join(", ")}`);
    }
  }
  console.log(`[runtime-assets] OK critical ${spec.rel} (${count} for ${DA_SILVA_SCHOOL_ID})`);
}

function verifySupportFile(spec) {
  const absPath = path.join(BACKEND_ROOT, spec.rel);
  if (!fs.existsSync(absPath)) {
    console.warn(`[runtime-assets] WARN missing support ${spec.rel} after repair`);
    return;
  }

  if (spec.kind === "binary") {
    const size = fs.statSync(absPath).size;
    if (size < (spec.minBytes || 1)) {
      console.warn(`[runtime-assets] WARN ${spec.rel} small (${size} bytes)`);
      return;
    }
    console.log(`[runtime-assets] OK support ${spec.rel} (${size} bytes)`);
    return;
  }

  const parsed = readJson(absPath);

  if (spec.kind === "user-access") {
    const users = parsed?.users;
    const userCount =
      users && typeof users === "object" && !Array.isArray(users)
        ? Object.keys(users).length
        : 0;
    if (userCount < 1) {
      console.warn(`[runtime-assets] WARN ${spec.rel} has no users`);
      return;
    }
    console.log(`[runtime-assets] OK support ${spec.rel} (${userCount} user(s))`);
    return;
  }

  if (spec.kind === "json-array") {
    if (!Array.isArray(parsed)) {
      console.warn(`[runtime-assets] WARN ${spec.rel} is not an array`);
      return;
    }
    console.log(`[runtime-assets] OK support ${spec.rel} (${parsed.length} row(s))`);
    return;
  }

  if (spec.kind === "json-object") {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.warn(`[runtime-assets] WARN ${spec.rel} is not an object`);
      return;
    }
    console.log(`[runtime-assets] OK support ${spec.rel}`);
    return;
  }

  const count =
    spec.kind === "school-array"
      ? countSchoolArrayEntries(parsed)
      : countSchoolObjectKeys(parsed);

  if (spec.warnBelowCount != null && count < spec.warnBelowCount) {
    console.warn(
      `[runtime-assets] WARN support ${spec.rel} count=${count} (expected >= ${spec.warnBelowCount})`
    );
    return;
  }
  console.log(`[runtime-assets] OK support ${spec.rel} (${count} for ${DA_SILVA_SCHOOL_ID})`);
}

console.log(`[runtime-assets] Repairing missing support files under ${BACKEND_ROOT}/data`);
const repair = repairMissingSupportFiles(BACKEND_ROOT);
if (repair.created.length) {
  for (const row of repair.created) {
    console.log(`[runtime-assets] repaired ${row.file} from ${row.source}`);
  }
}

console.log(`[runtime-assets] Verifying critical billing files`);
for (const spec of CRITICAL_FILES) {
  verifyCriticalFile(spec);
}

console.log(`[runtime-assets] Verifying support files`);
for (const spec of SUPPORT_FILES) {
  verifySupportFile(spec);
}

console.log("[runtime-assets] All runtime asset checks complete");
