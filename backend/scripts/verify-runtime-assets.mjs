/**
 * Verify billing JSON stores for production boot.
 * Critical files must exist and pass validation.
 * Support files are repaired if missing (never overwrites existing).
 *
 * Age-analysis rules are integrity-based (not a hard historical ceiling):
 * - floor minCount (Phase-1)
 * - unique account refs
 * - forbidden refs (JAC001, LET007)
 * - required snapshot fields
 * - educlear-registration rows must link to ≥1 learner in DB (Render / explicit opt-in)
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

const REQUIRED_SNAPSHOT_FIELDS = ["schoolId", "accountRef", "accountHolder", "balance", "buckets", "source", "importedAt"];
const ALLOWED_SOURCES = new Set(["kideesys-age-analysis", "educlear-registration"]);

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
    // No exactCount / allowedCounts ceiling — production grows with genuine registrations.
    forbiddenAccountRefs: ["JAC001", "LET007"],
    integrityAgeAnalysis: true,
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

function shouldVerifyRegistrationLearnerLinks() {
  if (String(process.env.SKIP_AGE_ANALYSIS_DB_VERIFY || "").trim() === "true") return false;
  if (String(process.env.VERIFY_AGE_ANALYSIS_DB_LINKS || "").trim() === "true") return true;
  return String(process.env.RENDER || "").trim() === "true";
}

function verifyAgeAnalysisIntegrity(rel, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    fail(`${rel} school ${DA_SILVA_SCHOOL_ID} payload is not an object`);
  }

  const refs = Object.keys(payload);
  const normalized = refs.map((r) => String(r || "").trim().toUpperCase());
  const seen = new Map();
  for (let i = 0; i < refs.length; i++) {
    const raw = refs[i];
    const norm = normalized[i];
    if (!norm) {
      fail(`${rel} contains an empty account reference key`);
    }
    if (seen.has(norm)) {
      fail(
        `${rel} duplicate account reference ${norm} (keys ${JSON.stringify(seen.get(norm))} and ${JSON.stringify(raw)})`
      );
    }
    seen.set(norm, raw);
    if (raw !== norm) {
      fail(`${rel} account key ${JSON.stringify(raw)} must be uppercase trimmed (${norm})`);
    }
  }

  for (const ref of refs) {
    const row = payload[ref];
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      fail(`${rel} account ${ref} is malformed (not an object)`);
    }
    for (const field of REQUIRED_SNAPSHOT_FIELDS) {
      if (row[field] === undefined || row[field] === null || row[field] === "") {
        fail(`${rel} account ${ref} missing required field ${field}`);
      }
    }
    if (String(row.accountRef || "").trim().toUpperCase() !== ref) {
      fail(
        `${rel} account ${ref} has mismatched accountRef field ${JSON.stringify(row.accountRef)}`
      );
    }
    if (String(row.schoolId || "").trim() !== DA_SILVA_SCHOOL_ID) {
      fail(`${rel} account ${ref} has unexpected schoolId ${JSON.stringify(row.schoolId)}`);
    }
    if (!ALLOWED_SOURCES.has(String(row.source || "").trim())) {
      fail(`${rel} account ${ref} has invalid source ${JSON.stringify(row.source)}`);
    }
    if (typeof row.balance !== "number" || Number.isNaN(row.balance)) {
      fail(`${rel} account ${ref} has invalid balance`);
    }
    const buckets = row.buckets;
    if (!buckets || typeof buckets !== "object" || Array.isArray(buckets)) {
      fail(`${rel} account ${ref} has invalid buckets`);
    }
  }

  console.log(
    `[runtime-assets] OK age-analysis integrity (${refs.length} unique refs, required fields present)`
  );
}

async function verifyEduclearRegistrationLearnerLinks(rel, payload) {
  if (!shouldVerifyRegistrationLearnerLinks()) {
    console.log(
      "[runtime-assets] skip DB learner-link check for educlear-registration rows (set VERIFY_AGE_ANALYSIS_DB_LINKS=true to force)"
    );
    return;
  }
  if (!process.env.DATABASE_URL) {
    fail(`${rel} DB learner-link check required but DATABASE_URL is not set`);
  }

  const registrationRefs = Object.keys(payload).filter(
    (ref) => String(payload[ref]?.source || "").trim() === "educlear-registration"
  );
  if (!registrationRefs.length) {
    console.log("[runtime-assets] OK no educlear-registration age-analysis rows requiring learner links");
    return;
  }

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    for (const ref of registrationRefs) {
      const fa = await prisma.familyAccount.findUnique({
        where: {
          schoolId_accountRef: { schoolId: DA_SILVA_SCHOOL_ID, accountRef: ref },
        },
        select: {
          id: true,
          accountRef: true,
          _count: { select: { learners: true } },
        },
      });
      if (!fa) {
        fail(
          `${rel} orphan educlear-registration account ${ref}: FamilyAccount row missing`
        );
      }
      if (!fa._count.learners) {
        fail(
          `${rel} orphan educlear-registration account ${ref}: FamilyAccount ${fa.id} has zero learners`
        );
      }
    }
    console.log(
      `[runtime-assets] OK educlear-registration learner links (${registrationRefs.length} account(s))`
    );
  } finally {
    await prisma.$disconnect();
  }
}

async function verifyCriticalFile(spec) {
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

  if (Array.isArray(spec.forbiddenAccountRefs) && spec.kind === "school-object") {
    const payload = parsed?.[DA_SILVA_SCHOOL_ID];
    const forbidden = spec.forbiddenAccountRefs.filter(
      (ref) => payload && typeof payload === "object" && ref in payload
    );
    if (forbidden.length) {
      fail(`${spec.rel} must not contain excluded account(s): ${forbidden.join(", ")}`);
    }
  }

  if (spec.integrityAgeAnalysis && spec.kind === "school-object") {
    const payload = parsed?.[DA_SILVA_SCHOOL_ID];
    verifyAgeAnalysisIntegrity(spec.rel, payload);
    await verifyEduclearRegistrationLearnerLinks(spec.rel, payload || {});
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

async function main() {
  console.log(`[runtime-assets] Repairing missing support files under ${BACKEND_ROOT}/data`);
  const repair = repairMissingSupportFiles(BACKEND_ROOT);
  if (repair.created.length) {
    for (const row of repair.created) {
      console.log(`[runtime-assets] repaired ${row.file} from ${row.source}`);
    }
  }

  console.log(`[runtime-assets] Verifying critical billing files`);
  for (const spec of CRITICAL_FILES) {
    await verifyCriticalFile(spec);
  }

  console.log(`[runtime-assets] Verifying support files`);
  for (const spec of SUPPORT_FILES) {
    verifySupportFile(spec);
  }

  console.log("[runtime-assets] All runtime asset checks complete");
}

main().catch((error) => {
  console.error(`[runtime-assets] FAIL: ${error?.message || error}`);
  process.exit(1);
});
