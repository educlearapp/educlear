/**
 * Audit Da Silva Academy learner ↔ family account ↔ ledger linkage.
 *
 * Usage:
 *   npx tsc && node dist/scripts/audit-da-silva-linked-data.js
 *   node dist/scripts/audit-da-silva-linked-data.js [schoolId]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_OWNER_EMAIL,
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import {
  countFamilyAccountsWithLearnersSafe,
  countParentLearnerLinksSafe,
  fetchSampleLearnersSafe,
  getDaSilvaLearnerSchemaCaps,
} from "./lib/daSilvaSchemaSafe";

const prisma = new PrismaClient();

async function resolveSchoolId(cliSchoolId?: string): Promise<{ id: string; name: string }> {
  const hint = String(cliSchoolId || getDaSilvaResolvedSchoolId() || "").trim();
  const school =
    (hint
      ? await prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
      : null) ||
    (await prisma.school.findFirst({
      where: { email: DA_SILVA_OWNER_EMAIL },
      select: { id: true, name: true },
    })) ||
    (await prisma.school.findFirst({
      where: { name: DA_SILVA_SCHOOL_NAME },
      select: { id: true, name: true },
    }));
  if (!school) throw new Error("Da Silva Academy school not found");
  setDaSilvaResolvedSchoolId(school.id);
  return school;
}

async function main(): Promise<void> {
  const cliSchoolId = process.argv[2];
  const school = await resolveSchoolId(cliSchoolId);
  const schoolId = school.id;
  const schemaCaps = await getDaSilvaLearnerSchemaCaps(prisma);

  const [
    learnersCount,
    parentsCount,
    familyAccountCount,
    learnersWithFamilyAccountId,
    learnersWithAdmissionNo,
    familyAccountsWithLearnersResult,
    parentLinksResult,
  ] = await Promise.all([
    prisma.learner.count({ where: { schoolId } }),
    prisma.parent.count({ where: { schoolId } }),
    prisma.familyAccount.count({ where: { schoolId } }),
    prisma.learner.count({ where: { schoolId, familyAccountId: { not: null } } }),
    prisma.learner.count({ where: { schoolId, admissionNo: { not: null } } }),
    countFamilyAccountsWithLearnersSafe(prisma, schoolId),
    countParentLearnerLinksSafe(prisma, schoolId),
  ]);

  const ledger = readSchoolLedger(schoolId);
  const ledgerBySource: Record<string, number> = {};
  let ledgerMissingLearnerId = 0;
  for (const entry of ledger) {
    const source = String(entry.source || "unknown");
    ledgerBySource[source] = (ledgerBySource[source] || 0) + 1;
    if (!String(entry.learnerId || "").trim()) ledgerMissingLearnerId += 1;
  }

  const sampleLearners = await fetchSampleLearnersSafe(prisma, schoolId, schemaCaps, 10);

  const sampleFamilyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId },
    take: 10,
    orderBy: { accountRef: "asc" },
    select: {
      accountRef: true,
      familyName: true,
      learners: {
        take: 3,
        select: { id: true, firstName: true, lastName: true, admissionNo: true },
      },
    },
  });

  const familyBalances = new Map<string, number>();
  for (const entry of ledger) {
    const acct = String(entry.accountNo || "").trim();
    if (!acct) continue;
    const sign =
      entry.type === "payment" || entry.type === "credit" ? -1 : 1;
    familyBalances.set(
      acct,
      (familyBalances.get(acct) || 0) + sign * Number(entry.amount || 0)
    );
  }

  const sampleAccountsWithBalance = sampleFamilyAccounts.map((fa) => ({
    accountNumber: fa.accountRef,
    name: fa.familyName,
    balance: Math.round((familyBalances.get(fa.accountRef) || 0) * 100) / 100,
    linkedLearners: fa.learners.map((l) => ({
      id: l.id,
      name: `${l.firstName} ${l.lastName}`.trim(),
      admissionNo: l.admissionNo,
    })),
  }));

  const schemaNotes = [
    ...schemaCaps.notes,
    ...(familyAccountsWithLearnersResult.note ? [familyAccountsWithLearnersResult.note] : []),
    ...(parentLinksResult.note ? [parentLinksResult.note] : []),
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    schoolId,
    schoolName: school.name,
    schemaNotes,
    learnersCount,
    parentsCount,
    familyAccountCount,
    learnersWithFamilyAccountId,
    learnersWithAdmissionNo,
    familyAccountsWithLearnerLinks: familyAccountsWithLearnersResult.count,
    parentLearnerLinks: parentLinksResult.count,
    ledgerEntriesCount: ledger.length,
    ledgerEntriesMissingLearnerId: ledgerMissingLearnerId,
    transactionEntriesBySource: ledgerBySource,
    sampleLearners: sampleLearners.map((l) => ({
      firstName: l.firstName,
      lastName: l.lastName,
      className: l.className,
      admissionNo: l.admissionNo,
      familyAccountId: l.familyAccountId,
      displayStatus: l.displayStatus,
      accountRef: l.accountRef,
      parentLinkCount: l.parentLinkCount,
      relationsNote: l.relationsNote,
    })),
    sampleFamilyAccounts: sampleAccountsWithBalance,
  };

  const jsonPath = path.join(process.cwd(), "audit-da-silva-linked-data.json");
  const txtPath = path.join(process.cwd(), "audit-da-silva-linked-data.txt");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  const lines = [
    "Da Silva linked-data audit",
    `Generated: ${report.generatedAt}`,
    `School: ${report.schoolName} (${report.schoolId})`,
    ...(schemaNotes.length
      ? ["", "Schema notes:", ...schemaNotes.map((n) => `  ${n}`)]
      : []),
    "",
    `Learners: ${learnersCount}`,
    `Parents: ${parentsCount}`,
    `Family accounts: ${familyAccountCount}`,
    `Learners with familyAccountId: ${learnersWithFamilyAccountId}`,
    `Learners with admissionNo: ${learnersWithAdmissionNo}`,
    `Family accounts with ≥1 learner: ${familyAccountsWithLearnersResult.count}`,
    `Parent–learner links: ${parentLinksResult.count}`,
    "",
    `Ledger entries: ${ledger.length}`,
    `Ledger rows missing learnerId: ${ledgerMissingLearnerId}`,
    "Ledger by source:",
    ...Object.entries(ledgerBySource).map(([k, v]) => `  ${k}: ${v}`),
    "",
    "Sample learners:",
    ...report.sampleLearners.map((l) => {
      const parents =
        l.parentLinkCount === null
          ? l.relationsNote || "n/a"
          : String(l.parentLinkCount);
      return `  ${l.firstName} ${l.lastName} | status=${l.displayStatus} | class=${l.className || "-"} | adm=${l.admissionNo || "-"} | acct=${l.accountRef || "-"} | parents=${parents}`;
    }),
    "",
    "Sample family accounts:",
    ...report.sampleFamilyAccounts.map(
      (a) =>
        `  ${a.accountNumber} ${a.name} | balance=${a.balance} | learners=${a.linkedLearners.length}`
    ),
  ];
  fs.writeFileSync(txtPath, lines.join("\n"));

  console.log(lines.join("\n"));
  console.log(`\nWrote ${jsonPath} and ${txtPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
