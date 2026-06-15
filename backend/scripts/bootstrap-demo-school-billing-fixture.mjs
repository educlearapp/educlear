/**
 * One-time bootstrap: seed EduClear Demo School billing fixture when env flags are set.
 * Never touches Da Silva JSON. Skips when demo fixture already present.
 *
 * Render (one deploy only — remove env vars after verify):
 *   AUTO_SEED_DEMO_SCHOOL_BILLING_FIXTURE=true
 *   CONFIRM_DEMO_SCHOOL_BILLING_FIXTURE=true
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DEMO_SCHOOL_ID = "cmpbdigd00001vuzmxnwkbgiu";
const AUTO_ENV = "AUTO_SEED_DEMO_SCHOOL_BILLING_FIXTURE";
const CONFIRM_ENV = "CONFIRM_DEMO_SCHOOL_BILLING_FIXTURE";
const EXPECTED_REFS = ["TST001", "TST002", "TST003"];

function readDemoAgeRefs() {
  const agePath = path.join(BACKEND_ROOT, "data", "family-account-age-analysis.json");
  if (!fs.existsSync(agePath)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(agePath, "utf8"));
    const school = parsed?.[DEMO_SCHOOL_ID];
    if (!school || typeof school !== "object") return [];
    return Object.keys(school).map((r) => String(r).toUpperCase()).sort();
  } catch {
    return [];
  }
}

function main() {
  const auto = String(process.env[AUTO_ENV] || "").trim().toLowerCase() === "true";
  const confirm = String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() === "true";
  const refs = readDemoAgeRefs();
  const expected = [...EXPECTED_REFS].sort();
  const hasFixture =
    refs.length === expected.length && refs.every((ref, i) => ref === expected[i]);

  if (hasFixture) {
    console.log(`[bootstrap-demo-fixture] OK demo fixture present (${refs.join(", ")}), skip seed`);
    return;
  }

  if (!auto || !confirm) {
    console.log(
      `[bootstrap-demo-fixture] Demo fixture not present (refs=${refs.length}). Set ${AUTO_ENV}=true and ${CONFIRM_ENV}=true to seed once.`
    );
    return;
  }

  console.log("[bootstrap-demo-fixture] Seeding EduClear Demo School billing fixture...");
  const result = spawnSync("npx", ["tsx", "scripts/seed-demo-school-billing-fixture.ts", "--apply"], {
    cwd: BACKEND_ROOT,
    stdio: "inherit",
    env: {
      ...process.env,
      [CONFIRM_ENV]: "true",
    },
  });

  if (result.status !== 0) {
    console.error("[bootstrap-demo-fixture] Seed failed");
    process.exit(result.status || 1);
  }

  console.log("[bootstrap-demo-fixture] Seed complete");
}

main();
