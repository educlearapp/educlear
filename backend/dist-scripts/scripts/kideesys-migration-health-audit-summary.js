/**
 * Print the same high-level Kid-e-Sys audit metrics used by
 * `auditKideesysMigrationHealth` without applying any repairs.
 *
 * Usage:
 *   node dist-scripts/scripts/kideesys-migration-health-audit-summary.js [schoolId]
 */
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const {
  auditKideesysMigrationHealth,
} = require("../src/services/kideesysMigration/kideesysBillingReconciliation");

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
  const audit = await auditKideesysMigrationHealth(school.id, null);

  const outPath = path.join(process.cwd(), "kideesys-migration-health-audit.json");
  fs.writeFileSync(outPath, JSON.stringify({ schoolId: school.id, schoolName: school.name, audit }, null, 2));

  console.log(`School: ${school.name} (${school.id})`);
  console.log(`Real active unresolved: ${audit.activeLearnersMissingKidesysAccountRef || 0}`);
  console.log(`Statements with balance: ${audit.statementsWithBalance || 0}`);
  console.log(`Statements with last invoice: ${audit.statementsWithLastInvoice || 0}`);
  console.log(`Statements with last payment: ${audit.statementsWithLastPayment || 0}`);
  console.log(`Audit ${audit.gatePassed ? "PASS" : "FAIL"}`);
  console.log(`Wrote ${outPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

