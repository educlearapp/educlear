/**
 * CORS allowlist unit tests (staging origin + no wildcard).
 * Run: npx tsx src/utils/outboundSafety.cors.unit.test.ts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_CORS_ALLOWED_ORIGINS,
  isCorsOriginAllowed,
  parseCorsAllowedOrigins,
  resolveCorsAllowedOrigins,
} from "./outboundSafety";

const STAGING_FE = "https://educlear-frontend-staging.onrender.com";
const PROD_FE = "https://educlear-frontend.onrender.com";

function testDefaultsIncludeStagingAndProduction() {
  assert.ok(DEFAULT_CORS_ALLOWED_ORIGINS.includes(PROD_FE), "production frontend preserved");
  assert.ok(DEFAULT_CORS_ALLOWED_ORIGINS.includes(STAGING_FE), "staging frontend present");
  assert.ok(DEFAULT_CORS_ALLOWED_ORIGINS.includes("http://localhost:5173"), "localhost present");
  assert.ok(
    !DEFAULT_CORS_ALLOWED_ORIGINS.some((o) => o.includes("*")),
    "no wildcard in defaults"
  );
  console.log("✓ defaults include staging + production; no wildcard");
}

function testResolveAllowsStagingRejectsArbitrary() {
  const allowed = resolveCorsAllowedOrigins(undefined);
  assert.equal(isCorsOriginAllowed(STAGING_FE, allowed, { isDev: false }), true);
  assert.equal(isCorsOriginAllowed(PROD_FE, allowed, { isDev: false }), true);
  assert.equal(
    isCorsOriginAllowed("https://evil.example.com", allowed, { isDev: false }),
    false
  );
  assert.equal(isCorsOriginAllowed(undefined, allowed, { isDev: false }), true);
  console.log("✓ staging allowed; arbitrary origin rejected");
}

function testEnvAdditiveNoReplace() {
  const allowed = resolveCorsAllowedOrigins("https://custom-preview.example.com");
  assert.ok(allowed.includes(PROD_FE), "env does not drop production");
  assert.ok(allowed.includes(STAGING_FE), "env does not drop staging");
  assert.ok(allowed.includes("https://custom-preview.example.com"), "env origin additive");
  assert.deepEqual(parseCorsAllowedOrigins("*"), [], "wildcard env entries rejected");
  console.log("✓ CORS_ALLOWED_ORIGINS additive; wildcard env rejected");
}

function main() {
  testDefaultsIncludeStagingAndProduction();
  testResolveAllowsStagingRejectsArbitrary();
  testEnvAdditiveNoReplace();
  console.log("\nAll outboundSafety CORS tests passed.");
}

main();
