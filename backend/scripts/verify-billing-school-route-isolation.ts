/**
 * READ-ONLY billing JSON store-key route verification.
 * Proves school → bucket mapping only. No invoices, payments, or ledger writes.
 *
 * Usage:
 *   npx tsx scripts/verify-billing-school-route-isolation.ts
 *
 * Optional production read-only statements check (no writes):
 *   API_BASE=https://educlear-backend.onrender.com npx tsx scripts/verify-billing-school-route-isolation.ts --api
 */
import fs from "fs";
import path from "path";

import {
  DA_SILVA_BILLING_DATA_SCHOOL_ID,
  isDaSilvaSchoolId,
  resolveSchoolJsonStoreKey,
} from "../src/services/daSilvaSchoolResolve";

const DA_SILVA = DA_SILVA_BILLING_DATA_SCHOOL_ID;
const DEMO = "cmpbdigd00001vuzmxnwkbgiu";
const PAYFAST_EDU = "cmq57tcic0009twre2xuu3irr";
const PAYFAST = "cmq5afroi0041twred1289zoo";

const EXPECTED: Array<{ label: string; schoolId: string; expectedKey: string }> = [
  { label: "Da Silva Academy", schoolId: DA_SILVA, expectedKey: DA_SILVA },
  { label: "EduClear Demo School", schoolId: DEMO, expectedKey: DEMO },
  { label: "EduClear Payfast Test School", schoolId: PAYFAST_EDU, expectedKey: PAYFAST_EDU },
  { label: "Payfast Test School", schoolId: PAYFAST, expectedKey: PAYFAST },
];

function hasArrayContent(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

function hasObjectContent(value: unknown): boolean {
  return value !== null && typeof value === "object" && Object.keys(value as object).length > 0;
}

function buildSingletonCanonicalFixture<T>(canonicalValue: T): Record<string, T | undefined> {
  return { [DA_SILVA]: canonicalValue };
}

function assertRoute(
  label: string,
  schoolId: string,
  expectedKey: string,
  all: Record<string, unknown>,
  hasContent: (value: unknown) => boolean
): void {
  const resolved = resolveSchoolJsonStoreKey(schoolId, all, hasContent);
  if (resolved !== expectedKey) {
    throw new Error(
      `[FAIL] ${label}: schoolId=${schoolId} resolved=${resolved} expected=${expectedKey}`
    );
  }
  console.log(`[PASS] ${label}: ${schoolId} → ${resolved}`);
}

function verifyResolverWithSingletonCanonical(): void {
  console.log("\n=== Resolver (singleton canonical bucket — production-like) ===\n");

  const ledgerFixture = buildSingletonCanonicalFixture([{ id: "ledger-entry" }]);
  const ageFixture = buildSingletonCanonicalFixture({ ACC001: { balance: 100 } });

  for (const row of EXPECTED) {
    assertRoute(row.label, row.schoolId, row.expectedKey, ledgerFixture, hasArrayContent);
    assertRoute(row.label, row.schoolId, row.expectedKey, ageFixture, hasObjectContent);
  }

  if (!isDaSilvaSchoolId(DA_SILVA)) {
    throw new Error("[FAIL] Da Silva canonical id must register as Da Silva school");
  }
  for (const nonDaSilva of [DEMO, PAYFAST_EDU, PAYFAST]) {
    if (isDaSilvaSchoolId(nonDaSilva)) {
      throw new Error(`[FAIL] ${nonDaSilva} must not be a Da Silva school id`);
    }
  }
  console.log("[PASS] isDaSilvaSchoolId: only Da Silva ids match");
}

function verifyLocalDaSilvaLedgerUnchanged(): void {
  const ledgerPath = path.join(process.cwd(), "data", "billing-ledger.json");
  if (!fs.existsSync(ledgerPath)) {
    console.log("\n[SKIP] Local data/billing-ledger.json not present — ledger count check skipped");
    return;
  }

  console.log("\n=== Local Da Silva ledger (read-only) ===\n");

  const raw = JSON.parse(fs.readFileSync(ledgerPath, "utf8")) as Record<string, unknown>;
  const daSilvaEntries = Array.isArray(raw[DA_SILVA]) ? raw[DA_SILVA].length : 0;
  const resolvedKey = resolveSchoolJsonStoreKey(DA_SILVA, raw, hasArrayContent);

  if (resolvedKey !== DA_SILVA) {
    throw new Error(`[FAIL] Da Silva ledger resolves to ${resolvedKey}, expected ${DA_SILVA}`);
  }
  console.log(`[PASS] Da Silva ledger store key: ${resolvedKey}`);
  console.log(`[INFO] Da Silva ledger entry count: ${daSilvaEntries}`);

  for (const row of EXPECTED.filter((r) => r.schoolId !== DA_SILVA)) {
    const key = resolveSchoolJsonStoreKey(row.schoolId, raw, hasArrayContent);
    if (key !== row.schoolId) {
      throw new Error(
        `[FAIL] ${row.label} ledger resolves to ${key}, expected own id ${row.schoolId}`
      );
    }
    const ownCount = Array.isArray(raw[row.schoolId]) ? raw[row.schoolId].length : 0;
    console.log(`[PASS] ${row.label}: ${row.schoolId} → ${key} (${ownCount} entries)`);
  }
}

async function verifyApiStatementsReadOnly(): Promise<void> {
  if (!process.argv.includes("--api")) return;

  const apiBase = String(process.env.API_BASE || "https://educlear-backend.onrender.com").replace(
    /\/$/,
    ""
  );
  console.log(`\n=== API statements read-only (${apiBase}) ===\n`);

  for (const row of EXPECTED) {
    const url = `${apiBase}/api/statements?schoolId=${encodeURIComponent(row.schoolId)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    const body = (await res.json().catch(() => ({}))) as {
      accounts?: unknown[];
      summary?: Record<string, number>;
    };
    const count = Array.isArray(body.accounts) ? body.accounts.length : -1;
    console.log(`[INFO] ${row.label}: accountsCount=${count}`);

    if (row.schoolId === DA_SILVA) {
      if (count !== 344) {
        throw new Error(`[FAIL] Da Silva must have 344 accounts, got ${count}`);
      }
      console.log("[PASS] Da Silva: 344 accounts unchanged");
    } else if (count === 344) {
      throw new Error(
        `[FAIL] ${row.label} still returns Da Silva's 344 accounts — isolation not active on API`
      );
    } else {
      console.log(`[PASS] ${row.label}: not aliased to Da Silva (${count} accounts)`);
    }
  }
}

async function main(): Promise<void> {
  verifyResolverWithSingletonCanonical();
  verifyLocalDaSilvaLedgerUnchanged();
  await verifyApiStatementsReadOnly();
  console.log("\n[OK] Billing school route isolation verification passed.\n");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
