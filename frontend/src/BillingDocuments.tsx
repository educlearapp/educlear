import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "./api";
import { useSchoolId } from "./useSchoolId";

type DocumentKey = "Invoices" | "Statements";

type ParentRow = {
  id: string;
  firstName?: string | null;
  surname?: string | null;
  relationship?: string | null;
  email?: string | null;
};

function getSchoolNameFromStorage() {
  return (localStorage.getItem("schoolName") || "").trim();
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 15, 15, 0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
        zIndex: 60,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "min(760px, 100%)",
          background: "#ffffff",
          borderRadius: 16,
          border: "1px solid #ece7dc",
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "16px 18px",
            borderBottom: "1px solid #eee7db",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 18, fontWeight: 800 }}>{title}</div>
          <button className="btn-gold-light" onClick={onClose}>
            Close
          </button>
        </div>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>
  );
}

function FullscreenModal({
  open,
  title,
  onBack,
  topRight,
  children,
}: {
  open: boolean;
  title: string;
  onBack: () => void;
  topRight?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "#f7f4ef",
        zIndex: 65,
        overflow: "auto",
      }}
    >
      <div className="dashboard-page" style={{ minHeight: "100vh" }}>
        <div
          className="dashboard-header"
          style={{ alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
        >
          <div style={{ display: "grid", gap: 8 }}>
            <h1 className="page-title">{title}</h1>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn-gold-light" onClick={onBack}>
              Back
            </button>
            {topRight}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function BillingDocuments() {
  const schoolId = useSchoolId();
  const schoolName = useMemo(() => getSchoolNameFromStorage(), []);

  type DocumentType = "LETTER_OF_DEMAND" | "SECTION_41_NOTICE" | "FINAL_LETTER_OF_DEMAND";

  type OverdueAccount = {
    parentId: string;
    accountId: string | null;
    accountRef: string | null;
    parentName: string;
    parentEmail: string | null;
    parentCellNo: string | null;
    learnerNames: string[];
    totalOutstandingBalance: number;
    overdueBalance: number;
    lastPaymentDate: string | null;
    status: string | null;
  };

  type GeneratedItem = {
    id?: string;
    parentId: string;
    parentEmail: string | null;
    accountId: string | null;
    accountRef: string | null;
    learnerNames: string[];
    totalOutstandingBalance: number;
    overdueBalance: number;
    generatedHtml: string;
    emailStatus?: string;
    sentAt?: string | null;
  };

  const [activeTab, setActiveTab] = useState<"legal" | "legacy">("legal");

  const [docType, setDocType] = useState<DocumentType>("LETTER_OF_DEMAND");
  const [letterDate, setLetterDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [deadlineDate, setDeadlineDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });
  const [note, setNote] = useState("");

  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accounts, setAccounts] = useState<OverdueAccount[]>([]);
  const [selectedParentIds, setSelectedParentIds] = useState<Record<string, boolean>>({});

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItems, setPreviewItems] = useState<GeneratedItem[]>([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const previewItem = previewItems[previewIdx] || null;

  const [generating, setGenerating] = useState(false);
  const [lastRun, setLastRun] = useState<{ id: string; createdAt?: string; documentType: string } | null>(null);
  const [generatedByParentId, setGeneratedByParentId] = useState<Record<string, GeneratedItem>>({});

  const [emailSending, setEmailSending] = useState(false);
  const [emailResultsOpen, setEmailResultsOpen] = useState(false);
  const [emailResults, setEmailResults] = useState<any[]>([]);

  const [runsLoading, setRunsLoading] = useState(false);
  const [runs, setRuns] = useState<any[]>([]);

  const selectedParents = useMemo(() => {
    const ids = Object.entries(selectedParentIds)
      .filter(([, v]) => v)
      .map(([k]) => k);
    return ids;
  }, [selectedParentIds]);

  const selectedAccounts = useMemo(() => {
    const s = new Set(selectedParents);
    return accounts.filter((a) => s.has(a.parentId));
  }, [accounts, selectedParents]);

  function currency(amount: number) {
    try {
      return new Intl.NumberFormat("en-ZA", { style: "currency", currency: "ZAR" }).format(amount || 0);
    } catch {
      return `R${Number(amount || 0).toFixed(2)}`;
    }
  }

  async function loadOverdueAccounts() {
    if (!schoolId) return;
    setLoadingAccounts(true);
    try {
      const params = new URLSearchParams({ schoolId });
      const resp = await apiFetch(`/api/billing-documents/overdue-accounts?${params.toString()}`);
      const rows = Array.isArray((resp as any)?.accounts) ? ((resp as any).accounts as OverdueAccount[]) : [];
      setAccounts(rows);
      setSelectedParentIds({});
      setGeneratedByParentId({});
      setLastRun(null);
    } finally {
      setLoadingAccounts(false);
    }
  }

  async function loadRuns() {
    if (!schoolId) return;
    setRunsLoading(true);
    try {
      const params = new URLSearchParams({ schoolId });
      const resp = await apiFetch(`/api/billing-documents/runs?${params.toString()}`);
      setRuns(Array.isArray((resp as any)?.runs) ? (resp as any).runs : []);
    } finally {
      setRunsLoading(false);
    }
  }

  useEffect(() => {
    if (!schoolId) {
      setAccounts([]);
      setSelectedParentIds({});
      setRuns([]);
      setLastRun(null);
      setGeneratedByParentId({});
      return;
    }
    loadRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schoolId]);

  async function previewSelected() {
    if (!schoolId || selectedParents.length === 0) return;
    setGenerating(true);
    try {
      const resp = await apiFetch(`/api/billing-documents/generate`, {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          documentType: docType,
          letterDate: `${letterDate}T00:00:00.000Z`,
          deadlineDate: `${deadlineDate}T00:00:00.000Z`,
          note: note || null,
          dryRun: true,
          items: selectedParents.map((parentId) => ({ parentId })),
        }),
      });
      const items = Array.isArray((resp as any)?.items) ? ((resp as any).items as GeneratedItem[]) : [];
      setPreviewItems(items);
      setPreviewIdx(0);
      setPreviewOpen(true);
    } finally {
      setGenerating(false);
    }
  }

  async function generateLetters() {
    if (!schoolId || selectedParents.length === 0) return;
    setGenerating(true);
    try {
      const resp = await apiFetch(`/api/billing-documents/generate`, {
        method: "POST",
        body: JSON.stringify({
          schoolId,
          documentType: docType,
          letterDate: `${letterDate}T00:00:00.000Z`,
          deadlineDate: `${deadlineDate}T00:00:00.000Z`,
          note: note || null,
          dryRun: false,
          items: selectedParents.map((parentId) => ({ parentId })),
        }),
      });
      const run = (resp as any)?.run;
      const items = Array.isArray((resp as any)?.items) ? ((resp as any).items as GeneratedItem[]) : [];
      setLastRun(run?.id ? { id: String(run.id), createdAt: run.createdAt, documentType: String(run.documentType || docType) } : null);
      const map: Record<string, GeneratedItem> = {};
      for (const it of items) {
        map[it.parentId] = it;
      }
      setGeneratedByParentId(map);
      loadRuns();
    } finally {
      setGenerating(false);
    }
  }

  async function emailSelectedLetters() {
    if (!schoolId || !lastRun?.id) return;
    const selectedGenerated = selectedParents
      .map((pid) => generatedByParentId[pid])
      .filter(Boolean)
      .map((it) => it.id)
      .filter(Boolean) as string[];
    if (selectedGenerated.length === 0) return;

    setEmailSending(true);
    try {
      const resp = await apiFetch(`/api/billing-documents/email`, {
        method: "POST",
        body: JSON.stringify({ schoolId, runId: lastRun.id, itemIds: selectedGenerated }),
      });
      const results = Array.isArray((resp as any)?.results) ? (resp as any).results : [];
      setEmailResults(results);
      setEmailResultsOpen(true);
      loadRuns();
    } finally {
      setEmailSending(false);
    }
  }

  const canLoad = Boolean(schoolId) && !loadingAccounts;
  const canPreview = Boolean(schoolId) && selectedParents.length > 0 && !generating;
  const canGenerate = Boolean(schoolId) && selectedParents.length > 0 && !generating;
  const canEmail =
    Boolean(schoolId) &&
    Boolean(lastRun?.id) &&
    selectedParents.some((pid) => Boolean(generatedByParentId[pid]?.id)) &&
    !emailSending;

  // Legacy documents (kept for backward compatibility of the UI)
  const [selectedDoc, setSelectedDoc] = useState<DocumentKey | null>(null);
  const [showPrintSetup, setShowPrintSetup] = useState(false);
  const [showActionsModal, setShowActionsModal] = useState(false);
  const canPrint = Boolean(selectedDoc);

  return (
    <div className="dashboard-page">
      <div className="dashboard-header" style={{ alignItems: "baseline" }}>
        <div style={{ display: "grid", gap: 8 }}>
          <h1 className="page-title">Billing Documents</h1>
        </div>
      </div>

      <div className="dashboard-card" style={{ padding: 0 }}>
        <div
          style={{
            padding: 18,
            borderBottom: "1px solid #ece7dc",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 800 }}>Billing Documents</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className={activeTab === "legal" ? "btn-gold-dark" : "btn-gold-light"}
              onClick={() => setActiveTab("legal")}
            >
              Legal Letters
            </button>
            <button
              className={activeTab === "legacy" ? "btn-gold-dark" : "btn-gold-light"}
              onClick={() => setActiveTab("legacy")}
            >
              Legacy Documents
            </button>
          </div>
        </div>

        <div style={{ padding: 18 }}>
          {!schoolId ? (
            <div style={{ padding: 12, border: "1px solid #f0b4b4", background: "#fff5f5", borderRadius: 12 }}>
              No school selected. Please select a school first.
            </div>
          ) : activeTab === "legal" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  alignItems: "start",
                  marginBottom: 14,
                }}
              >
                <div className="dashboard-card" style={{ padding: 14, margin: 0 }}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>Document run controls</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <label style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 800 }}>Document type</div>
                      <select value={docType} onChange={(e) => setDocType(e.target.value as any)}>
                        <option value="LETTER_OF_DEMAND">Letter of Demand</option>
                        <option value="SECTION_41_NOTICE">Section 41 Notice</option>
                        <option value="FINAL_LETTER_OF_DEMAND">Final Letter of Demand</option>
                      </select>
                    </label>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 800 }}>Letter date</div>
                        <input type="date" value={letterDate} onChange={(e) => setLetterDate(e.target.value)} />
                      </label>
                      <label style={{ display: "grid", gap: 6 }}>
                        <div style={{ fontWeight: 800 }}>Payment deadline date</div>
                        <input type="date" value={deadlineDate} onChange={(e) => setDeadlineDate(e.target.value)} />
                      </label>
                    </div>

                    <label style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontWeight: 800 }}>Optional custom note</div>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={3}
                        placeholder="Optional note to include on the letters…"
                        style={{ resize: "vertical" }}
                      />
                    </label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button className="btn-gold-dark" disabled={!canLoad} onClick={loadOverdueAccounts}>
                        Load overdue accounts
                      </button>
                      <button className="btn-gold-light" disabled={!schoolId || runsLoading} onClick={loadRuns}>
                        Refresh runs
                      </button>
                    </div>
                  </div>
                </div>

                <div className="dashboard-card" style={{ padding: 14, margin: 0 }}>
                  <div style={{ fontWeight: 900, marginBottom: 10 }}>Run actions</div>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ color: "#5b6575", fontSize: 13 }}>
                      Selected accounts: <strong style={{ color: "#111827" }}>{selectedParents.length}</strong>
                      {lastRun?.id ? (
                        <>
                          {" "}
                          • Last generated run: <strong style={{ color: "#111827" }}>{lastRun.id}</strong>
                        </>
                      ) : null}
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <button
                        className="btn-gold-light"
                        onClick={() => {
                          const next: Record<string, boolean> = {};
                          for (const a of accounts) next[a.parentId] = true;
                          setSelectedParentIds(next);
                        }}
                        disabled={accounts.length === 0}
                      >
                        Select All
                      </button>
                      <button
                        className="btn-gold-light"
                        onClick={() => setSelectedParentIds({})}
                        disabled={accounts.length === 0}
                      >
                        Untick All
                      </button>
                      <button className="btn-gold-dark" onClick={previewSelected} disabled={!canPreview}>
                        Preview Selected
                      </button>
                      <button className="btn-gold-dark" onClick={generateLetters} disabled={!canGenerate}>
                        Generate Letters
                      </button>
                      <button className="btn-gold-dark" onClick={emailSelectedLetters} disabled={!canEmail}>
                        Email Selected Letters
                      </button>
                    </div>

                    <div style={{ fontSize: 12.5, color: "#5b6575" }}>
                      Safety: Emails are only sent when you click <strong>Email Selected Letters</strong>. Recipients are
                      always taken from the parent record linked to the account.
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#0f172a", color: "#f8fafc", textAlign: "left" }}>
                      <th style={{ padding: 10, width: 34 }} />
                      <th style={{ padding: 10 }}>Account number</th>
                      <th style={{ padding: 10 }}>Parent name</th>
                      <th style={{ padding: 10 }}>Parent email</th>
                      <th style={{ padding: 10 }}>Learner name(s)</th>
                      <th style={{ padding: 10 }}>Total outstanding</th>
                      <th style={{ padding: 10 }}>Overdue</th>
                      <th style={{ padding: 10 }}>Last payment</th>
                      <th style={{ padding: 10 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingAccounts ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 12, color: "#5b6575" }}>
                          Loading overdue accounts…
                        </td>
                      </tr>
                    ) : accounts.length === 0 ? (
                      <tr>
                        <td colSpan={9} style={{ padding: 12, color: "#5b6575" }}>
                          No overdue accounts loaded yet. Click <strong>Load overdue accounts</strong>.
                        </td>
                      </tr>
                    ) : (
                      accounts.map((a) => {
                        const checked = Boolean(selectedParentIds[a.parentId]);
                        const generated = generatedByParentId[a.parentId];
                        const displayStatus = generated?.emailStatus
                          ? generated.emailStatus
                          : generated?.id
                          ? "GENERATED"
                          : a.status || "—";
                        return (
                          <tr key={a.parentId} style={{ borderTop: "1px solid #e5e7eb" }}>
                            <td style={{ padding: 10 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setSelectedParentIds((prev) => ({ ...prev, [a.parentId]: e.target.checked }))
                                }
                              />
                            </td>
                            <td style={{ padding: 10, fontWeight: 800 }}>{a.accountRef || "—"}</td>
                            <td style={{ padding: 10 }}>{a.parentName || "—"}</td>
                            <td style={{ padding: 10 }}>{a.parentEmail || "—"}</td>
                            <td style={{ padding: 10 }}>{a.learnerNames?.length ? a.learnerNames.join(", ") : "—"}</td>
                            <td style={{ padding: 10, fontWeight: 900 }}>{currency(a.totalOutstandingBalance)}</td>
                            <td style={{ padding: 10 }}>{currency(a.overdueBalance)}</td>
                            <td style={{ padding: 10 }}>{a.lastPaymentDate ? a.lastPaymentDate.slice(0, 10) : "—"}</td>
                            <td style={{ padding: 10, fontWeight: 800 }}>{displayStatus}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>Recent document runs</div>
                <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                        <th style={{ padding: 10 }}>Run ID</th>
                        <th style={{ padding: 10 }}>Type</th>
                        <th style={{ padding: 10 }}>Letter date</th>
                        <th style={{ padding: 10 }}>Deadline</th>
                        <th style={{ padding: 10 }}>Items</th>
                        <th style={{ padding: 10 }}>Sent</th>
                        <th style={{ padding: 10 }}>Failed</th>
                        <th style={{ padding: 10 }}>Created</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runsLoading ? (
                        <tr>
                          <td colSpan={8} style={{ padding: 12, color: "#5b6575" }}>
                            Loading runs…
                          </td>
                        </tr>
                      ) : runs.length === 0 ? (
                        <tr>
                          <td colSpan={8} style={{ padding: 12, color: "#5b6575" }}>
                            No runs yet.
                          </td>
                        </tr>
                      ) : (
                        runs.map((r: any) => (
                          <tr key={r.id} style={{ borderTop: "1px solid #e5e7eb" }}>
                            <td style={{ padding: 10, fontFamily: "monospace" }}>{r.id}</td>
                            <td style={{ padding: 10, fontWeight: 800 }}>{r.documentType}</td>
                            <td style={{ padding: 10 }}>{String(r.letterDate || "").slice(0, 10) || "—"}</td>
                            <td style={{ padding: 10 }}>{String(r.deadlineDate || "").slice(0, 10) || "—"}</td>
                            <td style={{ padding: 10 }}>{r.itemsCount ?? 0}</td>
                            <td style={{ padding: 10 }}>{r.sentCount ?? 0}</td>
                            <td style={{ padding: 10 }}>{r.failedCount ?? 0}</td>
                            <td style={{ padding: 10 }}>{String(r.createdAt || "").slice(0, 10) || "—"}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : (
            <>
              <div style={{ marginBottom: 12, color: "#5b6575" }}>
                Legacy UI for older document actions (Invoices / Statements). Legal letter runs are in the “Legal Letters”
                tab.
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                      <th style={{ padding: 12, width: 34 }} />
                      <th style={{ padding: 12 }}>Report Name</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(["Invoices", "Statements"] as DocumentKey[]).map((k) => {
                      const isSelected = k === selectedDoc;
                      return (
                        <tr
                          key={k}
                          onClick={() => setSelectedDoc(k)}
                          style={{
                            cursor: "pointer",
                            background: isSelected ? "#fff8e1" : "white",
                            borderTop: "1px solid #e5e7eb",
                          }}
                        >
                          <td style={{ padding: 12 }}>
                            <input type="radio" checked={isSelected} onChange={() => setSelectedDoc(k)} />
                          </td>
                          <td style={{ padding: 12, fontWeight: 700, color: "#1d2736" }}>{k}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
                <button
                  className="btn-gold-dark"
                  disabled={!canPrint || !schoolId}
                  onClick={() => setShowPrintSetup(true)}
                  title={!canPrint ? "Select a document first" : "Print"}
                >
                  Print
                </button>
              </div>
            </>
          )}

          <div style={{ marginTop: 12, fontSize: 13, color: "#5b6575" }}>
            School: <span style={{ fontWeight: 800, color: "#1d2736" }}>{schoolName || "—"}</span>
          </div>
        </div>
      </div>

      <Modal open={showPrintSetup} title={selectedDoc || "Billing Document"} onClose={() => setShowPrintSetup(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "#5b6575" }}>Click Continue to choose View / Download / Export.</div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
            <button className="btn-gold-light" onClick={() => setShowPrintSetup(false)}>
              Cancel
            </button>
            <button
              className="btn-gold-dark"
              onClick={() => {
                setShowPrintSetup(false);
                setShowActionsModal(true);
              }}
            >
              Continue
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={showActionsModal} title="Document Actions" onClose={() => setShowActionsModal(false)}>
        <div style={{ display: "grid", gap: 12 }}>
          <div style={{ color: "#5b6575" }}>
            Document: <span style={{ fontWeight: 800, color: "#1d2736" }}>{selectedDoc || "—"}</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button
              className="btn-gold-dark"
              disabled={!selectedDoc}
              onClick={() => {
                if (!selectedDoc) return;
                const docTitle = selectedDoc;
                const html = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title></head><body style="font-family: Arial, Helvetica, sans-serif;"><h2>${schoolName ||
                  ""}</h2><h1>${docTitle}</h1><p>No records found for this school yet.</p></body></html>`;
                const w = window.open("", "_blank");
                if (w) {
                  w.document.open();
                  w.document.write(html);
                  w.document.close();
                }
              }}
            >
              View
            </button>
            <button
              className="btn-gold-dark"
              disabled={!selectedDoc}
              onClick={() => {
                if (!selectedDoc) return;
                const docTitle = selectedDoc;
                const html = `<!doctype html><html><head><meta charset="utf-8"><title>${docTitle}</title></head><body style="font-family: Arial, Helvetica, sans-serif;"><h2>${schoolName ||
                  ""}</h2><h1>${docTitle}</h1><p>No records found for this school yet.</p></body></html>`;
                const blob = new Blob([html], { type: "text/html;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${docTitle}.html`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Download
            </button>
            <button
              className="btn-gold-dark"
              disabled={!selectedDoc}
              onClick={() => {
                if (!selectedDoc) return;
                const docTitle = selectedDoc;
                const csv = `School,Document\n"${(schoolName || "").replaceAll('"', '""')}","${docTitle.replaceAll(
                  '"',
                  '""'
                )}"\n`;
                const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `${docTitle}.csv`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              Export
            </button>
            <button className="btn-gold-light" onClick={() => setShowActionsModal(false)}>
              Close
            </button>
          </div>
        </div>
      </Modal>

      <FullscreenModal
        open={previewOpen}
        title={`Preview » ${previewItem ? previewItem.accountRef || "Account" : ""}`}
        onBack={() => setPreviewOpen(false)}
        topRight={
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <div style={{ fontSize: 13, color: "#5b6575" }}>
              {previewItems.length ? (
                <>
                  Letter {previewIdx + 1} of {previewItems.length}
                </>
              ) : null}
            </div>
            <button
              className="btn-gold-light"
              onClick={() => setPreviewIdx((i) => Math.max(0, i - 1))}
              disabled={previewIdx <= 0}
            >
              Prev
            </button>
            <button
              className="btn-gold-light"
              onClick={() => setPreviewIdx((i) => Math.min(previewItems.length - 1, i + 1))}
              disabled={previewIdx >= previewItems.length - 1}
            >
              Next
            </button>
          </div>
        }
      >
        <div className="dashboard-card" style={{ padding: 0 }}>
          <div style={{ padding: 12, borderBottom: "1px solid #ece7dc", display: "flex", gap: 12, flexWrap: "wrap" }}>
            <div style={{ fontWeight: 900 }}>
              Total outstanding: {previewItem ? currency(previewItem.totalOutstandingBalance) : "—"}
            </div>
            <div style={{ fontWeight: 700, color: "#5b6575" }}>
              Overdue: {previewItem ? currency(previewItem.overdueBalance) : "—"}
            </div>
          </div>
          <div style={{ padding: 12 }}>
            {!previewItem ? (
              <div style={{ color: "#5b6575" }}>No preview available.</div>
            ) : (
              <iframe
                title="Letter preview"
                style={{
                  width: "100%",
                  height: "78vh",
                  border: "1px solid #e5e7eb",
                  borderRadius: 12,
                  background: "#ffffff",
                }}
                srcDoc={previewItem.generatedHtml}
              />
            )}
          </div>
        </div>
      </FullscreenModal>

      <Modal open={emailResultsOpen} title="Email Results" onClose={() => setEmailResultsOpen(false)}>
        <div style={{ display: "grid", gap: 10 }}>
          {emailResults.length === 0 ? (
            <div style={{ color: "#5b6575" }}>No results.</div>
          ) : (
            <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9fafb", textAlign: "left" }}>
                    <th style={{ padding: 10 }}>Item</th>
                    <th style={{ padding: 10 }}>Status</th>
                    <th style={{ padding: 10 }}>To</th>
                    <th style={{ padding: 10 }}>Error</th>
                  </tr>
                </thead>
                <tbody>
                  {emailResults.map((r: any) => (
                    <tr key={String(r.itemId)} style={{ borderTop: "1px solid #e5e7eb" }}>
                      <td style={{ padding: 10, fontFamily: "monospace" }}>{String(r.itemId)}</td>
                      <td style={{ padding: 10, fontWeight: 900, color: r.ok ? "#14532d" : "#b42318" }}>
                        {r.ok ? "SENT" : "FAILED"}
                      </td>
                      <td style={{ padding: 10 }}>{r.to || "—"}</td>
                      <td style={{ padding: 10 }}>{r.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

