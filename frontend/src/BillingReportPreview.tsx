import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { useSchoolId } from "./useSchoolId";

function getQuery(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const report = (params.get("report") || "").trim();
  const schoolName = (params.get("schoolName") || localStorage.getItem("schoolName") || "").trim();
  return {
    report,
    schoolName,
    groupBy: (params.get("groupBy") || "").trim(),
    sortBy: (params.get("sortBy") || "").trim(),
    show: (params.get("show") || "").trim(),
    includeInactiveWithBalances: params.get("includeInactiveWithBalances") === "1",
  };
}

export default function BillingReportPreview() {
  const location = useLocation();
  const navigate = useNavigate();
  const schoolId = useSchoolId();

  const q = useMemo(() => getQuery(location.search), [location.search]);
  const reportTitle = q.report || "Billing Report";
  const schoolName = q.schoolName || "—";

  const [loading, setLoading] = useState(true);
  const [hasRecords, setHasRecords] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!schoolId) {
      setLoading(false);
      setHasRecords(false);
      return;
    }

    setLoading(true);
    (async () => {
      try {
        // Lightweight, school-specific check: do learners exist for this school?
        const params = new URLSearchParams({
          schoolId,
          classroom: "ALL",
          group: "ALL",
          q: "",
        });
        const data = (await apiFetch(`/api/billing-plans/learners?${params.toString()}`)) as any;
        const learners = Array.isArray(data?.learners) ? data.learners : [];
        if (cancelled) return;
        setHasRecords(learners.length > 0);
      } catch {
        if (!cancelled) setHasRecords(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [schoolId]);

  return (
    <div style={{ background: "#f7f4ef", minHeight: "100vh", padding: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn-gold-dark" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn-gold-light" onClick={() => navigate(-1)}>
            Back
          </button>
        </div>
        <div style={{ color: "#5b6575", fontSize: 13 }}>
          Tip: use your browser print dialog to save as PDF.
        </div>
      </div>

      <div
        style={{
          background: "#ffffff",
          border: "1px solid #ece7dc",
          borderRadius: 16,
          boxShadow: "0 8px 24px rgba(15, 15, 15, 0.06)",
          padding: 22,
        }}
      >
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 900, fontSize: 18 }}>{schoolName}</div>
          <div style={{ fontWeight: 900, fontSize: 28 }}>{reportTitle}</div>
          {(q.groupBy || q.sortBy || q.show) && (
            <div style={{ color: "#5b6575", fontSize: 13, lineHeight: 1.45 }}>
              {q.groupBy ? <div>Group By: {q.groupBy}</div> : null}
              {q.sortBy ? <div>Sort By: {q.sortBy}</div> : null}
              {q.show ? <div>Show: {q.show}</div> : null}
              {"includeInactiveWithBalances" in q ? (
                <div>Include Inactive Accounts With Balances: {q.includeInactiveWithBalances ? "Yes" : "No"}</div>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ marginTop: 18, borderTop: "1px solid #eee7db", paddingTop: 18 }}>
          {loading ? (
            <div style={{ color: "#5b6575" }}>Generating preview…</div>
          ) : !hasRecords ? (
            <div style={{ color: "#1d2736", fontSize: 16 }}>No records found for this school yet.</div>
          ) : (
            <div style={{ color: "#1d2736", fontSize: 16 }}>
              Report data rendering is coming next. For now, this preview is school-specific and ready to print/export.
            </div>
          )}
        </div>
      </div>

      <style>{`
        @media print {
          body { background: #ffffff !important; }
          button { display: none !important; }
          a { text-decoration: none; }
        }
      `}</style>
    </div>
  );
}

