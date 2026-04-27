import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { getParentPortalSession } from "./parentPortalSession";

export default function ParentPortalNotices() {
  const navigate = useNavigate();
  const session = useMemo(() => getParentPortalSession(), []);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [notices, setNotices] = useState<any[]>([]);
  const [schoolId, setSchoolId] = useState<string>("");

  useEffect(() => {
    if (!session) {
      navigate("/parent/login", { replace: true });
      return;
    }
    (async () => {
      setLoading(true);
      setStatus("");
      try {
        const dash: any = await apiFetch(`/api/parent-portal/dashboard/${session.parentId}`);
        const sid = String(dash?.parent?.schoolId || session.schoolId || "");
        setSchoolId(sid);
        if (!sid) throw new Error("Missing schoolId");
        const res: any = await apiFetch(`/api/parent-portal/notices?schoolId=${encodeURIComponent(sid)}`);
        setNotices(Array.isArray(res?.notices) ? res.notices : []);
      } catch (e: any) {
        setStatus(e?.message || "Failed to fetch notices");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, session]);

  if (!session) return null;

  return (
    <div style={{ maxWidth: 1000, margin: "28px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Notices</h2>
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
      ) : notices.length ? (
        <div style={{ display: "grid", gap: 10 }}>
          {notices.map((n) => (
            <div key={n.id} style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 900 }}>{n.title}</div>
                <div style={{ color: "#475569", fontWeight: 800 }}>{new Date(n.date).toLocaleDateString()}</div>
              </div>
              <div style={{ marginTop: 8, color: "#334155" }}>{n.message}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ padding: 16, background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)" }}>
          <div style={{ fontWeight: 900 }}>No notices</div>
          <div style={{ marginTop: 6, color: "#475569" }}>
            {schoolId ? "When the school publishes notices, they will appear here." : "School not detected."}
          </div>
        </div>
      )}
    </div>
  );
}

