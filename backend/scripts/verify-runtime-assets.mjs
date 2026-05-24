/**
 * Verify Da Silva / EduClear JSON stores and logo are present for production deploy.
 * Runs after `tsc` in npm run build and before `node dist/index.js` in npm start.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

const REQUIRED_FILES = [
  {
    rel: "data/billing-ledger.json",
    kind: "school-array",
    minCount: 337,
  },
  {
    rel: "data/kidesys-transaction-history.json",
    kind: "school-array",
    minCount: 40916,
  },
  {
    rel: "data/learner-billing-plans.json",
    kind: "school-object",
    minCount: 396,
  },
  {
    rel: "data/user-access.json",
    kind: "user-access",
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

function countSchoolPayload(parsed, kind) {
  const payload = parsed?.[DA_SILVA_SCHOOL_ID];
  if (kind === "school-array") {
    return Array.isArray(payload) ? payload.length : 0;
  }
  if (kind === "school-object") {
    return payload && typeof payload === "object" && !Array.isArray(payload)
      ? Object.keys(payload).length
      : 0;
  }
  return 0;
}

function verifyFile(spec) {
  const absPath = path.join(BACKEND_ROOT, spec.rel);
  if (!fs.existsSync(absPath)) {
    fail(`missing ${spec.rel} (expected at ${absPath})`);
  }

  if (spec.kind === "binary") {
    const size = fs.statSync(absPath).size;
    if (size < (spec.minBytes || 1)) {
      fail(`${spec.rel} too small (${size} bytes)`);
    }
    console.log(`[runtime-assets] OK ${spec.rel} (${size} bytes)`);
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
      fail(`${spec.rel} has no users`);
    }
    console.log(`[runtime-assets] OK ${spec.rel} (${userCount} user(s))`);
    return;
  }

  const count = countSchoolPayload(parsed, spec.kind);
  if (count < spec.minCount) {
    fail(
      `${spec.rel} school ${DA_SILVA_SCHOOL_ID} count=${count}, expected >= ${spec.minCount}`
    );
  }
  console.log(`[runtime-assets] OK ${spec.rel} (${count} for ${DA_SILVA_SCHOOL_ID})`);
}

console.log(`[runtime-assets] Verifying deployment assets under ${BACKEND_ROOT}`);
for (const spec of REQUIRED_FILES) {
  verifyFile(spec);
}
console.log("[runtime-assets] All deployment assets verified");
