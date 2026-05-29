/**
 * Proof: billing UI endpoints expose Kid-e-Sys accountRef billing (not SA-SAMS numeric).
 *
 * Usage:
 *   cd backend
 *   npx tsx scripts/prove-billing-pages-use-kidesys.ts [schoolId]
 *   API_URL=http://localhost:3000 npx tsx scripts/prove-billing-pages-use-kidesys.ts
 */
import { PrismaClient } from "@prisma/client";

import { materializeKidesysDisplayHistory } from "../src/services/kidesysDisplayHistoryMaterializer";
import { isSasamsNumericBillingAccount } from "../src/services/statementAccounts";
import { isKidESysSourceAccountRef } from "../src/services/daSilvaMigration/ageAnalysisParser";

const API_URL = String(process.env.API_URL || "http://localhost:3000").replace(/\/$/, "");

async function resolveSchoolId(prisma: PrismaClient): Promise<string> {
  const hint = String(process.argv[2] || process.env.KIDESYS_SCHOOL_ID || "").trim();
  if (hint) return hint;
  const top = await prisma.learner.groupBy({
    by: ["schoolId"],
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 1,
  });
  if (!top.length) throw new Error("No schoolId and no learners in DB");
  return top[0].schoolId;
}

async function fetchJson(path: string): Promise<any> {
  const url = `${API_URL}${path}`;
  const res = await fetch(url, { cache: "no-store" });
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON ${res.status} from ${url}: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

function parseArray(data: any, keys: string[]): any[] {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function isKidesysRef(value: string): boolean {
  return isKidESysSourceAccountRef(String(value || "").trim());
}

function yesNo(pass: boolean): string {
  return pass ? "yes" : "no";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const schoolId = await resolveSchoolId(prisma);
    const materialized = materializeKidesysDisplayHistory({ schoolId, dryRun: false });
    process.stderr.write(
      `[prove] schoolId=${schoolId} history ${materialized.previousCount} → ${materialized.mergedCount}\n`
    );

    const qs = encodeURIComponent(schoolId);

    const statementsData = await fetchJson(`/api/statements?schoolId=${qs}`);
    const statementRows = parseArray(statementsData, ["statements", "accounts", "items", "data"]);

    const invoicesData = await fetchJson(`/api/invoices?schoolId=${qs}`);
    const invoiceRows = parseArray(invoicesData, ["invoices", "items", "data"]);
    const importedInvoices = invoiceRows.filter(
      (row: any) =>
        String(row.id || "").startsWith("kidesys-invoice-") ||
        String(row.source || "").includes("kideesys")
    );

    const paymentsData = await fetchJson(`/api/payments?schoolId=${qs}`);
    const paymentRows = parseArray(paymentsData, ["payments", "items", "data"]);
    const importedPayments = paymentRows.filter(
      (row: any) =>
        String(row.id || "").startsWith("kidesys-payment-") ||
        String(row.source || "").includes("kideesys")
    );

    const paymentAccountsData = await fetchJson(`/api/payments/accounts?schoolId=${qs}`);
    const paymentAccountRows = parseArray(paymentAccountsData, ["accounts", "items", "data"]);

    process.stdout.write("Statements:\n");
    process.stdout.write(`- rows: ${statementRows.length}\n`);
    process.stdout.write(
      `- first 10 account numbers: ${statementRows
        .slice(0, 10)
        .map((r: any) => r.accountNo)
        .join(", ")}\n`
    );
    const totalOutstanding = statementRows.reduce(
      (sum: number, r: any) => sum + (Number(r.balance) || 0),
      0
    );
    process.stdout.write(`- total outstanding: ${Math.round(totalOutstanding * 100) / 100}\n`);
    process.stdout.write(
      `- last invoice populated count: ${
        statementRows.filter((r: any) => Boolean(String(r.lastInvoiceDate || "").trim())).length
      }\n`
    );
    process.stdout.write(
      `- last payment populated count: ${
        statementRows.filter((r: any) => Boolean(String(r.lastPaymentDate || "").trim())).length
      }\n`
    );

    process.stdout.write("\nInvoices:\n");
    process.stdout.write(`- imported invoice count: ${importedInvoices.length}\n`);
    process.stdout.write(
      `- first 10 invoices: ${importedInvoices
        .slice(0, 10)
        .map(
          (r: any) =>
            `${String(r.accountNo || "-")} | ${Number(r.amount) || 0} | ${String(r.date || r.invoiceDate || "").slice(0, 10)}`
        )
        .join("; ")}\n`
    );

    process.stdout.write("\nPayments:\n");
    process.stdout.write(`- imported payment count: ${importedPayments.length}\n`);
    process.stdout.write(
      `- first 10 payments: ${importedPayments
        .slice(0, 10)
        .map(
          (r: any) =>
            `${String(r.accountNo || "-")} | ${Number(r.amount) || 0} | ${String(r.date || r.paymentDate || "").slice(0, 10)}`
        )
        .join("; ")}\n`
    );

    process.stdout.write("\nNew Invoice / Payment account list:\n");
    process.stdout.write(`- account count: ${paymentAccountRows.length}\n`);
    process.stdout.write(
      `- first 10 accountRefs: ${paymentAccountRows
        .slice(0, 10)
        .map((r: any) => r.accountNo)
        .join(", ")}\n`
    );
    const balancesPopulated = paymentAccountRows.some(
      (r: any) => Number.isFinite(Number(r.balance)) && Number(r.balance) !== 0
    );
    process.stdout.write(`- balances populated: ${balancesPopulated ? "yes" : "no"}\n`);

    const allAccountNos = [
      ...statementRows.map((r: any) => String(r.accountNo || "")),
      ...paymentAccountRows.map((r: any) => String(r.accountNo || "")),
      ...importedInvoices.slice(0, 50).map((r: any) => String(r.accountNo || "")),
      ...importedPayments.slice(0, 50).map((r: any) => String(r.accountNo || "")),
    ].filter(Boolean);

    const sasamsNumeric = allAccountNos.filter((ref) => isSasamsNumericBillingAccount(ref));
    const kidesysRefs = allAccountNos.filter((ref) => isKidesysRef(ref));

    const statementsFixed =
      statementRows.length > 0 &&
      statementRows.every((r: any) => isKidesysRef(String(r.accountNo || ""))) &&
      statementRows.some((r: any) => Number(r.balance) !== 0);
    const invoicesFixed = importedInvoices.length > 0;
    const paymentsFixed = importedPayments.length > 0;
    const newInvoiceListFixed =
      paymentAccountRows.length > 0 &&
      paymentAccountRows.every((r: any) => isKidesysRef(String(r.accountNo || "")));
    const paymentListFixed = newInvoiceListFixed;
    const sasamsRemoved = sasamsNumeric.length === 0 && kidesysRefs.length > 0;

    const auditPass =
      statementsFixed &&
      invoicesFixed &&
      paymentsFixed &&
      newInvoiceListFixed &&
      paymentListFixed &&
      sasamsRemoved;

    process.stdout.write("\n");
    process.stdout.write(`Statements fixed: ${yesNo(statementsFixed)}\n`);
    process.stdout.write(`Invoices fixed: ${yesNo(invoicesFixed)}\n`);
    process.stdout.write(`Payments fixed: ${yesNo(paymentsFixed)}\n`);
    process.stdout.write(`New Invoice account list fixed: ${yesNo(newInvoiceListFixed)}\n`);
    process.stdout.write(`Payment account list fixed: ${yesNo(paymentListFixed)}\n`);
    process.stdout.write(`SA-SAMS numeric billing accounts removed: ${yesNo(sasamsRemoved)}\n`);
    process.stdout.write(`Audit ${auditPass ? "PASS" : "FAIL"}\n`);

    process.exit(auditPass ? 0 : 1);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
