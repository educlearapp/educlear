import React from "react";
import type { ListRegisterDef } from "./listRegisterCatalog";
import { COLUMN_LABELS } from "./listRegisterCatalog";
import type { ListRegisterSection } from "./buildListRegisterReport";

const GOLD = "#d4af37";

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  fontSize: 11,
  fontWeight: 900,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  borderBottom: "1px solid #e2e8f0",
  whiteSpace: "nowrap",
  background: "#f8fafc",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "#0f172a",
  borderBottom: "1px solid #f1f5f9",
  verticalAlign: "top",
};

type Props = {
  def: ListRegisterDef;
  schoolName: string;
  sections: ListRegisterSection[];
  onClose: () => void;
};

export default function ListRegisterReportView({ def, schoolName, sections, onClose }: Props) {
  const cols = def.columns;
  const total = sections.reduce((n, s) => n + s.count, 0);
  const showSectionHeaders =
    def.groupBy !== "none" &&
    sections.length > 0 &&
    !(sections.length === 1 && sections[0].key === "all");

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 120, overflow: "auto", padding: 40 }}>
      <div className="list-register-no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button
          type="button"
          onClick={() => window.print()}
          style={{
            marginRight: 10,
            background: GOLD,
            color: "#111",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Print
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "#0f172a",
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "10px 16px",
            fontWeight: 800,
            cursor: "pointer",
          }}
        >
          Close
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>{def.label}</h1>
          <div style={{ marginTop: 6, color: "#64748b", fontWeight: 700 }}>
            {total} learner{total === 1 ? "" : "s"}
          </div>
        </div>
        <h1 style={{ fontSize: 28, margin: 0 }}>{schoolName}</h1>
      </div>

      {!def.implemented ? (
        <div style={{ marginTop: 40, padding: 24, border: "1px solid #e2e8f0", borderRadius: 12 }}>
          <strong>Report not yet implemented</strong>
          <p style={{ marginTop: 8, color: "#64748b" }}>
            This catalogue entry is reserved for a future Lists &amp; Registers release.
          </p>
        </div>
      ) : (
        sections.map((section) => (
          <div key={section.key} style={{ marginTop: 28 }}>
            {showSectionHeaders ? (
              <h2 style={{ fontSize: 20, margin: "0 0 10px", borderBottom: `2px solid ${GOLD}`, paddingBottom: 6 }}>
                {section.label}{" "}
                <span style={{ color: "#64748b", fontWeight: 700, fontSize: 14 }}>
                  ({section.count})
                </span>
              </h2>
            ) : null}
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
              <thead>
                <tr>
                  {cols.map((c) => (
                    <th key={c} style={th}>
                      {COLUMN_LABELS[c]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row, index) => (
                  <tr
                    key={`${section.key}-${row.learnerId}-${index}`}
                    style={{ background: index % 2 ? "rgba(212,175,55,0.05)" : "#fff" }}
                  >
                    {cols.map((c) => (
                      <td key={c} style={td}>
                        {row[c]}
                      </td>
                    ))}
                  </tr>
                ))}
                {section.rows.length === 0 ? (
                  <tr>
                    <td style={td} colSpan={cols.length}>
                      No learners match the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ))
      )}

      <style>{`
        @media print {
          .list-register-no-print { display: none !important; }
          body { background: #fff; }
        }
      `}</style>
    </div>
  );
}
