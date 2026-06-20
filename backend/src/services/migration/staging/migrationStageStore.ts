import fs from "fs";
import path from "path";
import type { MigrationStage, MigrationStageListItem } from "../types/MigrationStage";
import type {
  PaymentReceiveListStageData,
  PaymentReceiveListStagedRow,
} from "../core/paymentReceiveListReconciliation";

const STAGES_DIR = path.join(process.cwd(), "storage", "migration-stages");

function ensureStagesDir(): void {
  if (!fs.existsSync(STAGES_DIR)) {
    fs.mkdirSync(STAGES_DIR, { recursive: true });
  }
}

function sanitizeStageId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function stageFilePath(id: string): string {
  const safe = sanitizeStageId(id);
  if (!safe) throw new Error("Invalid stage id");
  const resolved = path.resolve(STAGES_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(STAGES_DIR) + path.sep)) {
    throw new Error("Invalid stage path");
  }
  return resolved;
}

function parsePaymentReceiveListStageData(raw: unknown): PaymentReceiveListStageData | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const value = raw as Partial<PaymentReceiveListStageData>;
  const files = Array.isArray(value.files)
    ? value.files.map((file) => ({
        fileId: String((file as { fileId?: string }).fileId || "").trim(),
        filename: String((file as { filename?: string }).filename || "").trim(),
        rows: Array.isArray((file as { rows?: unknown[] }).rows)
          ? ((file as { rows: Partial<PaymentReceiveListStagedRow>[] }).rows)
              .map((row) => ({
                source: "Kid-e-Sys" as const,
                category: "payment-receive-list" as const,
                purpose: "reconciliation-only" as const,
                accountNumber: String(row.accountNumber || "").trim().toUpperCase(),
                learnerName: String(row.learnerName || "").trim(),
                accountHolderName: String(row.accountHolderName || "").trim(),
                outstandingBalance: Number(row.outstandingBalance) || 0,
                creditOverpaidAmount: Number(row.creditOverpaidAmount) || 0,
                recentOwing:
                  row.recentOwing == null ? null : Number(row.recentOwing) || 0,
                badDebt: row.badDebt == null ? null : Number(row.badDebt) || 0,
                netBalance: Number(row.netBalance) || 0,
                ...(row.gradeSection ? { gradeSection: String(row.gradeSection).trim() } : {}),
              }))
              .filter((row) => row.accountNumber)
          : [],
        audit: (file as { audit?: PaymentReceiveListStageData["files"][number]["audit"] })
          .audit,
      }))
    : [];

  const reconciliation = value.reconciliation;
  if (!reconciliation || typeof reconciliation !== "object") return undefined;

  return {
    label: "Reconciliation only — does not affect balances.",
    optional: true,
    source: "Kid-e-Sys",
    category: "payment-receive-list",
    purpose: "reconciliation-only",
    files,
    reconciliation: {
      label: "Reconciliation only — does not affect balances.",
      optional: true,
      source: "Kid-e-Sys",
      category: "payment-receive-list",
      purpose: "reconciliation-only",
      pdfFileCount: Number(reconciliation.pdfFileCount) || files.length,
      totalPdfAccounts: Number(reconciliation.totalPdfAccounts) || 0,
      ageAnalysisAccounts: Number(reconciliation.ageAnalysisAccounts) || 0,
      totalMatchedAccounts: Number(reconciliation.totalMatchedAccounts) || 0,
      missingInAgeAnalysis: Array.isArray(reconciliation.missingInAgeAnalysis)
        ? reconciliation.missingInAgeAnalysis.map(String)
        : [],
      missingInPdf: Array.isArray(reconciliation.missingInPdf)
        ? reconciliation.missingInPdf.map(String)
        : [],
      balanceDifferences: Array.isArray(reconciliation.balanceDifferences)
        ? reconciliation.balanceDifferences.map((d) => ({
            accountNumber: String(
              (d as { accountNumber?: string }).accountNumber || ""
            ).trim(),
            learnerName: String((d as { learnerName?: string }).learnerName || "").trim() || undefined,
            ageAnalysisBalance: Number(
              (d as { ageAnalysisBalance?: number }).ageAnalysisBalance
            ) || 0,
            pdfBalance: Number((d as { pdfBalance?: number }).pdfBalance) || 0,
            difference: Number((d as { difference?: number }).difference) || 0,
          }))
        : [],
      totalOutstanding: Number(reconciliation.totalOutstanding) || 0,
      totalCreditsOverpaid: Number(reconciliation.totalCreditsOverpaid) || 0,
      netPosition: Number(reconciliation.netPosition) || 0,
      ageAnalysisNetPosition: Number(reconciliation.ageAnalysisNetPosition) || 0,
    },
  };
}

function parseStageFile(raw: string, fileId: string): MigrationStage | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MigrationStage>;
    if (!parsed || typeof parsed !== "object") return null;
    const stageId = String(parsed.stageId || fileId).trim();
    const createdAt = String(parsed.createdAt || "").trim();
    const sourceSystem = String(parsed.sourceSystem || "").trim();
    if (!stageId || !createdAt || !sourceSystem) return null;

    const files = Array.isArray(parsed.files)
      ? parsed.files
          .map((f) => {
            const pathRaw = String((f as { path?: string }).path || "").trim();
            return {
              fileId: String((f as { fileId?: string }).fileId || "").trim(),
              filename: String((f as { filename?: string }).filename || "").trim(),
              category: String((f as { category?: string }).category || "unknown").trim(),
              rowCount: Number((f as { rowCount?: number }).rowCount) || 0,
              ...(pathRaw ? { path: pathRaw } : {}),
            };
          })
          .filter((f) => f.fileId && f.filename)
      : [];

    const mappings = Array.isArray(parsed.mappings)
      ? parsed.mappings
          .map((m) => ({
            fileId: String((m as { fileId?: string }).fileId || "").trim(),
            mappings: Array.isArray((m as { mappings?: unknown[] }).mappings)
              ? ((m as { mappings: Array<{ sourceColumn?: string; targetField?: string }> }).mappings)
                  .map((row) => ({
                    sourceColumn: String(row?.sourceColumn || "").trim(),
                    targetField: String(row?.targetField || "").trim(),
                  }))
                  .filter((row) => row.sourceColumn && row.targetField)
              : [],
          }))
          .filter((m) => m.fileId)
      : [];

    const validationSummary = parsed.validationSummary;
    if (
      !validationSummary ||
      typeof validationSummary !== "object" ||
      typeof (validationSummary as MigrationStage["validationSummary"]).canProceed !== "boolean"
    ) {
      return null;
    }

    const stagedCounts = parsed.stagedCounts;
    if (!stagedCounts || typeof stagedCounts !== "object") return null;

    const counts: MigrationStage["stagedCounts"] = {
      learners: Number((stagedCounts as MigrationStage["stagedCounts"]).learners) || 0,
      parents: Number((stagedCounts as MigrationStage["stagedCounts"]).parents) || 0,
      billingAccounts:
        Number((stagedCounts as MigrationStage["stagedCounts"]).billingAccounts) || 0,
      transactions: Number((stagedCounts as MigrationStage["stagedCounts"]).transactions) || 0,
      staff: Number((stagedCounts as MigrationStage["stagedCounts"]).staff) || 0,
      historical: Number((stagedCounts as MigrationStage["stagedCounts"]).historical) || 0,
    };

    const rawReadiness = parsed.transactionReadiness;
    const transactionReadiness: MigrationStage["transactionReadiness"] = {
      historicalOnlyTransactions:
        Number(
          (rawReadiness as MigrationStage["transactionReadiness"] | undefined)
            ?.historicalOnlyTransactions
        ) || 0,
      eligibleActiveTransactions:
        Number(
          (rawReadiness as MigrationStage["transactionReadiness"] | undefined)
            ?.eligibleActiveTransactions
        ) || 0,
      blockedTransactions:
        Number(
          (rawReadiness as MigrationStage["transactionReadiness"] | undefined)?.blockedTransactions
        ) || 0,
      unmatchedTransactions:
        Number(
          (rawReadiness as MigrationStage["transactionReadiness"] | undefined)?.unmatchedTransactions
        ) || 0,
    };

    const cutoverRaw = String(parsed.cutoverDate || "").trim();
    const cutoverDate = cutoverRaw && !Number.isNaN(Date.parse(cutoverRaw))
      ? new Date(cutoverRaw).toISOString().slice(0, 10)
      : undefined;

    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.map((w) => String(w)).filter(Boolean)
      : [];

    const paymentReceiveList = parsePaymentReceiveListStageData(parsed.paymentReceiveList);

    return {
      stageId,
      createdAt,
      sourceSystem,
      ...(cutoverDate ? { cutoverDate } : {}),
      files,
      mappings,
      validationSummary: validationSummary as MigrationStage["validationSummary"],
      stagedCounts: counts,
      transactionReadiness,
      ...(paymentReceiveList ? { paymentReceiveList } : {}),
      warnings,
      canApply: Boolean(parsed.canApply),
    };
  } catch {
    return null;
  }
}

function toListItem(stage: MigrationStage): MigrationStageListItem {
  return {
    stageId: stage.stageId,
    createdAt: stage.createdAt,
    sourceSystem: stage.sourceSystem,
    stagedCounts: stage.stagedCounts,
    canApply: stage.canApply,
    fileCount: stage.files.length,
  };
}

export function createStage(stage: MigrationStage): MigrationStage {
  ensureStagesDir();
  const safeId = sanitizeStageId(stage.stageId);
  if (!safeId) throw new Error("Invalid stage id");

  const filePath = stageFilePath(safeId);
  if (fs.existsSync(filePath)) {
    throw new Error("Stage id already exists");
  }

  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(stage, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
  return stage;
}

export function getStage(stageId: string): MigrationStage | null {
  ensureStagesDir();
  const safeId = sanitizeStageId(stageId);
  if (!safeId) return null;
  const filePath = stageFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return parseStageFile(raw, safeId);
  } catch {
    return null;
  }
}

export function listStages(): MigrationStageListItem[] {
  ensureStagesDir();
  const entries = fs.readdirSync(STAGES_DIR, { withFileTypes: true });
  const items: MigrationStageListItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fileId = entry.name.replace(/\.json$/i, "");
    try {
      const raw = fs.readFileSync(path.join(STAGES_DIR, entry.name), "utf8");
      const stage = parseStageFile(raw, fileId);
      if (stage) items.push(toListItem(stage));
    } catch {
      // Skip corrupt files
    }
  }

  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function deleteStage(stageId: string): boolean {
  ensureStagesDir();
  const safeId = sanitizeStageId(stageId);
  if (!safeId) return false;
  const filePath = stageFilePath(safeId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
