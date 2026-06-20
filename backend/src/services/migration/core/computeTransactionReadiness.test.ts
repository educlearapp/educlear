import assert from "assert";
import { computeTransactionReadiness } from "./computeTransactionReadiness";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "../types/MigrationValidation";

function testKidESysTransactionListIsHistoricalOnly(): void {
  const preview: MigrationFilePreview = {
    fileId: "transactions",
    filename: "transaction_list-2.xls",
    category: "transactions",
    columns: ["Reference", "Date", "Account", "Child", "Amount"],
    sampleRows: [],
    rowCount: 2,
    warnings: [],
  };
  const mappings: MigrationFileColumnMappings[] = [
    {
      fileId: preview.fileId,
      mappings: [
        { sourceColumn: "Reference", targetField: "reference" },
        { sourceColumn: "Date", targetField: "transactionDate" },
        { sourceColumn: "Account", targetField: "accountNumber" },
        { sourceColumn: "Child", targetField: "fullName" },
        { sourceColumn: "Amount", targetField: "amount" },
      ],
    },
  ];
  const rowsByFileId = new Map<string, Record<string, unknown>[]>([
    [
      preview.fileId,
      [
        {
          Reference: "Invoice 1",
          Date: "2024/01/01",
          Account: "ABC001",
          Child: "Learner One",
          Amount: "100.00",
        },
        {
          Reference: "Payment 1",
          Date: "2024/01/02",
          Account: "ABC001",
          Child: "Learner One",
          Amount: "-50.00",
        },
      ],
    ],
  ]);

  const readiness = computeTransactionReadiness({
    previews: [preview],
    mappings,
    rowsByFileId,
  });

  assert.strictEqual(readiness.historicalOnlyTransactions, 2);
  assert.strictEqual(readiness.blockedTransactions, 0);
  assert.strictEqual(readiness.eligibleActiveTransactions, 0);
}

testKidESysTransactionListIsHistoricalOnly();
console.log("computeTransactionReadiness.test.ts: ok");
