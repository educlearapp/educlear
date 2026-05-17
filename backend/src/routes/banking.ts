import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import multer from "multer";

import { prisma } from "../prisma";
import { resolveLearnerAccountNo } from "../utils/learnerIdentity";
import {
  appendSchoolEntry,
  listPayments,
  normaliseAmount,
  readSchoolLedger,
  type BillingLedgerEntry,
} from "../utils/billingLedgerStore";
import { parseBankStatementFile } from "../utils/bankStatementParser";
import {
  EXPENSE_CATEGORIES,
  matchBankTransaction,
  transactionFingerprint,
  type ExpenseCategory,
  type LearnerMatchProfile,
  type MatchConfidence,
} from "../utils/paymentMatcher";

const router = Router();
const DATA_FILE = path.join(process.cwd(), "data", "banking-imports.json");
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 12 * 1024 * 1024 } });

type BankTransactionRow = {
  id: string;
  date: string;
  description: string;
  reference: string;
  moneyIn: number;
  moneyOut: number;
  direction: "in" | "out";
  suggestedAccountNo: string;
  suggestedLearnerId: string;
  suggestedLearnerName: string;
  matchConfidence: MatchConfidence;
  matchReason: string;
  reviewStatus: "pending" | "accepted" | "unmatched" | "ignored" | "posted";
  expenseCategory: ExpenseCategory | "";
  postedPaymentId?: string;
  fingerprint: string;
};

type BankImportRecord = {
  id: string;
  schoolId: string;
  fileName: string;
  format: string;
  importedAt: string;
  transactions: BankTransactionRow[];
};

type BankingStore = {
  imports: BankImportRecord[];
  postedFingerprints: Record<string, string[]>;
};

function ensureStore(): BankingStore {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial: BankingStore = { imports: [], postedFingerprints: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      imports: Array.isArray(parsed?.imports) ? parsed.imports : [],
      postedFingerprints:
        parsed?.postedFingerprints && typeof parsed.postedFingerprints === "object"
          ? parsed.postedFingerprints
          : {},
    };
  } catch {
    return { imports: [], postedFingerprints: {} };
  }
}

function writeStore(store: BankingStore) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function newId(prefix: string) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

async function buildMatchProfiles(schoolId: string): Promise<LearnerMatchProfile[]> {
  const ledger = readSchoolLedger(schoolId);
  const payments = listPayments(schoolId);

  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      familyAccount: { select: { accountRef: true } },
      links: {
        include: {
          parent: { select: { firstName: true, surname: true } },
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

    return {
      learnerId: learner.id,
      learnerName: `${learner.firstName || ""} ${learner.lastName || ""}`.trim(),
      accountNo,
      parentNames,
      lastPaymentAmount: sorted[0]?.amount,
    };
  });
}

router.post("/import", upload.single("file"), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    if (!req.file) return res.status(400).json({ success: false, error: "Missing bank statement file" });

    const parsed = parseBankStatementFile(req.file.buffer, req.file.originalname, req.file.mimetype);
    if (!parsed.ok) return res.status(400).json({ success: false, error: parsed.error });

    const profiles = await buildMatchProfiles(schoolId);
    const store = ensureStore();

    const transactions: BankTransactionRow[] = parsed.transactions.map((txn) => {
      const direction: "in" | "out" = txn.moneyIn > 0 ? "in" : "out";
      const suggestion =
        direction === "in"
          ? matchBankTransaction(txn, profiles)
          : {
              suggestedAccountNo: "",
              suggestedLearnerId: "",
              suggestedLearnerName: "",
              matchConfidence: "none" as MatchConfidence,
              matchReason: "",
            };

      return {
        id: newId("txn"),
        date: txn.date,
        description: txn.description,
        reference: txn.reference,
        moneyIn: normaliseAmount(txn.moneyIn),
        moneyOut: normaliseAmount(txn.moneyOut),
        direction,
        suggestedAccountNo: suggestion.suggestedAccountNo,
        suggestedLearnerId: suggestion.suggestedLearnerId,
        suggestedLearnerName: suggestion.suggestedLearnerName,
        matchConfidence: suggestion.matchConfidence,
        matchReason: suggestion.matchReason,
        reviewStatus: "pending",
        expenseCategory: direction === "out" ? "Other" : "",
        fingerprint: transactionFingerprint(txn),
      };
    });

    const record: BankImportRecord = {
      id: newId("import"),
      schoolId,
      fileName: req.file.originalname,
      format: parsed.format,
      importedAt: new Date().toISOString(),
      transactions,
    };

    store.imports.unshift(record);
    writeStore(store);

    return res.status(201).json({
      success: true,
      import: record,
      expenseCategories: EXPENSE_CATEGORIES,
      accountingNote: "Accounting module integration pending",
    });
  } catch (error) {
    console.error("[banking] POST /import failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/imports", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });
    const store = ensureStore();
    const imports = store.imports
      .filter((r) => r.schoolId === schoolId)
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
    return res.json({ success: true, imports });
  } catch (error) {
    console.error("[banking] GET /imports failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.get("/imports/:id", (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const id = String(req.params.id || "").trim();
    const store = ensureStore();
    const record = store.imports.find((r) => r.id === id && (!schoolId || r.schoolId === schoolId));
    if (!record) return res.status(404).json({ success: false, error: "Import not found" });
    return res.json({
      success: true,
      import: record,
      expenseCategories: EXPENSE_CATEGORIES,
      accountingNote: "Accounting module integration pending",
    });
  } catch (error) {
    console.error("[banking] GET /imports/:id failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.patch("/imports/:id/transaction/:transactionId", (req, res) => {
  try {
    const importId = String(req.params.id || "").trim();
    const transactionId = String(req.params.transactionId || "").trim();
    const schoolId = String(req.body?.schoolId || "").trim();
    const store = ensureStore();
    const record = store.imports.find((r) => r.id === importId && r.schoolId === schoolId);
    if (!record) return res.status(404).json({ success: false, error: "Import not found" });

    const idx = record.transactions.findIndex((t) => t.id === transactionId);
    if (idx < 0) return res.status(404).json({ success: false, error: "Transaction not found" });

    const current = record.transactions[idx];
    if (current.reviewStatus === "posted") {
      return res.status(400).json({ success: false, error: "Posted transactions cannot be edited" });
    }

    const body = req.body || {};
    const next = { ...current };

    if (body.reviewStatus) {
      const status = String(body.reviewStatus) as BankTransactionRow["reviewStatus"];
      if (["pending", "accepted", "unmatched", "ignored"].includes(status)) {
        next.reviewStatus = status;
      }
    }

    if (body.suggestedAccountNo !== undefined) next.suggestedAccountNo = String(body.suggestedAccountNo).trim();
    if (body.suggestedLearnerId !== undefined) next.suggestedLearnerId = String(body.suggestedLearnerId).trim();
    if (body.suggestedLearnerName !== undefined) {
      next.suggestedLearnerName = String(body.suggestedLearnerName).trim();
    }

    if (body.expenseCategory !== undefined && current.direction === "out") {
      const cat = String(body.expenseCategory).trim() as ExpenseCategory;
      next.expenseCategory = (EXPENSE_CATEGORIES as readonly string[]).includes(cat) ? cat : "Other";
    }

    record.transactions[idx] = next;
    writeStore(store);

    return res.json({ success: true, transaction: next, import: record });
  } catch (error) {
    console.error("[banking] PATCH transaction failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

router.post("/imports/:id/post-payments", async (req, res) => {
  try {
    const importId = String(req.params.id || "").trim();
    const schoolId = String(req.body?.schoolId || "").trim();
    const transactionIds = Array.isArray(req.body?.transactionIds)
      ? (req.body.transactionIds as unknown[]).map((v) => String(v).trim()).filter(Boolean)
      : [];

    if (!schoolId) return res.status(400).json({ success: false, error: "Missing schoolId" });

    const store = ensureStore();
    const record = store.imports.find((r) => r.id === importId && r.schoolId === schoolId);
    if (!record) return res.status(404).json({ success: false, error: "Import not found" });

    if (!store.postedFingerprints[schoolId]) store.postedFingerprints[schoolId] = [];
    const postedSet = new Set(store.postedFingerprints[schoolId]);

    const posted: BillingLedgerEntry[] = [];
    const skipped: { transactionId: string; reason: string }[] = [];

    for (const txn of record.transactions) {
      if (transactionIds.length && !transactionIds.includes(txn.id)) continue;
      if (txn.direction !== "in" || txn.moneyIn <= 0) {
        skipped.push({ transactionId: txn.id, reason: "Not an incoming payment" });
        continue;
      }
      if (txn.reviewStatus !== "accepted") {
        skipped.push({ transactionId: txn.id, reason: "Transaction not accepted for posting" });
        continue;
      }
      if (txn.matchConfidence === "low" || txn.matchConfidence === "none") {
        skipped.push({ transactionId: txn.id, reason: "Low confidence match cannot be auto-posted" });
        continue;
      }
      if (!txn.suggestedLearnerId || !txn.suggestedAccountNo || txn.suggestedAccountNo === "-") {
        skipped.push({ transactionId: txn.id, reason: "Missing learner/account match" });
        continue;
      }
      if (postedSet.has(txn.fingerprint)) {
        skipped.push({ transactionId: txn.id, reason: "Duplicate bank transaction already posted" });
        continue;
      }

      const paymentId = newId("pay");
      const entry: BillingLedgerEntry = {
        id: paymentId,
        schoolId,
        learnerId: txn.suggestedLearnerId,
        accountNo: txn.suggestedAccountNo,
        type: "payment",
        amount: normaliseAmount(txn.moneyIn),
        date: txn.date,
        reference: txn.reference || txn.description.slice(0, 80),
        description: `Bank import: ${txn.description || "Payment"}`.trim(),
        method: "Bank Import",
        createdAt: new Date().toISOString(),
      };

      appendSchoolEntry(schoolId, entry);
      postedSet.add(txn.fingerprint);
      txn.reviewStatus = "posted";
      txn.postedPaymentId = paymentId;
      posted.push(entry);
    }

    store.postedFingerprints[schoolId] = Array.from(postedSet);
    writeStore(store);

    return res.json({
      success: true,
      postedCount: posted.length,
      skipped,
      ledgerEntries: posted,
      import: record,
    });
  } catch (error) {
    console.error("[banking] POST post-payments failed:", error);
    return res.status(500).json({ success: false, error: "Server error" });
  }
});

export default router;
