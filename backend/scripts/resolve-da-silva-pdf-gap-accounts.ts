/**
 * Resolve 3 active EduClear accounts missing from payment_receive_list.pdf.
 * Read-only by default; production writes require CONFIRM_PRODUCTION_WRITE=true.
 *
 *   npx ts-node --transpile-only scripts/resolve-da-silva-pdf-gap-accounts.ts
 *   CONFIRM_PRODUCTION_WRITE=true PRODUCTION_DATABASE_URL="..." \
 *     npx ts-node --transpile-only scripts/resolve-da-silva-pdf-gap-accounts.ts --apply
 */
import "dotenv/config";

import { PrismaClient } from "@prisma/client";

const SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";
const CONFIRM_ENV = "CONFIRM_PRODUCTION_WRITE";
const GAP_REFS = ["LET007", "MAJ001", "MON001"] as const;

const APPLY = process.argv.includes("--apply");
const allowLocalTarget = process.argv.includes("--allow-local-target");

function resolveDatabaseUrl(): string {
  const prod = String(process.env.PRODUCTION_DATABASE_URL || "").trim();
  const local = String(process.env.DATABASE_URL || "").trim();
  if (prod) return prod;
  if (allowLocalTarget && local) return local;
  throw new Error("Set PRODUCTION_DATABASE_URL (or --allow-local-target with DATABASE_URL)");
}

type GapPlan = {
  accountRef: string;
  action: string;
  reason: string;
  learnerIds: string[];
  learnerNames: string[];
  enrollmentBefore: string[];
  enrollmentAfter: string[];
  familyAccountIdBefore: string | null;
  familyAccountIdAfter: string | null;
};

async function main() {
  const prisma = new PrismaClient({ datasources: { db: { url: resolveDatabaseUrl() } } });

  const mon014 = await prisma.familyAccount.findFirst({
    where: { schoolId: SCHOOL_ID, accountRef: "MON014" },
    select: { id: true, accountRef: true, familyName: true, schoolId: true },
  });
  if (!mon014 || mon014.schoolId !== SCHOOL_ID) {
    throw new Error("MON014 family account not found for Da Silva");
  }

  const plans: GapPlan[] = [];

  for (const accountRef of GAP_REFS) {
    const fa = await prisma.familyAccount.findFirst({
      where: { schoolId: SCHOOL_ID, accountRef },
      include: {
        learners: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            enrollmentStatus: true,
            className: true,
            familyAccountId: true,
          },
        },
      },
    });

    if (!fa) {
      plans.push({
        accountRef,
        action: "none",
        reason: "Family account not found",
        learnerIds: [],
        learnerNames: [],
        enrollmentBefore: [],
        enrollmentAfter: [],
        familyAccountIdBefore: null,
        familyAccountIdAfter: null,
      });
      continue;
    }

    if (accountRef === "MON001") {
      const learner = fa.learners[0];
      if (!learner) {
        plans.push({
          accountRef,
          action: "none",
          reason: "MON001 has no linked learner",
          learnerIds: [],
          learnerNames: [],
          enrollmentBefore: [],
          enrollmentAfter: [],
          familyAccountIdBefore: fa.id,
          familyAccountIdAfter: null,
        });
        continue;
      }
      plans.push({
        accountRef,
        action: "relink_to_MON014",
        reason:
          "PDF lists Grace Monaise as MON014 R0.00 (Creche). MON001 is a duplicate shell — relink learner to PDF account MON014.",
        learnerIds: [learner.id],
        learnerNames: [`${learner.firstName} ${learner.lastName}`.trim()],
        enrollmentBefore: [learner.enrollmentStatus],
        enrollmentAfter: ["ACTIVE"],
        familyAccountIdBefore: learner.familyAccountId,
        familyAccountIdAfter: mon014.id,
      });
      continue;
    }

    if (accountRef === "LET007") {
      for (const learner of fa.learners) {
        plans.push({
          accountRef,
          action: "set_historical",
          reason:
            "Not in payment_receive_list.pdf. Family shell is HISTORICAL ORPHAN LET007 — exclude from active billing (no PDF balance to apply).",
          learnerIds: [learner.id],
          learnerNames: [`${learner.firstName} ${learner.lastName}`.trim()],
          enrollmentBefore: [learner.enrollmentStatus],
          enrollmentAfter: ["HISTORICAL"],
          familyAccountIdBefore: learner.familyAccountId,
          familyAccountIdAfter: learner.familyAccountId,
        });
      }
      continue;
    }

    if (accountRef === "MAJ001") {
      for (const learner of fa.learners) {
        plans.push({
          accountRef,
          action: "set_historical",
          reason:
            "Not in payment_receive_list.pdf. No Kid-e-Sys billing row — exclude from active billing (no balance to guess).",
          learnerIds: [learner.id],
          learnerNames: [`${learner.firstName} ${learner.lastName}`.trim()],
          enrollmentBefore: [learner.enrollmentStatus],
          enrollmentAfter: ["HISTORICAL"],
          familyAccountIdBefore: learner.familyAccountId,
          familyAccountIdAfter: learner.familyAccountId,
        });
      }
    }
  }

  const report = {
    mode: APPLY ? "apply" : "plan",
    schoolId: SCHOOL_ID,
    gapAccounts: GAP_REFS,
    pdfConfirmedMissing: true,
    plans,
    summary: {
      relinkToMon014: plans.filter((p) => p.action === "relink_to_MON014").length,
      setHistorical: plans.filter((p) => p.action === "set_historical").length,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  if (!APPLY) {
    console.log(`\nPlan only. Re-run with --apply and ${CONFIRM_ENV}=true`);
    await prisma.$disconnect();
    return;
  }

  if (String(process.env[CONFIRM_ENV] || "").trim().toLowerCase() !== "true") {
    console.error(`Refusing --apply without ${CONFIRM_ENV}=true`);
    process.exit(1);
  }

  for (const plan of plans) {
    if (plan.action === "relink_to_MON014") {
      for (const learnerId of plan.learnerIds) {
        await prisma.learner.update({
          where: { id: learnerId },
          data: { familyAccountId: mon014.id, enrollmentStatus: "ACTIVE" },
        });
      }
    } else if (plan.action === "set_historical") {
      for (const learnerId of plan.learnerIds) {
        await prisma.learner.update({
          where: { id: learnerId },
          data: { enrollmentStatus: "HISTORICAL" },
        });
      }
    }
  }

  console.log("\nApplied gap-account resolution.");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
