/**
 * Rate-limit scoping regression — ensure staff/PayFast routes do not import OA limiter.
 * Run: npx ts-node --transpile-only src/middleware/publicAdmissionsRateLimit.scope.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";

/** Resolve backend/src whether run from source or compiled outDir. */
function resolveSrcRoot(): string {
  const candidates = [
    path.join(__dirname, ".."),
    path.join(process.cwd(), "src"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "routes", "publicAdmissions.ts"))) {
      return candidate;
    }
  }
  throw new Error("Could not locate backend/src for scope regression reads");
}

const root = resolveSrcRoot();

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const publicRoute = read("routes/publicAdmissions.ts");
const staffRoute = read("routes/admissions.ts");
const payfastRoute = read("routes/payfast.ts");
const indexSrc = read("index.ts");

assert.ok(
  publicRoute.includes("publicAdmissionsRateLimit"),
  "public OA routes must attach rate limit middleware"
);
assert.ok(
  !staffRoute.includes("publicAdmissionsRateLimit"),
  "staff /api/admissions must not use public OA rate limiter"
);
assert.ok(
  !payfastRoute.includes("publicAdmissionsRateLimit"),
  "PayFast routes must not use public OA rate limiter"
);
assert.ok(
  !indexSrc.includes("publicAdmissionsRateLimit"),
  "index must not globally mount OA rate limiter"
);
assert.ok(
  indexSrc.includes('"/api/public/admissions/:schoolSlug"'),
  "public OA mount path preserved"
);
assert.ok(indexSrc.includes('"/api/admissions"'), "staff admissions mount preserved");
assert.ok(indexSrc.includes('"/api/payfast"'), "payfast mount preserved");
assert.ok(!indexSrc.includes('trust proxy'), "must not enable Express trust proxy");

console.log("✓ OA rate-limit scoping: public only; staff/PayFast/index untouched");
console.log("\nAll publicAdmissionsRateLimit scope tests passed.");
