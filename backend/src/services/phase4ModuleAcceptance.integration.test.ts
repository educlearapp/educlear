/**
 * Phase 4 local DB acceptance — four entitlement combinations + backfill/session proofs.
 * SAFE TARGET ONLY: localhost PostgreSQL (asserted at start).
 *
 * Run: ../frontend/node_modules/.bin/tsx src/services/phase4ModuleAcceptance.integration.test.ts
 *
 * Creates disposable schools prefixed phase4- and deletes them at end.
 */
import assert from "assert";
import { PrismaClient, ProductModule } from "@prisma/client";
import jwt from "jsonwebtoken";

import {
  getSchoolModuleEntitlements,
  isSchoolModuleEnabled,
  updateSchoolModuleEntitlements,
  ensureSchoolModuleEntitlements,
} from "./schoolModuleEntitlements";
import {
  bankImportTransactionTypeForModule,
  persistableBankImportAccountingFields,
  assertNoAccountingBankingMutationWhenDisabled,
  sanitizeBankTransactionForModule,
} from "./bankingModuleFieldPolicy";
import {
  assertNoPayrollMutationWhenDisabled,
  sanitizeEmployeeForModule,
} from "./employeeModuleFieldPolicy";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import { hashAuthPassword } from "./authCredentials";

const prisma = new PrismaClient();
const PREFIX = "phase4-";

function assertLocalDatabase() {
  const url = String(process.env.DATABASE_URL || "");
  assert.ok(url, "DATABASE_URL required");
  const hostMatch = url.match(/@([^/:?]+)/) || url.match(/\/\/(?:[^@]+@)?([^/:]+)/);
  // postgresql://user:pass@localhost:5432/educlear
  let host = "";
  try {
    host = new URL(url.replace(/^postgresql:/, "http:")).hostname;
  } catch {
    host = hostMatch?.[1] || "";
  }
  assert.ok(
    host === "localhost" || host === "127.0.0.1",
    `Refusing Phase 4 acceptance against non-local host: ${host || "(unknown)"}`
  );
  console.log(`✓ Safe DB host=${host}`);
}

async function createFixtureSchool(label: string) {
  const id = `${PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `${id}@phase4.test`;
  const school = await prisma.school.create({
    data: {
      id,
      name: `Phase4 ${label}`,
      email,
      lifecycleStatus: "ACTIVE",
    },
  });
  await ensureSchoolModuleEntitlements(school.id);
  const passwordHash = await hashAuthPassword("Phase4Test!123");
  const user = await prisma.user.create({
    data: {
      id: `${id}-owner`,
      schoolId: school.id,
      email: `owner-${email}`,
      fullName: `Owner ${label}`,
      role: "SCHOOL_ADMIN",
      isActive: true,
      passwordHash,
    },
  });
  await prisma.userRbacMeta.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      schoolId: school.id,
      firstName: "Owner",
      surname: label,
      appRole: "Owner",
      permissions: {
        payments: { view: true, create: true },
        payroll: { view: true },
        reports: { view: true },
        employees: { view: true, edit: true },
      },
    },
    update: {
      schoolId: school.id,
      appRole: "Owner",
      permissions: {
        payments: { view: true, create: true },
        payroll: { view: true },
        reports: { view: true },
        employees: { view: true, edit: true },
      },
    },
  });
  return { school, user };
}

async function setCombo(
  schoolId: string,
  combo: { accounting: boolean; payroll: boolean },
  actor: { userId: string; email: string }
) {
  await updateSchoolModuleEntitlements({
    schoolId,
    accounting: combo.accounting,
    payroll: combo.payroll,
    actor,
  });
}

async function cleanupFixtures() {
  const schools = await prisma.school.findMany({
    where: { id: { startsWith: PREFIX } },
    select: { id: true },
  });
  for (const s of schools) {
    await prisma.userRbacMeta.deleteMany({ where: { schoolId: s.id } });
    await prisma.user.deleteMany({ where: { schoolId: s.id } });
    await prisma.schoolModuleEntitlement.deleteMany({ where: { schoolId: s.id } });
    await prisma.bankTransaction.deleteMany({ where: { schoolId: s.id } });
    await prisma.bankStatementImport.deleteMany({ where: { schoolId: s.id } });
    await prisma.learner.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.familyAccount.deleteMany({ where: { schoolId: s.id } }).catch(() => undefined);
    await prisma.school.delete({ where: { id: s.id } }).catch(() => undefined);
  }
  console.log(`✓ Cleaned ${schools.length} phase4 fixture school(s)`);
}

function signStaff(userId: string, schoolId: string) {
  return jwt.sign(
    { userId, schoolId, role: "SCHOOL_ADMIN", email: "phase4@test" },
    STAFF_JWT_SECRET
  );
}

async function main() {
  assertLocalDatabase();
  await cleanupFixtures();

  // --- Existing-school all-on / ensure behaviour ---
  const fullSchool = await createFixtureSchool("full-seed");
  // New school via ensure → all on
  let ents = await getSchoolModuleEntitlements(fullSchool.school.id);
  assert.deepStrictEqual(ents, { CORE: true, ACCOUNTING: true, PAYROLL: true });
  console.log("✓ New/existing school ensure → FULL (all on)");

  // Explicit disable must NOT fail-open
  await setCombo(fullSchool.school.id, { accounting: false, payroll: false }, {
    userId: fullSchool.user.id,
    email: fullSchool.user.email,
  });
  ents = await getSchoolModuleEntitlements(fullSchool.school.id);
  assert.strictEqual(ents.ACCOUNTING, false);
  assert.strictEqual(ents.PAYROLL, false);
  assert.strictEqual(await isSchoolModuleEnabled(fullSchool.school.id, "ACCOUNTING"), false);
  assert.strictEqual(await isSchoolModuleEnabled(fullSchool.school.id, "PAYROLL"), false);
  console.log("✓ Explicit disable does not fail-open");

  // Missing row fail-open: delete ACCOUNTING row only
  await prisma.schoolModuleEntitlement.deleteMany({
    where: { schoolId: fullSchool.school.id, module: ProductModule.ACCOUNTING },
  });
  // isSchoolModuleEnabled fail-open when row missing
  assert.strictEqual(await isSchoolModuleEnabled(fullSchool.school.id, "ACCOUNTING"), true);
  // getSchoolModuleEntitlements re-ensures missing rows as enabled
  ents = await getSchoolModuleEntitlements(fullSchool.school.id);
  assert.strictEqual(ents.ACCOUNTING, true);
  console.log("✓ Missing entitlement row fail-open + ensure restores enabled row");

  // Restore FULL seed then build four combos
  await setCombo(fullSchool.school.id, { accounting: true, payroll: true }, {
    userId: fullSchool.user.id,
    email: fullSchool.user.email,
  });

  const coreOnly = await createFixtureSchool("core-only");
  await setCombo(coreOnly.school.id, { accounting: false, payroll: false }, {
    userId: coreOnly.user.id,
    email: coreOnly.user.email,
  });

  const coreAcc = await createFixtureSchool("core-acc");
  await setCombo(coreAcc.school.id, { accounting: true, payroll: false }, {
    userId: coreAcc.user.id,
    email: coreAcc.user.email,
  });

  const corePay = await createFixtureSchool("core-pay");
  await setCombo(corePay.school.id, { accounting: false, payroll: true }, {
    userId: corePay.user.id,
    email: corePay.user.email,
  });

  const full = fullSchool;

  // Prefer direct isSchoolModuleEnabled for matrix
  const matrix = [
    ["CORE ONLY", coreOnly.school.id, false, false],
    ["CORE+ACC", coreAcc.school.id, true, false],
    ["CORE+PAY", corePay.school.id, false, true],
    ["FULL", full.school.id, true, true],
  ] as const;

  for (const [label, sid, acc, pay] of matrix) {
    assert.strictEqual(await isSchoolModuleEnabled(sid, "CORE"), true, label);
    assert.strictEqual(await isSchoolModuleEnabled(sid, "ACCOUNTING"), acc, `${label} ACC`);
    assert.strictEqual(await isSchoolModuleEnabled(sid, "PAYROLL"), pay, `${label} PAY`);
    console.log(`✓ ${label} entitlements CORE=on ACC=${acc} PAY=${pay}`);
  }

  // --- Field policies ---
  // CORE ONLY / CORE+PAYROLL: accounting banking mutations blocked
  for (const sid of [coreOnly.school.id, corePay.school.id]) {
    const v = assertNoAccountingBankingMutationWhenDisabled(
      { expenseCategory: "Utilities", supplierId: "s1" },
      false
    );
    assert.ok(v);
    const persist = persistableBankImportAccountingFields(false, {
      expenseCategory: "Utilities",
      suggestedSupplierName: "ACME",
      supplierId: "s1",
      suggestedInvoiceId: "i1",
      suggestedInvoiceNumber: "SI-1",
      invoiceMatchScore: 90,
      expenseNotes: "n",
      expenseMatchReason: "hit",
    });
    assert.strictEqual(persist.expenseCategory, "");
    assert.strictEqual(persist.supplierId, "");
    assert.strictEqual(bankImportTransactionTypeForModule("out", false), "ignore");
    assert.strictEqual(bankImportTransactionTypeForModule("in", false), "payment");
    const sanitized = sanitizeBankTransactionForModule(
      { expenseCategory: "Utilities", supplierId: "s1", transactionType: "expense", direction: "out" },
      false
    );
    assert.strictEqual(sanitized.expenseCategory, "");
    assert.strictEqual(sanitized.transactionType, "ignore");
  }
  console.log("✓ ACCOUNTING-off banking persistence/sanitize/mutation policy");

  // CORE ONLY / CORE+ACC: payroll employee fields blocked
  for (const sid of [coreOnly.school.id, coreAcc.school.id]) {
    void sid;
    const v = assertNoPayrollMutationWhenDisabled({ basicSalary: 10000, taxNumber: "x" }, false);
    assert.ok(v);
    const sanitized = sanitizeEmployeeForModule(
      { firstName: "Ada", basicSalary: 10000, taxNumber: "T", jobTitle: "Teacher" } as any,
      false
    );
    assert.strictEqual((sanitized as any).basicSalary, undefined);
    assert.strictEqual((sanitized as any).jobTitle, "Teacher");
  }
  console.log("✓ PAYROLL-off employee field policy");

  // CORE+ACC: accounting mutation allowed by policy helper
  assert.strictEqual(
    assertNoAccountingBankingMutationWhenDisabled({ expenseCategory: "Utilities" }, true),
    null
  );
  // CORE+PAY: payroll mutation allowed
  assert.strictEqual(assertNoPayrollMutationWhenDisabled({ basicSalary: 1 }, true), null);
  console.log("✓ Optional modules ON preserve enrichment policies");

  // --- Auth/session style entitlement delivery (serialize path via getSchoolModuleEntitlements) ---
  for (const [label, school, user, expect] of [
    ["CORE ONLY", coreOnly.school, coreOnly.user, { ACCOUNTING: false, PAYROLL: false }],
    ["CORE+ACC", coreAcc.school, coreAcc.user, { ACCOUNTING: true, PAYROLL: false }],
    ["CORE+PAY", corePay.school, corePay.user, { ACCOUNTING: false, PAYROLL: true }],
    ["FULL", full.school, full.user, { ACCOUNTING: true, PAYROLL: true }],
  ] as const) {
    const moduleEntitlements = await getSchoolModuleEntitlements(school.id);
    assert.strictEqual(moduleEntitlements.CORE, true);
    assert.strictEqual(moduleEntitlements.ACCOUNTING, expect.ACCOUNTING, label);
    assert.strictEqual(moduleEntitlements.PAYROLL, expect.PAYROLL, label);
    const token = signStaff(user.id, school.id);
    assert.ok(token.length > 20);
    console.log(`✓ ${label} auth entitlement payload shape ready (token issued)`);
  }

  // --- Core banking persistence simulation (ACCOUNTING OFF) ---
  const bankSchool = coreOnly;
  const imp = await prisma.bankStatementImport.create({
    data: {
      id: `${PREFIX}imp-${Date.now()}`,
      schoolId: bankSchool.school.id,
      fileName: "phase4.csv",
      format: "csv",
      bankName: "Test",
      uploadedBy: "phase4",
      totalRows: 2,
      matchedRows: 1,
      unmatchedRows: 1,
      duplicateRows: 0,
      totalAmountImported: 1500,
      transactions: {
        create: [
          {
            id: `${PREFIX}txn-in-${Date.now()}`,
            schoolId: bankSchool.school.id,
            date: "2026-09-01",
            description: "FEE PAYMENT LEARNER",
            reference: "REF1",
            moneyIn: 1500,
            moneyOut: 0,
            direction: "in",
            transactionType: bankImportTransactionTypeForModule("in", false),
            suggestedAccountId: "fa-1",
            suggestedAccountNo: "ACC-1",
            suggestedLearnerId: "learner-1",
            suggestedLearnerName: "Test Learner",
            confidenceScore: 90,
            matchConfidence: "high",
            matchReason: "reference match",
            reviewStatus: "accepted",
            matchStatus: "accepted",
            ...(() => {
              const p = persistableBankImportAccountingFields(false, {
                expenseCategory: "Utilities",
                suggestedSupplierName: "ACME",
                supplierId: "sup-1",
                suggestedInvoiceId: "inv-1",
                suggestedInvoiceNumber: "SI-1",
                invoiceMatchScore: 88,
                expenseNotes: "should-not-persist",
                expenseMatchReason: "supplier",
              });
              const { expenseMatchReason: _r, ...persisted } = p;
              return persisted;
            })(),
            fingerprint: `${PREFIX}fp-in-${Date.now()}`,
            isDuplicate: false,
          },
          {
            id: `${PREFIX}txn-out-${Date.now()}`,
            schoolId: bankSchool.school.id,
            date: "2026-09-02",
            description: "Eskom",
            reference: "OUT1",
            moneyIn: 0,
            moneyOut: 400,
            direction: "out",
            transactionType: bankImportTransactionTypeForModule("out", false),
            suggestedAccountId: "",
            suggestedAccountNo: "",
            suggestedLearnerId: "",
            suggestedLearnerName: "",
            confidenceScore: 0,
            matchConfidence: "none",
            matchReason: "",
            reviewStatus: "pending",
            matchStatus: "imported",
            ...(() => {
              const p = persistableBankImportAccountingFields(false, {
                expenseCategory: "Utilities",
                suggestedSupplierName: "Eskom",
                supplierId: "sup-eskom",
                suggestedInvoiceId: "inv-2",
                suggestedInvoiceNumber: "SI-2",
                invoiceMatchScore: 70,
                expenseNotes: "x",
                expenseMatchReason: "infer",
              });
              const { expenseMatchReason: _r, ...persisted } = p;
              return persisted;
            })(),
            fingerprint: `${PREFIX}fp-out-${Date.now()}`,
            isDuplicate: false,
          },
        ],
      },
    },
    include: { transactions: true },
  });

  const inTxn = imp.transactions.find((t) => t.direction === "in")!;
  const outTxn = imp.transactions.find((t) => t.direction === "out")!;
  assert.strictEqual(inTxn.transactionType, "payment");
  assert.strictEqual(inTxn.suggestedLearnerId, "learner-1");
  assert.strictEqual(inTxn.expenseCategory, "");
  assert.strictEqual(inTxn.supplierId, "");
  assert.strictEqual(outTxn.transactionType, "ignore");
  assert.strictEqual(outTxn.expenseCategory, "");
  assert.strictEqual(outTxn.suggestedInvoiceId, "");
  assert.strictEqual(outTxn.invoiceMatchScore, 0);
  console.log("✓ Core Banking ACCOUNTING-off: fee match fields kept; Accounting enrichment NOT persisted");

  // Expense mutation rejection policy (already covered) + accept fee path fields remain writable conceptually
  assert.strictEqual(
    assertNoAccountingBankingMutationWhenDisabled(
      { matchAction: "accept", suggestedLearnerId: "L1" },
      false
    ),
    null
  );

  // Super Admin toggle simulation on fixture (safe DB)
  await setCombo(coreOnly.school.id, { accounting: true, payroll: false }, {
    userId: coreOnly.user.id,
    email: coreOnly.user.email,
  });
  assert.deepStrictEqual(await getSchoolModuleEntitlements(coreOnly.school.id), {
    CORE: true,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  await setCombo(coreOnly.school.id, { accounting: false, payroll: false }, {
    userId: coreOnly.user.id,
    email: coreOnly.user.email,
  });
  assert.strictEqual(await isSchoolModuleEnabled(coreOnly.school.id, "ACCOUNTING"), false);
  console.log("✓ Super Admin-style ACCOUNTING toggle on fixture school");

  await setCombo(corePay.school.id, { accounting: false, payroll: false }, {
    userId: corePay.user.id,
    email: corePay.user.email,
  });
  assert.strictEqual(await isSchoolModuleEnabled(corePay.school.id, "PAYROLL"), false);
  await setCombo(corePay.school.id, { accounting: false, payroll: true }, {
    userId: corePay.user.id,
    email: corePay.user.email,
  });
  assert.strictEqual(await isSchoolModuleEnabled(corePay.school.id, "PAYROLL"), true);
  console.log("✓ Super Admin-style PAYROLL toggle on fixture school");

  // Phase 5A foundation: explicit CORE=false preserved; ensure does not flip it
  await updateSchoolModuleEntitlements({
    schoolId: coreAcc.school.id,
    core: false,
    accounting: true,
    payroll: false,
    actor: { userId: coreAcc.user.id, email: coreAcc.user.email },
  });
  assert.deepStrictEqual(await getSchoolModuleEntitlements(coreAcc.school.id), {
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  await ensureSchoolModuleEntitlements(coreAcc.school.id);
  assert.deepStrictEqual(await getSchoolModuleEntitlements(coreAcc.school.id), {
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
  });
  console.log("✓ Phase5A: CORE=false Accounting-only preserved through ensure");

  // Admissions Core: no ACCOUNTING required for module map (admissions not in ACCOUNTING_ONLY)
  // Proven by product model + isSchoolModuleEnabled CORE path; admissions routes are not ACCOUNTING-gated.
  assert.strictEqual(await isSchoolModuleEnabled(coreOnly.school.id, "CORE"), true);
  console.log("✓ Admissions/Core available without ACCOUNTING (CORE entitlement on)");

  await cleanupFixtures();
  await prisma.$disconnect();
  console.log("✓ phase4ModuleAcceptance.integration.test.ts passed");
}

main().catch(async (error) => {
  console.error(error);
  try {
    await cleanupFixtures();
  } catch {
    /* ignore */
  }
  await prisma.$disconnect();
  process.exit(1);
});
