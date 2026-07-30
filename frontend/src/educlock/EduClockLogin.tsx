import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../api";
import { consumeInactivityLogoutMessage } from "../auth/sessionLogout";
import { clearEduClearRole, syncEduClearRoleFromLoginResponse } from "../auth/roles";
import { clearSuperAdminSession } from "../auth/superAdminSession";
import { cacheSchoolLogoUrl } from "../utils/schoolLogo";

export default function EduClockLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const inactivityMessage = consumeInactivityLogoutMessage();
    if (inactivityMessage) setStatus(inactivityMessage);
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("Signing in…");
    setLoading(true);
    clearEduClearRole();
    clearSuperAdminSession();
    try {
      const data: any = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const token = data?.token;
      const schoolId = data?.schoolId ?? data?.school?.id ?? data?.user?.schoolId;
      if (!token) throw new Error("Login response missing token.");
      if (!schoolId) throw new Error("Your account is not linked to a school.");

      localStorage.setItem("token", String(token));
      localStorage.setItem("schoolId", String(schoolId));
      const schoolName = data?.school?.name ?? data?.schoolName ?? data?.user?.schoolName;
      if (schoolName) localStorage.setItem("schoolName", String(schoolName));
      const logoUrl = data?.school?.logoUrl;
      if (logoUrl) cacheSchoolLogoUrl(String(logoUrl));

      const u = data?.user;
      if (u?.email) localStorage.setItem("userEmail", String(u.email));
      localStorage.setItem("userName", String(u?.fullName || "Staff"));
      localStorage.setItem("userRole", String(u?.role || "STAFF"));

      syncEduClearRoleFromLoginResponse(data);
      setStatus("");
      navigate("/educlock/activate", { replace: true });
    } catch (err: unknown) {
      setStatus(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="teacher-app-main" style={{ maxWidth: 480 }}>
      <h1 className="teacher-app-title" style={{ marginBottom: 8 }}>
        EduClock
      </h1>
      <p className="teacher-muted" style={{ marginBottom: 24 }}>
        Sign in with your EduClear email and password to activate staff clock access.
      </p>
      <form onSubmit={onSubmit}>
        <div className="teacher-field">
          <label htmlFor="ec-email">Email</label>
          <input
            id="ec-email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="teacher-field">
          <label htmlFor="ec-pass">Password</label>
          <input
            id="ec-pass"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <button type="submit" className="teacher-touch-btn primary" disabled={loading} style={{ width: "100%" }}>
          {loading ? "Please wait…" : "Sign in"}
        </button>
      </form>
      {status && <p className="teacher-error">{status}</p>}
    </main>
  );
}
