import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  BILLING_UPDATED_EVENT,
  formatMoney,
  notifyBillingUpdated,
  upsertSchoolEntries,
  type BillingLedgerEntry,
} from "../billing/billingLedger";
import { getLearnerAccountNo } from "../learner/learnerIdentity";
import {
  EXPENSE_CATEGORIES,
  fetchBankImport,
  fetchBankImports,
  importBankStatement,
  patchBankTransaction,
  postAcceptedBankPayments,
  type BankImportRecord,
  type BankTransactionRow,
} from "./bankingApi";

type Props = {
  schoolId: string;
  learners: any[];
};

const GOLD = "#d4af37";
const INK = "#111827";

const pageWrap: React.CSSProperties = {
  padding: 24,
  maxWidth: 1400,
};

const goldBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: INK,
  fontWeight: 900,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "10px 18px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: INK,
  fontWeight: 800,
  cursor: "pointer",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
};

const th: React.CSSProperties = {
  padding: 12,
  textAlign: "left",
  fontSize: 12,
  fontWeight: 900,
  borderBottom: `2px solid ${GOLD}`,
};

const td: React.CSSProperties = {
  padding: 12,
  borderBottom: "1px solid #f1f5f9",
  fontSize: 13,
  verticalAlign: "top",
};

function confidenceColor(c: string) {
  if (c === "high") return "#15803d";
  if (c === "medium") return "#92400e";
  if (c === "low") return "#b45309";
  return "#64748b";
}

export default function BankStatementImport({ schoolId, learners }: Props) {
  const [imports, setImports] = useState<BankImportRecord[]>([]);
  const [activeImport, setActiveImport] = useState<BankImportRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [accountingNote, setAccountingNote] = useState("Accounting module integration pending");

  const learnerOptions = useMemo(() => {
    return (learners || []).map((l) => ({
      id: String(l?.id || l?.learnerId || "").trim(),
      name: `${l?.firstName || ""} ${l?.lastName || l?.surname || ""}`.trim(),
      accountNo: getLearnerAccountNo(l),
    }));
  }, [learners]);

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

  const refreshActive = async (importId: string) => {
    if (!schoolId) return;
    const res = await fetchBankImport(schoolId, importId);
    setActiveImport(res.import);
    setAccountingNote(res.accountingNote || "Accounting module integration pending");
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
      const res = await importBankStatement(schoolId, file);
      setActiveImport(res.import);
      setAccountingNote(res.accountingNote);
      setMessage(`Parsed ${res.import.transactions.length} transaction(s) from ${res.import.format.toUpperCase()}.`);
      await loadImports();
    } catch (e: any) {
      setError(e?.message || "Import failed");
    } finally {
      setLoading(false);
    }
  };

  const patchTxn = async (txn: BankTransactionRow, payload: Record<string, unknown>) => {
    if (!activeImport || !schoolId) return;
    setLoading(true);
    setError("");
    try {
      const res = await patchBankTransaction(schoolId, activeImport.id, txn.id, payload);
      setActiveImport(res.import);
      setMessage("Transaction updated.");
    } catch (e: any) {
      setError(e?.message || "Update failed");
    } finally {
      setLoading(false);
    }
  };

  const acceptTxn = (txn: BankTransactionRow) => patchTxn(txn, { reviewStatus: "accepted" });
  const ignoreTxn = (txn: BankTransactionRow) => patchTxn(txn, { reviewStatus: "ignored" });
  const unmatchedTxn = (txn: BankTransactionRow) => patchTxn(txn, { reviewStatus: "unmatched" });

  const changeAccount = (txn: BankTransactionRow, learnerId: string) => {
    const learner = learnerOptions.find((l) => l.id === learnerId);
    if (!learner) return;
    patchTxn(txn, {
      suggestedLearnerId: learner.id,
      suggestedLearnerName: learner.name,
      suggestedAccountNo: learner.accountNo,
      reviewStatus: "accepted",
    });
  };

  const postAccepted = async () => {
    if (!activeImport || !schoolId) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const acceptedIds = activeImport.transactions
        .filter(
          (t) =>
            t.direction === "in" &&
            t.reviewStatus === "accepted" &&
            t.matchConfidence !== "low" &&
            t.matchConfidence !== "none"
        )
        .map((t) => t.id);

      if (!acceptedIds.length) {
        setError("No accepted incoming payments with sufficient match confidence to post.");
        return;
      }

      const res = await postAcceptedBankPayments(schoolId, activeImport.id, acceptedIds);
      const entries = (res.ledgerEntries || []) as BillingLedgerEntry[];
      if (entries.length) {
        upsertSchoolEntries(schoolId, entries);
        notifyBillingUpdated();
        window.dispatchEvent(new CustomEvent(BILLING_UPDATED_EVENT));
      }
      await refreshActive(activeImport.id);
      setMessage(
        `Posted ${res.postedCount} payment(s) to the unified ledger.${
          res.skipped?.length ? ` Skipped ${res.skipped.length}.` : ""
        }`
      );
    } catch (e: any) {
      setError(e?.message || "Post payments failed");
    } finally {
      setLoading(false);
    }
  };

  const incoming = activeImport?.transactions.filter((t) => t.direction === "in") || [];
  const expenses = activeImport?.transactions.filter((t) => t.direction === "out") || [];

  return (
    <div style={pageWrap}>
      <div style={{ marginBottom: 18 }}>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: "#0f172a" }}>Bank Statement Import</h1>
        <p style={{ margin: "6px 0 0", color: "#64748b", fontWeight: 700 }}>
          Upload CSV or OFX bank statements · match incoming payments to learner accounts
        </p>
      </div>

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
          padding: 20,
          borderRadius: 12,
          border: `2px solid ${GOLD}`,
          background: "#fff",
          marginBottom: 20,
        }}
      >
        <h3 style={{ marginTop: 0 }}>1. Upload bank statement</h3>
        <p style={{ color: "#64748b", fontSize: 13 }}>
          Supported: CSV, OFX. PDF is not parsed yet (placeholder only).
        </p>
        <input
          type="file"
          accept=".csv,.ofx,.qfx,text/csv,application/vnd.ms-excel"
          disabled={loading || !schoolId}
          onChange={(e) => handleUpload(e.target.files?.[0] || null)}
        />
        {imports.length ? (
          <div style={{ marginTop: 16 }}>
            <label style={{ fontWeight: 800, fontSize: 13 }}>Recent imports</label>
            <select
              style={{ ...fieldStyle, maxWidth: 420, marginTop: 6 }}
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
                  {imp.fileName} · {imp.importedAt.slice(0, 10)} · {imp.transactions.length} lines
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>

      {activeImport ? (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
            <button type="button" style={goldBtn} onClick={postAccepted} disabled={loading}>
              Post accepted payments
            </button>
            <span style={{ color: "#64748b", fontWeight: 700, alignSelf: "center" }}>
              {incoming.filter((t) => t.reviewStatus === "accepted").length} accepted incoming ·{" "}
              {expenses.length} expense candidate(s)
            </span>
          </div>

          <h3>2. Review incoming payments</h3>
          <div style={{ overflowX: "auto", marginBottom: 28 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, background: "#fff" }}>
              <thead>
                <tr>
                  {[
                    "Date",
                    "Description",
                    "Reference",
                    "Money In",
                    "Suggested Account",
                    "Suggested Learner",
                    "Confidence",
                    "Action",
                  ].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {incoming.length === 0 ? (
                  <tr>
                    <td colSpan={8} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                      No incoming transactions in this file.
                    </td>
                  </tr>
                ) : (
                  incoming.map((txn) => (
                    <tr key={txn.id}>
                      <td style={td}>{txn.date}</td>
                      <td style={td}>{txn.description}</td>
                      <td style={td}>{txn.reference || "-"}</td>
                      <td style={td}>{formatMoney(txn.moneyIn)}</td>
                      <td style={td}>{txn.suggestedAccountNo || "-"}</td>
                      <td style={td}>{txn.suggestedLearnerName || "-"}</td>
                      <td style={{ ...td, color: confidenceColor(txn.matchConfidence), fontWeight: 800 }}>
                        {txn.matchConfidence}
                        {txn.matchReason ? (
                          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>{txn.matchReason}</div>
                        ) : null}
                      </td>
                      <td style={td}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 160 }}>
                          <select
                            style={fieldStyle}
                            value={txn.suggestedLearnerId || ""}
                            disabled={txn.reviewStatus === "posted"}
                            onChange={(e) => changeAccount(txn, e.target.value)}
                          >
                            <option value="">Change account…</option>
                            {learnerOptions.map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.accountNo} — {l.name}
                              </option>
                            ))}
                          </select>
                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            <button type="button" style={ghostBtn} disabled={loading || txn.reviewStatus === "posted"} onClick={() => acceptTxn(txn)}>
                              Accept
                            </button>
                            <button type="button" style={ghostBtn} disabled={loading || txn.reviewStatus === "posted"} onClick={() => unmatchedTxn(txn)}>
                              Unmatched
                            </button>
                            <button type="button" style={ghostBtn} disabled={loading || txn.reviewStatus === "posted"} onClick={() => ignoreTxn(txn)}>
                              Ignore
                            </button>
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 800, color: txn.reviewStatus === "posted" ? "#15803d" : "#64748b" }}>
                            {txn.reviewStatus}
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h3>3. Expense candidates (not posted to billing)</h3>
          <p style={{ color: "#92400e", fontWeight: 700, fontSize: 13 }}>{accountingNote}</p>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900, background: "#fff" }}>
              <thead>
                <tr>
                  {["Date", "Description", "Reference", "Money Out", "Category", "Status", "Action"].map((h) => (
                    <th key={h} style={th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {expenses.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ ...td, textAlign: "center", color: "#64748b" }}>
                      No outgoing transactions detected.
                    </td>
                  </tr>
                ) : (
                  expenses.map((txn) => (
                    <tr key={txn.id}>
                      <td style={td}>{txn.date}</td>
                      <td style={td}>{txn.description}</td>
                      <td style={td}>{txn.reference || "-"}</td>
                      <td style={td}>{formatMoney(txn.moneyOut)}</td>
                      <td style={td}>
                        <select
                          style={fieldStyle}
                          value={txn.expenseCategory || "Other"}
                          onChange={(e) => patchTxn(txn, { expenseCategory: e.target.value })}
                        >
                          {EXPENSE_CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td style={td}>{txn.reviewStatus}</td>
                      <td style={td}>
                        <button type="button" style={ghostBtn} onClick={() => ignoreTxn(txn)}>
                          Ignore
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p style={{ color: "#64748b", fontWeight: 700 }}>Upload a statement to begin review.</p>
      )}
    </div>
  );
}
