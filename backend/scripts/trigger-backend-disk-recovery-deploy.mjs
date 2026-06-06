/**
 * Attach billing disk (if missing), remove AUTO_SEED env, trigger educlear-backend deploy.
 *
 *   RENDER_API_KEY=... node backend/scripts/trigger-backend-disk-recovery-deploy.mjs
 */
const SERVICE_NAME = "educlear-backend";
const RENDER_KEY = process.env.RENDER_API_KEY || "";
const DISK_NAME = "educlear-billing-data";
const DISK_MOUNT = "/opt/render/project/src/backend/data";
const DISK_SIZE_GB = 1;
const AUTO_SEED_ENV = "AUTO_SEED_PHASE1_BILLING_DISK";

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
  if (!res.ok) {
    throw new Error(`Render ${path} ${res.status}: ${JSON.stringify(data).slice(0, 800)}`);
  }
  return data;
}

async function findServiceId() {
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

async function listDisks(serviceId) {
  const data = await renderFetch(`/services/${serviceId}/disks`);
  return Array.isArray(data) ? data.map((row) => row.disk || row) : [];
}

async function ensureDisk(serviceId) {
  const disks = await listDisks(serviceId);
  const existing = disks.find(
    (d) => d.mountPath === DISK_MOUNT || d.name === DISK_NAME
  );
  if (existing) {
    console.log(`Disk already attached: ${existing.name} @ ${existing.mountPath}`);
    return existing;
  }
  console.log(`Creating disk ${DISK_NAME} @ ${DISK_MOUNT} (${DISK_SIZE_GB}GB)...`);
  const created = await renderFetch(`/services/${serviceId}/disks`, {
    method: "POST",
    body: JSON.stringify({
      name: DISK_NAME,
      mountPath: DISK_MOUNT,
      sizeGB: DISK_SIZE_GB,
    }),
  });
  const disk = created.disk || created;
  console.log(`Disk created: ${disk.id}`);
  return disk;
}

async function listEnvVars(serviceId) {
  const data = await renderFetch(`/services/${serviceId}/env-vars`);
  return Array.isArray(data) ? data.map((row) => row.envVar || row) : [];
}

async function removeEnvVar(serviceId, key) {
  const rows = await listEnvVars(serviceId);
  const existing = rows.find((row) => row.key === key);
  const id = existing?.id;
  if (!id) {
    console.log(`Env var not set (OK): ${key}`);
    return;
  }
  await renderFetch(`/services/${serviceId}/env-vars/${id}`, { method: "DELETE" });
  console.log(`Removed env var: ${key}`);
}

async function triggerDeploy(serviceId) {
  console.log("Triggering backend deploy...");
  const result = await renderFetch(`/services/${serviceId}/deploys`, {
    method: "POST",
    body: JSON.stringify({ clearCache: "do_not_clear" }),
  });
  const deploy = result.deploy || result;
  console.log(`Deploy triggered: ${deploy.id} status=${deploy.status}`);
  return deploy;
}

async function main() {
  if (!RENDER_KEY) {
    console.error("Set RENDER_API_KEY");
    process.exit(1);
  }
  const serviceId = await findServiceId();
  console.log(`Service: ${SERVICE_NAME} (${serviceId})`);
  await ensureDisk(serviceId);
  await removeEnvVar(serviceId, AUTO_SEED_ENV);
  await triggerDeploy(serviceId);
  console.log("Done. Poll GET /api/payments/env/full until persistentDiskDetected=true");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
