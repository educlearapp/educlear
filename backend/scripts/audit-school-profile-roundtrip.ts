/**
 * School profile PUT → GET round-trip (no auth on local /api/schools).
 * Usage: npx tsx scripts/audit-school-profile-roundtrip.ts [schoolId] [apiBase]
 */
const SCHOOL_ID = process.argv[2] || "cmpideqeq0000108xb6ouv9zi";
const API_BASE = (process.argv[3] || process.env.PUBLIC_API_URL || "http://localhost:3000").replace(
  /\/$/,
  ""
);

type SchoolRow = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  cellNo?: string | null;
  address?: string | null;
  postalAddress?: string | null;
  bankingDetails?: string | null;
  logoUrl?: string | null;
};

async function fetchSchool(): Promise<SchoolRow> {
  const res = await fetch(`${API_BASE}/api/schools/${encodeURIComponent(SCHOOL_ID)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET failed ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as SchoolRow;
}

async function putSchool(body: Record<string, unknown>): Promise<SchoolRow> {
  const res = await fetch(`${API_BASE}/api/schools/${encodeURIComponent(SCHOOL_ID)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`PUT failed ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text) as SchoolRow;
}

function lines4(value: string | null | undefined): string {
  return String(value || "")
    .split(/\r?\n/)
    .slice(0, 4)
    .join("|");
}

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const before = await fetchSchool();
  const logoUrl = before.logoUrl ?? null;

  const probe = {
    name: `Da Silva Academy`,
    email: `profile-audit-${stamp}@example.com`,
    phone: `011-${stamp.slice(-6)}`,
    cellNo: `082-${stamp.slice(-6)}`,
    address: `Physical line 1 ${stamp}\nPhysical line 2`,
    postalAddress: `Postal line 1 ${stamp}\nPostal line 2`,
    bankingDetails: `Bank line 1 ${stamp}\nBank line 2`,
    logoUrl,
  };

  await putSchool(probe);
  const after = await fetchSchool();

  await putSchool({
    name: before.name || "Da Silva Academy",
    email: before.email,
    phone: before.phone,
    cellNo: before.cellNo,
    address: before.address,
    postalAddress: before.postalAddress ?? null,
    bankingDetails: before.bankingDetails,
    logoUrl,
  });

  const checks: Array<{ field: string; ok: boolean; expected: string; actual: string }> = [
    {
      field: "name",
      ok: after.name === probe.name,
      expected: probe.name,
      actual: String(after.name || ""),
    },
    {
      field: "email",
      ok: after.email === probe.email,
      expected: String(probe.email),
      actual: String(after.email || ""),
    },
    {
      field: "phone (tel)",
      ok: after.phone === probe.phone,
      expected: String(probe.phone),
      actual: String(after.phone || ""),
    },
    {
      field: "cellNo (cell)",
      ok: after.cellNo === probe.cellNo,
      expected: String(probe.cellNo),
      actual: String(after.cellNo || ""),
    },
    {
      field: "address (physical)",
      ok: lines4(after.address) === lines4(probe.address),
      expected: lines4(probe.address),
      actual: lines4(after.address),
    },
    {
      field: "postalAddress",
      ok: lines4(after.postalAddress) === lines4(probe.postalAddress),
      expected: lines4(probe.postalAddress),
      actual: lines4(after.postalAddress),
    },
    {
      field: "bankingDetails",
      ok: lines4(after.bankingDetails) === lines4(probe.bankingDetails),
      expected: lines4(probe.bankingDetails),
      actual: lines4(after.bankingDetails),
    },
    {
      field: "logoUrl",
      ok: (after.logoUrl || null) === (probe.logoUrl || null),
      expected: String(probe.logoUrl || "(null)"),
      actual: String(after.logoUrl || "(null)"),
    },
  ];

  console.log("=== School profile API round-trip ===");
  console.log(`School: ${SCHOOL_ID}`);
  console.log(`API: ${API_BASE}`);
  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? "PASS" : "FAIL"} — ${c.field}`);
    if (!c.ok) {
      failed += 1;
      console.log(`  expected: ${c.expected}`);
      console.log(`  actual:   ${c.actual}`);
    }
  }
  console.log(failed === 0 ? "RESULT: PASS" : `RESULT: FAIL (${failed} field(s))`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
