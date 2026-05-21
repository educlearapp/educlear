import { Router } from "express";
import crypto from "crypto";
import multer from "multer";
import type { BankTransaction, BankTransactionMatchStatus, Prisma } from "@prisma/client";

import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  appendSchoolEntry,
  listPayments,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { parseBankStatementBuffer } from "../utils/bankParsers";
import { listInvoices } from "../utils/billingLedgerStore";
import {
  confidenceFromScore,
  depositMatchStatusFromScore,
  EXPENSE_CATEGORIES,
  inferExpenseCategory,
  inferSupplierNameFromDescription,
  matchBankTransaction,
  matchSupplierFromDescription,
  normaliseBankBlob,
  transactionFingerprint,
  type BillingInvoiceRef,
  type ExpenseCategory,
  type LearnerMatchProfile,
  type MatchConfidence,
  type PreviousBankMatch,
  type SupplierMatchInput,
} from "../utils/paymentMatcher";
import { matchSupplierInvoicesForBankLine } from "../utils/supplierInvoiceMatcher";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

type TransactionType = "payment" | "expense" | "transfer" | "ignore";

type BankTransactionRow = {
  id: string;
  date: string;
  description: string;
  reference: string;
  moneyIn: number;
  moneyOut: number;
  direction: "in" | "out";
  transactionType: TransactionType;
  suggestedAccountId: string;
  suggestedAccountNo: string;
  suggestedLearnerId: string;
  suggestedLearnerName: string;
  confidenceScore: number;
  matchConfidence: MatchConfidence;
  matchReason: string;
  reviewStatus: "pending" | "accepted" | "unmatched" | "ignored" | "posted";
  matchStatus: BankTransactionMatchStatus;
  expenseCategory: ExpenseCategory | "";
  suggestedSupplierName: string;
  supplierId: string;
  expenseNotes: string;
  suggestedInvoiceId: string;
  suggestedInvoiceNumber: string;
  invoiceMatchScore: number;
  postedPaymentId?: string;
  fingerprint: string;
  isDuplicate?: boolean;
};

type BankImportRecord = {
  id: string;
  schoolId: string;
  fileName: string;
  format: string;
  bankName: string;
  uploadedBy: string;
  importedAt: string;
  totalRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  totalAmountImported: number;
  transactions: BankTransactionRow[];
};

type BankingStats = {
  imports: number;
  matchedPayments: number;
  suggestedPayments: number;
  expenseCandidates: number;
  unmatched: number;
  duplicateLines: number;
  readyToPost: number;
};

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function parseSupplierList(raw: unknown): SupplierMatchInput[] {
  if (Array.isArray(raw)) {
    const out: SupplierMatchInput[] = [];
    for (const row of raw) {
      const r = row as Record<string, unknown>;
      const id = String(r.id || "").trim();
      const name = String(r.name || "").trim();
      if (!id || !name) continue;
      const rule = String(r.autoMatchRule || "").trim();
      out.push({
        id,
        name,
        category: String(r.category || "Other").trim(),
        ...(rule ? { autoMatchRule: rule } : {}),
      });
    }
    return out;
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      return parseSupplierList(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function defaultTransactionType(direction: "in" | "out"): TransactionType {
  return direction === "in" ? "payment" : "expense";
}

function txnTypeFromRow(txn: Pick<BankTransactionRow, "transactionType" | "direction">): TransactionType {
  const tt = txn.transactionType;
  if (tt === "payment" || tt === "expense" || tt === "transfer" || tt === "ignore") return tt;
  return defaultTransactionType(txn.direction);
}

function effectiveConfidenceScore(
  txn: Pick<BankTransaction, "confidenceScore" | "matchConfidence" | "suggestedLearnerId">
): number {
  const stored = txn.confidenceScore ?? 0;
  if (stored > 0) return stored;
  if (!txn.suggestedLearnerId) return 0;
  const mc = String(txn.matchConfidence || "").toLowerCase();
  if (mc === "high") return 95;
  if (mc === "medium") return 75;
  if (mc === "low") return 55;
  return 0;
}

function toApiRow(txn: BankTransaction): BankTransactionRow {
  const confidenceScore = effectiveConfidenceScore(txn);
  return {
    id: txn.id,
    date: txn.date,
    description: txn.description,
    reference: txn.reference,
    moneyIn: normaliseAmount(txn.moneyIn),
    moneyOut: normaliseAmount(txn.moneyOut),
    direction: txn.direction === "out" ? "out" : "in",
    transactionType: txnTypeFromRow({
      transactionType: txn.transactionType as TransactionType,
      direction: txn.direction === "out" ? "out" : "in",
    }),
    suggestedAccountId: txn.suggestedAccountId,
    suggestedAccountNo: txn.suggestedAccountNo,
    suggestedLearnerId: txn.suggestedLearnerId,
    suggestedLearnerName: txn.suggestedLearnerName,
    confidenceScore,
    matchConfidence: (txn.matchConfidence || "none") as MatchConfidence,
    matchReason: txn.matchReason,
    reviewStatus: txn.reviewStatus as BankTransactionRow["reviewStatus"],
    matchStatus: txn.matchStatus,
    expenseCategory: (txn.expenseCategory || "") as ExpenseCategory | "",
    suggestedSupplierName: txn.suggestedSupplierName,
    supplierId: txn.supplierId,
    expenseNotes: txn.expenseNotes,
    suggestedInvoiceId: txn.suggestedInvoiceId || "",
    suggestedInvoiceNumber: txn.suggestedInvoiceNumber || "",
    invoiceMatchScore: txn.invoiceMatchScore ?? 0,
    postedPaymentId: txn.postedPaymentId || undefined,
    fingerprint: txn.fingerprint,
    isDuplicate: txn.isDuplicate,
  };
}

function toImportRecord(
  imp: {
    id: string;
    schoolId: string;
    fileName: string;
    format: string;
    bankName?: string;
    uploadedBy?: string;
    importedAt: Date;
    totalRows?: number;
    matchedRows?: number;
    unmatchedRows?: number;
    duplicateRows?: number;
    totalAmountImported?: number;
  },
  transactions: BankTransaction[]
): BankImportRecord {
  return {
    id: imp.id,
    schoolId: imp.schoolId,
    fileName: imp.fileName,
    format: imp.format,
    bankName: String(imp.bankName || "").trim(),
    uploadedBy: String(imp.uploadedBy || "").trim(),
    importedAt: imp.importedAt.toISOString(),
    totalRows: imp.totalRows ?? transactions.length,
    matchedRows: imp.matchedRows ?? 0,
    unmatchedRows: imp.unmatchedRows ?? 0,
    duplicateRows: imp.duplicateRows ?? 0,
    totalAmountImported: normaliseAmount(imp.totalAmountImported ?? 0),
    transactions: transactions.map(toApiRow),
  };
}

function buildBillingInvoiceRefs(schoolId: string): BillingInvoiceRef[] {
  return listInvoices(schoolId).map((inv) => ({
    learnerId: inv.learnerId,
    learnerName: "",
    accountNo: inv.accountNo,
    familyAccountId: "",
    reference: String(inv.reference || "").trim(),
  }));
}

function summariseImportRows(
  rows: Array<{
    moneyIn: number;
    moneyOut: number;
    isDuplicate: boolean;
    matchStatus: BankTransactionMatchStatus;
  }>
) {
  let matchedRows = 0;
  let unmatchedRows = 0;
  let duplicateRows = 0;
  let totalAmountImported = 0;

  for (const row of rows) {
    totalAmountImported += normaliseAmount(row.moneyIn) + normaliseAmount(row.moneyOut);
    if (row.isDuplicate || row.matchStatus === "duplicate") {
      duplicateRows += 1;
      continue;
    }
    if (row.matchStatus === "matched") matchedRows += 1;
    else unmatchedRows += 1;
  }

  return {
    totalRows: rows.length,
    matchedRows,
    unmatchedRows,
    duplicateRows,
    totalAmountImported,
  };
}

function deriveInitialMatchStatus(input: {
  isDuplicate: boolean;
  direction: "in" | "out";
  confidenceScore: number;
  expenseCategory: ExpenseCategory | "";
}): BankTransactionMatchStatus {
  if (input.isDuplicate) return "duplicate";
  if (input.direction === "in") {
    return depositMatchStatusFromScore(input.confidenceScore, false);
  }
  if (input.expenseCategory && input.expenseCategory !== "Other") return "matched";
  return "imported";
}

function syncMatchStatus(row: BankTransactionRow): BankTransactionMatchStatus {
  if (row.isDuplicate || row.matchStatus === "duplicate") return "duplicate";
  if (row.reviewStatus === "posted") {
    return row.matchStatus === "ready_to_post" ? "ready_to_post" : row.matchStatus;
  }
  if (row.reviewStatus === "accepted") return "accepted";
  if (row.reviewStatus === "unmatched") return "rejected";

  const type = txnTypeFromRow(row);

  if (row.direction === "in" && type === "payment" && row.reviewStatus === "pending") {
    return depositMatchStatusFromScore(row.confidenceScore, false);
  }

  if (row.direction === "out" && type === "expense" && row.expenseCategory && row.expenseCategory !== "Other") {
    return "matched";
  }

  if (row.matchStatus) return row.matchStatus;
  return "imported";
}

async function loadSchoolFingerprints(schoolId: string): Promise<Set<string>> {
  const posted = await prisma.bankTransaction.findMany({
    where: { schoolId, reviewStatus: "posted" },
    select: { fingerprint: true },
  });
  const all = await prisma.bankTransaction.findMany({
    where: { schoolId },
    select: { fingerprint: true },
  });
  return new Set([...posted.map((r) => r.fingerprint), ...all.map((r) => r.fingerprint)]);
}

async function computeStats(schoolId: string, importId?: string): Promise<BankingStats> {
  const imports = await prisma.bankStatementImport.count({ where: { schoolId } });

  if (!importId) {
    return {
      imports,
      matchedPayments: 0,
      suggestedPayments: 0,
      expenseCandidates: 0,
      unmatched: 0,
      duplicateLines: 0,
      readyToPost: 0,
    };
  }

  const txns = await prisma.bankTransaction.findMany({
    where: { schoolId, importId },
  });

  let matchedPayments = 0;
  let suggestedPayments = 0;
  let expenseCandidates = 0;
  let unmatched = 0;
  let duplicateLines = 0;
  let readyToPost = 0;

  for (const raw of txns) {
    const row = toApiRow(raw);
    const type = txnTypeFromRow(row);

    if (row.isDuplicate || row.matchStatus === "duplicate") duplicateLines += 1;

    if (
      row.direction === "in" &&
      type === "payment" &&
      row.reviewStatus !== "ignored" &&
      (row.matchStatus === "matched" || row.matchStatus === "ready_to_post")
    ) {
      matchedPayments += 1;
    }

    if (
      row.direction === "in" &&
      type === "payment" &&
      row.reviewStatus === "pending" &&
      row.matchStatus === "suggested"
    ) {
      suggestedPayments += 1;
    }

    if (row.direction === "out" && type === "expense" && row.reviewStatus === "accepted") {
      expenseCandidates += 1;
    }

    if (
      row.matchStatus === "unmatched" ||
      row.reviewStatus === "unmatched" ||
      (row.reviewStatus === "pending" &&
        row.direction === "in" &&
        type === "payment" &&
        row.matchStatus === "imported" &&
        row.confidenceScore === 0)
    ) {
      unmatched += 1;
    }

    const postConfidence = effectiveConfidenceScore({
      confidenceScore: row.confidenceScore,
      matchConfidence: row.matchConfidence,
      suggestedLearnerId: row.suggestedLearnerId,
    });
    if (
      row.matchStatus === "ready_to_post" ||
      (row.direction === "in" &&
        type === "payment" &&
        row.reviewStatus === "accepted" &&
        postConfidence >= 50 &&
        row.suggestedLearnerId &&
        row.suggestedAccountNo &&
        row.suggestedAccountNo !== "-")
    ) {
      readyToPost += 1;
    }
  }

  return {
    imports,
    matchedPayments,
    suggestedPayments,
    expenseCandidates,
    unmatched,
    duplicateLines,
    readyToPost,
  };
}

async function loadPreviousBankMatches(schoolId: string): Promise<PreviousBankMatch[]> {
  const rows = await prisma.bankTransaction.findMany({
    where: {
      schoolId,
      direction: "in",
      suggestedLearnerId: { not: "" },
      reviewStatus: { in: ["accepted", "posted"] },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      description: true,
      reference: true,
      suggestedLearnerId: true,
      suggestedLearnerName: true,
      suggestedAccountNo: true,
      suggestedAccountId: true,
    },
  });

  const seen = new Set<string>();
  const out: PreviousBankMatch[] = [];
  for (const row of rows) {
    const blobKey = normaliseBankBlob(row.description, row.reference);
    if (!blobKey || seen.has(blobKey)) continue;
    seen.add(blobKey);
    out.push({
      blobKey,
      learnerId: row.suggestedLearnerId,
      learnerName: row.suggestedLearnerName,
      accountNo: row.suggestedAccountNo,
      familyAccountId: row.suggestedAccountId,
    });
  }
  return out;
}

async function buildMatchProfiles(schoolId: string): Promise<LearnerMatchProfile[]> {
  const payments = listPayments(schoolId);

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyAccountId: true,
      familyAccount: { select: { id: true, accountRef: true } },
      links: {
        include: {
          parent: { select: { firstName: true, surname: true, cellNo: true } },
        },
      },
    },
  });

  return learners.map((learner) => {
    const accountNo = resolveLearnerAccountNo(learner);
    const learnerPayments = payments.filter(
      (p) => p.learnerId === learner.id || p.accountNo === accountNo
    );
    const sorted = [...learnerPayments].sort(
      (a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime()
    );
    const parentNames = (learner.links || [])
      .map((l) => `${l.parent?.firstName || ""} ${l.parent?.surname || ""}`.trim())
      .filter(Boolean);
    const parentSurnames = (learner.links || [])
      .map((l) => String(l.parent?.surname || "").trim())
      .filter(Boolean);
    const parentCellNumbers = (learner.links || [])
      .map((l) => String(l.parent?.cellNo || "").trim())
      .filter(Boolean);

    return {
      learnerId: learner.id,
      learnerName: `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
      learnerSurname: String(learner.lastName || "").trim(),
      accountNo,
      familyAccountId: String(learner.familyAccountId || learner.familyAccount?.id || "").trim(),
      parentNames,
      parentSurnames,
      parentCellNumbers,
      lastPaymentAmount: sorted[0]?.amount,
    };
  });
}

async function fetchImportRecord(schoolId: string, importId: string): Promise<BankImportRecord | null> {
  const imp = await prisma.bankStatementImport.findFirst({
    where: { id: importId, schoolId },
    include: {
      transactions: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!imp) return null;
  return toImportRecord(imp, imp.transactions);
}

router.get("/stats", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const importId = String(req.query.importId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const stats = await computeStats(schoolId, importId || undefined);
    return res.json({ success: true, stats });
  } catch (error) {
    console.error("[banking] GET /stats failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/transactions", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const importId = String(req.query.importId || "").trim();
    const matchStatus = String(req.query.matchStatus || "").trim() as BankTransactionMatchStatus;

    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const where: Prisma.BankTransactionWhereInput = { schoolId };
    if (importId) where.importId = importId;
    if (matchStatus) where.matchStatus = matchStatus;

    const rows = await prisma.bankTransaction.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    return res.json({ success: true, transactions: rows.map(toApiRow) });
  } catch (error) {
    console.error("[banking] GET /transactions failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/import", upload.single("file"), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    if (!req.file) return res.status(400).json({ success: false, error: "Missing bank statement file" });

    const parsed = parseBankStatementBuffer(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

    const uploadedBy = String(req.body?.uploadedBy || req.body?.createdBy || "").trim();
    const bankName = String(parsed.bankName || "").trim();
    const importFormat = parsed.parserId || parsed.format;

    const profiles = await buildMatchProfiles(schoolId);
    const previousMatches = await loadPreviousBankMatches(schoolId);
    const invoiceRefs = buildBillingInvoiceRefs(schoolId);

    const dbSuppliers = await prisma.supplier.findMany({
      where: { schoolId, status: "active" },
      select: { id: true, supplierName: true },
    });
    const supplierList: SupplierMatchInput[] =
      parseSupplierList(req.body?.suppliers).length > 0
        ? parseSupplierList(req.body?.suppliers)
        : dbSuppliers.map((s) => ({
            id: s.id,
            name: s.supplierName,
            category: "Other",
          }));

    const openInvoices = await prisma.supplierInvoice.findMany({
      where: {
        schoolId,
        status: { in: ["approved", "partially_paid"] },
        outstandingAmount: { gt: 0 },
      },
      include: { supplier: true },
    });
    const invoiceMatchInputs = openInvoices.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      totalAmount: inv.totalAmount,
      outstandingAmount: inv.outstandingAmount,
      supplierId: inv.supplierId,
      status: inv.status,
      supplierName: inv.supplier.supplierName,
    }));

    const existingFingerprints = await loadSchoolFingerprints(schoolId);
    const postedFingerprints = new Set(
      (
        await prisma.bankTransaction.findMany({
          where: { schoolId, reviewStatus: "posted" },
          select: { fingerprint: true },
        })
      ).map((r) => r.fingerprint)
    );

    const seenInBatch = new Set<string>();
    const createRows: Prisma.BankTransactionUncheckedCreateWithoutImportInput[] = [];

    for (const txn of parsed.transactions) {
      const direction: "in" | "out" = txn.moneyIn > 0 ? "in" : "out";
      const fingerprint = transactionFingerprint(schoolId, txn);
      const duplicateInBatch = seenInBatch.has(fingerprint);
      seenInBatch.add(fingerprint);
      const isDuplicate =
        duplicateInBatch || existingFingerprints.has(fingerprint) || postedFingerprints.has(fingerprint);

      const suggestion =
        direction === "in"
          ? matchBankTransaction(txn, profiles, previousMatches, invoiceRefs)
          : {
              suggestedAccountId: "",
              suggestedAccountNo: "",
              suggestedLearnerId: "",
              suggestedLearnerName: "",
              confidenceScore: 0,
              matchConfidence: "none" as MatchConfidence,
              matchReason: "",
            };

      let expenseCategory: ExpenseCategory | "" = "";
      let suggestedSupplierName = "";
      let supplierId = "";
      let expenseMatchReason = "";
      let suggestedInvoiceId = "";
      let suggestedInvoiceNumber = "";
      let invoiceMatchScore = 0;

      if (direction === "out") {
        const bankAmount = normaliseAmount(txn.moneyOut);
        const invoiceHit = matchSupplierInvoicesForBankLine(
          txn.description,
          txn.reference,
          bankAmount,
          dbSuppliers.map((s) => ({ id: s.id, supplierName: s.supplierName })),
          invoiceMatchInputs
        );

        const supplierHit = matchSupplierFromDescription(txn.description, txn.reference, supplierList);
        const expenseInfer = inferExpenseCategory(txn.description, txn.reference);

        if (invoiceHit) {
          suggestedInvoiceId = invoiceHit.invoiceId;
          suggestedInvoiceNumber = invoiceHit.invoiceNumber;
          invoiceMatchScore = invoiceHit.score;
          supplierId = invoiceHit.supplierId;
          suggestedSupplierName = invoiceHit.supplierName;
          expenseMatchReason = invoiceHit.reason;
          expenseCategory = expenseInfer.expenseCategory;
        } else if (supplierHit) {
          supplierId = supplierHit.supplierId;
          suggestedSupplierName = supplierHit.supplierName;
          const cat = String(supplierHit.category || "").trim() as ExpenseCategory;
          expenseCategory = (EXPENSE_CATEGORIES as readonly string[]).includes(cat)
            ? cat
            : expenseInfer.expenseCategory;
          expenseMatchReason = supplierHit.reason;
        } else {
          expenseCategory = expenseInfer.expenseCategory;
          suggestedSupplierName = inferSupplierNameFromDescription(txn.description);
          expenseMatchReason = expenseInfer.matchReason;
        }
      }

      const matchConfidence = suggestion.matchConfidence;
      const matchStatus = deriveInitialMatchStatus({
        isDuplicate,
        direction,
        confidenceScore: suggestion.confidenceScore,
        expenseCategory,
      });

      createRows.push({
        id: newId("txn"),
        schoolId,
        date: txn.date,
        description: txn.description,
        reference: txn.reference,
        moneyIn: normaliseAmount(txn.moneyIn),
        moneyOut: normaliseAmount(txn.moneyOut),
        direction,
        transactionType: direction === "in" ? "payment" : "expense",
        suggestedAccountId: suggestion.suggestedAccountId,
        suggestedAccountNo: suggestion.suggestedAccountNo,
        suggestedLearnerId: suggestion.suggestedLearnerId,
        suggestedLearnerName: suggestion.suggestedLearnerName,
        confidenceScore: suggestion.confidenceScore,
        matchConfidence,
        matchReason:
          direction === "in" ? suggestion.matchReason : expenseMatchReason || suggestion.matchReason,
        reviewStatus: "pending",
        matchStatus,
        expenseCategory,
        suggestedSupplierName,
        supplierId,
        suggestedInvoiceId,
        suggestedInvoiceNumber,
        invoiceMatchScore,
        expenseNotes: "",
        fingerprint,
        rawRow: txn as unknown as Prisma.InputJsonValue,
        isDuplicate,
      });
    }

    const batchSummary = summariseImportRows(
      createRows.map((r) => ({
        moneyIn: normaliseAmount(r.moneyIn ?? 0),
        moneyOut: normaliseAmount(r.moneyOut ?? 0),
        isDuplicate: Boolean(r.isDuplicate),
        matchStatus: r.matchStatus as BankTransactionMatchStatus,
      }))
    );

    const importRecord = await prisma.bankStatementImport.create({
      data: {
        id: newId("import"),
        schoolId,
        fileName: req.file.originalname,
        format: importFormat,
        bankName,
        uploadedBy,
        totalRows: batchSummary.totalRows,
        matchedRows: batchSummary.matchedRows,
        unmatchedRows: batchSummary.unmatchedRows,
        duplicateRows: batchSummary.duplicateRows,
        totalAmountImported: batchSummary.totalAmountImported,
        transactions: {
          create: createRows,
        },
      },
      include: {
        transactions: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
      },
    });

    const hydrated = toImportRecord(importRecord, importRecord.transactions);

    return res.status(201).json({
      success: true,
      import: hydrated,
      expenseCategories: EXPENSE_CATEGORIES,
      accountingNote:
        "Accepted banking expense candidates are sent to Accounting → Expenses review queue.",
    });
  } catch (error) {
    console.error("[banking] POST /import failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/imports", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const imports = await prisma.bankStatementImport.findMany({
      where: { schoolId },
      orderBy: { importedAt: "desc" },
      include: {
        transactions: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
      },
    });

    return res.json({
      success: true,
      imports: imports.map((imp) => toImportRecord(imp, imp.transactions)),
    });
  } catch (error) {
    console.error("[banking] GET /imports failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/imports/:id", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const record = await fetchImportRecord(schoolId, id);
    if (!record) return res.status(404).json({ success: false, error: "Import not found" });

    return res.json({
      success: true,
      import: record,
      expenseCategories: EXPENSE_CATEGORIES,
      accountingNote:
        "Accepted banking expense candidates are sent to Accounting → Expenses review queue.",
    });
  } catch (error) {
    console.error("[banking] GET /imports/:id failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.patch("/imports/:id/transaction/:transactionId", async (req, res) => {
  try {
    const importId = String(req.params.id || "").trim();
    const transactionId = String(req.params.transactionId || "").trim();
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const existing = await prisma.bankTransaction.findFirst({
      where: { id: transactionId, importId, schoolId },
    });
    if (!existing) return res.status(404).json({ success: false, error: "Transaction not found" });
    if (existing.reviewStatus === "posted") {
      return res.status(400).json({ success: false, error: "Posted transactions cannot be edited" });
    }

    const body = req.body || {};
    const current = toApiRow(existing);
    const next: BankTransactionRow = { ...current };

    const matchAction = String(body.matchAction || "").trim();
    if (matchAction === "accept") {
      next.reviewStatus = "accepted";
      next.matchStatus = "accepted";
      if (
        next.direction === "in" &&
        txnTypeFromRow(next) === "payment" &&
        next.suggestedLearnerId
      ) {
        const floor = effectiveConfidenceScore({
          confidenceScore: next.confidenceScore,
          matchConfidence: next.matchConfidence,
          suggestedLearnerId: next.suggestedLearnerId,
        });
        if (floor > next.confidenceScore) {
          next.confidenceScore = floor;
          next.matchConfidence = confidenceFromScore(next.confidenceScore);
        }
      }
    } else if (matchAction === "reject") {
      next.reviewStatus = "unmatched";
      next.matchStatus = "rejected";
    } else if (body.reviewStatus) {
      const status = String(body.reviewStatus) as BankTransactionRow["reviewStatus"];
      if (["pending", "accepted", "unmatched", "ignored"].includes(status)) {
        next.reviewStatus = status;
      }
    }

    if (body.suggestedAccountId !== undefined) {
      next.suggestedAccountId = String(body.suggestedAccountId).trim();
    }
    if (body.suggestedAccountNo !== undefined) next.suggestedAccountNo = String(body.suggestedAccountNo).trim();
    if (body.suggestedLearnerId !== undefined) next.suggestedLearnerId = String(body.suggestedLearnerId).trim();
    if (body.suggestedLearnerName !== undefined) {
      next.suggestedLearnerName = String(body.suggestedLearnerName).trim();
    }
    if (body.confidenceScore !== undefined) {
      const score = Math.max(0, Math.min(100, Number(body.confidenceScore) || 0));
      next.confidenceScore = score;
      next.matchConfidence = confidenceFromScore(score);
    }
    if (body.matchReason !== undefined) next.matchReason = String(body.matchReason).trim();
    if (body.matchConfidence !== undefined) {
      const mc = String(body.matchConfidence).trim() as MatchConfidence;
      if (["high", "medium", "low", "none"].includes(mc)) next.matchConfidence = mc;
    }

    if (
      body.suggestedLearnerId !== undefined &&
      String(body.suggestedLearnerId).trim() &&
      body.matchAction !== "reject"
    ) {
      const manualScore =
        body.confidenceScore !== undefined ? next.confidenceScore : Math.max(next.confidenceScore, 100);
      next.confidenceScore = manualScore;
      next.matchConfidence = confidenceFromScore(manualScore);
      if (!body.matchReason && !next.matchReason) {
        next.matchReason = "Manually selected by admin";
      }
    }

    if (body.expenseCategory !== undefined && current.direction === "out") {
      const cat = String(body.expenseCategory).trim() as ExpenseCategory;
      next.expenseCategory = (EXPENSE_CATEGORIES as readonly string[]).includes(cat) ? cat : "Other";
    }

    if (body.transactionType !== undefined) {
      const tt = String(body.transactionType).trim() as TransactionType;
      if (["payment", "expense", "transfer", "ignore"].includes(tt)) {
        next.transactionType = tt;
      }
    }

    if (body.suggestedSupplierName !== undefined) {
      next.suggestedSupplierName = String(body.suggestedSupplierName).trim();
    }
    if (body.supplierId !== undefined) next.supplierId = String(body.supplierId).trim();
    if (body.suggestedInvoiceId !== undefined) {
      next.suggestedInvoiceId = String(body.suggestedInvoiceId).trim();
    }
    if (body.suggestedInvoiceNumber !== undefined) {
      next.suggestedInvoiceNumber = String(body.suggestedInvoiceNumber).trim();
    }
    if (body.invoiceMatchScore !== undefined) {
      next.invoiceMatchScore = Math.max(0, Math.min(100, Number(body.invoiceMatchScore) || 0));
    }
    if (body.expenseNotes !== undefined) next.expenseNotes = String(body.expenseNotes).trim();
    if (body.description !== undefined) next.description = String(body.description).trim();

    next.matchStatus = syncMatchStatus(next);

    const updated = await prisma.bankTransaction.update({
      where: { id: transactionId },
      data: {
        reviewStatus: next.reviewStatus,
        matchStatus: next.matchStatus,
        suggestedAccountId: next.suggestedAccountId,
        suggestedAccountNo: next.suggestedAccountNo,
        suggestedLearnerId: next.suggestedLearnerId,
        suggestedLearnerName: next.suggestedLearnerName,
        confidenceScore: next.confidenceScore,
        matchConfidence: next.matchConfidence,
        matchReason: next.matchReason,
        expenseCategory: next.expenseCategory,
        transactionType: next.transactionType,
        suggestedSupplierName: next.suggestedSupplierName,
        supplierId: next.supplierId,
        suggestedInvoiceId: next.suggestedInvoiceId,
        suggestedInvoiceNumber: next.suggestedInvoiceNumber,
        invoiceMatchScore: next.invoiceMatchScore,
        expenseNotes: next.expenseNotes,
        description: next.description,
      },
    });

    const importRecord = await fetchImportRecord(schoolId, importId);
    if (!importRecord) return res.status(404).json({ success: false, error: "Import not found" });

    return res.json({ success: true, transaction: toApiRow(updated), import: importRecord });
  } catch (error) {
    console.error("[banking] PATCH transaction failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

function bankPaymentIdForTransaction(transactionId: string) {
  return `pay-bank-${transactionId}`;
}

function ledgerHasBankSourcePayment(
  ledger: BillingLedgerEntry[],
  bankTransactionId: string,
  paymentId: string
) {
  return ledger.some(
    (e) =>
      e.type === "payment" &&
      (e.id === paymentId ||
        (e.bankTransactionId && e.bankTransactionId === bankTransactionId))
  );
}

router.post("/imports/:id/post-payments", async (req, res) => {
  try {
    const importId = String(req.params.id || "").trim();
    const schoolId = String(req.body?.schoolId || "").trim();
    const transactionIds = Array.isArray(req.body?.transactionIds)
      ? (req.body.transactionIds as unknown[]).map((v) => String(v).trim()).filter(Boolean)
      : [];

    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const importExists = await prisma.bankStatementImport.findFirst({
      where: { id: importId, schoolId },
    });
    if (!importExists) return res.status(404).json({ success: false, error: "Import not found" });

    const transactions = await prisma.bankTransaction.findMany({
      where: { importId, schoolId },
    });

    const postedFingerprints = new Set(
      (
        await prisma.bankTransaction.findMany({
          where: { schoolId, reviewStatus: "posted" },
          select: { fingerprint: true },
        })
      ).map((r) => r.fingerprint)
    );

    const ledger = readSchoolLedger(schoolId);
    const learnerRows = await prisma.learner.findMany({
      where: { schoolId },
      select: {
        id: true,
        familyAccountId: true,
        familyAccount: { select: { id: true, accountRef: true } },
      },
    });
    const learnerById = new Map(
      learnerRows.map((l) => [l.id, resolveLearnerAccountNo(l)])
    );

    const posted: BillingLedgerEntry[] = [];
    const skipped: { transactionId: string; reason: string }[] = [];

    for (const txn of transactions) {
      if (transactionIds.length && !transactionIds.includes(txn.id)) continue;

      const row = toApiRow(txn);
      const paymentId = row.postedPaymentId || bankPaymentIdForTransaction(txn.id);

      if (row.reviewStatus === "posted" || row.postedPaymentId) {
        skipped.push({ transactionId: txn.id, reason: "Already posted to Billing" });
        continue;
      }
      if (row.isDuplicate) {
        skipped.push({ transactionId: txn.id, reason: "Duplicate bank line cannot be posted" });
        continue;
      }
      if (txnTypeFromRow(row) !== "payment") {
        skipped.push({ transactionId: txn.id, reason: "Not classified as a payment" });
        continue;
      }
      if (row.direction !== "in" || row.moneyIn <= 0) {
        skipped.push({ transactionId: txn.id, reason: "Not an incoming payment" });
        continue;
      }
      if (row.reviewStatus !== "accepted") {
        skipped.push({ transactionId: txn.id, reason: "Transaction not accepted for posting" });
        continue;
      }
      if (row.confidenceScore < 50) {
        skipped.push({ transactionId: txn.id, reason: "Low confidence match cannot be posted" });
        continue;
      }
      if (!row.suggestedLearnerId || !row.suggestedAccountNo || row.suggestedAccountNo === "-") {
        skipped.push({ transactionId: txn.id, reason: "Missing learner/account match" });
        continue;
      }
      if (!learnerById.has(row.suggestedLearnerId)) {
        skipped.push({ transactionId: txn.id, reason: "Learner not found for this school" });
        continue;
      }
      if (postedFingerprints.has(row.fingerprint)) {
        skipped.push({ transactionId: txn.id, reason: "Duplicate bank transaction already posted" });
        continue;
      }
      if (ledgerHasBankSourcePayment(ledger, txn.id, paymentId)) {
        skipped.push({ transactionId: txn.id, reason: "Payment already exists in billing ledger" });
        continue;
      }

      const accountNo = learnerById.get(row.suggestedLearnerId) || row.suggestedAccountNo;
      const bankRef = String(row.reference || "").trim();
      const bankDesc = String(row.description || "Payment").trim();

      const entry: BillingLedgerEntry = {
        id: paymentId,
        schoolId,
        learnerId: row.suggestedLearnerId,
        accountNo,
        type: "payment",
        amount: normaliseAmount(row.moneyIn),
        date: row.date,
        reference: bankRef || bankDesc.slice(0, 80),
        description: `Bank statement (${importExists.fileName}): ${bankDesc}`.trim(),
        method: "Bank Import",
        bankTransactionId: txn.id,
        bankImportId: importId,
        source: "bank_import",
        createdAt: new Date().toISOString(),
      };

      appendSchoolEntry(schoolId, entry);
      ledger.push(entry);
      postedFingerprints.add(row.fingerprint);

      await prisma.bankTransaction.update({
        where: { id: txn.id },
        data: {
          reviewStatus: "posted",
          matchStatus: "ready_to_post",
          postedPaymentId: paymentId,
        },
      });

      posted.push(entry);
    }

    const importRecord = await fetchImportRecord(schoolId, importId);

    return res.json({
      success: true,
      postedCount: posted.length,
      skipped,
      ledgerEntries: posted,
      import: importRecord,
    });
  } catch (error) {
    console.error("[banking] POST post-payments failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
