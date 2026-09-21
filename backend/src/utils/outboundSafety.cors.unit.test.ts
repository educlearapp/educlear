/**
 * CORS allowlist unit tests (staging origin + no wildcard).
 * Run: npx tsx src/utils/outboundSafety.cors.unit.test.ts
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import cors from "cors";
import express from "express";
import {
  DEFAULT_CORS_ALLOWED_HEADERS,
  DEFAULT_CORS_ALLOWED_ORIGINS,
  isCorsOriginAllowed,
  parseCorsAllowedOrigins,
  resolveCorsAllowedOrigins,
} from "./outboundSafety";

const STAGING_FE = "https://educlear-frontend-staging.onrender.com";
const PROD_FE = "https://educlear-frontend.onrender.com";
const PROD_CUSTOM_DOMAIN = "https://www.educlear.co.za";

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

async function testApplicantTokenPreflight() {
  const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
      callback(
        null,
        isCorsOriginAllowed(origin, resolveCorsAllowedOrigins(undefined), { isDev: false })
      );
    },
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [...DEFAULT_CORS_ALLOWED_HEADERS],
    credentials: true,
  };
  const app = express();
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/public/admissions/test/documents`, {
      method: "OPTIONS",
      headers: {
        Origin: PROD_CUSTOM_DOMAIN,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "X-Admissions-Access-Token",
      },
    });

    assert.equal(response.status, 204, "preflight succeeds");
    assert.equal(response.headers.get("access-control-allow-origin"), PROD_CUSTOM_DOMAIN);
    const allowedHeaders = String(response.headers.get("access-control-allow-headers") || "")
      .toLowerCase()
      .split(",")
      .map((header) => header.trim());
    assert.ok(
      allowedHeaders.includes("x-admissions-access-token"),
      "applicant token header permitted"
    );
    console.log("✓ production-origin preflight permits applicant access token header");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function main() {
  testDefaultsIncludeStagingAndProduction();
  testResolveAllowsStagingRejectsArbitrary();
  testEnvAdditiveNoReplace();
  await testApplicantTokenPreflight();
  console.log("\nAll outboundSafety CORS tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
