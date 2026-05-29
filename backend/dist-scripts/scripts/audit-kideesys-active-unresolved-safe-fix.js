/**
 * Audit + safe-fix ONLY for "Real active unresolved" learners:
 * active learners that should have Kid-e-Sys billing but are NOT linked
 * to a FamilyAccount whose accountRef is a Kid-e-Sys account code.
 *
 * Constraints:
 * - Do NOT re-import
 * - Do NOT touch invoices/payments/balances
 * - Do NOT touch historical shell accounts
 * - Apply ONLY unambiguous safe fixes by updating learner.familyAccountId
 *
 * Usage:
 *   node dist-scripts/scripts/audit-kideesys-active-unresolved-safe-fix.js [schoolId]
 *   node dist-scripts/scripts/audit-kideesys-active-unresolved-safe-fix.js [schoolId] --apply
 */
require("dotenv/config");

const fs = require("fs");
const path = require("path");
const { PrismaClient } = require("@prisma/client");

const { isKidESysSourceAccountRef } = require("../src/services/daSilvaMigration/ageAnalysisParser");
const { resolveLearnerAccountNo } = require("../src/utils/learnerIdentity");
const { readSchoolLedger } = require("../src/utils/billingLedgerStore");
const { readSchoolKidesysHistory } = require("../src/utils/kidesysTransactionHistoryStore");

const prisma = new PrismaClient();
const apply = process.argv.includes("--apply");
const reportFixed = process.argv.includes("--report-fixed");
const schoolIdArg = process.argv.slice(2).find((a) => !a.startsWith("--"));

function admissionBase(admissionNo) {
  const adm = String(admissionNo || "").trim();
  if (!adm) return "";
  const dash = adm.indexOf("-");
  return dash === -1 ? adm : adm.slice(0, dash);
}

function normalizeKidRef(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  return isKidESysSourceAccountRef(v) ? v.toUpperCase() : "";
}

function isHistoricalShellAccountRef(value) {
  const v = String(value || "").trim().toUpperCase();
  if (!v) return false;
  return v.startsWith("SHELL") || v.includes("SHELL-") || v.includes("SHELL_");
}

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

function learnerDisplayName(learner) {
  return [learner.firstName, learner.lastName].filter(Boolean).join(" ").trim() || "(Unnamed)";
}

function expectedRefFromLearner(learner) {
  const base = normalizeKidRef(admissionBase(learner.admissionNo));
  if (base) return base;

  const resolved = normalizeKidRef(resolveLearnerAccountNo(learner));
  if (resolved) return resolved;

  return "";
}

async function main() {
  const school = await resolveSchool();
  const schoolId = school.id;

  const ledger = readSchoolLedger(schoolId);
  const history = readSchoolKidesysHistory(schoolId);

  const learnerHasKidesysLedgerActivity = new Set();
  const learnerToKidesysRefs = new Map(); // learnerId -> Set(accountRef)
  for (const entry of ledger) {
    const learnerId = String(entry.learnerId || "").trim();
    const accountNo = String(entry.accountNo || "").trim();
    if (!learnerId) continue;
    if (isKidESysSourceAccountRef(accountNo)) {
      learnerHasKidesysLedgerActivity.add(learnerId);
      const ref = normalizeKidRef(accountNo);
      if (ref) {
        const set = learnerToKidesysRefs.get(learnerId) || new Set();
        set.add(ref);
        learnerToKidesysRefs.set(learnerId, set);
      }
    }
  }

  const activeLearners = await prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      admissionNo: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true } },
    },
  });

  const familyAccountsByRef = new Map();
  const allFamilyAccounts = await prisma.familyAccount.findMany({
    where: { schoolId },
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

  const unresolved = [];
  const safeCandidates = [];
  const ambiguous = [];

  for (const learner of activeLearners) {
    const currentRefRaw = String((learner.familyAccount && learner.familyAccount.accountRef) || "").trim();
    const currentKidRef = normalizeKidRef(currentRefRaw);
    const shouldHaveKidesysBilling =
      learnerHasKidesysLedgerActivity.has(String(learner.id || "").trim()) ||
      Boolean(history.length > 0 && String(learner.familyAccountId || "").trim());

    if (!shouldHaveKidesysBilling) continue;
    if (currentKidRef) {
      if (!reportFixed) continue;
      const ledgerRefs = learnerToKidesysRefs.get(String(learner.id || "").trim());
      if (!ledgerRefs || ledgerRefs.size !== 1) continue;
      const only = [...ledgerRefs][0];
      if (only !== currentKidRef) continue;
      // Include confirmed fixed links (post-apply reporting).
      unresolved.push({
        learnerName: learnerDisplayName(learner),
        learnerId: learner.id,
        currentFamilyAccountId: learner.familyAccountId,
        currentFamilyAccountRef: currentRefRaw || null,
        expectedKideesysAccountRef: only || null,
        reasonUnresolved: "Resolved (Kid-e-Sys ref confirmed by learner ledger activity)",
        safeFix: "N/A (already linked)",
        safeToApply: false,
        targetFamilyAccountId: learner.familyAccountId || null,
      });
      continue;
    }

    const expectedRef = expectedRefFromLearner(learner) || "";
    const ledgerRefs = learnerToKidesysRefs.get(String(learner.id || "").trim());
    const ledgerExpected =
      !expectedRef && ledgerRefs && ledgerRefs.size === 1 ? [...ledgerRefs][0] : "";
    const effectiveExpectedRef = expectedRef || ledgerExpected;
    const expectedIsKid = Boolean(expectedRef && isKidESysSourceAccountRef(expectedRef));
    const effectiveIsKid = Boolean(effectiveExpectedRef && isKidESysSourceAccountRef(effectiveExpectedRef));
    const existingByExpected = effectiveIsKid ? familyAccountsByRef.get(effectiveExpectedRef) || [] : [];

    let reason = "";
    let safeFix = "No safe fix (manual review)";
    let safeToApply = false;
    let targetFamilyAccountId = null;

    if (!effectiveIsKid) {
      if (ledgerRefs && ledgerRefs.size > 1) {
        reason = `Multiple Kid-e-Sys accountRef values found in learner ledger activity (${[...ledgerRefs].join(
          ", "
        )}) — cannot choose expected accountRef safely`;
      } else {
        reason =
          "No expected Kid-e-Sys accountRef on learner identity, and no single unambiguous Kid-e-Sys accountRef inferred from ledger activity";
      }
    } else if (existingByExpected.length === 0) {
      reason = `Expected Kid-e-Sys accountRef ${effectiveExpectedRef} does not exist as FamilyAccount.accountRef`;
    } else if (existingByExpected.length > 1) {
      reason = `Duplicate FamilyAccount rows share expected accountRef ${effectiveExpectedRef} (ambiguous)`;
    } else {
      const target = existingByExpected[0];
      const targetRef = String(target.accountRef || "").trim();
      if (isHistoricalShellAccountRef(targetRef)) {
        reason = `Expected accountRef ${effectiveExpectedRef} maps to a historical shell family (blocked)`;
      } else {
        const learnerAdmission = String(learner.admissionNo || "").trim();
        const admissionMatch = normalizeKidRef(admissionBase(learnerAdmission)) === effectiveExpectedRef;

        // Condition 2: exact match OR already confirmed. If we inferred from ledger activity (learnerId-linked),
        // that is considered already confirmed.
        const confirmedByLedger = Boolean(ledgerExpected && ledgerExpected === effectiveExpectedRef);

        if (!admissionMatch && !confirmedByLedger) {
          reason = `Expected accountRef ${effectiveExpectedRef} found, but learner identity is not an exact admission match and is not confirmed by ledger activity`;
        } else if (learner.familyAccountId && learner.familyAccountId === target.id) {
          reason = `Learner already linked to FamilyAccount ${target.id} but accountRef not recognized as Kid-e-Sys (data mismatch)`;
        } else {
          const otherLearnersOnExpected = activeLearners.filter((l) => {
            if (l.id === learner.id) return false;
            const exp = expectedRefFromLearner(l);
            const otherLedgerRefs = learnerToKidesysRefs.get(String(l.id || "").trim());
            const otherLedgerExpected =
              !exp && otherLedgerRefs && otherLedgerRefs.size === 1 ? [...otherLedgerRefs][0] : "";
            const otherEffective = exp || otherLedgerExpected;
            return otherEffective === effectiveExpectedRef;
          });
          const conflicting = otherLearnersOnExpected.some(
            (l) => l.familyAccountId && l.familyAccountId !== target.id
          );

          if (conflicting) {
            reason = `Another learner with expected accountRef ${effectiveExpectedRef} is linked to a different FamilyAccountId (conflict)`;
          } else {
            reason = "Active learner should have Kid-e-Sys billing but is linked to a non-Kid family accountRef";
            targetFamilyAccountId = target.id;
            safeFix = `Update learner.familyAccountId -> ${target.id} (FamilyAccount.accountRef=${effectiveExpectedRef})`;
            safeToApply = true;
          }
        }
      }
    }

    const row = {
      learnerName: learnerDisplayName(learner),
      learnerId: learner.id,
      currentFamilyAccountId: learner.familyAccountId,
      currentFamilyAccountRef: currentRefRaw || null,
      expectedKideesysAccountRef: effectiveExpectedRef || null,
      reasonUnresolved: reason,
      safeFix,
      safeToApply,
      targetFamilyAccountId,
    };

    unresolved.push(row);
    if (safeToApply) safeCandidates.push(row);
    else ambiguous.push(row);
  }

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

