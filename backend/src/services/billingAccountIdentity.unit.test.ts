/**
 * Billing account identity — pure contract + resolver behaviour.
 * Run: npx ts-node --transpile-only src/services/billingAccountIdentity.unit.test.ts
 */
import assert from "assert";
import {
  parseBillingAccountIdentity,
  preferExplicitBillingIdentity,
  resolveCanonicalBillingAccount,
} from "./billingAccountIdentity";
import { prisma } from "../prisma";

function isLocalDatabase(): boolean {
  const url = String(process.env.DATABASE_URL || "");
  return /localhost|127\.0\.0\.1/i.test(url);
}

async function main() {
  // --- Pure contract (no DB) ---
  assert.deepStrictEqual(
    parseBillingAccountIdentity({ type: "familyAccountId", value: "fa-1" }),
    { type: "familyAccountId", value: "fa-1" }
  );
  assert.strictEqual(parseBillingAccountIdentity({ type: "guess", value: "x" }), null);
  assert.strictEqual(parseBillingAccountIdentity({ type: "learnerId", value: "" }), null);

  assert.deepStrictEqual(
    preferExplicitBillingIdentity({
      familyAccountId: "fa-1",
      learnerId: "learner-should-not-win",
      accountNo: "ACC001",
    }),
    { type: "familyAccountId", value: "fa-1" }
  );
  assert.deepStrictEqual(
    preferExplicitBillingIdentity({
      identityType: "learnerId",
      identityValue: "L1",
      familyAccountId: "fa-ignored-when-typed",
    }),
    { type: "learnerId", value: "L1" }
  );
  assert.deepStrictEqual(
    preferExplicitBillingIdentity({ accountNo: "ABA001" }),
    { type: "accountNo", value: "ABA001" }
  );
  assert.strictEqual(preferExplicitBillingIdentity({}), null);

  console.log("✓ pure identity contract");

  if (!isLocalDatabase()) {
    console.log("⊘ DB resolution skipped (non-local DATABASE_URL)");
    console.log("billingAccountIdentity.unit.test.ts: OK");
    return;
  }

  const stamp = Date.now();
  const schoolA = await prisma.school.create({
    data: { name: `Identity A ${stamp}`, email: `id-a-${stamp}@test.local` },
  });
  const schoolB = await prisma.school.create({
    data: { name: `Identity B ${stamp}`, email: `id-b-${stamp}@test.local` },
  });

  try {
    // 1. Native family with one learner
    const faNative = await prisma.familyAccount.create({
      data: {
        schoolId: schoolA.id,
        accountRef: `NAT${String(stamp).slice(-3)}`,
        accountNo: `NAT${String(stamp).slice(-3)}`,
        familyName: "Native",
      },
    });
    const learnerNative = await prisma.learner.create({
      data: {
        schoolId: schoolA.id,
        firstName: "One",
        lastName: "Child",
        grade: "1",
        familyAccountId: faNative.id,
        enrollmentStatus: "ACTIVE",
      },
    });
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "familyAccountId", value: faNative.id },
      });
      assert.strictEqual(r.ok, true);
      if (r.ok) {
        assert.strictEqual(r.account.familyAccountId, faNative.id);
        assert.ok(r.account.learnerIds.includes(learnerNative.id));
      }
    }

    // 2. Multi-learner
    const faMulti = await prisma.familyAccount.create({
      data: {
        schoolId: schoolA.id,
        accountRef: `MUL${String(stamp).slice(-3)}`,
        familyName: "Multi",
      },
    });
    const lA = await prisma.learner.create({
      data: {
        schoolId: schoolA.id,
        firstName: "A",
        lastName: "Multi",
        grade: "2",
        familyAccountId: faMulti.id,
        enrollmentStatus: "ACTIVE",
      },
    });
    const lB = await prisma.learner.create({
      data: {
        schoolId: schoolA.id,
        firstName: "B",
        lastName: "Multi",
        grade: "3",
        familyAccountId: faMulti.id,
        enrollmentStatus: "ACTIVE",
      },
    });
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "familyAccountId", value: faMulti.id },
      });
      assert.strictEqual(r.ok, true);
      if (r.ok) {
        assert.ok(r.account.learnerIds.includes(lA.id));
        assert.ok(r.account.learnerIds.includes(lB.id));
      }
    }

    // 3. Migrated Fly Eagle dual identity
    const faFly = await prisma.familyAccount.create({
      data: {
        schoolId: schoolA.id,
        accountRef: `Express Cust ${stamp}`,
        accountNo: "ABA001",
        familyName: "FlyEagle",
      },
    });
    const lFly = await prisma.learner.create({
      data: {
        schoolId: schoolA.id,
        firstName: "Fly",
        lastName: "Eagle",
        grade: "4",
        familyAccountId: faFly.id,
        enrollmentStatus: "ACTIVE",
      },
    });
    {
      const byFa = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "familyAccountId", value: faFly.id },
      });
      assert.strictEqual(byFa.ok, true);
      if (byFa.ok) assert.strictEqual(byFa.account.accountRef, `Express Cust ${stamp}`);

      const byNo = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "accountNo", value: "ABA001" },
      });
      assert.strictEqual(byNo.ok, true);
      if (byNo.ok) assert.strictEqual(byNo.account.familyAccountId, faFly.id);

      const byLearner = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "learnerId", value: lFly.id },
      });
      assert.strictEqual(byLearner.ok, true);
      if (byLearner.ok) assert.strictEqual(byLearner.account.familyAccountId, faFly.id);
    }

    // 4. Zero linked learners
    const faOrphan = await prisma.familyAccount.create({
      data: {
        schoolId: schoolA.id,
        accountRef: `Orphan ${stamp}`,
        accountNo: "ORP001",
        familyName: "Orphan",
      },
    });
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "familyAccountId", value: faOrphan.id },
      });
      assert.strictEqual(r.ok, true);
      if (r.ok) {
        assert.strictEqual(r.account.learnerIds.length, 0);
        assert.strictEqual(r.account.accountRef, `Orphan ${stamp}`);
      }
    }

    // 8. Missing
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "familyAccountId", value: "does-not-exist" },
      });
      assert.strictEqual(r.ok, false);
      if (!r.ok) assert.strictEqual(r.code, "NOT_FOUND");
    }

    // 9–10. Ambiguous: same query matches one family's accountNo and another's accountRef
    const ambigCode = `AMB${String(stamp).slice(-3)}`;
    await prisma.familyAccount.create({
      data: {
        schoolId: schoolA.id,
        accountRef: `DUP-A-${stamp}`,
        accountNo: ambigCode,
        familyName: "DupA",
      },
    });
    await prisma.familyAccount.create({
      data: {
        schoolId: schoolA.id,
        accountRef: ambigCode,
        familyName: "DupB",
      },
    });
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "accountNo", value: ambigCode },
      });
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        assert.strictEqual(r.code, "AMBIGUOUS");
        assert.strictEqual(r.status, 409);
      }
    }

    // 11. Cross-school — no existence leak
    const faOther = await prisma.familyAccount.create({
      data: {
        schoolId: schoolB.id,
        accountRef: `OTH${String(stamp).slice(-3)}`,
        familyName: "Other",
      },
    });
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "familyAccountId", value: faOther.id },
      });
      assert.strictEqual(r.ok, false);
      if (!r.ok) {
        assert.strictEqual(r.code, "NOT_FOUND");
        assert.strictEqual(r.error, "Account not found for statement PDF");
      }
    }

    // SA-SAMS numeric rejected
    {
      const r = await resolveCanonicalBillingAccount({
        authorizedSchoolId: schoolA.id,
        identity: { type: "accountNo", value: "1234567" },
      });
      assert.strictEqual(r.ok, false);
      if (!r.ok) assert.strictEqual(r.code, "UNSUPPORTED_IDENTITY");
    }

    console.log("✓ DB-backed identity resolution scenarios");
  } finally {
    await prisma.learner.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.familyAccount.deleteMany({ where: { schoolId: { in: [schoolA.id, schoolB.id] } } });
    await prisma.school.deleteMany({ where: { id: { in: [schoolA.id, schoolB.id] } } });
  }

  console.log("billingAccountIdentity.unit.test.ts: OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
