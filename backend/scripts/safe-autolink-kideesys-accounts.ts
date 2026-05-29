/**
 * Safe, explicit Kid-e-Sys billing account linking (NO ledger/invoice/payment mutations).
 *
 * Does ONLY the explicitly allowed 6 mappings:
 * - find FamilyAccount by accountRef
 * - set learner.familyAccountId to that FamilyAccount.id
 * - preserve learner profile fields (only updates familyAccountId)
 * - writes before/after audit JSON
 *
 * Usage:
 *   npx tsx scripts/safe-autolink-kideesys-accounts.ts [schoolId]
 *   npx tsx scripts/safe-autolink-kideesys-accounts.ts [schoolId] --apply
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import { auditKideesysMigrationHealth } from "../src/services/kideesysMigration/kideesysBillingReconciliation";
import { buildAccountsFromLearners } from "../src/services/statementAccounts";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";

type LinkSpec = { accountRef: string; learnerId: string };

const SAFE_LINKS: LinkSpec[] = [
  { accountRef: "KOR001", learnerId: "cmpp2ez4i00j5txyzhasj0ihv" },
  { accountRef: "MOY004", learnerId: "cmpp2eyzv005ftxyzln53t9xs" },
  { accountRef: "NGW003", learnerId: "cmpp2ez3g00fjtxyzcgmc0y5c" },
  { accountRef: "DIK001", learnerId: "cmpp2ez2900bhtxyz1m2v65p2" },
  { accountRef: "MOS021", learnerId: "cmpp2ez4z00kptxyzh4ufrem6" },
  { accountRef: "MAH007", learnerId: "cmpp2ez0v007ztxyzkqws376f" },
];

const AMBIGUOUS_ACCOUNT_REFS = [
  "MOL040",
  "MOE008",
  "NZI001",
  "HOB002",
  "RAM009",
  "RAM020",
  "MAL020",
  "MAS030",
];

const ALL_14_ACCOUNT_REFS = [...SAFE_LINKS.map((s) => s.accountRef), ...AMBIGUOUS_ACCOUNT_REFS];

const apply = process.argv.includes("--apply");
const schoolIdArg = process.argv
  .slice(2)
  .find((a) => !a.startsWith("--"));

async function resolveSchoolId(): Promise<{ id: string; name: string }> {
  const hint = String(schoolIdArg || process.env.KIDESYS_SCHOOL_ID || "").trim();
  const school =
    (hint
      ? await prisma.school.findUnique({
          where: { id: hint },
          select: { id: true, name: true },
        })
      : null) ||
    (await prisma.school.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true },
    }));
  if (!school) throw new Error("School not found — pass schoolId");
  return school;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function abs(n: number) {
  return Math.abs(Number(n) || 0);
}

async function main(): Promise<void> {
  const school = await resolveSchoolId();

  const auditBefore = await auditKideesysMigrationHealth(school.id, null);

  const learnersBefore = await prisma.learner.findMany({
    where: { schoolId: school.id, id: { in: SAFE_LINKS.map((s) => s.learnerId) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      enrollmentStatus: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true, familyName: true } },
      createdAt: true,
    },
  });

  const familyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId: school.id, accountRef: { in: ALL_14_ACCOUNT_REFS } },
    select: { id: true, accountRef: true, familyName: true, createdAt: true },
  });

  const familyByRef = new Map(familyAccounts.map((fa) => [fa.accountRef, fa]));

  const preflightErrors: string[] = [];
  for (const spec of SAFE_LINKS) {
    const fa = familyByRef.get(spec.accountRef);
    if (!fa) preflightErrors.push(`FamilyAccount not found for accountRef ${spec.accountRef}`);
  }
  for (const spec of SAFE_LINKS) {
    const exists = learnersBefore.find((l) => l.id === spec.learnerId);
    if (!exists) preflightErrors.push(`Learner not found for learnerId ${spec.learnerId}`);
  }
  for (const spec of SAFE_LINKS) {
    const learner = learnersBefore.find((l) => l.id === spec.learnerId);
    if (!learner) continue;
    const existingRef = learner.familyAccount?.accountRef || null;
    if (existingRef && existingRef !== spec.accountRef) {
      preflightErrors.push(
        `Learner ${spec.learnerId} already linked to ${existingRef}; refusing to move to ${spec.accountRef}`
      );
    }
  }

  if (preflightErrors.length) {
    const out = {
      mode: apply ? "apply" : "dry-run",
      schoolId: school.id,
      schoolName: school.name,
      auditedAt: new Date().toISOString(),
      error: "Preflight failed",
      preflightErrors,
      safeLinks: SAFE_LINKS,
      ambiguousAccountRefs: AMBIGUOUS_ACCOUNT_REFS,
      auditBefore,
      learnersBefore,
    };
    const outPath = path.join(process.cwd(), `safe-autolink-kideesys-accounts.${nowStamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
    console.error(JSON.stringify({ ok: false, reason: "preflight_failed", outPath }, null, 2));
    process.exit(1);
  }

  const linkResults: Array<{
    accountRef: string;
    learnerId: string;
    familyAccountId: string;
    mode: "linked" | "skipped_already_linked";
  }> = [];

  if (apply) {
    await prisma.$transaction(async (tx) => {
      for (const spec of SAFE_LINKS) {
        const fa = familyByRef.get(spec.accountRef)!;
        const learner = learnersBefore.find((l) => l.id === spec.learnerId)!;
        if (learner.familyAccountId === fa.id) {
          linkResults.push({
            accountRef: spec.accountRef,
            learnerId: spec.learnerId,
            familyAccountId: fa.id,
            mode: "skipped_already_linked",
          });
          continue;
        }

        await tx.learner.update({
          where: { id: learner.id },
          data: { familyAccountId: fa.id },
          select: { id: true },
        });

        linkResults.push({
          accountRef: spec.accountRef,
          learnerId: spec.learnerId,
          familyAccountId: fa.id,
          mode: "linked",
        });
      }
    });
  }

  const learnersAfter = await prisma.learner.findMany({
    where: { schoolId: school.id, id: { in: SAFE_LINKS.map((s) => s.learnerId) } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      enrollmentStatus: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true, familyName: true } },
      createdAt: true,
    },
  });

  const auditAfter = await auditKideesysMigrationHealth(school.id, null);

  // Determine linked vs still-unmatched for the 14 accountRefs, based on whether the FamilyAccount has any learners.
  const familyWithLearners = await prisma.familyAccount.findMany({
    where: { schoolId: school.id, accountRef: { in: ALL_14_ACCOUNT_REFS } },
    select: {
      accountRef: true,
      id: true,
      learners: { select: { id: true } },
    },
  });
  const linkedAccountRefs = familyWithLearners
    .filter((fa) => (fa.learners?.length || 0) > 0)
    .map((fa) => fa.accountRef)
    .sort();
  const stillUnmatchedAccountRefs = familyWithLearners
    .filter((fa) => (fa.learners?.length || 0) === 0)
    .map((fa) => fa.accountRef)
    .sort();

  // Statement metrics (read-only): compute from learners + ledger + history.
  const ledger = readSchoolLedger(school.id);
  const statementAccounts = await buildAccountsFromLearners(school.id, ledger);
  const statementsWithBalance = statementAccounts.filter((a) => abs(a.balance) > 0.01).length;
  const statementsWithLastInvoice = statementAccounts.filter(
    (a) => Boolean(String(a.lastInvoiceDate || "").trim()) || Boolean(a.lastInvoiceLabel)
  ).length;
  const statementsWithLastPayment = statementAccounts.filter((a) =>
    Boolean(String(a.lastPaymentDate || "").trim())
  ).length;

  const summary = {
    linked: linkedAccountRefs,
    stillUnmatched: stillUnmatchedAccountRefs,
    statementsWithBalance,
    statementsWithLastInvoice,
    statementsWithLastPayment,
    audit: {
      pass: auditAfter.gatePassed,
      gateErrors: auditAfter.gateErrors,
    },
  };

  const out = {
    mode: apply ? "apply" : "dry-run",
    schoolId: school.id,
    schoolName: school.name,
    auditedAt: new Date().toISOString(),
    safeLinks: SAFE_LINKS,
    ambiguousAccountRefs: AMBIGUOUS_ACCOUNT_REFS,
    linkResults: apply ? linkResults : [],
    auditBefore,
    auditAfter,
    learnersBefore,
    learnersAfter,
    reconciliationSummary: summary,
  };

  const outPath = path.join(process.cwd(), `safe-autolink-kideesys-accounts.${nowStamp()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log(
    JSON.stringify(
      {
        ok: true,
        mode: out.mode,
        schoolId: out.schoolId,
        schoolName: out.schoolName,
        wrote: outPath,
        appliedLinks: apply ? linkResults.filter((r) => r.mode === "linked").length : 0,
        summary,
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

