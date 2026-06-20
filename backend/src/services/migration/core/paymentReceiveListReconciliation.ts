import type { ParsedPaymentReceiveRow, PaymentReceiveListParseAudit } from "../../daSilvaMigration/paymentReceiveListParser";
import type { MigrationFilePreview } from "../types/MigrationFilePreview";

export type PaymentReceiveListStagedRow = {
  source: "Kid-e-Sys";
  category: "payment-receive-list";
  purpose: "reconciliation-only";
  accountNumber: string;
  learnerName: string;
  accountHolderName: string;
  outstandingBalance: number;
  creditOverpaidAmount: number;
  recentOwing: number | null;
  badDebt: number | null;
  netBalance: number;
  gradeSection?: string;
};

export type PaymentReceiveListStageFile = {
  fileId: string;
  filename: string;
  rows: PaymentReceiveListStagedRow[];
  audit?: PaymentReceiveListParseAudit;
};

export type PaymentReceiveListBalanceDifference = {
  accountNumber: string;
  learnerName?: string;
  ageAnalysisBalance: number;
  pdfBalance: number;
  difference: number;
};

export type PaymentReceiveListReconciliationSummary = {
  label: "Reconciliation only — does not affect balances.";
  optional: true;
  source: "Kid-e-Sys";
  category: "payment-receive-list";
  purpose: "reconciliation-only";
  pdfFileCount: number;
  totalPdfAccounts: number;
  ageAnalysisAccounts: number;
  totalMatchedAccounts: number;
  missingInAgeAnalysis: string[];
  missingInPdf: string[];
  balanceDifferences: PaymentReceiveListBalanceDifference[];
  totalOutstanding: number;
  totalCreditsOverpaid: number;
  netPosition: number;
  ageAnalysisNetPosition: number;
};

export type PaymentReceiveListStageData = {
  label: "Reconciliation only — does not affect balances.";
  optional: true;
  source: "Kid-e-Sys";
  category: "payment-receive-list";
  purpose: "reconciliation-only";
  files: PaymentReceiveListStageFile[];
  reconciliation: PaymentReceiveListReconciliationSummary;
};

const RECONCILIATION_LABEL = "Reconciliation only — does not affect balances." as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cleanString(value: unknown): string {
  return String(value ?? "").trim();
}

function compactKey(value: string): string {
  return cleanString(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? round2(value) : 0;
  const raw = cleanString(value);
  if (!raw) return 0;
  const normalized = raw
    .replace(/r/gi, "")
    .replace(/\s/g, "")
    .replace(/,/g, ".");
  const n = Number(normalized);
  return Number.isFinite(n) ? round2(n) : 0;
}

function pickValue(row: Record<string, unknown>, aliases: string[]): unknown {
  const aliasKeys = new Set(aliases.map(compactKey));
  for (const [key, value] of Object.entries(row)) {
    if (aliasKeys.has(compactKey(key))) return value;
  }
  return undefined;
}

export function toPaymentReceiveListStagedRow(
  row: ParsedPaymentReceiveRow
): PaymentReceiveListStagedRow {
  const netBalance = round2(Number(row.balance) || 0);
  return {
    source: "Kid-e-Sys",
    category: "payment-receive-list",
    purpose: "reconciliation-only",
    accountNumber: cleanString(row.accountNo).toUpperCase(),
    learnerName: cleanString(row.learnerName),
    accountHolderName: "",
    outstandingBalance: netBalance > 0 ? netBalance : 0,
    creditOverpaidAmount: netBalance < 0 ? Math.abs(netBalance) : 0,
    recentOwing: null,
    badDebt: null,
    netBalance,
    ...(row.gradeSection ? { gradeSection: row.gradeSection } : {}),
  };
}

export function buildPaymentReceiveListStageData(input: {
  previews: MigrationFilePreview[];
  rowsByFileId: Map<string, Record<string, unknown>[]>;
}): PaymentReceiveListStageData | undefined {
  const pdfPreviews = input.previews.filter(
    (p) => cleanString(p.category) === "payment-receive-list"
  );
  if (pdfPreviews.length === 0) return undefined;

  const files: PaymentReceiveListStageFile[] = pdfPreviews.map((preview) => ({
    fileId: preview.fileId,
    filename: preview.filename,
    rows: (input.rowsByFileId.get(preview.fileId) ?? [])
      .map((row) => ({
        source: "Kid-e-Sys" as const,
        category: "payment-receive-list" as const,
        purpose: "reconciliation-only" as const,
        accountNumber: cleanString(row.accountNumber).toUpperCase(),
        learnerName: cleanString(row.learnerName),
        accountHolderName: cleanString(row.accountHolderName),
        outstandingBalance: parseMoney(row.outstandingBalance),
        creditOverpaidAmount: parseMoney(row.creditOverpaidAmount),
        recentOwing:
          row.recentOwing == null || cleanString(row.recentOwing) === ""
            ? null
            : parseMoney(row.recentOwing),
        badDebt:
          row.badDebt == null || cleanString(row.badDebt) === ""
            ? null
            : parseMoney(row.badDebt),
        netBalance: parseMoney(row.netBalance),
        ...(cleanString(row.gradeSection) ? { gradeSection: cleanString(row.gradeSection) } : {}),
      }))
      .filter((row) => row.accountNumber),
  }));

  return {
    label: RECONCILIATION_LABEL,
    optional: true,
    source: "Kid-e-Sys",
    category: "payment-receive-list",
    purpose: "reconciliation-only",
    files,
    reconciliation: buildPaymentReceiveListReconciliation({
      files,
      previews: input.previews,
      rowsByFileId: input.rowsByFileId,
    }),
  };
}

function collectAgeAnalysisBalances(
  previews: MigrationFilePreview[],
  rowsByFileId: Map<string, Record<string, unknown>[]>
): Map<string, { balance: number; accountName: string }> {
  const out = new Map<string, { balance: number; accountName: string }>();

  for (const preview of previews) {
    const filenameKey = compactKey(preview.filename);
    const category = cleanString(preview.category);
    const looksLikeAgeAnalysis =
      category === "billing" &&
      (filenameKey.includes("ageanalysis") || filenameKey.includes("accountlist"));
    if (!looksLikeAgeAnalysis) continue;

    for (const row of rowsByFileId.get(preview.fileId) ?? []) {
      const accountNumber = cleanString(
        pickValue(row, ["Account", "Account Number", "Account No", "accountNumber"])
      ).toUpperCase();
      if (!accountNumber) continue;

      const balance = parseMoney(
        pickValue(row, ["Balance", "Outstanding", "Current Balance", "currentBalance"])
      );
      const accountName = cleanString(
        pickValue(row, ["Account Name", "AccountName", "Child", "Child Name", "Learner Name"])
      );
      out.set(accountNumber, { balance, accountName });
    }
  }

  return out;
}

function buildPaymentReceiveListReconciliation(input: {
  files: PaymentReceiveListStageFile[];
  previews: MigrationFilePreview[];
  rowsByFileId: Map<string, Record<string, unknown>[]>;
}): PaymentReceiveListReconciliationSummary {
  const pdfByAccount = new Map<string, PaymentReceiveListStagedRow>();
  for (const file of input.files) {
    for (const row of file.rows) {
      if (!pdfByAccount.has(row.accountNumber)) {
        pdfByAccount.set(row.accountNumber, row);
      }
    }
  }

  const ageByAccount = collectAgeAnalysisBalances(input.previews, input.rowsByFileId);
  const missingInAgeAnalysis: string[] = [];
  const missingInPdf: string[] = [];
  const balanceDifferences: PaymentReceiveListBalanceDifference[] = [];
  let matched = 0;
  let totalOutstanding = 0;
  let totalCreditsOverpaid = 0;
  let netPosition = 0;
  let ageAnalysisNetPosition = 0;

  for (const row of pdfByAccount.values()) {
    totalOutstanding += row.outstandingBalance;
    totalCreditsOverpaid += row.creditOverpaidAmount;
    netPosition += row.netBalance;

    const age = ageByAccount.get(row.accountNumber);
    if (!age) {
      missingInAgeAnalysis.push(row.accountNumber);
      continue;
    }
    matched += 1;
    const difference = round2(row.netBalance - age.balance);
    if (Math.abs(difference) > 0.01) {
      balanceDifferences.push({
        accountNumber: row.accountNumber,
        learnerName: row.learnerName || age.accountName || undefined,
        ageAnalysisBalance: age.balance,
        pdfBalance: row.netBalance,
        difference,
      });
    }
  }

  for (const [accountNumber, age] of ageByAccount) {
    ageAnalysisNetPosition += age.balance;
    if (!pdfByAccount.has(accountNumber)) {
      missingInPdf.push(accountNumber);
    }
  }

  return {
    label: RECONCILIATION_LABEL,
    optional: true,
    source: "Kid-e-Sys",
    category: "payment-receive-list",
    purpose: "reconciliation-only",
    pdfFileCount: input.files.length,
    totalPdfAccounts: pdfByAccount.size,
    ageAnalysisAccounts: ageByAccount.size,
    totalMatchedAccounts: matched,
    missingInAgeAnalysis: missingInAgeAnalysis.sort(),
    missingInPdf: missingInPdf.sort(),
    balanceDifferences: balanceDifferences.sort((a, b) =>
      a.accountNumber.localeCompare(b.accountNumber)
    ),
    totalOutstanding: round2(totalOutstanding),
    totalCreditsOverpaid: round2(totalCreditsOverpaid),
    netPosition: round2(netPosition),
    ageAnalysisNetPosition: round2(ageAnalysisNetPosition),
  };
}

