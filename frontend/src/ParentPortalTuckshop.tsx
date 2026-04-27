import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import { getParentPortalSession } from "./parentPortalSession";

export default function ParentPortalTuckshop() {
  const navigate = useNavigate();
  const session = useMemo(() => getParentPortalSession(), []);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("");
  const [menu, setMenu] = useState<any>(null);

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
        const schoolId = String(dash?.parent?.schoolId || session.schoolId || "");
        if (!schoolId) throw new Error("Missing schoolId");
        const res: any = await apiFetch(`/api/parent-portal/tuckshop?schoolId=${encodeURIComponent(schoolId)}&latest=true`);
        setMenu(res?.menu || null);
      } catch (e: any) {
        setStatus(e?.message || "Failed to fetch tuckshop menu");
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate, session]);

  if (!session) return null;

  const items = menu?.items;

  return (
    <div style={{ maxWidth: 1000, margin: "28px auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ margin: 0 }}>Tuckshop Menu</h2>
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
      ) : menu ? (
        <div style={{ background: "#fff", borderRadius: 16, padding: 14, border: "1px solid rgba(15,23,42,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <div style={{ fontWeight: 900 }}>Menu</div>
            <div style={{ color: "#475569", fontWeight: 800 }}>{new Date(menu.date).toLocaleDateString()}</div>
          </div>
          <div style={{ marginTop: 10 }}>
            {Array.isArray(items) ? (
              <div style={{ display: "grid", gap: 8 }}>
                {items.map((it: any, idx: number) => (
                  <div key={idx} style={{ border: "1px solid rgba(15,23,42,0.08)", borderRadius: 12, padding: 10 }}>
                    <div style={{ fontWeight: 900 }}>{String(it?.name || it?.item || `Item ${idx + 1}`)}</div>
                    {it?.price != null ? <div style={{ color: "#475569", fontWeight: 800 }}>R {Number(it.price).toFixed(2)}</div> : null}
                    {it?.description ? <div style={{ marginTop: 6, color: "#334155" }}>{String(it.description)}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", background: "#0b0b0b", color: "#f8fafc", padding: 12, borderRadius: 12 }}>
                {JSON.stringify(items, null, 2)}
              </pre>
            )}
          </div>
        </div>
      ) : (
        <div style={{ padding: 16, background: "#fff", borderRadius: 16, border: "1px solid rgba(15,23,42,0.08)" }}>
          <div style={{ fontWeight: 900 }}>No menu published</div>
          <div style={{ marginTop: 6, color: "#475569" }}>When the school publishes a tuckshop menu, it will appear here.</div>
        </div>
      )}
    </div>
  );
}

