/**
 * Trigger educlear-frontend rollback on Render + optional Cloudflare purge.
 *
 *   RENDER_API_KEY=... node backend/scripts/trigger-frontend-rollback-deploy.mjs
 *   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ZONE_ID=... (optional purge)
 */
const COMMIT = "32715bd89336da60b8ddddf1961b54b971bbce48";
const SERVICE_NAME = "educlear-frontend";
const RENDER_KEY = process.env.RENDER_API_KEY || "";
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || "";
const CF_ZONE = process.env.CLOUDFLARE_ZONE_ID || "";

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
  await upsert("VITE_FEE_CHECK_BUILD_ID", "32715bd-rollback");
  await upsert("VITE_API_URL", "https://educlear-backend.onrender.com");
  console.log("Env vars set: VITE_FEE_CHECK_BUILD_ID, VITE_API_URL");
}

async function triggerDeploy(serviceId) {
  const deploy = await renderFetch(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ commitId: COMMIT, clearCache: true }),
  });
  const id = deploy.id || deploy.deploy?.id;
  console.log(`Deploy triggered: ${id || JSON.stringify(deploy).slice(0, 200)}`);
  return id;
}

async function waitDeploy(serviceId, deployId) {
  for (let i = 1; i <= 60; i++) {
    const d = await renderFetch(`/services/${serviceId}/deploys/${deployId}`);
    const status = d.status || d.deploy?.status;
    console.log(`[${i}/60] deploy status: ${status}`);
    if (status === "live") return true;
    if (status === "build_failed" || status === "update_failed" || status === "canceled") {
      throw new Error(`Deploy failed: ${status}`);
    }
    await new Promise((r) => setTimeout(r, 15000));
  }
  throw new Error("Deploy wait timeout");
}

async function purgeCloudflare() {
  if (!CF_TOKEN || !CF_ZONE) {
    console.log("Skip Cloudflare purge (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID not set)");
    return;
  }
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${CF_ZONE}/purge_cache`, {
    method: "POST",
    headers: { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ purge_everything: true }),
  });
  const data = await res.json();
  if (!data.success) throw new Error(`Cloudflare purge failed: ${JSON.stringify(data).slice(0, 300)}`);
  console.log("Cloudflare cache purged");
}

async function verifyBundle() {
  const html = await (await fetch("https://www.educlear.co.za/")).text();
  const m = html.match(/index-[^"]+\.js/);
  const bundle = m ? m[0] : "";
  console.log(`Live bundle: ${bundle || "(none)"}`);
  if (bundle === "index-CU69jto6.js") throw new Error("Still serving index-CU69jto6.js");
  return bundle;
}

async function main() {
  if (!RENDER_KEY) {
    console.error("Set RENDER_API_KEY to use this script.");
    process.exit(1);
  }
  const serviceId = await findFrontendServiceId();
  console.log(`Service ${SERVICE_NAME}: ${serviceId}`);
  await patchEnv(serviceId);
  const deployId = await triggerDeploy(serviceId);
  if (deployId) await waitDeploy(serviceId, deployId);
  await purgeCloudflare();
  const bundle = await verifyBundle();
  console.log(`Rollback frontend live: ${bundle}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
