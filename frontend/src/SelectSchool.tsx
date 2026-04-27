import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { apiFetch } from "./api";
import logo from "./assets/logo.png";

type SchoolListItem = {
  id: string;
  name?: string | null;
  email?: string | null;
  createdAt?: string | null;
};

const gold = "#D4AF37";
const bg = "#070707";

export default function SelectSchool() {
  const navigate = useNavigate();
  const location = useLocation() as any;
  const [schools, setSchools] = useState<SchoolListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const from = String(location?.state?.from || "/dashboard");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");

    (async () => {
      try {
        const data = (await apiFetch("/api/schools")) as any;
        const list = Array.isArray(data) ? (data as SchoolListItem[]) : [];
        if (!cancelled) setSchools(list);
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load schools.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return schools;
    return schools.filter((s) => String(s?.name || "").toLowerCase().includes(q) || String(s?.email || "").toLowerCase().includes(q));
  }, [schools, query]);

  function selectSchool(id: string) {
    localStorage.setItem("schoolId", id);
    navigate(from);
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("schoolId");
    navigate("/");
  }

  return (
    <div style={{ minHeight: "100vh", background: bg, color: "#fff" }}>
      <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 20px 60px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img src={logo} alt="EduClear" style={{ width: 46, height: 46, objectFit: "contain" }} />
            <div style={{ fontWeight: 900, letterSpacing: 0.4 }}>Select your school</div>
          </div>
          <button
            type="button"
            onClick={logout}
            style={{
              padding: "10px 12px",
              borderRadius: 12,
              background: "transparent",
              border: "1px solid rgba(255,255,255,0.16)",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
          >
            Logout
          </button>
        </div>

        <div style={{ marginTop: 18, color: "rgba(255,255,255,0.75)", lineHeight: 1.6 }}>
          To protect privacy, EduClear does not show any school dashboard until you explicitly select a school after login.
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search schools (name or email)"
            style={{
              flex: "1 1 320px",
              padding: "11px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              outline: "none",
            }}
          />
          <button
            type="button"
            onClick={() => navigate("/register")}
            style={{
              padding: "11px 12px",
              borderRadius: 12,
              background: gold,
              border: `1px solid ${gold}`,
              color: "#151515",
              fontWeight: 950,
              cursor: "pointer",
            }}
          >
            Register a new school
          </button>
        </div>

        <div style={{ marginTop: 18 }}>
          {loading ? (
            <div style={{ color: "rgba(255,255,255,0.75)", fontWeight: 800 }}>Loading schools...</div>
          ) : error ? (
            <div style={{ color: "rgba(255,200,200,0.95)", fontWeight: 900 }}>{error}</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.75)", fontWeight: 800 }}>No schools found.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {filtered.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectSchool(s.id)}
                  style={{
                    textAlign: "left",
                    borderRadius: 16,
                    padding: 14,
                    background: "rgba(0,0,0,0.35)",
                    border: "1px solid rgba(212,175,55,0.18)",
                    color: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 950, marginBottom: 6 }}>{String(s?.name || "Unnamed school")}</div>
                  <div style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, lineHeight: 1.5 }}>
                    {s.email ? s.email : "No email on record"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

