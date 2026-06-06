/**
 * Read-only: verify GET /api/payments/env/full persistence flags.
 *
 *   node backend/scripts/verify-billing-persistence-env.mjs
 */
const API_BASE = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
  /\/$/,
  ""
);

async function main() {
  const url = `${API_BASE}/api/payments/env/full`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
    process.exit(1);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error("Non-JSON response — guard endpoint not deployed yet?");
    console.error(text.slice(0, 400));
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));

  const checks = {
    persistentDiskDetected: data.persistentDiskDetected === true,
    paymentWritesAllowed: data.paymentWritesAllowed === true,
    dataDirIsSeparateDeviceFromCwd: data.dataDirIsSeparateDeviceFromCwd === true,
  };

  console.log("\nRequired flags:");
  for (const [key, ok] of Object.entries(checks)) {
    console.log(`  ${ok ? "PASS" : "FAIL"} ${key}=${data[key]}`);
  }

  if (!Object.values(checks).every(Boolean)) {
    process.exit(1);
  }
  console.log("\nAll persistence flags PASS.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
