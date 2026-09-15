/**
 * Staging CORS allowlist — focused unit tests.
 * Run: npx ts-node --transpile-only src/utils/corsAllowlist.unit.test.ts
 */
import assert from "assert";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_CORS_ALLOWED_ORIGINS,
  isCorsOriginAllowed,
  resolveCorsAllowedOrigins,
} from "./outboundSafety";

const STAGING_FRONTEND = "https://educlear-frontend-staging.onrender.com";
const PRODUCTION_FRONTEND = "https://educlear-frontend.onrender.com";
const ARBITRARY = "https://evil.example.com";

function testDefaultListIncludesStagingAndProduction() {
  assert.ok(
    DEFAULT_CORS_ALLOWED_ORIGINS.includes(STAGING_FRONTEND),
    "DEFAULT_CORS must include staging frontend"
  );
  assert.ok(
    DEFAULT_CORS_ALLOWED_ORIGINS.includes(PRODUCTION_FRONTEND),
    "DEFAULT_CORS must preserve production frontend"
  );
  assert.ok(
    !DEFAULT_CORS_ALLOWED_ORIGINS.includes(ARBITRARY),
    "DEFAULT_CORS must not include arbitrary origins"
  );
}

function testResolvedAllowlistBehaviour() {
  const allowed = resolveCorsAllowedOrigins(undefined);
  assert.strictEqual(isCorsOriginAllowed(STAGING_FRONTEND, allowed, { isDev: false }), true);
  assert.strictEqual(isCorsOriginAllowed(PRODUCTION_FRONTEND, allowed, { isDev: false }), true);
  assert.strictEqual(isCorsOriginAllowed(ARBITRARY, allowed, { isDev: false }), false);
  assert.strictEqual(isCorsOriginAllowed(undefined, allowed, { isDev: false }), true);
}

function testIndexTsRuntimeAllowlistSynced() {
  const src = readFileSync(join(__dirname, "../index.ts"), "utf8");
  assert.ok(
    src.includes(`"${STAGING_FRONTEND}"`),
    "backend/src/index.ts CORS allowlist must include staging frontend"
  );
  assert.ok(
    src.includes(`"${PRODUCTION_FRONTEND}"`),
    "backend/src/index.ts CORS allowlist must preserve production frontend"
  );
  assert.ok(!src.includes('"*"') || !/allowedOrigins[\s\S]*"\*"/.test(src), "must not use wildcard CORS");
  // Ensure arbitrary domain is not present in the allowlist block.
  assert.ok(!src.includes(ARBITRARY), "must not allow arbitrary origin");
}

function main() {
  testDefaultListIncludesStagingAndProduction();
  testResolvedAllowlistBehaviour();
  testIndexTsRuntimeAllowlistSynced();
  console.log("corsAllowlist.unit.test.ts: all passed");
}

main();
