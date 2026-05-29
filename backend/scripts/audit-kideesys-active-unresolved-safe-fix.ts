/**
 * Audit + safe-fix ONLY for "Real active unresolved" learners:
 * active learners that should have Kid-e-Sys billing but are NOT linked
 * to a FamilyAccount whose accountRef is a Kid-e-Sys account code.
 *
 * Constraints (per ops runbook):
 * - Do NOT re-import
 * - Do NOT touch invoices/payments/balances
 * - Do NOT touch historical shell accounts
 * - Apply ONLY unambiguous safe fixes by updating learner.familyAccountId
 *
 * Usage:
 *   npx tsx scripts/audit-kideesys-active-unresolved-safe-fix.ts [schoolId]            (audit only)
 *   npx tsx scripts/audit-kideesys-active-unresolved-safe-fix.ts [schoolId] --apply   (apply safe fixes)
 *
 * Output:
 * - Writes JSON to ./kideesys-active-unresolved-audit.json
 * - Prints summary counts to stdout
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { isKidESysSourceAccountRef } from "../src/services/daSilvaMigration/ageAnalysisParser";
import { resolveLearnerAccountNo } from "../src/utils/learnerIdentity";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../src/utils/kidesysTransactionHistoryStore";

const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");
const schoolIdArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

function admissionBase(admissionNo: string | null | undefined): string {
  const adm = String(admissionNo || "").trim();
  if (!adm) return "";
  const dash = adm.indexOf("-");
  return dash === -1 ? adm : adm.slice(0, dash);
}

function normalizeKidRef(value: string): string {
  const v = String(value || "").trim();
  if (!v) return "";
  return isKidESysSourceAccountRef(v) ? v.toUpperCase() : "";
}

function isHistoricalShellAccountRef(value: string): boolean {
  const v = String(value || "").trim().toUpperCase();
  if (!v) return false;
  // Conservative: skip any special/system "shell" families.
  return v.startsWith("SHELL") || v.includes("SHELL-") || v.includes("SHELL_");
}

async function resolveSchoolId(): Promise<{ id: string; name: string }> {
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

type UnresolvedRow = {
  learnerName: string;
  learnerId: string;
  currentFamilyAccountId: string | null;
  currentFamilyAccountRef: string | null;
  expectedKideesysAccountRef: string | null;
  reasonUnresolved: string;
  safeFix: string;
  safeToApply: boolean;
  targetFamilyAccountId: string | null;
};

function learnerDisplayName(learner: { firstName: string | null; lastName: string | null }): string {
  return [learner.firstName, learner.lastName].filter(Boolean).join(" ").trim() || "(Unnamed)";
}

function expectedRefFromLearner(learner: {
  admissionNo: string | null;
  accountNo: string | null;
  accountNumber: string | null;
  familyAccount?: { accountRef?: string | null } | null;
}): string {
  // Prefer explicit admission-base if it's a Kid-e-Sys account code (e.g. ALI002).
  const base = normalizeKidRef(admissionBase(learner.admissionNo));
  if (base) return base;

  // Fallback to the identity resolver (familyAccount ref first, then admission, then accountNo/number).
  const resolved = normalizeKidRef(resolveLearnerAccountNo(learner));
  if (resolved) return resolved;

  // Last fallback: accountNo/accountNumber if they happen to carry Kid-e-Sys codes.
  const raw = normalizeKidRef(String(learner.accountNo || learner.accountNumber || "").trim());
  return raw;
}

async function main(): Promise<void> {
  const school = await resolveSchoolId();
  const schoolId = school.id;

  const ledger = readSchoolLedger(schoolId);
  const history = readSchoolKidesysHistory(schoolId);

  const learnerHasKidesysLedgerActivity = new Set<string>();
  for (const entry of ledger) {
    const learnerId = String((entry as any).learnerId || "").trim();
    const accountNo = String((entry as any).accountNo || "").trim();
    if (!learnerId) continue;
    if (isKidESysSourceAccountRef(accountNo)) learnerHasKidesysLedgerActivity.add(learnerId);
  }

  const activeLearners = await prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      accountNo: true,
      accountNumber: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true } },
    },
  });

  const familyAccountsByRef = new Map<string, Array<{ id: string; accountRef: string }>>();
  const allFamilyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId, accountRef: { not: null } },
    select: { id: true, accountRef: true },
  });
  for (const fa of allFamilyAccounts) {
    const ref = String(fa.accountRef || "").trim();
    if (!ref) continue;
    const key = ref.toUpperCase();
    const arr = familyAccountsByRef.get(key) || [];
    arr.push({ id: fa.id, accountRef: ref });
    familyAccountsByRef.set(key, arr);
  }

  const unresolved: UnresolvedRow[] = [];
  const safeCandidates: UnresolvedRow[] = [];
  const ambiguous: UnresolvedRow[] = [];

  for (const learner of activeLearners) {
    const currentRefRaw = String(learner.familyAccount?.accountRef || "").trim();
    const currentKidRef = normalizeKidRef(currentRefRaw);
    const shouldHaveKidesysBilling =
      learnerHasKidesysLedgerActivity.has(String(learner.id || "").trim()) ||
      Boolean(history.length > 0 && String(learner.familyAccountId || "").trim());

    if (!shouldHaveKidesysBilling) continue;
    if (currentKidRef) continue;

    const expectedRef = expectedRefFromLearner(learner) || "";
    const expectedIsKid = Boolean(expectedRef && isKidESysSourceAccountRef(expectedRef));
    const existingByExpected = expectedIsKid ? (familyAccountsByRef.get(expectedRef) || []) : [];

    let reason = "";
    let safeFix = "No safe fix (manual review)";
    let safeToApply = false;
    let targetFamilyAccountId: string | null = null;

    if (!expectedIsKid) {
      reason =
        "No expected Kid-e-Sys accountRef on learner identity (admissionNo/accountNo not a Kid-e-Sys code), and current FamilyAccount.accountRef is not Kid-e-Sys";
    } else if (existingByExpected.length === 0) {
      reason = `Expected Kid-e-Sys accountRef ${expectedRef} does not exist as FamilyAccount.accountRef`;
    } else if (existingByExpected.length > 1) {
      reason = `Duplicate FamilyAccount rows share expected accountRef ${expectedRef} (ambiguous)`;
    } else {
      const target = existingByExpected[0]!;
      const targetRef = String(target.accountRef || "").trim();
      if (isHistoricalShellAccountRef(targetRef)) {
        reason = `Expected accountRef ${expectedRef} maps to a historical shell family (blocked)`;
      } else {
        const learnerAdmission = String(learner.admissionNo || "").trim();
        const admissionMatch = normalizeKidRef(admissionBase(learnerAdmission)) === expectedRef;
        const acctMatch = normalizeKidRef(String(learner.accountNo || learner.accountNumber || "").trim()) === expectedRef;

        if (!admissionMatch && !acctMatch) {
          reason = `Expected accountRef ${expectedRef} found, but learner identity does not exactly match it (no exact admission/account match)`;
        } else if (learner.familyAccountId && learner.familyAccountId === target.id) {
          reason = `Learner already linked to FamilyAccount ${target.id} but accountRef not recognized as Kid-e-Sys (data mismatch)`;
        } else {
          // Conflict guard: if some other learner is already linked to this expected ref via a DIFFERENT FamilyAccountId,
          // treat as ambiguous. (Multiple learners can share the same family; but the familyAccountId must be the same.)
          const otherLearnersOnExpected = activeLearners.filter((l) => {
            if (l.id === learner.id) return false;
            const exp = expectedRefFromLearner(l);
            return exp === expectedRef;
          });
          const conflicting = otherLearnersOnExpected.some((l) => l.familyAccountId && l.familyAccountId !== target.id);

          if (conflicting) {
            reason = `Another learner with expected accountRef ${expectedRef} is linked to a different FamilyAccountId (conflict)`;
          } else {
            reason = `Active learner should have Kid-e-Sys billing but is linked to a non-Kid family accountRef`;
            targetFamilyAccountId = target.id;
            safeFix = `Update learner.familyAccountId -> ${target.id} (FamilyAccount.accountRef=${expectedRef})`;
            safeToApply = true;
          }
        }
      }
    }

    const row: UnresolvedRow = {
      learnerName: learnerDisplayName(learner),
      learnerId: learner.id,
      currentFamilyAccountId: learner.familyAccountId,
      currentFamilyAccountRef: currentRefRaw || null,
      expectedKideesysAccountRef: expectedIsKid ? expectedRef : expectedRef || null,
      reasonUnresolved: reason,
      safeFix,
      safeToApply,
      targetFamilyAccountId,
    };

    unresolved.push(row);
    if (safeToApply) safeCandidates.push(row);
    else ambiguous.push(row);
  }

  // Persist audit artifact for review.
  const outPath = path.join(process.cwd(), "kideesys-active-unresolved-audit.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        schoolId,
        schoolName: school.name,
        auditedAt: new Date().toISOString(),
        applyMode: apply ? "apply" : "dry-run",
        realActiveUnresolved: unresolved.length,
        safeCandidateCount: safeCandidates.length,
        ambiguousCount: ambiguous.length,
        rows: unresolved,
      },
      null,
      2
    )
  );

  if (apply && safeCandidates.length > 0) {
    for (const fix of safeCandidates) {
      if (!fix.safeToApply || !fix.targetFamilyAccountId) continue;
      await prisma.learner.update({
        where: { id: fix.learnerId },
        data: { familyAccountId: fix.targetFamilyAccountId },
      });
    }
  }

  console.log(`School: ${school.name} (${schoolId})`);
  console.log(`Real active unresolved: ${unresolved.length}`);
  console.log(`Safe active links to apply: ${safeCandidates.length}`);
  console.log(`Ambiguous/manual review: ${ambiguous.length}`);
  console.log(`Wrote ${outPath}`);
  if (!apply) console.log("Dry run only. Re-run with --apply to persist safe fixes.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

