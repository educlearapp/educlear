import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { getParentPortalSession } from "./parentPortalSession";

export default function ParentPortalHomework() {
  const navigate = useNavigate();
  const session = useMemo(() => getParentPortalSession(), []);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [dashboard, setDashboard] = useState<any>(null);
  const [className, setClassName] = useState<string>("");
  const [homework, setHomework] = useState<any[]>([]);

  useEffect(() => {
    if (!session) {
      navigate("/parent/login", { replace: true });
      return;
    }
    (async () => {
      setLoading(true);
      setStatus("");
      try {
        const dash = await apiFetch(`/api/parent-portal/dashboard/${session.parentId}`);
        setDashboard(dash);
        const learners: any[] = Array.isArray(dash?.learners) ? dash.learners : [];
        const classes = Array.from(new Set(learners.map((l) => l.className).filter(Boolean))) as string[];
        setClassName((prev) => prev || classes[0] || "");
      } catch (e: any) {
        setStatus(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, session]);

  useEffect(() => {
    if (!session) return;
    const schoolId = String(dashboard?.parent?.schoolId || session.schoolId || "");
    if (!schoolId || !className) return;
    (async () => {
      try {
        const res: any = await apiFetch(`/api/parent-portal/homework?schoolId=${encodeURIComponent(schoolId)}&className=${encodeURIComponent(className)}`);
        setHomework(Array.isArray(res?.homework) ? res.homework : []);
      } catch (e: any) {
        setStatus(e?.message || "Failed to fetch homework");
      }
    })();
  }, [className, dashboard?.parent?.schoolId, session, dashboard]);

  if (!session) return null;

  const learners: any[] = Array.isArray(dashboard?.learners) ? dashboard.learners : [];
  const classes = Array.from(new Set(learners.map((l) => l.className).filter(Boolean))) as string[];

  return (
    <div style={{ maxWidth: 1000, margin: "28px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Homework</h2>
        <div style={{ marginLeft: "auto" }}>
          <Link to="/parent/dashboard" style={{ color: "#b48a00", fontWeight: 900 }}>
            Back to dashboard
          </Link>
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 16 }}>Loading...</div>
      ) : status ? (
        <div style={{ padding: 16, color: "#b91c1c", fontWeight: 800 }}>{status}</div>
      ) : (
        <>
          <div style={{ background: "#111", color: "#f8fafc", borderRadius: 16, padding: 14, border: "1px solid rgba(212,175,55,0.25)" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ color: "#d4af37", fontWeight: 900 }}>Class</div>
              <select
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                style={{ padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)", background: "#0b0b0b", color: "#f8fafc" }}
              >
                <option value="">Select a class</option>
                {classes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div style={{ marginLeft: "auto", color: "#cbd5e1", fontWeight: 700 }}>
                {className ? `${homework.length} items` : "Choose a class to view homework"}
              </div>
            </div>
          </div>

          {className && homework.length ? (
            <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
              {homework.map((h) => (
                <div key={h.id} style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                    <div style={{ fontWeight: 900 }}>{h.title}</div>
                    <div style={{ color: "#475569", fontWeight: 800 }}>Due {new Date(h.dueDate).toLocaleDateString()}</div>
                  </div>
                  <div style={{ marginTop: 4, color: "#475569", fontWeight: 700 }}>
                    {h.subject ? `${h.subject} • ` : ""}{h.className}
                  </div>
                  {h.description ? <div style={{ marginTop: 8, color: "#334155" }}>{h.description}</div> : null}
                </div>
              ))}
            </div>
          ) : className ? (
            <div style={{ marginTop: 12, padding: 16, background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ fontWeight: 900 }}>No homework yet</div>
              <div style={{ marginTop: 6, color: "#475569" }}>When teachers post homework for {className}, it will appear here.</div>
            </div>
          ) : (
            <div style={{ marginTop: 12, padding: 16, background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ fontWeight: 900 }}>No class information</div>
              <div style={{ marginTop: 6, color: "#475569" }}>Your learners do not have a class assigned yet. Please ask the school to update class placement.</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

