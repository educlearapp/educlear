import React, { useCallback, useMemo, useState } from "react";
import { API_URL } from "../api";
import { previewLegalDocuments, type LegalDocumentType } from "./billingApi";
import {
  buildRunDueDateMap,
  computeLegalEligibleFromStatements,
  formatMoney,
  normaliseBillingAmount,
  readSchoolLedger,
  type BillingAccountRow,
} from "./billingLedger";

export type LegalDocMode = "wizard" | "email" | "preview";

type PreviewRow = {
  learnerId: string;
  accountNo: string;
  learnerName: string;
  grade: string;
  className: string;
  balance: number;
  overdueBalance: number;
  overdueInvoiceDates: string[];
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  paymentDeadline: string;
  generatedAt: string;
  duplicate?: boolean;
  skipReason?: string;
  documentHtml?: string;
  historyId?: string;
  selected?: boolean;
};

type ContactRow = {
  id: string;
  contactName: string;
  email: string;
  accountNo: string;
  learnerName: string;
  attachment: string;
  status: string;
  historyId?: string;
};

type Props = {
  schoolId: string;
  learners: any[];
  statementRows: BillingAccountRow[];
  documentType: LegalDocumentType;
  documentTitle: string;
  initialMode?: LegalDocMode;
  onClose: () => void;
};

const GOLD = "#d4af37";
const INK = "#111827";

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(15,23,42,0.55)",
  zIndex: 5000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
};

const panel: React.CSSProperties = {
  background: "#fff",
  border: `2px solid ${GOLD}`,
  borderRadius: 14,
  width: "min(1100px, 100%)",
  maxHeight: "92vh",
  overflow: "auto",
  boxShadow: "0 24px 60px rgba(0,0,0,0.25)",
};

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #cbd5e1",
  fontWeight: 600,
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

const disabledBtn: React.CSSProperties = {
  ...goldBtn,
  opacity: 0.45,
  cursor: "not-allowed",
};

function subjectFor(documentType: LegalDocumentType, learnerName: string, accountNo: string) {
  if (documentType === "section-41-notice") {
    return `Section 41 Notice - ${learnerName} - ${accountNo}`;
  }
  if (documentType === "letter-of-demand") {
    return `Letter of Demand - Outstanding School Fees - ${accountNo}`;
  }
  return `Final Demand - Urgent Outstanding School Fees - ${accountNo}`;
}

function openPrintHtml(html: string) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups to print.");
    return false;
  }
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
  return true;
}

type LetterPreviewState = {
  html: string;
  learnerName: string;
  accountNo: string;
};

function LegalLetterPreviewModal({
  preview,
  documentTitle,
  onClose,
}: {
  preview: LetterPreviewState;
  documentTitle: string;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        ...overlay,
        zIndex: 6000,
        background: "rgba(15,23,42,0.72)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          ...panel,
          width: "min(900px, 100%)",
          maxHeight: "94vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${GOLD}`,
            background: INK,
            color: GOLD,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            gap: 12,
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontWeight: 900, fontSize: 18 }}>{documentTitle}</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              {preview.learnerName} · Account {preview.accountNo}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" style={goldBtn} onClick={onClose}>
              Close
            </button>
            <button
              type="button"
              style={goldBtn}
              onClick={() => {
                if (!openPrintHtml(preview.html)) {
                  alert("Pop-up blocked. Allow pop-ups to print.");
                }
              }}
            >
              Print
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 16, background: "#f8fafc" }}>
          <iframe
            title={`${documentTitle} — ${preview.learnerName}`}
            srcDoc={preview.html}
            style={{
              width: "100%",
              minHeight: "min(70vh, 720px)",
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              background: "#fff",
              display: "block",
            }}
          />
        </div>
      </div>
    </div>
  );
}

function historyLookupKey(learnerId: string, accountNo: string) {
  return `${String(learnerId || "").trim()}::${String(accountNo || "").trim()}`;
}

async function legalApiPost(path: string, payload: Record<string, unknown>) {
  const response = await fetch(`${API_URL}/api/legal-billing-documents${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    data = { error: text };
  }
  if (!response.ok) {
    const backendError =
      typeof data.error === "string"
        ? data.error
        : typeof data.message === "string"
          ? data.message
          : "";
    if (backendError) throw new Error(backendError);
    if (response.status === 404) {
      throw new Error(
        "Legal documents API route not found. Rebuild and restart the backend: cd backend && npm run build && npm run dev"
      );
    }
    throw new Error(text?.slice(0, 200) || `Request failed (${response.status})`);
  }
  return data;
}

function parentFromLearner(learner: any, fallbackName: string) {
  const parents = Array.isArray(learner?.parents) ? learner.parents : [];
  const primary = parents.find((p: any) => p.isPrimary) || parents[0];
  if (!primary) {
    return { name: fallbackName || "Parent/Guardian", email: "", phone: "" };
  }
  return {
    name:
      `${primary.firstName || primary.name || ""} ${primary.surname || primary.lastName || ""}`.trim() ||
      fallbackName ||
      "Parent/Guardian",
    email: String(primary.email || "").trim(),
    phone: String(primary.cellNo || primary.phone || "").trim(),
  };
}

export default function LegalBillingDocuments({
  schoolId,
  learners,
  statementRows,
  documentType,
  documentTitle,
  initialMode = "wizard",
  onClose,
}: Props) {
  const [step, setStep] = useState<LegalDocMode>(initialMode);
  const [statusFilter, setStatusFilter] = useState("All Overdue");
  const [minBalance, setMinBalance] = useState(0);
  const [gradeFilter, setGradeFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [confirmDuplicates, setConfirmDuplicates] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const [fromEmail, setFromEmail] = useState("billing@school.co.za");
  const [description, setDescription] = useState(`Bulk ${documentTitle}`);
  const [subject, setSubject] = useState(documentTitle);
  const [emailMessage, setEmailMessage] = useState(
    `Please find the attached ${documentTitle} regarding overdue school fees.`
  );
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [sending, setSending] = useState(false);
  const [letterPreview, setLetterPreview] = useState<LetterPreviewState | null>(null);

  const learnerById = useMemo(() => {
    const map = new Map<string, any>();
    for (const learner of learners || []) {
      const id = String(learner?.id || learner?.learnerId || "").trim();
      if (id) map.set(id, learner);
    }
    return map;
  }, [learners]);

  const overdueRows = useMemo(
    () => previewRows.filter((r) => r.overdueBalance > 0),
    [previewRows]
  );

  const isRowSelectable = useCallback(
    (row: PreviewRow) => row.overdueBalance > 0 && (!row.duplicate || confirmDuplicates),
    [confirmDuplicates]
  );

  const selectableRows = useMemo(
    () => previewRows.filter((r) => isRowSelectable(r)),
    [previewRows, isRowSelectable]
  );

  const duplicateBlockedRows = useMemo(
    () => overdueRows.filter((r) => r.duplicate && !confirmDuplicates),
    [overdueRows, confirmDuplicates]
  );

  const selectedRows = useMemo(
    () => previewRows.filter((r) => r.selected && isRowSelectable(r)),
    [previewRows, isRowSelectable]
  );

  const activePreviewRow = useMemo(() => {
    if (selectedRows.length) return selectedRows[0];
    if (selectableRows.length) return selectableRows[0];
    return null;
  }, [selectedRows, selectableRows]);

  const hasPreviewHtml = Boolean(activePreviewRow?.documentHtml);

  const applyAccountsLoadMessages = (merged: PreviewRow[], allowRegenerate: boolean) => {
    const overdue = merged.filter((r) => r.overdueBalance > 0);
    const selectable = overdue.filter((r) => !r.duplicate || allowRegenerate);
    const blocked = overdue.filter((r) => r.duplicate && !allowRegenerate);

    if (!overdue.length) {
      setErrorMessage("No overdue accounts found from Statements ledger.");
      setInfoMessage("");
      return;
    }

    setErrorMessage("");

    if (!selectable.length && blocked.length) {
      setInfoMessage(
        `${overdue.length} overdue account(s) found. 0 selectable because notices were already generated today.`
      );
      return;
    }

    if (blocked.length > 0) {
      setInfoMessage(
        `${overdue.length} overdue account(s) found. ${selectable.length} selectable. ${blocked.length} already generated today — tick “Allow regenerate” to include them.`
      );
      return;
    }

    if (!merged.some((r) => r.documentHtml) && selectable.length) {
      setInfoMessage("Accounts loaded. Document HTML will generate when you preview or send.");
    } else {
      setInfoMessage("");
    }
  };

  const loadPreview = async (opts?: { confirmDup?: boolean }) => {
    setLoading(true);
    setErrorMessage("");
    setInfoMessage("");

    const allowRegenerate = opts?.confirmDup ?? confirmDuplicates;

    const { eligible, debug } = computeLegalEligibleFromStatements(statementRows, schoolId, learners, {
      statusFilter,
      minBalance,
      gradeFilter,
      classFilter,
    });

    console.debug("[LegalBilling] statementRows", debug.statementRowsCount);
    console.debug("[LegalBilling] balance > 0", debug.balancePositiveCount);
    console.debug("[LegalBilling] past-due invoices", debug.pastDueInvoiceCount);
    console.debug("[LegalBilling] legal eligible", debug.legalEligibleCount);
    if (debug.excluded.length) console.debug("[LegalBilling] excluded", debug.excluded);

    if (!eligible.length) {
      setPreviewRows([]);
      setAccountsLoaded(true);
      setGeneratedAt(new Date().toISOString());
      setErrorMessage("No overdue accounts found from Statements ledger.");
      setLoading(false);
      return;
    }

    try {
      const res = await previewLegalDocuments({
        schoolId,
        documentType,
        statusFilter,
        minBalance,
        gradeFilter: gradeFilter || undefined,
        classFilter: classFilter || undefined,
        confirmDuplicates: allowRegenerate,
        learnerIds: eligible.map((e) => e.learnerId),
        ledgerEntries: readSchoolLedger(schoolId),
        runDueDates: buildRunDueDateMap(),
      });

      if (res?.success === false) {
        throw new Error(String(res?.error || "Preview request failed"));
      }

      const apiRows = Array.isArray(res?.rows) ? res.rows : [];
      const apiByLearner = new Map(apiRows.map((r: any) => [String(r.learnerId), r]));

      const merged: PreviewRow[] = eligible.map((e) => {
        const learner = learnerById.get(e.learnerId);
        const parent = parentFromLearner(learner, e.learnerName);
        const api: any = apiByLearner.get(e.learnerId);
        return {
          learnerId: e.learnerId,
          accountNo: e.accountNo,
          learnerName: e.learnerName,
          grade: e.grade,
          className: e.className,
          balance: e.balance,
          overdueBalance: e.overdueBalance,
          overdueInvoiceDates: e.overdueInvoiceDates,
          parentName: String(api?.parentName || parent.name),
          parentEmail: String(api?.parentEmail || parent.email),
          parentPhone: String(api?.parentPhone || parent.phone),
          paymentDeadline: String(api?.paymentDeadline || ""),
          generatedAt: String(api?.generatedAt || res?.generatedAt || new Date().toISOString()),
          duplicate: Boolean(api?.duplicate),
          skipReason: api?.skipReason ? String(api.skipReason) : "",
          documentHtml: api?.documentHtml ? String(api.documentHtml) : "",
          selected: (!api?.duplicate || allowRegenerate) && e.overdueBalance > 0,
        };
      });

      if (opts?.confirmDup !== undefined) {
        setConfirmDuplicates(opts.confirmDup);
      }

      setGeneratedAt(String(res?.generatedAt || new Date().toISOString()));
      setPreviewRows(merged);
      setAccountsLoaded(true);
      applyAccountsLoadMessages(merged, allowRegenerate);
    } catch (e: any) {
      const msg = e?.message || "Failed to load document preview from server.";
      setErrorMessage(msg);

      const fallback: PreviewRow[] = eligible.map((e) => {
        const learner = learnerById.get(e.learnerId);
        const parent = parentFromLearner(learner, e.learnerName);
        return {
          ...e,
          parentName: parent.name,
          parentEmail: parent.email,
          parentPhone: parent.phone,
          paymentDeadline: "",
          generatedAt: new Date().toISOString(),
          duplicate: false,
          selected: e.overdueBalance > 0,
        };
      });
      setPreviewRows(fallback);
      setAccountsLoaded(true);
      applyAccountsLoadMessages(fallback, allowRegenerate);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    const selected = selectedRows;
    if (!selected.length) {
      setErrorMessage("Select at least one eligible account before generating.");
      return;
    }
    if (selected.some((r) => r.duplicate) && !confirmDuplicates) {
      setErrorMessage(
        "Tick “Allow regenerate notices already generated today” to generate again for those accounts."
      );
      return;
    }

    setLoading(true);
    setErrorMessage("");
    setInfoMessage("");
    try {
      const generatedAt = new Date().toISOString();
      const genRes = await legalApiPost("/generate", {
        schoolId,
        documentType,
        generatedAt,
        confirmDuplicates: confirmDuplicates,
        accounts: selected.map((r) => ({
          learnerId: r.learnerId,
          accountNo: r.accountNo,
          learnerName: r.learnerName,
          parentName: r.parentName,
          parentEmail: r.parentEmail,
          parentPhone: r.parentPhone,
          overdueBalance: r.overdueBalance,
          overdueInvoiceDates: r.overdueInvoiceDates,
          paymentDeadline: r.paymentDeadline,
        })),
      });

      if (genRes?.success === false) {
        throw new Error(String(genRes?.error || "Generate failed"));
      }

      type SavedRecord = { id?: string; learnerId?: string; accountNo?: string };
      const saved: SavedRecord[] = Array.isArray(genRes?.saved) ? (genRes.saved as SavedRecord[]) : [];
      if (!saved.length) {
        const skipped = Array.isArray(genRes?.skipped) ? genRes.skipped : [];
        throw new Error(
          skipped.length
            ? `No documents generated: ${skipped
                .map((s: any) => `${s.accountNo || "-"} (${s.reason || "skipped"})`)
                .join("; ")}`
            : "No documents were saved. Check account numbers and try again."
        );
      }

      const savedByKey = new Map(
        saved.map((record) => [historyLookupKey(record.learnerId || "", record.accountNo || ""), record] as const)
      );

      const built: ContactRow[] = selected
        .map((r) => {
          const email = String(r.parentEmail || "").trim();
          if (!email) return null;
          const record = savedByKey.get(historyLookupKey(r.learnerId, r.accountNo));
          return {
            id: `${r.learnerId}-${email}`,
            contactName: r.parentName || "Parent/Guardian",
            email,
            accountNo: r.accountNo,
            learnerName: r.learnerName,
            attachment: `${documentType}-${r.accountNo}.pdf`,
            status: "Ready",
            historyId: record?.id ? String(record.id) : undefined,
          };
        })
        .filter(Boolean) as ContactRow[];

      if (!built.length) {
        setErrorMessage("Selected accounts have no parent email on file. Add emails before sending.");
        return;
      }

      const mailSubject = subjectFor(documentType, selected[0].learnerName, selected[0].accountNo);
      setSubject(mailSubject);

      const sendRes = await legalApiPost("/send", {
        schoolId,
        documentType,
        simulate: true,
        from: fromEmail,
        description,
        subject: mailSubject,
        message: emailMessage,
        contacts: built.map((c) => ({
          contactName: c.contactName,
          email: c.email,
          accountNo: c.accountNo,
          learnerName: c.learnerName,
          attachment: c.attachment,
          historyId: c.historyId,
          subject: subjectFor(documentType, c.learnerName, c.accountNo),
        })),
      });

      if (sendRes?.success === false) {
        throw new Error(String(sendRes?.error || "Send failed after generate"));
      }

      const results = Array.isArray(sendRes?.results) ? sendRes.results : [];
      const sentContacts: ContactRow[] = built.map((c) => {
        const match = results.find((r: any) => r.email === c.email && r.accountNo === c.accountNo);
        return { ...c, status: match?.status || "Sent" };
      });

      setContacts(sentContacts);
      setInfoMessage(`Generated ${saved.length} document(s) and marked ${sentContacts.length} as Sent.`);
      setStep("email");
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to generate documents.");
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!contacts.length) {
      setErrorMessage("No contacts to send.");
      return;
    }
    setSending(true);
    setErrorMessage("");
    try {
      const res = await legalApiPost("/send", {
        schoolId,
        documentType,
        simulate: true,
        from: fromEmail,
        description,
        subject,
        message: emailMessage,
        contacts: contacts.map((c) => ({
          contactName: c.contactName,
          email: c.email,
          accountNo: c.accountNo,
          learnerName: c.learnerName,
          attachment: c.attachment,
          historyId: c.historyId,
          subject: subjectFor(documentType, c.learnerName, c.accountNo),
        })),
      });

      if (res?.success === false) {
        throw new Error(String(res?.error || "Send failed"));
      }

      const results = Array.isArray(res?.results) ? res.results : [];
      setContacts((prev) =>
        prev.map((c) => {
          const match = results.find((r: any) => r.email === c.email && r.accountNo === c.accountNo);
          return { ...c, status: match?.status || "Sent" };
        })
      );
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to send documents.");
      setContacts((prev) => prev.map((c) => ({ ...c, status: "Failed" })));
    } finally {
      setSending(false);
    }
  };

  const showLetterPreview = (html: string, row: PreviewRow) => {
    setErrorMessage("");
    setLetterPreview({
      html,
      learnerName: row.learnerName,
      accountNo: row.accountNo,
    });
  };

  const handlePreviewDocument = async () => {
    if (!activePreviewRow) {
      setErrorMessage("Preview accounts first, then select an eligible account.");
      return;
    }
    if (activePreviewRow.documentHtml) {
      showLetterPreview(activePreviewRow.documentHtml, activePreviewRow);
      return;
    }
    setLoading(true);
    setErrorMessage("");
    try {
      const res = await previewLegalDocuments({
        schoolId,
        documentType,
        learnerId: activePreviewRow.learnerId,
        ledgerEntries: readSchoolLedger(schoolId),
        runDueDates: buildRunDueDateMap(),
        confirmDuplicates,
      });
      const row = Array.isArray(res?.rows) ? res.rows[0] : null;
      const html = row?.documentHtml ? String(row.documentHtml) : "";
      if (!html) {
        setErrorMessage("Could not generate document HTML for the selected account.");
        return;
      }
      const updatedRow = { ...activePreviewRow, documentHtml: html };
      setPreviewRows((prev) =>
        prev.map((r) => (r.learnerId === activePreviewRow.learnerId ? { ...r, documentHtml: html } : r))
      );
      showLetterPreview(html, updatedRow);
    } catch (e: any) {
      setErrorMessage(e?.message || "Failed to generate document preview.");
    } finally {
      setLoading(false);
    }
  };

  const handlePrintSample = () => {
    if (!hasPreviewHtml || !activePreviewRow?.documentHtml) {
      setErrorMessage("Preview the document first for a selected eligible account.");
      return;
    }
    if (!openPrintHtml(activePreviewRow.documentHtml)) {
      setErrorMessage("Pop-up blocked. Allow pop-ups to print.");
    }
  };

  if (step === "email") {
    return (
      <div style={overlay}>
        <div style={{ ...panel, width: "min(1100px, 100%)" }}>
          <div style={{ padding: "20px 24px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
            <div style={{ fontWeight: 900, fontSize: 20 }}>Send — {documentTitle}</div>
            <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
              Email simulation · stamped {new Date().toLocaleString()}
            </div>
          </div>
          <div style={{ padding: 24, display: "grid", gap: 14 }}>
            {errorMessage ? (
              <div style={{ padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>
                {errorMessage}
              </div>
            ) : null}
            <label>
              From
              <input style={fieldStyle} value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} />
            </label>
            <label>
              Description
              <input style={fieldStyle} value={description} onChange={(e) => setDescription(e.target.value)} />
            </label>
            <label>
              Subject
              <input style={fieldStyle} value={subject} onChange={(e) => setSubject(e.target.value)} />
            </label>
            <label>
              Message
              <textarea
                style={{ ...fieldStyle, minHeight: 100 }}
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button type="button" style={goldBtn} onClick={handleSend} disabled={sending || !contacts.length}>
                {sending ? "Sending…" : "Send"}
              </button>
              <button type="button" style={goldBtn} onClick={() => setStep("wizard")}>
                Back
              </button>
              <button type="button" style={goldBtn} onClick={onClose}>
                Close
              </button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
                <thead>
                  <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                    {["Contact", "Email", "Account", "Attachment", "Status"].map((h) => (
                      <th key={h} style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 900 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contacts.map((c) => (
                    <tr key={c.id}>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.contactName}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.email}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.accountNo}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{c.attachment}</td>
                      <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>{c.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const previewDocDisabled = loading || !accountsLoaded || !activePreviewRow;
  const printDisabled = loading || !hasPreviewHtml;
  const generateDisabled = loading || !accountsLoaded || !selectedRows.length;

  const headerCountLabel = accountsLoaded
    ? `${overdueRows.length} overdue · ${selectableRows.length} selectable${
        duplicateBlockedRows.length > 0 ? ` · ${duplicateBlockedRows.length} already generated today` : ""
      }`
    : `${statementRows.length} statement row(s)`;

  return (
    <>
    <div style={overlay}>
      <div style={panel}>
        <div style={{ padding: "20px 24px", borderBottom: `1px solid ${GOLD}`, background: INK, color: GOLD }}>
          <div style={{ fontWeight: 900, fontSize: 20 }}>{documentTitle}</div>
          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
            Same ledger as Statements · {headerCountLabel}
          </div>
        </div>

        {errorMessage ? (
          <div style={{ margin: "16px 24px 0", padding: 12, borderRadius: 10, background: "#fef2f2", color: "#b91c1c", fontWeight: 700 }}>
            {errorMessage}
          </div>
        ) : null}
        {infoMessage ? (
          <div style={{ margin: "12px 24px 0", padding: 12, borderRadius: 10, background: "#fffbeb", color: "#92400e", fontWeight: 600 }}>
            {infoMessage}
          </div>
        ) : null}

        <div
          style={{
            padding: 24,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 14,
          }}
        >
          <label>
            Account status
            <select style={fieldStyle} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {["All Overdue", "Recently Owing", "Bad Debt"].map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          </label>
          <label>
            Minimum overdue balance (R)
            <input
              type="number"
              min={0}
              style={fieldStyle}
              value={minBalance}
              onChange={(e) => setMinBalance(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Grade
            <input style={fieldStyle} value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)} placeholder="All grades" />
          </label>
          <label>
            Classroom
            <input style={fieldStyle} value={classFilter} onChange={(e) => setClassFilter(e.target.value)} placeholder="All classes" />
          </label>
        </div>

        <label
          style={{
            margin: "0 24px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontWeight: 700,
            color: INK,
            cursor: loading ? "not-allowed" : "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={confirmDuplicates}
            disabled={loading}
            onChange={(e) => {
              const checked = e.target.checked;
              if (accountsLoaded) {
                void loadPreview({ confirmDup: checked });
              } else {
                setConfirmDuplicates(checked);
              }
            }}
          />
          Allow regenerate notices already generated today
        </label>

        <div style={{ padding: "0 24px", display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={goldBtn} onClick={() => loadPreview()} disabled={loading}>
            {loading ? "Loading…" : "Preview accounts"}
          </button>
          <button
            type="button"
            style={previewDocDisabled ? disabledBtn : goldBtn}
            onClick={handlePreviewDocument}
            disabled={previewDocDisabled}
          >
            Preview document
          </button>
          <button type="button" style={printDisabled ? disabledBtn : goldBtn} onClick={handlePrintSample} disabled={printDisabled}>
            Print sample
          </button>
          <button type="button" style={generateDisabled ? disabledBtn : goldBtn} onClick={handleGenerate} disabled={generateDisabled}>
            Generate &amp; send
          </button>
          <button type="button" style={goldBtn} onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ padding: 24, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
            <thead>
              <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                {["", "Learner", "Account", "Grade", "Class", "Balance", "Overdue", "Due dates", "Parent", "Email"].map((h) => (
                  <th key={h || "sel"} style={{ padding: 12, textAlign: "left", fontSize: 12, fontWeight: 900 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!accountsLoaded ? (
                <tr>
                  <td colSpan={10} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                    Click &quot;Preview accounts&quot; to load eligible overdue accounts from the Statements ledger.
                  </td>
                </tr>
              ) : previewRows.length === 0 ? (
                <tr>
                  <td colSpan={10} style={{ padding: 20, textAlign: "center", color: "#64748b" }}>
                    No overdue accounts found from Statements ledger.
                  </td>
                </tr>
              ) : (
                previewRows.map((row) => (
                  <tr
                    key={`${row.learnerId}-${row.accountNo}`}
                    style={row.duplicate && !confirmDuplicates ? { opacity: 0.55 } : undefined}
                  >
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(row.selected)}
                        disabled={row.overdueBalance <= 0 || (row.duplicate && !confirmDuplicates)}
                        onChange={(e) =>
                          setPreviewRows((prev) =>
                            prev.map((r) =>
                              r.learnerId === row.learnerId ? { ...r, selected: e.target.checked } : r
                            )
                          )
                        }
                      />
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontWeight: 800 }}>{row.learnerName}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.accountNo}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.grade || "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.className || "-"}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatMoney(row.balance)}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{formatMoney(row.overdueBalance)}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9", fontSize: 12 }}>
                      {row.overdueInvoiceDates?.join(", ") || "-"}
                      {row.duplicate ? ` · ${row.skipReason}` : ""}
                    </td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.parentName}</td>
                    <td style={{ padding: 12, borderBottom: "1px solid #f1f5f9" }}>{row.parentEmail || "-"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "0 24px 20px", color: "#64748b", fontSize: 12 }}>API: {API_URL}</div>
      </div>
    </div>
    {letterPreview ? (
      <LegalLetterPreviewModal
        preview={letterPreview}
        documentTitle={documentTitle}
        onClose={() => setLetterPreview(null)}
      />
    ) : null}
    </>
  );
}
