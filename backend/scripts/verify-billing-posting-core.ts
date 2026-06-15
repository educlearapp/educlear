/**
 * Billing posting core verification (local API or production read-only checks).
 *
 * Usage:
 *   API_BASE=http://localhost:4000 SCHOOL_ID=<test-school-id> npx tsx scripts/verify-billing-posting-core.ts
 *
 * Write tests (manual invoice + payment) require:
 *   CONFIRM_BILLING_WRITE_TEST=true
 * and must target a non-production test school — never Da Silva production.
 */
import fs from "fs";
import path from "path";

const API_BASE = String(process.env.API_BASE || "http://localhost:4000").replace(/\/$/, "");
const SCHOOL_ID = String(process.env.SCHOOL_ID || "").trim();
const CONFIRM_WRITE = process.env.CONFIRM_BILLING_WRITE_TEST === "true";
const DA_SILVA_PROD = "cmpideqeq0000108xb6ouv9zi";

type StatementRow = {
  accountNo?: string;
  balance?: number;
};

type LedgerEntry = {
  id?: string;
  type?: string;
  accountNo?: string;
  amount?: number;
  learnerId?: string;
  runId?: string;
};

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}: ${String(body?.error || text).slice(0, 300)}`);
  }
  return body;
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function readStatements(schoolId: string): Promise<StatementRow[]> {
  const data = await fetchJson(
    `${API_BASE}/api/statements?schoolId=${encodeURIComponent(schoolId)}`
  );
  return Array.isArray(data?.statements)
    ? data.statements
    : Array.isArray(data?.accounts)
      ? data.accounts
      : [];
}

async function readLedger(schoolId: string): Promise<LedgerEntry[]> {
  const data = await fetchJson(
    `${API_BASE}/api/invoices/ledger?schoolId=${encodeURIComponent(schoolId)}`
  );
  return Array.isArray(data?.entries) ? data.entries : [];
}

async function main() {
  if (!SCHOOL_ID) {
    throw new Error("Set SCHOOL_ID (test school only — not Da Silva production).");
  }
  if (SCHOOL_ID === DA_SILVA_PROD && CONFIRM_WRITE) {
    throw new Error("Refusing write tests on Da Silva production school.");
  }

  const results: string[] = [];
  const pass = (msg: string) => results.push(`✓ ${msg}`);
  const section = (msg: string) => results.push(`\n## ${msg}`);

  section("Read paths");
  const statementsBefore = await readStatements(SCHOOL_ID);
  pass(`Statements API returned ${statementsBefore.length} account(s)`);
  assert(statementsBefore.length > 0, "Expected at least one statement account");

  const ledgerBefore = await readLedger(SCHOOL_ID);
  pass(`Ledger API returned ${ledgerBefore.length} entry/entries`);

  const testAccount =
    statementsBefore.find((row) => Number(row.balance) >= 0)?.accountNo ||
    statementsBefore[0]?.accountNo;
  assert(Boolean(testAccount), "No test account found");
  const accountRef = String(testAccount).trim().toUpperCase();
  const balanceBefore = roundMoney(Number(
    statementsBefore.find(
      (r) => String(r.accountNo || "").trim().toUpperCase() === accountRef
    )?.balance || 0
  ));

  if (!CONFIRM_WRITE) {
    section("Write tests skipped");
    results.push(
      "Set CONFIRM_BILLING_WRITE_TEST=true to run manual invoice/payment posting checks on a test school."
    );
    console.log(results.join("\n"));
    return;
  }

  section("Manual invoice posting");
  const invoiceAmount = 1.23;
  const invoiceRef = `VERIFY-INV-${Date.now()}`;
  const invoiceRes = await fetchJson(`${API_BASE}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_ID,
      accountNo: accountRef,
      learnerId: "",
      amount: invoiceAmount,
      date: new Date().toISOString().slice(0, 10),
      reference: invoiceRef,
      description: "Billing core verify invoice",
      id: `verify-inv-${Date.now()}`,
    }),
  });
  assert(invoiceRes?.success !== false, "Invoice POST failed");
  assert(typeof invoiceRes.balance === "number", "Invoice POST must return balance");
  assert(
    roundMoney(Number(invoiceRes.balance)) >= roundMoney(balanceBefore + invoiceAmount - 0.01),
    "Invoice POST balance did not increase"
  );
  pass("Manual invoice POST returned authoritative balance");

  const statementsAfterInvoice = await readStatements(SCHOOL_ID);
  const balanceAfterInvoice = roundMoney(
    Number(
      statementsAfterInvoice.find(
        (r) => String(r.accountNo || "").trim().toUpperCase() === accountRef
      )?.balance || 0
    )
  );
  assert(
    balanceAfterInvoice >= roundMoney(balanceBefore + invoiceAmount - 0.01),
    "Statement balance did not update after invoice"
  );
  pass("Statement API reflects invoice balance");

  section("Manual payment posting");
  const paymentRes = await fetchJson(`${API_BASE}/api/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_ID,
      accountNo: accountRef,
      amount: invoiceAmount,
      date: new Date().toISOString().slice(0, 10),
      method: "Verify",
      reference: `VERIFY-PAY-${Date.now()}`,
      description: "Billing core verify payment",
      idempotencyKey: `verify-pay-${Date.now()}`,
    }),
  });
  assert(paymentRes?.success !== false, "Payment POST failed");
  assert(typeof paymentRes.balance === "number", "Payment POST must return balance");
  pass("Manual payment POST returned authoritative balance");

  const statementsAfterPayment = await readStatements(SCHOOL_ID);
  const balanceAfterPayment = roundMoney(
    Number(
      statementsAfterPayment.find(
        (r) => String(r.accountNo || "").trim().toUpperCase() === accountRef
      )?.balance || 0
    )
  );
  assert(
    Math.abs(balanceAfterPayment - balanceAfterInvoice + invoiceAmount) < 0.02,
    "Statement balance did not decrease after payment"
  );
  pass("Statement API reflects payment balance");

  section("Sibling same-amount invoice lines");
  const siblingRef = `VERIFY-SIB-${Date.now()}`;
  const batchRes = await fetchJson(`${API_BASE}/api/invoices/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_ID,
      invoices: [
        {
          accountNo: accountRef,
          learnerId: "sibling-a",
          amount: 15,
          date: new Date().toISOString().slice(0, 10),
          reference: `${siblingRef}-A`,
          description: "Sibling A monthly fee",
          lineKey: "A",
          id: `verify-sib-a-${Date.now()}`,
        },
        {
          accountNo: accountRef,
          learnerId: "sibling-b",
          amount: 15,
          date: new Date().toISOString().slice(0, 10),
          reference: `${siblingRef}-B`,
          description: "Sibling B monthly fee",
          lineKey: "B",
          id: `verify-sib-b-${Date.now()}`,
        },
      ],
    }),
  });
  assert(batchRes?.success !== false, "Sibling batch invoice failed");
  assert(Number(batchRes.createdCount) >= 2, "Expected both sibling invoice lines to save");
  pass("Same amount for different siblings saved in one batch");

  section("Invoice run duplicate protection");
  const runId = `VERIFY-RUN-${Date.now()}`;
  const runPayload = {
    schoolId: SCHOOL_ID,
    runId,
    invoices: [
      {
        accountNo: accountRef,
        learnerId: "run-learner-1",
        amount: 2,
        date: new Date().toISOString().slice(0, 10),
        reference: runId,
        description: "Verify run invoice",
        id: `invoice-${runId}-run-learner-1`,
      },
    ],
  };
  const run1 = await fetchJson(`${API_BASE}/api/invoices/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runPayload),
  });
  const run2 = await fetchJson(`${API_BASE}/api/invoices/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runPayload),
  });
  assert(Number(run1.createdCount) >= 1, "First run invoice should create");
  assert(Number(run2.duplicateCount) >= 1, "Second identical run invoice should be blocked");
  pass("Invoice run duplicate protection blocks re-post");

  const outPath = path.join(process.cwd(), "billing-posting-core-verify.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        schoolId: SCHOOL_ID,
        apiBase: API_BASE,
        accountRef,
        balanceBefore,
        balanceAfterInvoice,
        balanceAfterPayment,
        results,
        at: new Date().toISOString(),
      },
      null,
      2
    ),
    "utf8"
  );

  console.log(results.join("\n"));
  console.log(`\nWrote ${outPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
