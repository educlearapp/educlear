/**
 * Deploy educlear-frontend at recovery commit (Statement Manage transactions fix).
 *
 *   RENDER_API_KEY=... node backend/scripts/trigger-frontend-recovery-deploy.mjs
 */
const COMMIT = "793a652f9c3d36254343858eff5633484b72a4b4";
const BUILD_ID = "793a652-phase1-recovery";
const SERVICE_NAME = "educlear-frontend";
const RENDER_KEY = process.env.RENDER_API_KEY || "";

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

async function findFrontendServiceId() {
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({ limit: "100", name: SERVICE_NAME });
    if (cursor) q.set("cursor", cursor);
    const data = await renderFetch(`/services?${q}`);
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
      const svc = row.service || row;
      if (svc?.name === SERVICE_NAME || svc?.slug === SERVICE_NAME) return svc.id;
    }
    cursor = data?.cursor || "";
    if (!cursor || rows.length === 0) break;
  }
  throw new Error(`Service not found: ${SERVICE_NAME}`);
}

async function patchEnv(serviceId) {
  const env = await renderFetch(`/services/${serviceId}/env-vars`);
  const rows = Array.isArray(env) ? env : [];
  const upsert = async (key, value) => {
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
  };
  await upsert("VITE_FEE_CHECK_BUILD_ID", BUILD_ID);
  await upsert("VITE_API_URL", "https://educlear-backend.onrender.com");
  console.log(`Env vars set: VITE_FEE_CHECK_BUILD_ID=${BUILD_ID}`);
}

async function triggerDeploy(serviceId) {
  const deploy = await renderFetch(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ commitId: COMMIT, clearCache: true }),
  });
  const id = deploy.id || deploy.deploy?.id;
  console.log(`Frontend deploy triggered: ${id || JSON.stringify(deploy).slice(0, 200)}`);
  return id;
}

async function main() {
  if (!RENDER_KEY) {
    console.error("Set RENDER_API_KEY");
    process.exit(1);
  }
  const serviceId = await findFrontendServiceId();
  console.log(`Service ${SERVICE_NAME}: ${serviceId}`);
  await patchEnv(serviceId);
  await triggerDeploy(serviceId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
