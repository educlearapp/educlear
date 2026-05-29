/**
 * Compute statement metrics from ledger using existing statement account builder.
 *
 * Usage:
 *   node dist-scripts/scripts/kideesys-statement-metrics.js [schoolId]
 */
require("dotenv/config");

const { PrismaClient } = require("@prisma/client");
const { readSchoolLedger } = require("../src/utils/billingLedgerStore");
const { buildAccountsFromLearners } = require("../src/services/statementAccounts");

const prisma = new PrismaClient();
const schoolIdArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

async function resolveSchool() {
  const hint = String(schoolIdArg || process.env.KIDESYS_SCHOOL_ID || "").trim();
  const byId = hint
    ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
    : null;
  if (byId) return byId;

  const daSilva = await prisma.school.findFirst({
    where: { name: { contains: "da silva", mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  if (daSilva) return daSilva;

  const latest = await prisma.school.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });
  if (!latest) throw new Error("School not found — pass schoolId");
  return latest;
}

async function main() {
  const school = await resolveSchool();
  const ledger = readSchoolLedger(school.id);
  const accounts = await buildAccountsFromLearners(school.id, ledger, undefined);

  const statementsWithBalance = accounts.filter((r) => Math.abs(Number(r.balance) || 0) > 0.01).length;
  const statementsWithLastInvoice = accounts.filter(
    (r) => Number(r.lastInvoice || 0) !== 0 || String(r.lastInvoiceLabel || "").trim()
  ).length;
  const statementsWithLastPayment = accounts.filter((r) => Number(r.lastPayment || 0) !== 0).length;

  console.log(`School: ${school.name} (${school.id})`);
  console.log(`Statements with balance: ${statementsWithBalance}`);
  console.log(`Statements with last invoice: ${statementsWithLastInvoice}`);
  console.log(`Statements with last payment: ${statementsWithLastPayment}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

