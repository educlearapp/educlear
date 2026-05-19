import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingCardLabel,
  accountingCardValue,
} from "../accounting/accountingTheme";
import { postBillingPaymentJournal } from "../accounting/accountingJournalEngine";
import { syncBillingLedgerFromApi } from "../billing/billingApi";
import {
  BILLING_UPDATED_EVENT,
  formatMoney,
  normaliseBillingAmount,
  notifyBillingUpdated,
  upsertSchoolEntries,
  type BillingLedgerEntry,
} from "../billing/billingLedger";
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import {
  BANKING_EXPENSE_CATEGORIES,
  canPostBankPaymentToBilling,
  confidenceColor,
  formatConfidence,
  hasSuggestedPaymentMatch,
  importSummary,
  isUnmatchedTxn,
  hasSuggestedSupplierInvoiceMatch,
  loadSuppliersForMatching,
  refreshSuppliersForMatching,
  matchStatusLabel,
  paginate,
  statusPillStyle,
  suggestedMatchLabel,
  txnType,
  type BankingTransactionType,
} from "./bankingReconciliationUtils";
import { addExpenseCandidateFromBank } from "../accounting/accountingExpenseStorage";
import SupplierInvoiceBankMatch from "../accounting/SupplierInvoiceBankMatch";
import {
  fetchBankImport,
  fetchBankImports,
  fetchBankingStats,
  importBankStatement,
  patchBankTransaction,
  postAcceptedBankPayments,
  type BankImportRecord,
  type BankingStats,
  type BankTransactionRow,
} from "./bankingApi";

const EXPENSE_CANDIDATES_UPDATED = "educlear-expense-candidates-updated";

type Props = {
  schoolId: string;
  learners: any[];
};

type TabId = "import" | "review" | "payments" | "expenses" | "unmatched" | "history";

const PAGE_SIZE = 10;
const GOLD = ACCOUNTING_GOLD;
const INK = ACCOUNTING_INK;

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: INK,
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 13,
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: INK,
  fontWeight: 700,
  fontSize: 12,
  cursor: "pointer",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
  fontSize: 13,
};

const th: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontSize: 11,
  fontWeight: 900,
  color: GOLD,
  background: INK,
  borderBottom: `2px solid ${GOLD}`,
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  verticalAlign: "top",
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "10px 16px",
  borderRadius: 10,
  border: active ? `2px solid ${GOLD}` : "1px solid #e2e8f0",
  background: active ? "linear-gradient(135deg, #f7d56a, #d4af37)" : "#fff",
  color: INK,
  fontWeight: active ? 900 : 700,
  cursor: "pointer",
  fontSize: 13,
});

function typeLabel(t: BankingTransactionType) {
  if (t === "payment") return "Payment";
  if (t === "expense") return "Expense";
  if (t === "transfer") return "Transfer";
  return "Ignore";
}

function PaginationBar({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  if (total <= PAGE_SIZE) return null;
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
      <button type="button" style={ghostBtn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#64748b" }}>
        Page {page} of {totalPages} · {total} row(s)
      </span>
      <button type="button" style={ghostBtn} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}

export default function BankStatementImport({ schoolId, learners }: Props) {
  const [imports, setImports] = useState<BankImportRecord[]>([]);
  const [activeImport, setActiveImport] = useState<BankImportRecord | null>(null);
  const [tab, setTab] = useState<TabId>("import");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accountingNote, setAccountingNote] = useState(
    "Accepted banking expense candidates are sent to Accounting → Expenses review queue."
  );

  const [reviewPage, setReviewPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [expensesPage, setExpensesPage] = useState(1);
  const [unmatchedPage, setUnmatchedPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);

  const [typeModal, setTypeModal] = useState<BankTransactionRow | null>(null);
  const [editModal, setEditModal] = useState<BankTransactionRow | null>(null);
  const [draftType, setDraftType] = useState<BankingTransactionType>("payment");
  const [draftLearnerId, setDraftLearnerId] = useState("");
  const [draftSupplier, setDraftSupplier] = useState("");
  const [draftCategory, setDraftCategory] = useState("Other");
  const [draftNotes, setDraftNotes] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [learnerSearch, setLearnerSearch] = useState("");
  const [supplierMatchTxn, setSupplierMatchTxn] = useState<BankTransactionRow | null>(null);

  const learnerOptions = useMemo(() => {
    return (learners || []).map((l) => ({
      id: String(l?.id || l?.learnerId || "").trim(),
      name: `${l?.firstName || ""} ${l?.lastName || l?.surname || ""}`.trim(),
      accountNo: getLearnerAccountNo(l),
      familyAccountId: String(
        l?.familyAccountId || l?.familyAccount?.id || ""
      ).trim(),
    }));
  }, [learners]);

  const filteredLearnerOptions = useMemo(() => {
    const q = learnerSearch.trim().toLowerCase();
    if (!q) return learnerOptions;
    return learnerOptions.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.accountNo.toLowerCase().includes(q) ||
        l.id.toLowerCase().includes(q)
    );
  }, [learnerOptions, learnerSearch]);

  const [stats, setStats] = useState<BankingStats>({
    imports: 0,
    matchedPayments: 0,
    suggestedPayments: 0,
    expenseCandidates: 0,
    unmatched: 0,
    duplicateLines: 0,
    readyToPost: 0,
  });

  const refreshStats = useCallback(async (importId?: string) => {
    if (!schoolId) return;
    try {
      const res = await fetchBankingStats(schoolId, importId);
      setStats(res.stats);
    } catch {
      /* stats are non-blocking */
    }
  }, [schoolId]);

  const loadImports = useCallback(async () => {
    if (!schoolId) return;
    try {
      const res = await fetchBankImports(schoolId);
      setImports(res.imports || []);
    } catch (e: any) {
      setError(e?.message || "Failed to load imports");
    }
  }, [schoolId]);

  useEffect(() => {
    loadImports();
  }, [loadImports]);

  useEffect(() => {
    void refreshStats(activeImport?.id);
  }, [activeImport?.id, refreshStats]);

  const refreshActive = async (importId: string) => {
    if (!schoolId) return;
    const res = await fetchBankImport(schoolId, importId);
    setActiveImport(res.import);
    setAccountingNote(
      res.accountingNote ||
        "Accepted banking expense candidates are sent to Accounting → Expenses review queue."
    );
    setImports((prev) => {
      const next = prev.filter((r) => r.id !== importId);
      return [res.import, ...next];
    });
  };

  const handleUpload = async (file: File | null) => {
    if (!file || !schoolId) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const suppliers = await refreshSuppliersForMatching(schoolId);
      const res = await importBankStatement(schoolId, file, suppliers);
      setActiveImport(res.import);
      setAccountingNote(res.accountingNote);
      setMessage(`Parsed ${res.import.transactions.length} transaction(s) from ${res.import.format.toUpperCase()}.`);
      setTab("review");
      setReviewPage(1);
      await loadImports();
      await refreshStats(res.import.id);
    } catch (e: any) {
      setError(e?.message || "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const mergePatchedImport = (
    importRecord: BankImportRecord,
    transaction: BankTransactionRow
  ): BankImportRecord => ({
    ...importRecord,
    transactions: importRecord.transactions.map((row) =>
      row.id === transaction.id ? transaction : row
    ),
  });

  const patchTxn = async (
    txn: BankTransactionRow,
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    if (!schoolId) {
      const msg = "Missing school — cannot update this bank transaction.";
      console.error("[banking] patchTxn:", msg);
      setError(msg);
      return false;
    }
    if (!activeImport) {
      const msg = "No import selected — open an import from Import or History before accepting.";
      console.error("[banking] patchTxn:", msg);
      setError(msg);
      return false;
    }

    setLoading(true);
    setError("");
    try {
      const res = await patchBankTransaction(schoolId, activeImport.id, txn.id, payload);
      const updatedTxn = res.transaction;
      const nextImport = res.import
        ? updatedTxn
          ? mergePatchedImport(res.import, updatedTxn)
          : res.import
        : updatedTxn
          ? mergePatchedImport(activeImport, updatedTxn)
          : null;

      if (!nextImport) {
        throw new Error("Server did not return the updated import.");
      }

      setActiveImport(nextImport);
      setImports((prev) => prev.map((imp) => (imp.id === nextImport.id ? nextImport : imp)));
      setMessage(
        updatedTxn?.reviewStatus === "accepted"
          ? "Match accepted — ready to post when confidence is 50+."
          : updatedTxn?.reviewStatus === "unmatched"
            ? "Match rejected."
            : updatedTxn?.reviewStatus === "ignored"
              ? "Transaction ignored."
              : "Transaction updated."
      );
      await refreshStats(nextImport.id);
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Update failed";
      console.log("PATCH FAILED", { transactionId: txn.id, error: msg });
      setError(msg.includes("fetch") ? `${msg} — check network/CORS or API URL.` : msg);
      return false;
    } finally {
      setLoading(false);
    }
  };

  const acceptMatchTxn = async (txn: BankTransactionRow) => {
    console.log("ACCEPT CLICKED", txn.id);
    await patchTxn(txn, { matchAction: "accept", reviewStatus: "accepted" });
  };

  const rejectMatchTxn = async (txn: BankTransactionRow) => {
    await patchTxn(txn, { matchAction: "reject" });
  };

  const acceptTxn = async (txn: BankTransactionRow) => {
    console.log("ACCEPT CLICKED", txn.id);
    const type = txnType(txn);
    if (type === "expense") {
      if (!activeImport || !schoolId) return;
      setLoading(true);
      setError("");
      try {
        const res = await patchBankTransaction(schoolId, activeImport.id, txn.id, {
          reviewStatus: "accepted",
          transactionType: "expense",
        });
        setActiveImport(res.import);
        await refreshStats(res.import.id);
        const updated =
          res.import.transactions.find((t) => t.id === txn.id) ||
          ({ ...txn, reviewStatus: "accepted" as const, transactionType: "expense" as const });
        const addResult = addExpenseCandidateFromBank(schoolId, activeImport.id, updated);
        window.dispatchEvent(new CustomEvent(EXPENSE_CANDIDATES_UPDATED));
        if (addResult === "duplicate") {
          setMessage("Duplicate — this bank line is already in Accounting → Expenses review queue.");
        } else {
          setMessage("Sent to Accounting → Expenses review queue.");
        }
      } catch (e: any) {
        setError(e?.message || "Failed to accept expense");
      } finally {
        setLoading(false);
      }
      return;
    }
    if (type === "ignore" || type === "transfer") {
      await patchTxn(txn, { reviewStatus: "accepted", transactionType: type });
      return;
    }
    await patchTxn(txn, {
      matchAction: "accept",
      reviewStatus: "accepted",
      transactionType: "payment",
    });
  };

  const ignoreTxn = async (txn: BankTransactionRow) => {
    await patchTxn(txn, { reviewStatus: "ignored", transactionType: "ignore" });
  };

  const openTypeModal = (txn: BankTransactionRow) => {
    setTypeModal(txn);
    setDraftType(txnType(txn));
  };

  const saveTypeModal = () => {
    if (!typeModal) return;
    const payload: Record<string, unknown> = { transactionType: draftType };
    if (draftType === "ignore") payload.reviewStatus = "ignored";
    void patchTxn(typeModal, payload).then(() => setTypeModal(null));
  };

  const openEditModal = (txn: BankTransactionRow) => {
    setEditModal(txn);
    setDraftLearnerId(txn.suggestedLearnerId || "");
    setLearnerSearch("");
    setDraftSupplier(txn.suggestedSupplierName || "");
    setDraftCategory(txn.expenseCategory || "Other");
    setDraftNotes(txn.expenseNotes || "");
    setDraftDescription(txn.description || "");
  };

  const saveEditModal = () => {
    if (!editModal) return;
    const type = txnType(editModal);
    if (type === "payment") {
      const learner = learnerOptions.find((l) => l.id === draftLearnerId);
      if (!learner) {
        setError("Select a learner account for payment matching.");
        return;
      }
      void patchTxn(editModal, {
        suggestedAccountId: learner.familyAccountId,
        suggestedLearnerId: learner.id,
        suggestedLearnerName: learner.name,
        suggestedAccountNo: learner.accountNo,
        confidenceScore: 100,
        matchReason: "Manually selected by admin",
        reviewStatus: "accepted",
        transactionType: "payment",
      }).then(() => setEditModal(null));
      return;
    }
    void patchTxn(editModal, {
      suggestedSupplierName: draftSupplier,
      expenseCategory: draftCategory,
      expenseNotes: draftNotes,
      description: draftDescription,
      transactionType: "expense",
    }).then(() => setEditModal(null));
  };

  const postAccepted = async () => {
    console.log("POST PAYMENTS CLICKED");
    if (!activeImport || !schoolId) {
      setError("No import selected — open an import before posting payments.");
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const acceptedIds = activeImport.transactions.filter(canPostBankPaymentToBilling).map((t) => t.id);

      if (!acceptedIds.length) {
        setError("No accepted incoming payments ready to post. Accept matches first (confidence 50+).");
        return;
      }

      const res = await postAcceptedBankPayments(schoolId, activeImport.id, acceptedIds);
      const entries = (res.ledgerEntries || []) as BillingLedgerEntry[];
      if (entries.length) {
        upsertSchoolEntries(schoolId, entries);
        for (const entry of entries) {
          postBillingPaymentJournal({
            schoolId,
            sourceId: entry.id,
            amount: normaliseBillingAmount(entry.amount),
            date: entry.date,
            accountNo: entry.accountNo,
            reference: entry.reference || "Bank Import",
            createdBy: "Banking",
          });
        }
        notifyBillingUpdated();
        window.dispatchEvent(new CustomEvent(BILLING_UPDATED_EVENT));
      }
      await syncBillingLedgerFromApi(schoolId).catch(() => {});
      await refreshActive(activeImport.id);
      await refreshStats(activeImport.id);
      const skippedCount = res.skipped?.length || 0;
      setMessage(
        `Posted ${res.postedCount} payment(s) to Billing.${skippedCount ? ` Skipped ${skippedCount}.` : ""}`
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Post payments failed";
      console.log("POST PAYMENTS FAILED", msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const allTxns = activeImport?.transactions || [];
  const paymentRows = allTxns.filter((t) => t.direction === "in" && txnType(t) === "payment");
  const expenseRows = allTxns.filter((t) => t.direction === "out" && txnType(t) === "expense");
  const unmatchedRows = allTxns.filter(isUnmatchedTxn);

  const reviewPaged = paginate(allTxns, reviewPage, PAGE_SIZE);
  const paymentsPaged = paginate(paymentRows, paymentsPage, PAGE_SIZE);
  const expensesPaged = paginate(expenseRows, expensesPage, PAGE_SIZE);
  const unmatchedPaged = paginate(unmatchedRows, unmatchedPage, PAGE_SIZE);
  const historyPaged = paginate(imports, historyPage, PAGE_SIZE);

  const renderActions = (txn: BankTransactionRow) => {
    const showPaymentMatchActions =
      txn.direction === "in" &&
      txnType(txn) === "payment" &&
      hasSuggestedPaymentMatch(txn) &&
      txn.reviewStatus !== "posted";

    return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 140 }}>
      {showPaymentMatchActions ? (
        <>
          <button
            type="button"
            style={goldBtn}
            disabled={loading}
            onClick={() => void acceptMatchTxn(txn)}
          >
            Accept Match
          </button>
          <button
            type="button"
            style={ghostBtn}
            disabled={loading}
            onClick={() => void rejectMatchTxn(txn)}
          >
            Reject Match
          </button>
        </>
      ) : null}
      {txn.moneyOut > 0 && hasSuggestedSupplierInvoiceMatch(txn) ? (
        <>
          <button
            type="button"
            style={goldBtn}
            disabled={loading}
            onClick={async () => {
              const { acceptBankSupplierMatch, mergeJournalsIntoLocalStore } = await import(
                "../accounting/accountingSuppliersApi"
              );
              try {
                const res = await acceptBankSupplierMatch({
                  schoolId,
                  invoiceId: txn.suggestedInvoiceId!,
                  bankTransactionId: txn.id,
                  amount: txn.moneyOut,
                  paymentDate: txn.date,
                  reference: txn.reference || txn.description,
                });
                if (res.journal) mergeJournalsIntoLocalStore(schoolId, [res.journal]);
                await patchTxn(txn, {
                  reviewStatus: "posted",
                  transactionType: "expense",
                  matchReason: "Supplier invoice matched",
                });
                setMessage("Supplier match accepted.");
              } catch (e: unknown) {
                setError(e instanceof Error ? e.message : "Supplier match failed");
              }
            }}
          >
            Accept Supplier Match
          </button>
          <button
            type="button"
            style={ghostBtn}
            disabled={loading}
            onClick={() =>
              void patchTxn(txn, {
                suggestedInvoiceId: "",
                invoiceMatchScore: 0,
                matchReason: "Supplier match rejected",
              })
            }
          >
            Reject Match
          </button>
        </>
      ) : null}
      {txn.moneyOut > 0 ? (
        <button
          type="button"
          style={ghostBtn}
          disabled={loading || txn.reviewStatus === "posted"}
          onClick={() => setSupplierMatchTxn(txn)}
        >
          {hasSuggestedSupplierInvoiceMatch(txn) ? "Change supplier" : "Match supplier invoice"}
        </button>
      ) : null}
      <button
        type="button"
        style={ghostBtn}
        disabled={loading || txn.reviewStatus === "posted"}
        onClick={() => void acceptTxn(txn)}
      >
        Accept
      </button>
      <button type="button" style={ghostBtn} disabled={loading || txn.reviewStatus === "posted"} onClick={() => openTypeModal(txn)}>
        Change Type
      </button>
      <button type="button" style={ghostBtn} disabled={loading || txn.reviewStatus === "posted"} onClick={() => openEditModal(txn)}>
        Change Account/Category
      </button>
      <button
        type="button"
        style={ghostBtn}
        disabled={loading || txn.reviewStatus === "posted"}
        onClick={() => void ignoreTxn(txn)}
      >
        Ignore
      </button>
    </div>
    );
  };

  const renderReconciliationTable = (rows: BankTransactionRow[]) => (
    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, background: "#fff" }}>
      <thead>
        <tr>
          {[
            "Date",
            "Description",
            "Amount In",
            "Amount Out",
            "Suggested Match",
            "Confidence",
            "Type",
            "Status",
            "Actions",
          ].map((h) => (
            <th key={h} style={th}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={9} style={{ ...td, textAlign: "center", color: "#64748b" }}>
              No transactions to show.
            </td>
          </tr>
        ) : (
          rows.map((txn) => (
            <tr key={txn.id} style={txn.isDuplicate ? { background: "#fffbeb" } : undefined}>
              <td style={td}>{txn.date}</td>
              <td style={td}>
                {txn.description}
                {txn.isDuplicate ? (
                  <div style={{ fontSize: 11, color: "#b45309", fontWeight: 800 }}>Duplicate line</div>
                ) : null}
              </td>
              <td style={td}>{txn.moneyIn > 0 ? formatMoney(txn.moneyIn) : "-"}</td>
              <td style={td}>{txn.moneyOut > 0 ? formatMoney(txn.moneyOut) : "-"}</td>
              <td style={td}>
                <div style={{ fontWeight: 800 }}>{suggestedMatchLabel(txn)}</div>
                {txn.matchReason ? (
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>{txn.matchReason}</div>
                ) : null}
              </td>
              <td style={{ ...td, color: confidenceColor(txn.matchConfidence), fontWeight: 800 }}>
                {formatConfidence(txn)}
              </td>
              <td style={td}>{typeLabel(txnType(txn))}</td>
              <td style={td}>
                <span style={statusPillStyle(matchStatusLabel(txn))}>{matchStatusLabel(txn)}</span>
                {txn.reviewStatus === "posted" && txn.postedPaymentId ? (
                  <span
                    style={{ fontSize: 11, color: "#166534", fontWeight: 700, marginTop: 4, display: "block" }}
                  >
                    Billing payment {txn.postedPaymentId}
                  </span>
                ) : null}
              </td>
              <td style={td}>{renderActions(txn)}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );

  return (
    <div style={{ padding: "8px 32px 40px", maxWidth: 1400 }}>
      {error ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div style={{ marginBottom: 14, padding: 12, borderRadius: 10, background: "#ecfdf5", color: "#166534", fontWeight: 700 }}>
          {message}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 20,
        }}
      >
        {[
          { label: "Imports", value: stats.imports },
          { label: "Matched Payments", value: stats.matchedPayments },
          { label: "Suggested Matches", value: stats.suggestedPayments ?? 0 },
          { label: "Expense Candidates", value: stats.expenseCandidates },
          { label: "Unmatched Lines", value: stats.unmatched },
          { label: "Duplicate Lines", value: stats.duplicateLines },
          { label: "Ready to Post", value: stats.readyToPost },
        ].map((card) => (
          <div key={card.label} style={accountingCard}>
            <div style={accountingCardLabel}>{card.label}</div>
            <div style={accountingCardValue}>{card.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {(
          [
            ["import", "Import Statement"],
            ["review", "Reconciliation Review"],
            ["payments", "Payment Matches"],
            ["expenses", "Expense Matches"],
            ["unmatched", "Unmatched"],
            ["history", "Import History"],
          ] as [TabId, string][]
        ).map(([id, label]) => (
          <button key={id} type="button" style={tabBtn(tab === id)} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "import" && (
        <div style={{ ...accountingCard, marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, color: INK }}>Upload bank statement</h3>
          <p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>
            CSV or OFX · incoming payments post to Billing when you accept and post · duplicate protection enabled
          </p>
          <input
            type="file"
            accept=".csv,.ofx,.qfx,text/csv,application/vnd.ms-excel"
            disabled={loading || !schoolId}
            onChange={(e) => handleUpload(e.target.files?.[0] || null)}
          />
          {imports.length ? (
            <div style={{ marginTop: 16 }}>
              <label style={{ fontWeight: 800, fontSize: 13 }}>Open import</label>
              <select
                style={{ ...fieldStyle, maxWidth: 480, marginTop: 6 }}
                value={activeImport?.id || ""}
                onChange={async (e) => {
                  const id = e.target.value;
                  if (!id) {
                    setActiveImport(null);
                    return;
                  }
                  setLoading(true);
                  try {
                    await refreshActive(id);
                    setTab("review");
                  } catch (err: any) {
                    setError(err?.message || "Failed to load import");
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <option value="">Select import…</option>
                {imports.map((imp) => (
                  <option key={imp.id} value={imp.id}>
                    {imp.fileName} · {imp.importedAt.slice(0, 10)}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {activeImport ? (
            <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                style={goldBtn}
                onClick={() => void postAccepted()}
                disabled={loading || stats.readyToPost === 0}
              >
                Post accepted payments to Billing
              </button>
              <span style={{ color: "#64748b", fontWeight: 700, alignSelf: "center" }}>
                {stats.readyToPost} ready · uses same ledger as Payments
              </span>
            </div>
          ) : null}
        </div>
      )}

      {tab === "review" && (
        <div>
          {!activeImport ? (
            <p style={{ color: "#64748b", fontWeight: 700 }}>Upload or select an import to review transactions.</p>
          ) : (
            <>
              <p style={{ color: "#64748b", fontSize: 13, fontWeight: 600 }}>
                {activeImport.fileName} · {allTxns.length} line(s)
              </p>
              <div style={{ overflowX: "auto" }}>{renderReconciliationTable(reviewPaged.rows)}</div>
              <PaginationBar
                page={reviewPaged.page}
                totalPages={reviewPaged.totalPages}
                total={reviewPaged.total}
                onPage={setReviewPage}
              />
            </>
          )}
        </div>
      )}

      {tab === "payments" && (
        <div>
          {!activeImport ? (
            <p style={{ color: "#64748b", fontWeight: 700 }}>No active import.</p>
          ) : (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={goldBtn}
                  onClick={() => void postAccepted()}
                  disabled={loading || stats.readyToPost === 0}
                >
                  Post accepted to Billing
                </button>
              </div>
              <div style={{ overflowX: "auto" }}>{renderReconciliationTable(paymentsPaged.rows)}</div>
              <PaginationBar
                page={paymentsPaged.page}
                totalPages={paymentsPaged.totalPages}
                total={paymentsPaged.total}
                onPage={setPaymentsPage}
              />
            </>
          )}
        </div>
      )}

      {tab === "expenses" && (
        <div>
          {!activeImport ? (
            <p style={{ color: "#64748b", fontWeight: 700 }}>No active import.</p>
          ) : (
            <>
              <p style={{ color: "#92400e", fontWeight: 700, fontSize: 13, marginBottom: 12 }}>{accountingNote}</p>
              <div style={{ overflowX: "auto" }}>{renderReconciliationTable(expensesPaged.rows)}</div>
              <PaginationBar
                page={expensesPaged.page}
                totalPages={expensesPaged.totalPages}
                total={expensesPaged.total}
                onPage={setExpensesPage}
              />
            </>
          )}
        </div>
      )}

      {tab === "unmatched" && (
        <div>
          {!activeImport ? (
            <p style={{ color: "#64748b", fontWeight: 700 }}>No active import.</p>
          ) : (
            <>
              <div style={{ overflowX: "auto" }}>{renderReconciliationTable(unmatchedPaged.rows)}</div>
              <PaginationBar
                page={unmatchedPaged.page}
                totalPages={unmatchedPaged.totalPages}
                total={unmatchedPaged.total}
                onPage={setUnmatchedPage}
              />
            </>
          )}
        </div>
      )}

      {tab === "history" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, background: "#fff" }}>
            <thead>
              <tr>
                {["Date", "File", "Transactions", "Payments matched", "Expenses matched", "Unmatched", "Status", "Actions"].map(
                  (h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {historyPaged.rows.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                    No imports yet.
                  </td>
                </tr>
              ) : (
                historyPaged.rows.map((imp) => {
                  const sum = importSummary(imp);
                  return (
                    <tr key={imp.id}>
                      <td style={td}>{imp.importedAt.slice(0, 10)}</td>
                      <td style={td}>{imp.fileName}</td>
                      <td style={td}>{imp.transactions.length}</td>
                      <td style={td}>{sum.paymentsMatched}</td>
                      <td style={td}>{sum.expensesMatched}</td>
                      <td style={td}>{sum.unmatched}</td>
                      <td style={td}>
                        <span style={statusPillStyle(sum.status.toLowerCase())}>{sum.status}</span>
                      </td>
                      <td style={td}>
                        <button
                          type="button"
                          style={ghostBtn}
                          onClick={async () => {
                            setLoading(true);
                            try {
                              await refreshActive(imp.id);
                              setTab("review");
                            } catch (err: any) {
                              setError(err?.message || "Failed to open import");
                            } finally {
                              setLoading(false);
                            }
                          }}
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <PaginationBar
            page={historyPaged.page}
            totalPages={historyPaged.totalPages}
            total={historyPaged.total}
            onPage={setHistoryPage}
          />
        </div>
      )}

      {typeModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 6000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div style={{ ...accountingCard, width: "min(420px, 100%)" }}>
            <h3 style={{ marginTop: 0 }}>Change transaction type</h3>
            <select style={fieldStyle} value={draftType} onChange={(e) => setDraftType(e.target.value as BankingTransactionType)}>
              <option value="payment">Payment</option>
              <option value="expense">Expense</option>
              <option value="transfer">Transfer</option>
              <option value="ignore">Ignore</option>
            </select>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button type="button" style={goldBtn} onClick={saveTypeModal}>
                Save
              </button>
              <button type="button" style={ghostBtn} onClick={() => setTypeModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editModal ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15,23,42,0.55)",
            zIndex: 6000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 20,
          }}
        >
          <div style={{ ...accountingCard, width: "min(480px, 100%)" }}>
            <h3 style={{ marginTop: 0 }}>
              {txnType(editModal) === "payment" ? "Change payment account" : "Change expense details"}
            </h3>
            {txnType(editModal) === "payment" ? (
              <>
                <input
                  style={{ ...fieldStyle, marginBottom: 8 }}
                  placeholder="Search account, learner name…"
                  value={learnerSearch}
                  onChange={(e) => setLearnerSearch(e.target.value)}
                />
                <select style={fieldStyle} value={draftLearnerId} onChange={(e) => setDraftLearnerId(e.target.value)}>
                  <option value="">Select learner account…</option>
                  {filteredLearnerOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.accountNo} — {l.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label style={{ fontWeight: 800, fontSize: 12 }}>Supplier</label>
                <input style={fieldStyle} value={draftSupplier} onChange={(e) => setDraftSupplier(e.target.value)} />
                <label style={{ fontWeight: 800, fontSize: 12, marginTop: 10, display: "block" }}>Category</label>
                <select style={fieldStyle} value={draftCategory} onChange={(e) => setDraftCategory(e.target.value)}>
                  {BANKING_EXPENSE_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <label style={{ fontWeight: 800, fontSize: 12, marginTop: 10, display: "block" }}>Description</label>
                <input style={fieldStyle} value={draftDescription} onChange={(e) => setDraftDescription(e.target.value)} />
                <label style={{ fontWeight: 800, fontSize: 12, marginTop: 10, display: "block" }}>Notes</label>
                <textarea style={{ ...fieldStyle, minHeight: 72 }} value={draftNotes} onChange={(e) => setDraftNotes(e.target.value)} />
              </>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button type="button" style={goldBtn} onClick={saveEditModal}>
                Save
              </button>
              <button type="button" style={ghostBtn} onClick={() => setEditModal(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {supplierMatchTxn && schoolId ? (
        <SupplierInvoiceBankMatch
          schoolId={schoolId}
          bankTransactionId={supplierMatchTxn.id}
          date={supplierMatchTxn.date}
          description={supplierMatchTxn.description}
          amount={supplierMatchTxn.moneyOut}
          reference={supplierMatchTxn.reference}
          suggestedInvoiceId={supplierMatchTxn.suggestedInvoiceId}
          onClose={() => setSupplierMatchTxn(null)}
          onMatched={async () => {
            setSupplierMatchTxn(null);
            setMessage("Supplier invoice matched and bank line reconciled.");
            if (activeImport) await loadImports();
            await refreshStats(activeImport?.id);
          }}
        />
      ) : null}
    </div>
  );
}
