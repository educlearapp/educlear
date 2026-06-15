/**
 * Production one-off: seed EduClear Demo School billing fixture via Render job.
 * Does not touch Da Silva data.
 *
 *   node backend/scripts/deploy-demo-school-billing-fixture.mjs
 *
 * Requires: code deployed to Render (seed script on disk), Render CLI login.
 */
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

const BACKEND_SERVICE_ID = "srv-d6j8jvma2pns7397bghg";
const API_BASE = "https://educlear-backend.onrender.com";
const DEMO = "cmpbdigd00001vuzmxnwkbgiu";
const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const SEED_CMD =
  "CONFIRM_DEMO_SCHOOL_BILLING_FIXTURE=true npx tsx scripts/seed-demo-school-billing-fixture.ts --apply";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadRenderApiKey() {
  if (process.env.RENDER_API_KEY) return process.env.RENDER_API_KEY;
  const cfgPath = path.join(os.homedir(), ".render", "cli.yaml");
  if (!fs.existsSync(cfgPath)) return "";
  const raw = fs.readFileSync(cfgPath, "utf8");
  const match = raw.match(/^\s*key:\s*(\S+)/m);
  return match?.[1] || "";
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

async function demoFixtureReady() {
  const data = await fetchJson(`${API_BASE}/api/statements?schoolId=${encodeURIComponent(DEMO)}`);
  const rows = Array.isArray(data.statements) ? data.statements : [];
  const refs = rows.map((r) => String(r.accountNo || "").toUpperCase()).sort();
  return refs.join(",") === "TST001,TST002,TST003";
}

async function daSilvaHealthy() {
  const statements = await fetchJson(`${API_BASE}/api/statements?schoolId=${DA_SILVA}`);
  const ledger = await fetchJson(`${API_BASE}/api/invoices/ledger?schoolId=${DA_SILVA}`);
  const count = Array.isArray(statements.statements) ? statements.statements.length : 0;
  const entries = Array.isArray(ledger.entries) ? ledger.entries.length : 0;
  return { ok: count === 344 && entries === 41732, count, entries };
}

async function waitForLiveCommit(expectedPrefix) {
  for (let i = 0; i < 40; i++) {
    try {
      const env = await fetchJson(`${API_BASE}/api/payments/env`);
      const commit = String(env.gitCommit || "");
      if (commit.startsWith(expectedPrefix)) return commit;
    } catch {
      /* retry */
    }
    await sleep(15_000);
  }
  throw new Error(`Timed out waiting for backend deploy commit ${expectedPrefix}`);
}

function runRenderJob() {
  execSync(
    `render jobs create ${BACKEND_SERVICE_ID} --start-command ${JSON.stringify(SEED_CMD)} --confirm`,
    { stdio: "inherit" }
  );
}

async function main() {
  console.log("\n=== Demo school billing fixture — production job ===\n");

  const pre = await daSilvaHealthy();
  if (!pre.ok) {
    throw new Error(
      `Da Silva pre-check failed (${pre.count} accounts, ${pre.entries} ledger entries)`
    );
  }
  console.log("[PASS] Da Silva pre-check: 344 accounts, 41732 ledger");

  if (await demoFixtureReady()) {
    console.log("[OK] Demo fixture already present — nothing to do");
    return;
  }

  const expectedCommit = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  console.log(`[INFO] Waiting for backend deploy @ ${expectedCommit.slice(0, 7)}...`);
  const liveCommit = await waitForLiveCommit(expectedCommit.slice(0, 7));
  console.log(`[PASS] Backend live: ${liveCommit}`);

  console.log("[INFO] Starting Render one-off seed job...");
  runRenderJob();

  console.log("[INFO] Waiting for demo fixture (up to 10 min)...");
  for (let i = 0; i < 40; i++) {
    await sleep(15_000);
    if (await demoFixtureReady()) {
      const post = await daSilvaHealthy();
      if (!post.ok) {
        throw new Error(
          `Da Silva post-check failed (${post.count} accounts, ${post.entries} ledger)`
        );
      }
      console.log("\n[PASS] Demo fixture live: TST001, TST002, TST003");
      console.log("[PASS] Da Silva post-check: 344 accounts, 41732 ledger");
      return;
    }
    process.stdout.write(".");
  }

  throw new Error("Timed out — run verify-demo-school-billing-fixture.ts --api and check Render job logs");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
