import React, { useMemo, useState } from "react";
import BulkStatementSend from "./BulkStatementSend";
import LatePenaltyFine from "./LatePenaltyFine";
import LegalBillingDocuments, { type LegalDocMode } from "./LegalBillingDocuments";
import type { LegalDocumentType } from "./billingApi";

type Props = {
  schoolId: string;
  learners: any[];
  statementRows: any[];
  setActivePage: (page: any) => void;
};

const GOLD = "#d4af37";
const INK = "#111827";

const DOCUMENT_ROWS = [
  { id: "invoices", name: "Invoices", description: "Print or email learner invoices." },
  { id: "statements", name: "Statements", description: "Bulk send statements of account to parents." },
  {
    id: "late-penalty-fine",
    name: "Late Penalty Fine",
    description: "Apply a late payment penalty to overdue accounts.",
  },
  {
    id: "section-41-notice",
    name: "Section 41 Notice",
    description: "Formal overdue notice (Section 41 school-fee recovery context).",
  },
  {
    id: "letter-of-demand",
    name: "Letter of Demand",
    description: "Stern 7-day demand for overdue school fees.",
  },
  {
    id: "final-demand",
    name: "Final Demand",
    description: "Final 48-hour demand before recovery handover.",
  },
] as const;

const LEGAL_DOC_IDS = new Set(["section-41-notice", "letter-of-demand", "final-demand"]);

const goldBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: INK,
  fontWeight: 900,
  cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  padding: "8px 14px",
  borderRadius: 10,
  border: `1px solid ${GOLD}`,
  background: "#fff",
  color: INK,
  fontWeight: 800,
  cursor: "pointer",
};

function legalTitle(id: string) {
  return DOCUMENT_ROWS.find((r) => r.id === id)?.name || "Legal Document";
}

export default function BillingDocuments({
  schoolId,
  learners,
  statementRows,
  setActivePage,
}: Props) {
  const [search, setSearch] = useState("");
  const [bulkSendOpen, setBulkSendOpen] = useState(false);
  const [penaltyOpen, setPenaltyOpen] = useState(false);
  const [legalDoc, setLegalDoc] = useState<{
    type: LegalDocumentType;
    mode: LegalDocMode;
  } | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return DOCUMENT_ROWS;
    return DOCUMENT_ROWS.filter(
      (row) =>
        row.name.toLowerCase().includes(q) ||
        row.description.toLowerCase().includes(q) ||
        row.id.includes(q)
    );
  }, [search]);

  const openLegal = (id: string, mode: LegalDocMode) => {
    if (!LEGAL_DOC_IDS.has(id)) return;
    setLegalDoc({ type: id as LegalDocumentType, mode });
  };

  const handlePrint = (id: string) => {
    if (id === "statements") {
      setActivePage("statements");
      return;
    }
    if (id === "invoices") {
      setActivePage("invoices");
      return;
    }
    if (LEGAL_DOC_IDS.has(id)) {
      openLegal(id, "preview");
      return;
    }
    window.print();
  };

  const handleSend = (id: string) => {
    if (id === "statements") {
      setBulkSendOpen(true);
      return;
    }
    if (id === "invoices") {
      setActivePage("runs");
      return;
    }
    if (LEGAL_DOC_IDS.has(id)) {
      openLegal(id, "wizard");
      return;
    }
    alert("Late Penalty Fine is applied from Manage — not sent by email.");
  };

  const handleManage = (id: string) => {
    if (id === "statements") {
      setActivePage("statements");
      return;
    }
    if (id === "invoices") {
      setActivePage("invoices");
      return;
    }
    if (id === "late-penalty-fine") {
      setPenaltyOpen(true);
      return;
    }
    if (LEGAL_DOC_IDS.has(id)) {
      openLegal(id, "wizard");
    }
  };

  return (
    <>
      <div style={{ padding: "32px 36px", background: "#f6f4ef", minHeight: "100vh" }}>
        <h1 style={{ margin: 0, fontSize: 34, fontWeight: 900, color: INK }}>Billing Documents</h1>
        <p style={{ margin: "8px 0 24px", color: "#64748b", fontWeight: 600 }}>
          Print, send, or manage billing documents for your school.
        </p>

        <input
          type="search"
          placeholder="Search documents…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            maxWidth: 420,
            padding: "12px 14px",
            borderRadius: 12,
            border: "1px solid #cbd5e1",
            marginBottom: 20,
            fontWeight: 600,
          }}
        />

        <div
          style={{
            background: "#fff",
            border: `1px solid ${GOLD}`,
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 12px 40px rgba(17,24,39,0.08)",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "rgba(212,175,55,0.16)" }}>
                {["Document", "Description", "Print", "Send", "Manage / Open"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: 14,
                      textAlign: "left",
                      fontSize: 13,
                      fontWeight: 900,
                      color: "#334155",
                      borderBottom: "1px solid #e5e7eb",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: 14, fontWeight: 900, color: INK }}>{row.name}</td>
                  <td style={{ padding: 14, color: "#64748b", fontWeight: 600 }}>{row.description}</td>
                  <td style={{ padding: 14 }}>
                    <button type="button" style={ghostBtn} onClick={() => handlePrint(row.id)}>
                      Print
                    </button>
                  </td>
                  <td style={{ padding: 14 }}>
                    <button type="button" style={goldBtn} onClick={() => handleSend(row.id)}>
                      Send
                    </button>
                  </td>
                  <td style={{ padding: 14 }}>
                    <button type="button" style={ghostBtn} onClick={() => handleManage(row.id)}>
                      Manage / Open
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {bulkSendOpen && (
        <BulkStatementSend
          schoolId={schoolId}
          learners={learners}
          statementRows={statementRows}
          onClose={() => setBulkSendOpen(false)}
        />
      )}

      {penaltyOpen && (
        <LatePenaltyFine
          schoolId={schoolId}
          learners={learners}
          statementRows={statementRows}
          onClose={() => setPenaltyOpen(false)}
          onApplied={() => setPenaltyOpen(false)}
        />
      )}

      {legalDoc && (
        <LegalBillingDocuments
          schoolId={schoolId}
          learners={learners}
          statementRows={statementRows}
          documentType={legalDoc.type}
          documentTitle={legalTitle(legalDoc.type)}
          initialMode={legalDoc.mode}
          onClose={() => setLegalDoc(null)}
        />
      )}
    </>
  );
}
