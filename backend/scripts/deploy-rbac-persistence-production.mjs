/**
 * Production deploy sequence — RBAC persistence fix only.
 * Does NOT touch billing disk, ledger, payments, or migration data.
 *
 *   RENDER_API_KEY=... node backend/scripts/deploy-rbac-persistence-production.mjs
 *
 * Optional:
 *   PRODUCTION_DATABASE_URL=postgresql://...  (else fetched from Render backend env)
 *   SKIP_FRONTEND=1
 *   SKIP_BACKEND=1
 */
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const REPO_ROOT = path.resolve(BACKEND_ROOT, "..");

const RENDER_KEY = process.env.RENDER_API_KEY || "";
const BACKEND_SERVICE = "educlear-backend";
const FRONTEND_SERVICE = "educlear-frontend";
const DA_SILVA_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const BUILD_ID = process.env.RBAC_BUILD_ID || `rbac-persist-${Date.now()}`;

async function renderFetch(pathname, opts = {}) {
  const res = await fetch(`https://api.render.com/v1${pathname}`, {
    ...opts,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${RENDER_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    throw new Error(`Render ${pathname} ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
  }
  return data;
}

async function findServiceId(name) {
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: "100", name });
    if (cursor) q.set("cursor", cursor);
    const data = await renderFetch(`/services?${q}`);
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const svc = row.service || row;
      if (svc?.name === name || svc?.slug === name) return svc.id;
    }
    cursor = data?.cursor || "";
    if (!cursor || rows.length === 0) break;
  }
  throw new Error(`Service not found: ${name}`);
}

async function getEnvVar(serviceId, key) {
  const rows = await renderFetch(`/services/${serviceId}/env-vars`);
  const list = Array.isArray(rows) ? rows : [];
  for (const row of list) {
    const env = row.envVar || row;
    if (env.key === key) return String(env.value || "");
  }
  return "";
}

async function upsertEnv(serviceId, key, value) {
  const rows = await renderFetch(`/services/${serviceId}/env-vars`);
  const list = Array.isArray(rows) ? rows : [];
  const existing = list.find((r) => (r.envVar || r).key === key);
  const id = existing?.envVar?.id || existing?.id;
  if (id) {
    await renderFetch(`/services/${serviceId}/env-vars/${id}`, {
      method: "PUT",
      body: JSON.stringify({ value }),
    });
  } else {
    await renderFetch(`/services/${serviceId}/env-vars`, {
      method: "POST",
      body: JSON.stringify({ key, value }),
    });
  }
}

async function triggerDeploy(serviceId, { clearCache = false } = {}) {
  const body = clearCache ? { clearCache: true } : { clearCache: "do_not_clear" };
  const result = await renderFetch(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const deploy = result.deploy || result;
  return deploy.id;
}

async function waitDeploy(serviceId, deployId, label) {
  for (let i = 1; i <= 80; i++) {
    const d = await renderFetch(`/services/${serviceId}/deploys/${deployId}`);
    const deploy = d.deploy || d;
    const status = deploy.status;
    console.log(`[${label}] [${i}/80] deploy ${deployId}: ${status}`);
    if (status === "live") return deploy;
    if (status === "build_failed" || status === "update_failed" || status === "canceled") {
      throw new Error(`${label} deploy failed: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error(`${label} deploy wait timeout`);
}

function run(cmd, env = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, {
    cwd: BACKEND_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
}

async function runProductionDbSteps(databaseUrl) {
  if (!databaseUrl) throw new Error("PRODUCTION_DATABASE_URL is required for migrate steps");
  const env = { DATABASE_URL: databaseUrl };
  run("npx prisma migrate deploy", env);
  run("npx tsx scripts/migrate-user-access-to-postgres.ts", env);
  run(
    `npx tsx scripts/verify-user-rbac-persistence.ts --schoolId=${DA_SILVA_SCHOOL_ID}`,
    env
  );
}

async function verifyBackendHealth() {
  const res = await fetch("https://educlear-backend.onrender.com/api/health").catch(() => null);
  if (!res) {
    console.log("[health] backend health endpoint unreachable (non-fatal)");
    return;
  }
  const text = await res.text();
  console.log(`[health] GET /api/health → ${res.status} ${text.slice(0, 120)}`);
}

async function main() {
  if (!RENDER_KEY && !process.env.SKIP_BACKEND && !process.env.SKIP_FRONTEND) {
    console.error("Set RENDER_API_KEY");
    process.exit(1);
  }

  let databaseUrl = String(process.env.PRODUCTION_DATABASE_URL || "").trim();
  let backendDeployId = null;

  if (!process.env.SKIP_BACKEND) {
    const backendId = await findServiceId(BACKEND_SERVICE);
    console.log(`Backend service: ${BACKEND_SERVICE} (${backendId})`);

    if (!databaseUrl) {
      databaseUrl = await getEnvVar(backendId, "DATABASE_URL");
      if (databaseUrl) console.log("[env] Loaded DATABASE_URL from Render backend service");
    }

    backendDeployId = await triggerDeploy(backendId, { clearCache: false });
    console.log(`Backend deploy triggered: ${backendDeployId}`);
    await waitDeploy(backendId, backendDeployId, "backend");
    await verifyBackendHealth();
  }

  await runProductionDbSteps(databaseUrl);

  if (!process.env.SKIP_FRONTEND) {
    const frontendId = await findServiceId(FRONTEND_SERVICE);
    console.log(`Frontend service: ${FRONTEND_SERVICE} (${frontendId})`);
    await upsertEnv(frontendId, "VITE_FEE_CHECK_BUILD_ID", BUILD_ID);
    await upsertEnv(frontendId, "VITE_API_URL", "https://educlear-backend.onrender.com");
    const frontendDeployId = await triggerDeploy(frontendId, { clearCache: true });
    console.log(`Frontend deploy triggered: ${frontendDeployId}`);
    await waitDeploy(frontendId, frontendDeployId, "frontend");
  }

  console.log("\n=== RBAC persistence deploy complete ===");
  console.log(`Build id: ${BUILD_ID}`);
  console.log("Manual test: set role + permissions on one user, refresh, logout/login, other browser.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
