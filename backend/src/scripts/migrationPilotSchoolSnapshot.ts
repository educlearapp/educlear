/**
 * Read-only / disposable school snapshot helper for Universal Migration pilot evidence.
 *
 * Usage (local/disposable only unless explicitly authorized):
 *   ALLOW_DISPOSABLE_MIGRATION_E2E=true npx tsx src/scripts/migrationPilotSchoolSnapshot.ts --schoolId=<id>
 *
 * Never prints secrets. Uses integer cents for finance totals where ledger is available.
 */

import { prisma } from "../prisma";
import { readSchoolLedger } from "../utils/billingLedgerStore";
import { randToCents } from "../services/migration/finance/moneyCents";

const PROD = "cmpideqeq0000108xb6ouv9zi";

function arg(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
}

async function main() {
  const schoolId = String(arg("schoolId") || "").trim();
  if (!schoolId) throw new Error("--schoolId required");
  if (schoolId === PROD && process.env.ALLOW_PROD_SCHOOL_SNAPSHOT !== "true") {
    throw new Error("Refusing Da Silva production school without ALLOW_PROD_SCHOOL_SNAPSHOT=true");
  }
  if (process.env.ALLOW_DISPOSABLE_MIGRATION_E2E !== "true" && process.env.ALLOW_PROD_SCHOOL_SNAPSHOT !== "true") {
    throw new Error("Set ALLOW_DISPOSABLE_MIGRATION_E2E=true (or explicit prod snapshot allow)");
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const [learners, parents, links, classrooms, subjects, accounts] = await Promise.all([
    prisma.learner.count({ where: { schoolId } }),
    prisma.parent.count({ where: { schoolId } }),
    prisma.parentLearnerLink.count({ where: { schoolId } }),
    prisma.classroom.count({ where: { schoolId } }),
    prisma.schoolSubject.count({ where: { schoolId } }),
    prisma.familyAccount.count({ where: { schoolId } }),
  ]);

  const ledger = readSchoolLedger(schoolId);
  let netCents = 0;
  let debitCents = 0;
  let creditCents = 0;
  for (const e of ledger) {
    const c = randToCents(Number(e.amount || 0));
    const t = String(e.type || "").toLowerCase();
    if (t === "payment" || t === "credit") {
      creditCents += Math.abs(c);
      netCents -= Math.abs(c);
    } else {
      debitCents += Math.abs(c);
      netCents += Math.abs(c);
    }
  }

  const snap = {
    capturedAt: new Date().toISOString(),
    schoolId: school.id,
    schoolName: school.name,
    counts: { learners, parents, links, classrooms, subjects, accounts },
    finance: {
      ledgerEntries: ledger.length,
      debitCents,
      creditCents,
      netCents,
      note: "Ledger-derived; authoritative Fee Check/statement paths remain domain services.",
    },
  };
  console.log(JSON.stringify(snap, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
