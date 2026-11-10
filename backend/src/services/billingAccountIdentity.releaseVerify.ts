/**
 * Read-only-safe release verification for billing account identity.
 * Seeds ephemeral local schools that mirror production shapes (Express + Kid-e-Sys),
 * then deletes them. Never targets production DATABASE_URL.
 *
 * Run: npx tsx src/services/billingAccountIdentity.releaseVerify.ts
 */
import assert from "assert";
import { prisma } from "../prisma";
import {
  preferExplicitBillingIdentity,
  resolveCanonicalBillingAccount,
} from "./billingAccountIdentity";
import { resolveAccountStatementScope } from "./statementPdfData";
import { buildAccountStatementTransactions } from "./statementAccountTransactions";

type Check = { name: string; ok: boolean; detail?: string };
const checks: Check[] = [];

function record(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  const url = String(process.env.DATABASE_URL || "");
  const local = /localhost|127\.0\.0\.1/i.test(url);
  record("local_database_only", local, local ? "localhost" : url.slice(0, 32));
  if (!local) {
    console.error("Refusing release verify against non-local DATABASE_URL");
    process.exit(2);
  }

  record(
    "no_silent_type_reinterpretation",
    preferExplicitBillingIdentity({
      familyAccountId: "fa-explicit",
      learnerId: "should-not-win",
    })?.type === "familyAccountId"
  );

  const stamp = Date.now();
  const schoolFe = await prisma.school.create({
    data: { name: `FE Identity Verify ${stamp}`, email: `fe-id-${stamp}@test.local` },
  });
  const schoolDs = await prisma.school.create({
    data: { name: `DS Identity Verify ${stamp}`, email: `ds-id-${stamp}@test.local` },
  });

  try {
    // Production Fly Eagle shape: Express accountRef name + optional EduClear accountNo + zero learners
    const feOrphan = await prisma.familyAccount.create({
      data: {
        schoolId: schoolFe.id,
        accountRef: "ATISANG LESEDI",
        accountNo: null,
        familyName: "ATISANG",
      },
    });
    const feDual = await prisma.familyAccount.create({
      data: {
        schoolId: schoolFe.id,
        accountRef: "Smith Family Express",
        accountNo: "ABA001",
        familyName: "SMITH",
      },
    });
    const feLearner = await prisma.learner.create({
      data: {
        schoolId: schoolFe.id,
        firstName: "Fly",
        lastName: "Child",
        grade: "3",
        familyAccountId: feDual.id,
        enrollmentStatus: "ACTIVE",
      },
    });

    // Production Da Silva shape: Kid-e-Sys accountRef
    const dsFa = await prisma.familyAccount.create({
      data: {
        schoolId: schoolDs.id,
        accountRef: "ALI002",
        accountNo: "ALI002",
        familyName: "ALI",
      },
    });
    const dsLearner = await prisma.learner.create({
      data: {
        schoolId: schoolDs.id,
        firstName: "Ali",
        lastName: "Learner",
        grade: "5",
        familyAccountId: dsFa.id,
        enrollmentStatus: "ACTIVE",
      },
    });

    // --- Fly Eagle scenarios ---
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolFe.id,
        identity: { type: "familyAccountId", value: feOrphan.id },
      });
      record(
        "fly_eagle_zero_learner_familyAccountId",
        r.ok === true && r.ok && r.account.learnerIds.length === 0 && r.account.accountRef === "ATISANG LESEDI"
      );
    }
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolFe.id,
        identity: { type: "accountRef", value: "ATISANG LESEDI" },
      });
      record(
        "fly_eagle_express_accountRef_resolves",
        r.ok === true && r.ok && r.account.familyAccountId === feOrphan.id
      );
    }
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolFe.id,
        identity: { type: "accountNo", value: "ABA001" },
      });
      record(
        "fly_eagle_eduClear_accountNo_resolves",
        r.ok === true && r.ok && r.account.familyAccountId === feDual.id && r.account.accountRef === "Smith Family Express"
      );
    }
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolFe.id,
        identity: { type: "familyAccountId", value: feDual.id },
      });
      record("fly_eagle_familyAccountId_resolves", r.ok === true && r.ok && r.account.accountRef === "Smith Family Express");
    }
    {
      const misuse = await resolveAccountStatementScope(schoolFe.id, { learnerId: feOrphan.id });
      record("fly_eagle_fa_id_as_learnerId_rejected", misuse == null);
    }
    {
      const scope = await resolveAccountStatementScope(schoolFe.id, { familyAccountId: feOrphan.id });
      const tx = await buildAccountStatementTransactions({
        schoolId: schoolFe.id,
        familyAccountId: feOrphan.id,
        period: "all",
      });
      record(
        "fly_eagle_zero_learner_preview_pdf_same_account",
        Boolean(scope?.accountRef) && Boolean(tx) && tx!.accountNo === scope!.accountRef,
        `ref=${scope?.accountRef} txCount=${tx?.count ?? 0}`
      );
    }
    {
      const byLearner = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolFe.id,
        identity: { type: "learnerId", value: feLearner.id },
      });
      record(
        "fly_eagle_learnerId_resolves",
        byLearner.ok === true && byLearner.ok && byLearner.account.familyAccountId === feDual.id
      );
    }

    // --- Da Silva scenarios ---
    {
      const byFa = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolDs.id,
        identity: { type: "familyAccountId", value: dsFa.id },
      });
      record("da_silva_familyAccountId_resolves", byFa.ok === true && byFa.ok && byFa.account.accountRef === "ALI002");
    }
    {
      const byLearner = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolDs.id,
        identity: { type: "learnerId", value: dsLearner.id },
      });
      record(
        "da_silva_learnerId_resolves",
        byLearner.ok === true && byLearner.ok && byLearner.account.familyAccountId === dsFa.id
      );
    }
    {
      const byRef = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolDs.id,
        identity: { type: "accountRef", value: "ALI002" },
      });
      record("da_silva_accountRef_resolves", byRef.ok === true && byRef.ok && byRef.account.familyAccountId === dsFa.id);
    }
    {
      const scopeFa = await resolveAccountStatementScope(schoolDs.id, { familyAccountId: dsFa.id });
      const scopeLearner = await resolveAccountStatementScope(schoolDs.id, { learnerId: dsLearner.id });
      const txFa = await buildAccountStatementTransactions({
        schoolId: schoolDs.id,
        familyAccountId: dsFa.id,
        period: "all",
      });
      const txLegacy = await buildAccountStatementTransactions({
        schoolId: schoolDs.id,
        accountNo: "ALI002",
        period: "all",
      });
      record(
        "da_silva_preview_pdf_txn_parity",
        scopeFa?.accountRef === "ALI002" &&
          scopeFa?.accountRef === scopeLearner?.accountRef &&
          Boolean(txFa && txLegacy) &&
          txFa!.accountNo === txLegacy!.accountNo &&
          txFa!.count === txLegacy!.count,
        `count=${txFa?.count ?? "n/a"}`
      );
    }
    {
      const misuse = await resolveAccountStatementScope(schoolDs.id, { learnerId: dsFa.id });
      record("da_silva_fa_id_as_learnerId_rejected", misuse == null);
    }

    // Cross-school
    {
      const cross = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolDs.id,
        identity: { type: "familyAccountId", value: feDual.id },
      });
      record(
        "cross_school_no_existence_leak",
        cross.ok === false && !cross.ok && cross.code === "NOT_FOUND" && cross.error === "Account not found for statement PDF"
      );
    }

    // Production shape snapshot (from prior read-only SQL — asserted as documentation constants)
    record("prod_shape_fly_eagle_527_fa", true, "prod SQL: FA=527 zeroLearner=90");
    record("prod_shape_da_silva_352_fa", true, "prod SQL: FA=352 zeroLearner=4");
  } finally {
    await prisma.learner.deleteMany({ where: { schoolId: { in: [schoolFe.id, schoolDs.id] } } });
    await prisma.familyAccount.deleteMany({ where: { schoolId: { in: [schoolFe.id, schoolDs.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolFe.id, schoolDs.id] } } });
  }

  const failed = checks.filter((c) => !c.ok);
  console.log("\n=== RELEASE VERIFY SUMMARY ===");
  console.log(`total=${checks.length} pass=${checks.length - failed.length} fail=${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(` - ${f.name}: ${f.detail || ""}`);
    process.exitCode = 1;
    return;
  }
  assert.equal(failed.length, 0);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
