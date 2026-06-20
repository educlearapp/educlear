import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import PDFDocument from "pdfkit";

import { isUniversalMigrationUploadFile } from "../../../routes/migration";
import { parsePaymentReceiveListPdf } from "../../daSilvaMigration/paymentReceiveListParser";
import { buildMigrationStage } from "../staging/buildMigrationStage";
import { detectMigrationCategory } from "./detectMigrationCategory";
import { suggestColumnMappings } from "./suggestColumnMappings";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";
import type { MigrationValidationSummary } from "../types/MigrationValidation";

function fullValidationSummary(): MigrationValidationSummary {
  return {
    mode: "full",
    rowsChecked: 4,
    totalIssues: 0,
    errors: 0,
    warnings: 0,
    info: 0,
    canProceed: true,
    issuesShown: 0,
  };
}

function testPdfUploadAndCategory(): void {
  assert.strictEqual(
    detectMigrationCategory("Kid-e-Sys Payment Receive List.pdf"),
    "payment-receive-list"
  );
  assert.strictEqual(
    detectMigrationCategory("payment_receive_list_2026.pdf"),
    "payment-receive-list"
  );
  assert.strictEqual(
    detectMigrationCategory("transaction_list.csv"),
    "transactions",
    "existing transaction detection still works"
  );
  assert.strictEqual(
    detectMigrationCategory("account_list_(age_analysis).xls"),
    "billing",
    "existing Age Analysis detection still works"
  );
  assert.strictEqual(
    detectMigrationCategory("sibling_accounts.xls"),
    "billing",
    "Kid-e-Sys sibling accounts should use the billing pipeline category"
  );
  assert.strictEqual(
    detectMigrationCategory("Grade_1A.xls"),
    "learners",
    "existing Kid-e-Sys class list detection still works"
  );

  const accepted = isUniversalMigrationUploadFile({
    originalname: "Kid-e-Sys Payment Receive List.pdf",
    mimetype: "application/pdf",
  } as Express.Multer.File);
  assert.strictEqual(accepted, true, "Payment Receive List PDF upload should be accepted");
}

function testPdfMappingIsSuppressed(): void {
  const suggestion = suggestColumnMappings({
    fileId: "pdf-1",
    filename: "Kid-e-Sys Payment Receive List.pdf",
    category: "payment-receive-list",
    columns: ["accountNumber", "creditOverpaidAmount", "netBalance"],
    systemId: "kideesys",
  });

  assert.deepStrictEqual(suggestion.mappings, []);
  assert.deepStrictEqual(suggestion.unmappedColumns, [
    "accountNumber",
    "creditOverpaidAmount",
    "netBalance",
  ]);
}

function testStageReconciliationOnly(): void {
  const previews: MigrationFilePreview[] = [
    {
      fileId: "age-1",
      filename: "account_list_(age_analysis).xls",
      category: "billing",
      columns: ["Account", "Account Name", "Balance"],
      sampleRows: [],
      rowCount: 3,
      warnings: [],
      path: "/tmp/account_list_(age_analysis).xls",
    },
    {
      fileId: "pdf-1",
      filename: "Kid-e-Sys Payment Receive List.pdf",
      category: "payment-receive-list",
      columns: [
        "accountNumber",
        "learnerName",
        "outstandingBalance",
        "creditOverpaidAmount",
        "netBalance",
      ],
      sampleRows: [],
      rowCount: 3,
      warnings: ["Reconciliation only — does not affect balances."],
      path: "/tmp/payment_receive_list.pdf",
    },
  ];

  const rowsByFileId = new Map<string, Record<string, unknown>[]>([
    [
      "age-1",
      [
        { Account: "ALI002", "Account Name": "Alizain Ali", Balance: "7000.00" },
        { Account: "MAO002", "Account Name": "Amogelang Maapoga", Balance: "7200.00" },
        { Account: "NOB001", "Account Name": "Only Age", Balance: "100.00" },
      ],
    ],
    [
      "pdf-1",
      [
        {
          accountNumber: "ALI002",
          learnerName: "Alizain Ali",
          accountHolderName: "",
          outstandingBalance: 7000,
          creditOverpaidAmount: 0,
          recentOwing: null,
          badDebt: null,
          netBalance: 7000,
        },
        {
          accountNumber: "MAO002",
          learnerName: "Amogelang Maapoga",
          accountHolderName: "",
          outstandingBalance: 7100,
          creditOverpaidAmount: 0,
          recentOwing: null,
          badDebt: null,
          netBalance: 7100,
        },
        {
          accountNumber: "PDF001",
          learnerName: "Only Pdf",
          accountHolderName: "",
          outstandingBalance: 0,
          creditOverpaidAmount: 50,
          recentOwing: null,
          badDebt: null,
          netBalance: -50,
        },
      ],
    ],
  ]);

  const stage = buildMigrationStage({
    sourceSystem: "kideesys",
    previews,
    mappings: [
      {
        fileId: "age-1",
        mappings: [
          { sourceColumn: "Account", targetField: "accountNumber" },
          { sourceColumn: "Balance", targetField: "currentBalance" },
        ],
      },
      { fileId: "pdf-1", mappings: [] },
    ],
    validationSummary: fullValidationSummary(),
    rowsByFileId,
  });

  assert.strictEqual(stage.stagedCounts.billingAccounts, 3);
  assert.strictEqual(stage.stagedCounts.transactions, 0);
  assert.strictEqual(stage.transactionReadiness.eligibleActiveTransactions, 0);
  assert.ok(stage.paymentReceiveList, "expected staged Payment Receive List data");
  assert.strictEqual(stage.paymentReceiveList?.optional, true);
  assert.strictEqual(stage.paymentReceiveList?.files[0].rows.length, 3);
  assert.strictEqual(stage.paymentReceiveList?.reconciliation.totalPdfAccounts, 3);
  assert.strictEqual(stage.paymentReceiveList?.reconciliation.totalMatchedAccounts, 2);
  assert.deepStrictEqual(stage.paymentReceiveList?.reconciliation.missingInAgeAnalysis, ["PDF001"]);
  assert.deepStrictEqual(stage.paymentReceiveList?.reconciliation.missingInPdf, ["NOB001"]);
  assert.strictEqual(stage.paymentReceiveList?.reconciliation.balanceDifferences.length, 1);
  assert.strictEqual(stage.paymentReceiveList?.reconciliation.totalOutstanding, 14100);
  assert.strictEqual(stage.paymentReceiveList?.reconciliation.totalCreditsOverpaid, 50);
  assert.strictEqual(stage.paymentReceiveList?.reconciliation.netPosition, 14050);
}

async function writeSyntheticPaymentReceivePdf(filePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40 });
    const stream = fs.createWriteStream(filePath);
    stream.on("finish", resolve);
    stream.on("error", reject);
    doc.on("error", reject);
    doc.pipe(stream);
    doc.fontSize(10).text(
      [
        "Payment Receive List",
        "Da Silva Academy",
        "2026/06/20",
        "GRADE 1",
        "1",
        "ALI002Alizain Ali7 000,00",
        "2",
        "CRD001Credit Family-50,00",
      ].join("\n")
    );
    doc.end();
  });
}

async function testPdfRowsParseIntoStaging(): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "payment-receive-list-"));
  const pdfPath = path.join(dir, "Payment Receive List.pdf");
  try {
    await writeSyntheticPaymentReceivePdf(pdfPath);
    const parsed = await parsePaymentReceiveListPdf(pdfPath);
    assert.strictEqual(parsed.rows.length, 2);
    assert.strictEqual(parsed.rows[0].accountNo, "ALI002");
    assert.strictEqual(parsed.rows[0].learnerName, "Alizain Ali");
    assert.strictEqual(parsed.rows[0].balance, 7000);
    assert.strictEqual(parsed.rows[1].accountNo, "CRD001");
    assert.strictEqual(parsed.rows[1].balance, -50);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  testPdfUploadAndCategory();
  testPdfMappingIsSuppressed();
  await testPdfRowsParseIntoStaging();
  testStageReconciliationOnly();
  console.log("paymentReceiveListReconciliation.test.ts: ok");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

