/**
 * READ-ONLY verification for EduClear Demo School billing fixture.
 * No invoices, payments, or ledger writes.
 *
 * Local resolver + JSON checks:
 *   npx tsx scripts/verify-demo-school-billing-fixture.ts
 *
 * Production API checks:
 *   API_BASE=https://educlear-backend.onrender.com npx tsx scripts/verify-demo-school-billing-fixture.ts --api
 */
import fs from "fs";
import path from "path";

import {
  DA_SILVA_BILLING_DATA_SCHOOL_ID,
  resolveSchoolJsonStoreKey,
} from "../src/services/daSilvaSchoolResolve";

const DA_SILVA = DA_SILVA_BILLING_DATA_SCHOOL_ID;
const DEMO = "cmpbdigd00001vuzmxnwkbgiu";
const EXPECTED_ACCOUNTS = ["TST001", "TST002", "TST003"] as const;
const FIXTURE_FILE = path.join(process.cwd(), "fixtures", "demo-school-billing-fixture.json");

type StatementRow = {
  accountNo?: string;
  balance?: number;
  name?: string;
  surname?: string;
};

function readJson(filePath: string): Record<string, unknown> {
  if (!fs.existsSync(filePath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function verifyFixtureDefinition(): void {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_FILE, "utf8")) as {
    schoolId: string;
    accounts: Array<{ accountRef: string; learner: { firstName: string } }>;
  };
  if (fixture.schoolId !== DEMO) {
    throw new Error(`[FAIL] Fixture schoolId must be ${DEMO}`);
  }
  const refs = fixture.accounts.map((a) => String(a.accountRef).toUpperCase());
  for (const expected of EXPECTED_ACCOUNTS) {
    if (!refs.includes(expected)) {
      throw new Error(`[FAIL] Fixture missing account ${expected}`);
    }
  }
  for (const account of fixture.accounts) {
    if (!String(account.learner.firstName || "").includes("TEST")) {
      throw new Error(`[FAIL] Learner for ${account.accountRef} must be named TEST`);
    }
  }
  console.log("[PASS] Fixture definition: 3 TEST accounts for demo school");
}

function verifyLocalJsonRoutes(): void {
  const dataDir = path.join(process.cwd(), "data");
  const ledgerAll = readJson(path.join(dataDir, "billing-ledger.json"));
  const ageAll = readJson(path.join(dataDir, "family-account-age-analysis.json"));

  const daSilvaLedgerKey = resolveSchoolJsonStoreKey(DA_SILVA, ledgerAll, (v) =>
    Array.isArray(v) ? v.length > 0 : false
  );
  const demoLedgerKey = resolveSchoolJsonStoreKey(DEMO, ledgerAll, (v) =>
    Array.isArray(v) ? v.length > 0 : false
  );
  const demoAgeKey = resolveSchoolJsonStoreKey(DEMO, ageAll, (v) =>
    v && typeof v === "object" ? Object.keys(v as object).length > 0 : false
  );

  if (daSilvaLedgerKey !== DA_SILVA) {
    throw new Error(`[FAIL] Da Silva ledger key ${daSilvaLedgerKey}`);
  }
  if (demoLedgerKey !== DEMO) {
    throw new Error(`[FAIL] Demo ledger key ${demoLedgerKey}`);
  }
  if (demoAgeKey !== DEMO) {
    throw new Error(`[FAIL] Demo age-analysis key ${demoAgeKey}`);
  }
  console.log("[PASS] Store keys: Da Silva → canonical, Demo → own bucket");

  const demoAge =
    ageAll[DEMO] && typeof ageAll[DEMO] === "object"
      ? Object.keys(ageAll[DEMO] as Record<string, unknown>)
      : [];
  if (!demoAge.length) {
    console.log("[SKIP] Local demo age-analysis bucket empty (run seed on this disk first)");
    return;
  }

  const demoRefs = demoAge.map((r) => r.toUpperCase()).sort();
  const expected = [...EXPECTED_ACCOUNTS].sort();
  if (JSON.stringify(demoRefs) !== JSON.stringify(expected)) {
    throw new Error(`[FAIL] Demo age-analysis refs ${demoRefs.join(", ")} expected ${expected.join(", ")}`);
  }

  const demoLedger = Array.isArray(ledgerAll[DEMO]) ? ledgerAll[DEMO] : [];
  if (demoLedger.length !== 0) {
    throw new Error(`[FAIL] Demo ledger must be empty fixture, got ${demoLedger.length} entries`);
  }

  const daSilvaBefore = JSON.stringify(ledgerAll[DA_SILVA]);
  if (!daSilvaBefore || daSilvaBefore === "null") {
    console.log("[INFO] Local Da Silva ledger not present on this disk");
  } else {
    console.log(`[PASS] Demo bucket isolated (${demoRefs.length} accounts, 0 ledger rows)`);
  }
}

async function fetchStatements(apiBase: string, schoolId: string): Promise<StatementRow[]> {
  const res = await fetch(`${apiBase}/api/statements?schoolId=${encodeURIComponent(schoolId)}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    statements?: StatementRow[];
    accounts?: StatementRow[];
  };
  if (!res.ok) {
    throw new Error(`Statements ${schoolId} → ${res.status}`);
  }
  return Array.isArray(body.statements)
    ? body.statements
    : Array.isArray(body.accounts)
      ? body.accounts
      : [];
}

async function fetchLedgerCount(apiBase: string, schoolId: string): Promise<number> {
  const res = await fetch(
    `${apiBase}/api/invoices/ledger?schoolId=${encodeURIComponent(schoolId)}`,
    { headers: { Accept: "application/json" }, cache: "no-store" }
  );
  const body = (await res.json().catch(() => ({}))) as { entries?: unknown[] };
  if (!res.ok) {
    throw new Error(`Ledger ${schoolId} → ${res.status}`);
  }
  return Array.isArray(body.entries) ? body.entries.length : -1;
}

async function verifyApi(): Promise<void> {
  if (!process.argv.includes("--api")) return;

  const apiBase = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
    /\/$/,
    ""
  );
  console.log(`\n=== API verification (${apiBase}) ===\n`);

  const daSilvaRows = await fetchStatements(apiBase, DA_SILVA);
  const daSilvaLedger = await fetchLedgerCount(apiBase, DA_SILVA);
  if (daSilvaRows.length !== 344) {
    throw new Error(`[FAIL] Da Silva accounts ${daSilvaRows.length}, expected 344`);
  }
  if (daSilvaLedger !== 41732) {
    throw new Error(`[FAIL] Da Silva ledger ${daSilvaLedger}, expected 41732`);
  }
  console.log(`[PASS] Da Silva unchanged: 344 accounts, ${daSilvaLedger} ledger entries`);

  const demoRows = await fetchStatements(apiBase, DEMO);
  const demoLedger = await fetchLedgerCount(apiBase, DEMO);
  const demoRefs = demoRows.map((r) => String(r.accountNo || "").trim().toUpperCase()).sort();
  const expected = [...EXPECTED_ACCOUNTS].sort();

  if (JSON.stringify(demoRefs) !== JSON.stringify(expected)) {
    throw new Error(
      `[FAIL] Demo statements accounts [${demoRefs.join(", ")}], expected [${expected.join(", ")}]`
    );
  }
  if (demoRows.some((r) => daSilvaRows.some((d) => d.accountNo === r.accountNo))) {
    throw new Error("[FAIL] Demo statements include Da Silva account refs");
  }
  for (const row of demoRows) {
    const name = `${row.name || ""} ${row.surname || ""}`.toUpperCase();
    if (!name.includes("TEST")) {
      throw new Error(`[FAIL] Demo row ${row.accountNo} not named TEST (${name})`);
    }
  }
  if (demoLedger !== 0) {
    throw new Error(`[FAIL] Demo ledger must be empty, got ${demoLedger}`);
  }

  console.log(`[PASS] Demo school: ${demoRefs.join(", ")} only, ledger=${demoLedger}`);
  const balances = demoRows
    .map((r) => `${r.accountNo}=R${Number(r.balance || 0).toFixed(2)}`)
    .join(", ");
  console.log(`[INFO] Demo balances: ${balances}`);
}

async function main(): Promise<void> {
  console.log("\n=== Demo school billing fixture verification ===\n");
  verifyFixtureDefinition();
  verifyLocalJsonRoutes();
  await verifyApi();
  console.log("\n[OK] Demo school billing fixture verification passed.\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
