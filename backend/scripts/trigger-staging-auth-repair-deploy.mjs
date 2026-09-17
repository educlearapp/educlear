/**
 * Deploy educlear-frontend-staging + educlear-backend-staging at a given commit.
 * STAGING ONLY — refuses production service names.
 *
 *   RENDER_API_KEY=... COMMIT=<sha> BUILD_ID=<id> node backend/scripts/trigger-staging-auth-repair-deploy.mjs
 */
const COMMIT = String(process.env.COMMIT || "").trim();
const BUILD_ID = String(process.env.BUILD_ID || `central-auth-${COMMIT.slice(0, 7)}`).trim();
const FRONTEND_SERVICE = "educlear-frontend-staging";
const BACKEND_SERVICE = "educlear-backend-staging";
const STAGING_API = "https://educlear-backend-staging.onrender.com";
const RENDER_KEY = process.env.RENDER_API_KEY || "";

const FORBIDDEN = new Set(["educlear-frontend", "educlear-backend"]);

async function renderFetch(path, opts = {}) {
  const res = await fetch(`https://api.render.com/v1${path}`, {
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
  if (!res.ok) throw new Error(`Render ${path} ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  return data;
}

async function findServiceId(name) {
  if (FORBIDDEN.has(name)) throw new Error(`Refusing production service: ${name}`);
  if (!String(name).includes("staging")) throw new Error(`Service name must include staging: ${name}`);
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: "100", name });
    if (cursor) q.set("cursor", cursor);
    const data = await renderFetch(`/services?${q}`);
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const svc = row.service || row;
      if (svc?.name === name || svc?.slug === name) {
        if (FORBIDDEN.has(svc.name)) throw new Error("Matched production — abort");
        return svc.id;
      }
    }
    cursor = data?.cursor || "";
    if (!cursor || rows.length === 0) break;
  }
  throw new Error(`Service not found: ${name}`);
}

async function upsertEnv(serviceId, key, value) {
  const env = await renderFetch(`/services/${serviceId}/env-vars`);
  const rows = Array.isArray(env) ? env : [];
  const existing = rows.find((r) => (r.envVar || r).key === key);
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

async function triggerDeploy(serviceId, label) {
  const deploy = await renderFetch(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ commitId: COMMIT, clearCache: true }),
  });
  const id = deploy.id || deploy.deploy?.id;
  console.log(`${label} deploy triggered: ${id || JSON.stringify(deploy).slice(0, 200)}`);
  return id;
}

async function main() {
  if (!RENDER_KEY) {
    console.error("Set RENDER_API_KEY");
    process.exit(1);
  }
  if (!/^[a-f0-9]{7,40}$/i.test(COMMIT)) {
    console.error("Set COMMIT=<full or short sha>");
    process.exit(1);
  }
  console.log(`STAGING ONLY deploy\n  commit=${COMMIT}\n  buildId=${BUILD_ID}`);

  const feId = await findServiceId(FRONTEND_SERVICE);
  const beId = await findServiceId(BACKEND_SERVICE);
  console.log(`Frontend ${FRONTEND_SERVICE}: ${feId}`);
  console.log(`Backend ${BACKEND_SERVICE}: ${beId}`);

  await upsertEnv(feId, "VITE_FEE_CHECK_BUILD_ID", BUILD_ID);
  await upsertEnv(feId, "VITE_API_URL", STAGING_API);
  console.log(`Env set: VITE_FEE_CHECK_BUILD_ID=${BUILD_ID} VITE_API_URL=${STAGING_API}`);

  // Frontend-only auth repair is sufficient; still redeploy backend at same commit for pair consistency.
  await triggerDeploy(feId, "Frontend staging");
  await triggerDeploy(beId, "Backend staging");
  console.log("Done. Monitor Render dashboard for staging deploys. Do NOT deploy production.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
