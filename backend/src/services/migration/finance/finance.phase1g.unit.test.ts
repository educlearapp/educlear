/**
 * Phase 1G finance unit tests — zero production writes.
 * Run: npx tsx src/services/migration/finance/finance.phase1g.unit.test.ts
 */

import assert from "node:assert";
import fs from "fs";
import os from "os";
import path from "path";
import { classifyFinanceSourceRow } from "./classifyFinanceSourceRow";
import {
  centsEqual,
  formatRandFromCents,
  parseMoneyToCents,
  randToCents,
} from "./moneyCents";
import {
  migrationOpeningBalanceEntryId,
  postSingleMigrationOpeningBalance,
} from "./postMigrationOpeningBalances";
import {
  setBillingLedgerStoreDataDirForTests,
  readSchoolLedger,
  calculateBalanceFromEntries,
  appendSchoolEntrySafe,
} from "../../../utils/billingLedgerStore";
import { isKidesysOpeningBalanceEntry } from "../../../utils/billingDisplayRules";
import { UMIG_OPENING_BALANCE_SOURCE } from "./FinanceClassification";
import { buildSourceFinancePositions } from "./buildSourceFinanceTotals";
import { buildEduClearFinancePositions } from "./buildEduClearFinanceTotals";
import { compileMigrationPlan } from "../migrationPlan/compileMigrationPlan";
import { analyzeMigrationPackage } from "../sourceAnalysis/analyzeMigrationPackage";
import type { MigrationStage } from "../types/MigrationStage";

const SCHOOL_A = "school_phase1g_a";
const SCHOOL_B = "school_phase1g_b";

async function run() {
  console.log("Phase 1G finance tests…");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "umig-1g-"));
  setBillingLedgerStoreDataDirForTests(tmp);

  try {
    // A — classify opening vs payment vs unknown
    {
      const opening = classifyFinanceSourceRow({
        mapped: { accountNumber: "A100", openingBalance: "4250.00" },
      });
      assert.strictEqual(opening.classification, "OPENING_BALANCE");
      const payment = classifyFinanceSourceRow({
        mapped: {
          accountNumber: "A100",
          transactionDate: "2026-06-01",
          amount: "100",
          transactionType: "Payment",
        },
      });
      assert.strictEqual(payment.classification, "PAYMENT");
      const unknown = classifyFinanceSourceRow({
        mapped: { accountNumber: "A100", amount: "50" },
        sourceColumnHints: ["Balance"],
      });
      assert.strictEqual(unknown.classification, "UNKNOWN_FINANCE");
      console.log("  ✓ A — classify opening / payment / unknown");
    }

    // B — opening posts as invoice/credit not payment; idempotent
    {
      const tx = {
        familyAccount: {
          findFirst: async () => ({ id: "fa1", accountRef: "A100" }),
        },
        learner: {
          findFirst: async () => ({ id: "L1" }),
        },
      } as any;
      const report: any[] = [];
      const createdCounts: any = { transactions: 0 };
      const skippedCounts: any = { transactions: 0 };
      const failedCounts: any = { transactions: 0 };
      const posted: string[] = [];
      const ctx = {
        tx,
        schoolId: SCHOOL_A,
        cutoverDate: "2026-05-23",
        migrationRunId: "run1",
        stageId: "stage1",
        report,
        createdCounts,
        skippedCounts,
        failedCounts,
        postedLedgerEntryIds: posted,
      };
      const r1 = await postSingleMigrationOpeningBalance(ctx, {
        mapped: { accountNumber: "A100", openingBalance: "4250.00" },
        sourceFileId: "f1",
        sourceFilename: "accounts.csv",
        rowNumber: 1,
      });
      assert.strictEqual(r1, "created");
      const ledger = readSchoolLedger(SCHOOL_A);
      assert.strictEqual(ledger.length, 1);
      assert.strictEqual(ledger[0]!.type, "invoice");
      assert.notStrictEqual(ledger[0]!.type, "payment");
      assert.strictEqual(ledger[0]!.source, UMIG_OPENING_BALANCE_SOURCE);
      assert.ok(isKidesysOpeningBalanceEntry(ledger[0]!));

      const r2 = await postSingleMigrationOpeningBalance(ctx, {
        mapped: { accountNumber: "A100", openingBalance: "4250.00" },
        sourceFileId: "f1",
        sourceFilename: "accounts.csv",
        rowNumber: 1,
      });
      assert.strictEqual(r2, "skipped");
      assert.strictEqual(readSchoolLedger(SCHOOL_A).length, 1);

      // credit balance
      const tx2 = {
        familyAccount: {
          findFirst: async () => ({ id: "fa2", accountRef: "A200" }),
        },
        learner: { findFirst: async () => ({ id: "L2" }) },
      } as any;
      const rCredit = await postSingleMigrationOpeningBalance(
        { ...ctx, tx: tx2 },
        {
          mapped: { accountNumber: "A200", openingBalance: "-1900.00" },
          sourceFileId: "f1",
          sourceFilename: "accounts.csv",
          rowNumber: 2,
        }
      );
      assert.strictEqual(rCredit, "created");
      const credit = readSchoolLedger(SCHOOL_A).find((e) => e.accountNo === "A200");
      assert.ok(credit);
      assert.strictEqual(credit!.type, "credit");
      console.log("  ✓ B — opening balance invoice/credit + idempotent");
    }

    // C — money cents equality
    {
      assert.strictEqual(parseMoneyToCents("R1,234.56"), 123456);
      assert.strictEqual(parseMoneyToCents("(100.00)"), -10000);
      assert.ok(centsEqual(randToCents(12.345), 1235) || centsEqual(randToCents(12.345), 1234));
      assert.strictEqual(formatRandFromCents(122865542), "R1,228,655.42");
      assert.ok(centsEqual(0, 0));
      assert.ok(!centsEqual(1, 0));
      console.log("  ✓ C — cents equality (no float approx for compare)");
    }

    // D/E — source vs educlear reconcile match / mismatch
    {
      const stage = {
        stageId: "st1",
        migrationRunId: "run1",
        targetSchoolId: SCHOOL_A,
        cutoverDate: "2026-05-23",
        files: [{ fileId: "acc", filename: "accounts.csv", path: "x", category: "billing", rowCount: 2 }],
        mappings: [
          {
            fileId: "acc",
            mappings: [
              { sourceColumn: "Account", targetField: "accountNumber" },
              { sourceColumn: "Opening", targetField: "openingBalance" },
            ],
          },
        ],
      } as unknown as MigrationStage;

      const rowsByFileId = new Map<string, Record<string, string>[]>([
        [
          "acc",
          [
            { Account: "A100", Opening: "4250.00" },
            { Account: "A200", Opening: "-1900.00" },
          ],
        ],
      ]);
      const source = buildSourceFinancePositions({ stage, rowsByFileId });
      assert.strictEqual(source.byAccount.get("A100")?.netCents, 425000);
      assert.strictEqual(source.byAccount.get("A200")?.netCents, -190000);

      const educlear = buildEduClearFinancePositions({
        schoolId: SCHOOL_A,
        accountRefs: ["A100", "A200"],
      });
      // Ledger already has openings from test B
      assert.ok(centsEqual(educlear.byAccount.get("A100") ?? 0, 425000));
      assert.ok(centsEqual(educlear.byAccount.get("A200") ?? 0, -190000));
      console.log("  ✓ D — source vs EduClear match for openings");

      // Force mismatch
      appendSchoolEntrySafe(SCHOOL_A, {
        id: "umig-tx-payment-A100-x",
        schoolId: SCHOOL_A,
        learnerId: "L1",
        accountNo: "A100",
        type: "payment",
        amount: 400,
        date: "2026-06-01",
        reference: "EXTRA",
        description: "extra",
        source: "universal_migration_phase14",
        createdAt: new Date().toISOString(),
      });
      const educlear2 = buildEduClearFinancePositions({
        schoolId: SCHOOL_A,
        accountRefs: ["A100"],
      });
      assert.ok(!centsEqual(source.byAccount.get("A100")!.netCents, educlear2.byAccount.get("A100")!));
      console.log("  ✓ E — per-account mismatch detected");
    }

    // F — UNKNOWN never auto-post classification
    {
      const u = classifyFinanceSourceRow({
        mapped: { amount: "10", accountNumber: "X" },
      });
      assert.strictEqual(u.classification, "UNKNOWN_FINANCE");
      console.log("  ✓ F — UNKNOWN_FINANCE not auto-post class");
    }

    // G — historical + opening not double-counted
    {
      const stage = {
        stageId: "st2",
        migrationRunId: "run2",
        targetSchoolId: SCHOOL_A,
        cutoverDate: "2026-05-23",
        files: [
          { fileId: "acc", filename: "a.csv", path: "x", category: "billing", rowCount: 1 },
          { fileId: "tx", filename: "t.csv", path: "x", category: "transaction", rowCount: 1 },
        ],
        mappings: [
          {
            fileId: "acc",
            mappings: [
              { sourceColumn: "Account", targetField: "accountNumber" },
              { sourceColumn: "Opening", targetField: "openingBalance" },
            ],
          },
          {
            fileId: "tx",
            mappings: [
              { sourceColumn: "Account", targetField: "accountNumber" },
              { sourceColumn: "Date", targetField: "transactionDate" },
              { sourceColumn: "Amount", targetField: "amount" },
              { sourceColumn: "Type", targetField: "transactionType" },
            ],
          },
        ],
      } as unknown as MigrationStage;
      const rowsByFileId = new Map<string, Record<string, string>[]>([
        ["acc", [{ Account: "B1", Opening: "1000.00" }]],
        [
          "tx",
          [
            {
              Account: "B1",
              Date: "2026-01-01",
              Amount: "1000.00",
              Type: "Invoice",
            },
          ],
        ],
      ]);
      const source = buildSourceFinancePositions({ stage, rowsByFileId });
      assert.strictEqual(source.byAccount.get("B1")?.netCents, 100000);
      assert.ok(
        source.skippedUnsupported.some((s) => /Pre-cutover history/i.test(s.reason))
      );
      console.log("  ✓ G — historical + opening not double-counted");
    }

    // H — plan opening applicable; display rules recognize UMIG opening
    {
      const analysis = analyzeMigrationPackage({
        targetSchoolId: SCHOOL_A,
        files: [
          {
            fileId: "h1",
            filename: "accounts.csv",
            category: "billing",
            columns: ["Account Number", "Opening Balance"],
            rowCount: 1,
            sampleRows: [{ "Account Number": "Z1", "Opening Balance": "10" }],
          },
        ],
      });
      const plan = compileMigrationPlan({ analysis });
      const opening = plan.finance.filter((f) => f.kind === "opening_balance");
      assert.ok(opening.length > 0);
      assert.strictEqual(opening[0]!.applicability, "APPLICABLE_SAFE_PATH");
      assert.ok(migrationOpeningBalanceEntryId("Z1").startsWith("umig-opening-"));
      console.log("  ✓ H — opening balance applicable in compiled plan");
    }

    // I — wrong school ledger isolation (EduClear totals scoped by schoolId)
    {
      const posB = buildEduClearFinancePositions({
        schoolId: SCHOOL_B,
        accountRefs: ["A100"],
      });
      assert.strictEqual(posB.byAccount.get("A100") ?? 0, 0);
      const balA = calculateBalanceFromEntries(readSchoolLedger(SCHOOL_A));
      assert.ok(Math.abs(balA) > 0);
      console.log("  ✓ I — wrong-school ledger isolation");
    }

    console.log("Phase 1G finance tests: ALL PASSED");
  } finally {
    setBillingLedgerStoreDataDirForTests(null);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
