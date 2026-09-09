import React from "react";
import type { ListRegisterDef } from "./listRegisterCatalog";
import { resolveColumnLabel } from "./listRegisterCatalog";
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
  extraFieldLabels?: string[];
};

function countLabel(def: ListRegisterDef, total: number): string {
  if (def.kind === "contact") return `${total} contact${total === 1 ? "" : "s"}`;
  if (def.kind === "address") return `${total} address row${total === 1 ? "" : "s"}`;
  if (def.kind === "block-sheet") return `${def.blockCount || 0} blocks`;
  if (def.entity === "employee" && def.rowGrain === "employee-attendance-day") {
    return `${total} attendance row${total === 1 ? "" : "s"}`;
  }
  if (def.entity === "employee") return `${total} employee${total === 1 ? "" : "s"}`;
  if (def.entity === "incident") return `${total} incident${total === 1 ? "" : "s"}`;
  if (def.entity === "group-member") return `${total} member${total === 1 ? "" : "s"}`;
  return `${total} learner${total === 1 ? "" : "s"}`;
}

function BlockSheetView({ def, schoolName }: { def: ListRegisterDef; schoolName: string }) {
  const n = def.blockCount || 5;
  const lines = 8;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>{def.label}</h1>
          <div style={{ marginTop: 10, display: "grid", gap: 8, fontSize: 14, color: "#334155" }}>
            <div>
              Class / Group: ________________________________
            </div>
            <div>
              Teacher: _______________________________________
            </div>
            <div>
              Date: __________________________________________
            </div>
          </div>
        </div>
        <h1 style={{ fontSize: 28, margin: 0 }}>{schoolName}</h1>
      </div>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={`block-${i + 1}`}
          className="list-register-section"
          style={{
            marginTop: 22,
            border: "1px solid #cbd5e1",
            borderRadius: 8,
            padding: "12px 14px 16px",
            breakInside: "avoid",
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10, borderBottom: `2px solid ${GOLD}`, paddingBottom: 6 }}>
            Block {i + 1}
          </div>
          {Array.from({ length: lines }, (_, li) => (
            <div
              key={li}
              style={{
                borderBottom: "1px solid #94a3b8",
                height: 28,
                marginBottom: 4,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function ListRegisterReportView({
  def,
  schoolName,
  sections,
  onClose,
  extraFieldLabels,
}: Props) {
  const cols = def.columns;
  const total = sections.reduce((n, s) => n + s.count, 0);
  const showSectionHeaders =
    def.groupBy !== "none" &&
    sections.length > 0 &&
    !(sections.length === 1 && sections[0].key === "all");

  const isBlocked = def.status === "blocked_missing_data" || def.kind === "blocked" || !def.implemented;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#fff", zIndex: 120, overflow: "auto", padding: 40 }}>
      <div className="list-register-no-print" style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        {!isBlocked ? (
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
        ) : null}
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

      {isBlocked ? (
        <div>
          <h1 style={{ fontSize: 32, margin: 0 }}>{def.label}</h1>
          <div
            style={{
              marginTop: 40,
              padding: 24,
              border: "1px solid #fecaca",
              borderRadius: 12,
              background: "#fef2f2",
            }}
          >
            <strong style={{ color: "#991b1b", fontSize: 18 }}>
              This report cannot be produced yet
            </strong>
            <p style={{ marginTop: 12, color: "#7f1d1d", fontWeight: 600, lineHeight: 1.5 }}>
              {def.blockedReason ||
                "The information needed for this report is not currently recorded in EduClear."}
            </p>
          </div>
        </div>
      ) : def.kind === "block-sheet" ? (
        <BlockSheetView def={def} schoolName={schoolName} />
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, gap: 16 }}>
            <div>
              <h1 style={{ fontSize: 32, margin: 0 }}>{def.label}</h1>
              <div style={{ marginTop: 6, color: "#64748b", fontWeight: 700 }}>{countLabel(def, total)}</div>
            </div>
            <h1 style={{ fontSize: 28, margin: 0 }}>{schoolName}</h1>
          </div>

          {sections.map((section) => (
            <div key={section.key} style={{ marginTop: 28 }} className="list-register-section">
              {showSectionHeaders ? (
                <h2 style={{ fontSize: 20, margin: "0 0 10px", borderBottom: `2px solid ${GOLD}`, paddingBottom: 6 }}>
                  {section.label}{" "}
                  <span style={{ color: "#64748b", fontWeight: 700, fontSize: 14 }}>
                    ({section.count}
                    {def.kind === "class-roster"
                      ? " learners"
                      : def.kind === "group-list"
                        ? " members"
                        : ""}
                    )
                  </span>
                </h2>
              ) : null}
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
                <thead>
                  <tr>
                    {cols.map((c) => (
                      <th key={c} style={th}>
                        {resolveColumnLabel(c, extraFieldLabels)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, index) => (
                    <tr
                      key={`${section.key}-${row.learnerId || ""}-${row.employeeId || ""}-${row.parentId || ""}-${row._incidentId || ""}-${index}`}
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
                      <td style={td} colSpan={Math.max(cols.length, 1)}>
                        No rows match the current filters.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          ))}
        </>
      )}

      <style>{`
        @media print {
          .list-register-no-print { display: none !important; }
          body { background: #fff; }
          .list-register-section { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
    </div>
  );
}
