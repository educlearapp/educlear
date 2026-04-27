import * as React from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_URL, apiFetch } from "./api";
import { setParentPortalSession } from "./parentPortalSession";

type Mode = "login" | "register";

export default function ParentPortalLogin() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [parentId, setParentId] = useState("");
  const [phone, setPhone] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [status, setStatus] = useState<string>("");

  const canSubmit = useMemo(() => {
    if (!email || !password) return false;
    if (mode === "login") return true;
    return Boolean(phone && idNumber);
  }, [email, password, mode, phone, idNumber]);

  async function doLogin(e: React.FormEvent) {
    e.preventDefault();
    setStatus(mode === "login" ? "Logging in..." : "Registering...");
    try {
      if (mode === "register") {
        await apiFetch("/api/parent-portal/register", {
          method: "POST",
          body: JSON.stringify({
            email,
            password,
            confirmPassword: password,
            idNumber: idNumber || undefined,
            cell: phone || undefined,
            schoolId: schoolId || undefined,
          }),
        });
      }

      const data: any = await apiFetch("/api/parent-portal/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      const parent = data?.parent;
      const parentUser = data?.parentUser;
      const school = data?.school || parent?.school || null;
      const resolvedSchoolId = String(parent?.schoolId || "");
      const resolvedParentId = String(parent?.id || parentUser?.parentId || "");
      const resolvedParentUserId = String(parentUser?.id || "");

      if (!resolvedParentId || !resolvedSchoolId || !resolvedParentUserId) {
        throw new Error("Login succeeded but account data is incomplete. Please contact the school.");
      }

      setParentPortalSession({
        parentId: resolvedParentId,
        schoolId: resolvedSchoolId,
        parentUserId: resolvedParentUserId,
        parentEmail: String(parentUser?.email || email),
        schoolName: school?.name ? String(school.name) : undefined,
        schoolLogoUrl: school?.logoUrl ? (String(school.logoUrl).startsWith("/") ? `${API_URL}${school.logoUrl}` : String(school.logoUrl)) : null,
      });

      navigate("/parent/dashboard", { replace: true });
    } catch (err: any) {
      setStatus(err?.message || "Request failed");
    }
  }

  return (
    <div style={{ maxWidth: 560, margin: "40px auto", padding: 16 }}>
      <h2 style={{ marginBottom: 6 }}>EduClear Parent Portal</h2>
      <p style={{ marginTop: 0, color: "#b48a00", fontWeight: 600 }}>Secure access to homework, notices, tuckshop and messages.</p>

      <div style={{ display: "flex", gap: 10, margin: "16px 0" }}>
        <button
          type="button"
          onClick={() => setMode("login")}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(180, 138, 0, 0.35)",
            background: mode === "login" ? "#111" : "transparent",
            color: mode === "login" ? "#d4af37" : "#111",
            fontWeight: 700,
          }}
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => setMode("register")}
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            border: "1px solid rgba(180, 138, 0, 0.35)",
            background: mode === "register" ? "#111" : "transparent",
            color: mode === "register" ? "#d4af37" : "#111",
            fontWeight: 700,
          }}
        >
          Register
        </button>
        <button
          type="button"
          onClick={() => navigate("/")}
          style={{ marginLeft: "auto", padding: "10px 14px", borderRadius: 10, background: "transparent", border: "1px solid #ddd" }}
        >
          Back
        </button>
      </div>

      <form onSubmit={doLogin} style={{ background: "#111", color: "#f8fafc", borderRadius: 16, padding: 16 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            <div style={{ fontWeight: 700, color: "#d4af37" }}>Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)" }}
              autoComplete="username"
            />
          </label>
          <label>
            <div style={{ fontWeight: 700, color: "#d4af37" }}>Password</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)" }}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
            />
          </label>

          {mode === "register" && (
            <div style={{ display: "grid", gap: 10, paddingTop: 10 }}>
              <div style={{ color: "#cbd5e1" }}>
                Your details must match an existing Parent record on the school system. We verify using your South African ID number and cell number.
              </div>
              <label>
                <div style={{ fontWeight: 700, color: "#d4af37" }}>Parent ID (recommended)</div>
                <input
                  value={parentId}
                  onChange={(e) => setParentId(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)" }}
                />
              </label>
              <label>
                <div style={{ fontWeight: 700, color: "#d4af37" }}>Phone (cell no)</div>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)" }}
                />
              </label>
              <label>
                <div style={{ fontWeight: 700, color: "#d4af37" }}>ID Number</div>
                <input
                  value={idNumber}
                  onChange={(e) => setIdNumber(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)" }}
                />
              </label>
              <label>
                <div style={{ fontWeight: 700, color: "#d4af37" }}>School ID (optional, helps if phone matches multiple)</div>
                <input
                  value={schoolId}
                  onChange={(e) => setSchoolId(e.target.value)}
                  style={{ width: "100%", padding: 10, borderRadius: 12, border: "1px solid rgba(212,175,55,0.35)" }}
                />
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            style={{
              marginTop: 6,
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid rgba(212,175,55,0.55)",
              background: canSubmit ? "#d4af37" : "#6b7280",
              color: "#111",
              fontWeight: 900,
              cursor: canSubmit ? "pointer" : "not-allowed",
            }}
          >
            {mode === "login" ? "Login" : "Register + Login"}
          </button>

          {status && <div style={{ marginTop: 8, color: "#e2e8f0" }}>{status}</div>}
        </div>
      </form>
    </div>
  );
}

