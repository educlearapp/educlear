/**
 * OA-06B — public admissions SPA foundation unit + source guards.
 * Run: npx --yes tsx src/publicAdmissions/publicAdmissions.oa06b.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  canStartPublicApplication,
  derivePublicAdmissionsShellState,
  formatAdmissionFeeSummary,
} from "./derivePublicAdmissionsShellState";
import type { PublicAdmissionsConfig } from "./publicAdmissionsTypes";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function baseConfig(overrides: Partial<PublicAdmissionsConfig> = {}): PublicAdmissionsConfig {
  return {
    publicSlug: "demo-school",
    schoolDisplayName: "Demo Academy",
    branding: { logoUrl: "/uploads/logo.png", primaryColor: "#0f4c5c" },
    enabled: true,
    acceptingApplications: true,
    applicationsOpenAt: "2026-01-01T00:00:00.000Z",
    applicationsCloseAt: "2026-12-31T23:59:59.000Z",
    intakeYear: 2027,
    acceptedGrades: ["Grade R", "Grade 1"],
    admissionFeeRequired: true,
    admissionFeeAmount: "350.00",
    currency: "ZAR",
    proofOfPaymentRequired: true,
    paymentVerificationRequired: false,
    requirePaymentVerifiedBeforeAccept: false,
    admissionContactEmail: "admissions@demo.example",
    admissionContactPhone: "+27 11 000 0000",
    requiredDocuments: [],
    applicationQuestions: [],
    privacyNoticeVersion: null,
    declarationText: null,
    ...overrides,
  };
}

// --- Pure shell-state derivation ---
assert.equal(
  derivePublicAdmissionsShellState({
    loading: true,
    notFound: false,
    error: false,
    config: null,
  }),
  "LOADING"
);

assert.equal(
  derivePublicAdmissionsShellState({
    loading: false,
    notFound: true,
    error: false,
    config: null,
  }),
  "NOT_FOUND"
);

assert.equal(
  derivePublicAdmissionsShellState({
    loading: false,
    notFound: false,
    error: true,
    config: null,
  }),
  "ERROR"
);

assert.equal(
  derivePublicAdmissionsShellState({
    loading: false,
    notFound: false,
    error: false,
    config: baseConfig({ acceptingApplications: true }),
  }),
  "OPEN"
);
assert.equal(canStartPublicApplication("OPEN"), true);

assert.equal(
  derivePublicAdmissionsShellState({
    loading: false,
    notFound: false,
    error: false,
    config: baseConfig({ enabled: false, acceptingApplications: false }),
  }),
  "DISABLED"
);
assert.equal(canStartPublicApplication("DISABLED"), false);

assert.equal(
  derivePublicAdmissionsShellState({
    loading: false,
    notFound: false,
    error: false,
    config: baseConfig({
      enabled: true,
      acceptingApplications: false,
      applicationsOpenAt: "2027-01-01T00:00:00.000Z",
      applicationsCloseAt: "2027-06-01T00:00:00.000Z",
    }),
    now: new Date("2026-06-01T00:00:00.000Z"),
  }),
  "CLOSED_BEFORE_WINDOW"
);
assert.equal(canStartPublicApplication("CLOSED_BEFORE_WINDOW"), false);

assert.equal(
  derivePublicAdmissionsShellState({
    loading: false,
    notFound: false,
    error: false,
    config: baseConfig({
      enabled: true,
      acceptingApplications: false,
      applicationsOpenAt: "2025-01-01T00:00:00.000Z",
      applicationsCloseAt: "2025-06-01T00:00:00.000Z",
    }),
    now: new Date("2026-06-01T00:00:00.000Z"),
  }),
  "CLOSED_AFTER_WINDOW"
);
assert.equal(canStartPublicApplication("CLOSED_AFTER_WINDOW"), false);

assert.equal(
  derivePublicAdmissionsShellState({
    loading: false,
    notFound: false,
    error: false,
    config: baseConfig({
      enabled: true,
      acceptingApplications: false,
      applicationsOpenAt: null,
      applicationsCloseAt: null,
    }),
  }),
  "CLOSED"
);
assert.equal(canStartPublicApplication("CLOSED"), false);

assert.equal(formatAdmissionFeeSummary(baseConfig()), "R350.00");
assert.equal(
  formatAdmissionFeeSummary(baseConfig({ admissionFeeRequired: false })),
  null
);

// --- Source / route guards ---
const appSrc = read("App.tsx");
assert.ok(
  /path="\/admissions\/\*"[^>]*element=\{<PublicAdmissionsApp\s*\/>\}/.test(appSrc) ||
    /path=["']\/admissions\/\*["'][\s\S]{0,120}PublicAdmissionsApp/.test(appSrc),
  "/admissions/:slug route resolves via PublicAdmissionsApp"
);
assert.ok(
  /import PublicAdmissionsApp from ["'].*publicAdmissions\/PublicAdmissionsApp["']/.test(appSrc),
  "App imports PublicAdmissionsApp"
);

const apiSrc = read("publicAdmissions/publicAdmissionsApi.ts");
assert.ok(
  /\/api\/public\/admissions\/\$\{encodeURIComponent\(slug\)\}\/config/.test(apiSrc),
  "uses public config endpoint"
);
assert.ok(
  !/\bstaffAuthHeaders\s*\(/.test(apiSrc),
  "public config client does not call staffAuthHeaders()"
);
assert.ok(
  !/Authorization\s*:/.test(apiSrc),
  "public config client does not set Authorization header"
);
assert.ok(!/method:\s*["']POST["']/.test(apiSrc), "OA-06B API client has no POST");

const appPublicSrc = read("publicAdmissions/PublicAdmissionsApp.tsx");
assert.ok(
  /fetchPublicAdmissionsConfig/.test(appPublicSrc),
  "landing loads public config"
);
assert.ok(
  !/\bstaffAuthHeaders\s*\(/.test(appPublicSrc),
  "PublicAdmissionsApp does not use staff auth"
);
assert.ok(
  !/import\s+SchoolDashboard|<\s*SchoolDashboard/.test(appPublicSrc),
  "no SchoolDashboard in public admissions app"
);
assert.ok(
  /path=":publicSlug\/apply"/.test(appPublicSrc),
  "Start Application boundary route :publicSlug/apply exists"
);
assert.ok(
  !/method:\s*["']POST["']/.test(appPublicSrc),
  "landing does not POST applications"
);

const landingSrc = read("publicAdmissions/PublicAdmissionsLandingPage.tsx");
assert.ok(/Loading admissions/.test(landingSrc), "loading state copy present");
assert.ok(/Start Application/.test(landingSrc), "OPEN CTA present");
assert.ok(
  /Applications are currently closed/.test(landingSrc),
  "closed/disabled parent-facing copy present"
);
assert.ok(/Admissions unavailable/.test(landingSrc), "invalid slug copy present");
assert.ok(/Temporarily unavailable/.test(landingSrc), "API error copy present");
assert.ok(/Intake year/.test(landingSrc), "intake year display");
assert.ok(/Grades accepting applications/.test(landingSrc), "grades display");
assert.ok(/Admission fee/.test(landingSrc), "fee summary display");
assert.ok(/Admissions contact/.test(landingSrc), "contact display");
assert.ok(
  /canStartPublicApplication\(state\)/.test(landingSrc),
  "Start Application gated on OPEN"
);
assert.ok(
  !/SchoolDashboard|sidebar|billing menus/i.test(landingSrc),
  "landing has no staff dashboard chrome markers"
);

const layoutSrc = read("publicAdmissions/PublicAdmissionsLayout.tsx");
assert.ok(
  /data-testid="public-admissions-shell"/.test(layoutSrc),
  "public shell marker"
);
assert.ok(
  !/import\s+SchoolDashboard|<\s*SchoolDashboard/.test(layoutSrc),
  "layout is not SchoolDashboard"
);
assert.ok(/Online Admissions/.test(layoutSrc), "public admissions branding eyebrow");

const placeholderSrc = read("publicAdmissions/PublicAdmissionsApplyPlaceholder.tsx");
assert.ok(
  /No application has been created yet/.test(placeholderSrc),
  "apply placeholder does not create application"
);
assert.ok(!/fetch\(/.test(placeholderSrc), "apply placeholder does not call APIs");
assert.ok(!/method:\s*["']POST["']/.test(placeholderSrc), "no draft POST in placeholder");

const cssSrc = read("publicAdmissions/publicAdmissions.css");
assert.ok(/min-height:\s*3rem/.test(cssSrc), "mobile-friendly CTA height");
assert.ok(/max-width:\s*40rem/.test(cssSrc), "narrow mobile-first content column");

// Landing must not create applications on render (no POST in OA-06B public module)
const moduleFiles = fs
  .readdirSync(path.join(root, "publicAdmissions"))
  .filter((f) => (f.endsWith(".ts") || f.endsWith(".tsx")) && !f.includes(".test."));
for (const file of moduleFiles) {
  const src = read(`publicAdmissions/${file}`);
  assert.ok(!/method:\s*["']POST["']/.test(src), `${file}: must not POST in OA-06B`);
  assert.ok(!/\bstaffAuthHeaders\s*\(/.test(src), `${file}: no staffAuthHeaders()`);
  assert.ok(
    !/import\s+SchoolDashboard|<\s*SchoolDashboard/.test(src),
    `${file}: no SchoolDashboard import/usage`
  );
}

console.log("✓ OA-06B public admissions foundation unit tests passed");
