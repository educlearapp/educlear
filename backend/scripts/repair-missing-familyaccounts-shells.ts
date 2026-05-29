/**
 * Repair missing FamilyAccount shell rows for orphan accountRef values.
 *
 * Constraints (per migration rules):
 * - Do NOT re-import billing.
 * - Do NOT modify invoices, payments, balances, ledger rows.
 * - Do NOT auto-link learners.
 *
 * Usage:
 *   npx tsx scripts/repair-missing-familyaccounts-shells.ts [schoolId]            # dry-run
 *   npx tsx scripts/repair-missing-familyaccounts-shells.ts [schoolId] --apply   # apply
 */
import "dotenv/config";
import { prisma } from "../src/prisma";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../src/utils/kidesysTransactionHistoryStore";
import { buildAccountsFromLearners } from "../src/services/statementAccounts";

const apply = process.argv.includes("--apply");
const schoolIdArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

function cleanRef(value: unknown): string {
  const ref = String(value ?? "").trim();
  if (!ref || ref === "-") return "";
  return ref;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function loadExistingFamilyAccountsByRefs(
  refs: string[]
): Promise<Array<{ accountRef: string; schoolId: string }>> {
  if (refs.length === 0) return [];
  const rows: Array<{ accountRef: string; schoolId: string }> = [];
  for (const group of chunk(refs, 500)) {
    const found = await prisma.familyAccount.findMany({
      where: { accountRef: { in: group } },
      select: { accountRef: true, schoolId: true },
    });
    rows.push(...found);
  }
  return rows;
}

async function computeStatementStats(schoolId: string) {
  const ledger = readSchoolLedger(schoolId);
  const accounts = await buildAccountsFromLearners(schoolId, ledger);
  const statementsWithBalance = accounts.filter((a) => Math.abs(Number(a.balance) || 0) > 0.01).length;
  const statementsWithLastInvoice = accounts.filter((a) => Number(a.lastInvoice) > 0).length;
  const statementsWithLastPayment = accounts.filter((a) => Number(a.lastPayment) > 0).length;
  return { statementsWithBalance, statementsWithLastInvoice, statementsWithLastPayment };
}

async function computeLedgerOrphanStats(schoolId: string, familyAccountRefs: Set<string>) {
  const ledger = readSchoolLedger(schoolId);

  let orphanRows = 0;
  const orphanRefs = new Set<string>();

  for (const entry of ledger) {
    const ref = cleanRef(entry.accountNo);
    if (!ref) continue;
    if (!familyAccountRefs.has(ref)) {
      orphanRows += 1;
      orphanRefs.add(ref);
    }
  }

  return { orphanRows, orphanRefs };
}

function computeHistoricalOnlyRows(schoolId: string) {
  const ledger = readSchoolLedger(schoolId);
  const history = readSchoolKidesysHistory(schoolId);

  const ledgerRefs = new Set<string>();
  for (const e of ledger) {
    const ref = cleanRef(e.accountNo);
    if (ref) ledgerRefs.add(ref);
  }

  let historicalOnlyRows = 0;
  for (const e of history) {
    const ref = cleanRef(e.accountNo);
    if (!ref) continue;
    if (!ledgerRefs.has(ref)) historicalOnlyRows += 1;
  }

  return { historicalOnlyRows, ledgerDistinctRefs: ledgerRefs.size };
}

async function main(): Promise<void> {
  const schoolId = cleanRef(schoolIdArg);
  if (!schoolId) throw new Error("Missing schoolId argument");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error(`School not found: ${schoolId}`);

  const ledger = readSchoolLedger(schoolId);
  const history = readSchoolKidesysHistory(schoolId);

  const ledgerRefs = new Set<string>();
  for (const e of ledger) {
    const ref = cleanRef(e.accountNo);
    if (ref) ledgerRefs.add(ref);
  }

  const allLedgerRefs = Array.from(ledgerRefs.values()).sort();
  const existingGlobal = await loadExistingFamilyAccountsByRefs(allLedgerRefs);
  const existingByRef = new Map<string, { accountRef: string; schoolId: string }>();
  for (const row of existingGlobal) existingByRef.set(row.accountRef, row);

  const familyAccountsInSchool = await prisma.familyAccount.findMany({
    where: { schoolId: school.id },
    select: { accountRef: true },
  });
  const familyRefsInSchool = new Set(familyAccountsInSchool.map((r) => r.accountRef));

  const before = await computeLedgerOrphanStats(schoolId, familyRefsInSchool);
  const historicalOnly = computeHistoricalOnlyRows(schoolId);

  const missingRefs: string[] = [];
  const preventedDuplicates: Array<{ accountRef: string; existingSchoolId: string }> = [];

  for (const ref of allLedgerRefs) {
    const exists = existingByRef.get(ref);
    if (!exists) {
      missingRefs.push(ref);
      continue;
    }
    if (exists.schoolId !== school.id) {
      preventedDuplicates.push({ accountRef: ref, existingSchoolId: exists.schoolId });
    }
  }

  const toCreate = missingRefs;

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          mode: "dry-run",
          schoolId: school.id,
          schoolName: school.name,
          scanned: {
            ledgerRows: ledger.length,
            historyRows: history.length,
            distinctAccountRefsInLedger: allLedgerRefs.length,
          },
          before: {
            orphanRows: before.orphanRows,
            orphanDistinctAccountRefs: before.orphanRefs.size,
          },
          historicalOnlyRows: historicalOnly.historicalOnlyRows,
          missingFamilyAccountsFound: toCreate.length,
          familyAccountsToCreate: toCreate.length,
          duplicatesPrevented: preventedDuplicates.length,
          expectedOrphanReductionDistinctRefs: Math.min(before.orphanRefs.size, toCreate.length),
          sample: {
            missingAccountRefs: toCreate.slice(0, 25),
            duplicatePreventedAccountRefs: preventedDuplicates.slice(0, 10),
          },
        },
        null,
        2
      )
    );
    console.log("\nDry run only — re-run with --apply to create FamilyAccount shells.");
    return;
  }

  let created = 0;
  const createdRefs: string[] = [];
  for (const ref of toCreate) {
    const familyName = `HISTORICAL ORPHAN ${ref}`.slice(0, 255);
    try {
      await prisma.familyAccount.create({
        data: {
          schoolId: school.id,
          accountRef: ref,
          familyName,
        },
        select: { id: true },
      });
      created += 1;
      createdRefs.push(ref);
    } catch (e: any) {
      // Skip duplicates if created concurrently / already exists globally.
      if (e?.code === "P2002") continue;
      throw e;
    }
  }

  const familyAccountsAfter = await prisma.familyAccount.findMany({
    where: { schoolId: school.id },
    select: { accountRef: true },
  });
  const familyRefsAfter = new Set(familyAccountsAfter.map((r) => r.accountRef));

  const after = await computeLedgerOrphanStats(schoolId, familyRefsAfter);

  const accountsWithNoLearners = await prisma.familyAccount.count({
    where: { schoolId: school.id, learners: { none: {} } },
  });

  const activeUnresolved = await prisma.learner.count({
    where: { schoolId: school.id, enrollmentStatus: "ACTIVE", familyAccountId: null },
  });

  const statementStats = await computeStatementStats(schoolId);

  const auditPass = after.orphanRows === 0;

  console.log(
    JSON.stringify(
      {
        mode: "apply",
        schoolId: school.id,
        schoolName: school.name,
        familyAccountsCreated: created,
        createdAccountRefs: createdRefs,
        orphanRowsBefore: before.orphanRows,
        orphanRowsAfter: after.orphanRows,
        historicalOnlyRows: historicalOnly.historicalOnlyRows,
        historicalFamilyAccountsNoLearners: accountsWithNoLearners,
        activeUnresolved,
        ...statementStats,
        audit: auditPass ? "PASS" : "FAIL",
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

