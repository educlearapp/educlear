/**
 * Phase 5B — backend module boundary matrix (7 commercial packages).
 * Run: npx tsx src/middleware/phase5bModuleBoundaries.unit.test.ts
 */
import assert from "assert";
import jwt from "jsonwebtoken";

import { prisma } from "../prisma";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import {
  evaluateAnySchoolModuleGate,
  evaluateSchoolModuleGate,
  MODULE_NOT_ENTITLED,
} from "./requireSchoolModule";
import {
  assertNoAccountingBankingMutationWhenDisabled,
  assertNoCoreBankingMutationWhenDisabled,
  bankImportTransactionTypeForModule,
  sanitizeBankTransactionForModule,
} from "../services/bankingModuleFieldPolicy";

const SCHOOL = "school-phase5b";
const OWNER = "user-phase5b-owner";

type Combo = {
  label: string;
  CORE: boolean;
  ACCOUNTING: boolean;
  PAYROLL: boolean;
  expect: {
    coreApi: boolean;
    accounting: boolean;
    payroll: boolean;
    banking: boolean;
    bankingFee: boolean;
    bankingExpense: boolean;
    employees: boolean;
  };
};

const COMBOS: Combo[] = [
  {
    label: "100 Core",
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: false,
    expect: {
      coreApi: true,
      accounting: false,
      payroll: false,
      banking: true,
      bankingFee: true,
      bankingExpense: false,
      employees: true,
    },
  },
  {
    label: "010 Accounting",
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: false,
    expect: {
      coreApi: false,
      accounting: true,
      payroll: false,
      banking: true,
      bankingFee: false,
      bankingExpense: true,
      employees: false,
    },
  },
  {
    label: "001 Payroll",
    CORE: false,
    ACCOUNTING: false,
    PAYROLL: true,
    expect: {
      coreApi: false,
      accounting: false,
      payroll: true,
      banking: false,
      bankingFee: false,
      bankingExpense: false,
      employees: true,
    },
  },
  {
    label: "011 Accounting+Payroll",
    CORE: false,
    ACCOUNTING: true,
    PAYROLL: true,
    expect: {
      coreApi: false,
      accounting: true,
      payroll: true,
      banking: true,
      bankingFee: false,
      bankingExpense: true,
      employees: true,
    },
  },
  {
    label: "110 Core+Accounting",
    CORE: true,
    ACCOUNTING: true,
    PAYROLL: false,
    expect: {
      coreApi: true,
      accounting: true,
      payroll: false,
      banking: true,
      bankingFee: true,
      bankingExpense: true,
      employees: true,
    },
  },
  {
    label: "101 Core+Payroll",
    CORE: true,
    ACCOUNTING: false,
    PAYROLL: true,
    expect: {
      coreApi: true,
      accounting: false,
      payroll: true,
      banking: true,
      bankingFee: true,
      bankingExpense: false,
      employees: true,
    },
  },
  {
    label: "111 Full",
    CORE: true,
    ACCOUNTING: true,
    PAYROLL: true,
    expect: {
      coreApi: true,
      accounting: true,
      payroll: true,
      banking: true,
      bankingFee: true,
      bankingExpense: true,
      employees: true,
    },
  },
];

function mockCombo(c: Combo) {
  Object.assign(prisma, {
    user: {
      findUnique: async () => ({
        id: OWNER,
        schoolId: SCHOOL,
        email: "owner@phase5b.test",
        role: "SCHOOL_ADMIN",
        isActive: true,
        fullName: "Owner",
      }),
    },
    schoolModuleEntitlement: {
      findUnique: async ({
        where,
      }: {
        where: { schoolId_module: { schoolId: string; module: string } };
      }) => {
        const mod = where.schoolId_module.module as "CORE" | "ACCOUNTING" | "PAYROLL";
        return { enabled: c[mod] };
      },
    },
  });
}

function sign() {
  return jwt.sign(
    { userId: OWNER, schoolId: SCHOOL, role: "SCHOOL_ADMIN", email: "o@t" },
    STAFF_JWT_SECRET
  );
}

async function main() {
  for (const combo of COMBOS) {
    mockCombo(combo);
    const auth = `Bearer ${sign()}`;

    const core = await evaluateSchoolModuleGate({
      authHeader: auth,
      requestSchoolId: SCHOOL,
      module: "CORE",
    });
    assert.strictEqual(core.allowed, combo.expect.coreApi, `${combo.label} CORE`);

    const acc = await evaluateSchoolModuleGate({
      authHeader: auth,
      module: "ACCOUNTING",
    });
    assert.strictEqual(acc.allowed, combo.expect.accounting, `${combo.label} ACCOUNTING`);

    const pay = await evaluateSchoolModuleGate({
      authHeader: auth,
      module: "PAYROLL",
    });
    assert.strictEqual(pay.allowed, combo.expect.payroll, `${combo.label} PAYROLL`);

    const banking = await evaluateAnySchoolModuleGate({
      authHeader: auth,
      modules: ["CORE", "ACCOUNTING"],
    });
    assert.strictEqual(banking.allowed, combo.expect.banking, `${combo.label} banking`);

    const employees = await evaluateAnySchoolModuleGate({
      authHeader: auth,
      modules: ["CORE", "PAYROLL"],
    });
    assert.strictEqual(employees.allowed, combo.expect.employees, `${combo.label} employees`);

    assert.strictEqual(
      bankImportTransactionTypeForModule("in", {
        coreEnabled: combo.CORE,
        accountingEnabled: combo.ACCOUNTING,
      }),
      combo.expect.bankingFee ? "payment" : "ignore",
      `${combo.label} fee import type`
    );
    assert.strictEqual(
      bankImportTransactionTypeForModule("out", {
        coreEnabled: combo.CORE,
        accountingEnabled: combo.ACCOUNTING,
      }),
      combo.expect.bankingExpense ? "expense" : "ignore",
      `${combo.label} expense import type`
    );

    const feeMutation = assertNoCoreBankingMutationWhenDisabled(
      { suggestedLearnerId: "x", matchAction: "accept" },
      combo.CORE
    );
    assert.strictEqual(Boolean(feeMutation), !combo.expect.bankingFee, `${combo.label} fee mutate`);

    const expenseMutation = assertNoAccountingBankingMutationWhenDisabled(
      { expenseCategory: "Utilities", transactionType: "expense" },
      combo.ACCOUNTING
    );
    assert.strictEqual(
      Boolean(expenseMutation),
      !combo.expect.bankingExpense,
      `${combo.label} expense mutate`
    );

    const sanitized = sanitizeBankTransactionForModule(
      {
        suggestedLearnerId: "L1",
        suggestedLearnerName: "Kid",
        transactionType: "payment",
        expenseCategory: "Utilities",
        supplierId: "S1",
      },
      combo.ACCOUNTING,
      combo.CORE
    );
    if (!combo.CORE) {
      assert.strictEqual(sanitized.suggestedLearnerId, "");
      assert.notStrictEqual(sanitized.transactionType, "payment");
    }
    if (!combo.ACCOUNTING) {
      assert.strictEqual(sanitized.expenseCategory, "");
      assert.strictEqual(sanitized.supplierId, "");
    }

    console.log(`✓ ${combo.label}`);
  }

  // Explicit CORE=false still MODULE_NOT_ENTITLED (not fail-open)
  mockCombo(COMBOS[1]);
  const explicit = await evaluateSchoolModuleGate({
    authHeader: `Bearer ${sign()}`,
    module: "CORE",
  });
  assert.strictEqual(explicit.allowed, false);
  if (!explicit.allowed) assert.strictEqual(explicit.code, MODULE_NOT_ENTITLED);

  console.log("✓ phase5bModuleBoundaries.unit.test.ts passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
