import * as React from "react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { apiFetch } from "./api";
import {
  clearStaffAuthSession,
  consumeInactivityLogoutMessage,
} from "./auth/sessionLogout";
import { SUPER_ADMIN_ENTRY_PATH } from "./auth/roles";
import {
  clearSuperAdminSession,
  syncSuperAdminSessionFromLoginResponse,
} from "./auth/superAdminSession";
import logo from "./assets/logo.png";
import "./SuperAdminDashboard.css";

type Props = {
  initialStatus?: string;
  returnPathOverride?: string;
};

function safeReturnPath(raw: string | null): string {
  const value = String(raw || "").trim();
  if (!value.startsWith("/super-admin")) {
    return SUPER_ADMIN_ENTRY_PATH;
  }
  return value;
}

export default function SuperAdminLogin({ initialStatus = "", returnPathOverride }: Props) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnPath = safeReturnPath(returnPathOverride ?? searchParams.get("return"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const inactivityMessage = consumeInactivityLogoutMessage();
    setStatus(inactivityMessage || initialStatus);
  }, [initialStatus]);

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setStatus("Signing in…");
    setLoading(true);
    clearSuperAdminSession();

    try {
      const data: Record<string, unknown> = (await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      })) as Record<string, unknown>;

      const isAllowedSuperAdmin = syncSuperAdminSessionFromLoginResponse(data);
      if (!isAllowedSuperAdmin) {
        throw new Error(
          "This account is not authorized for Super Admin. Use a platform super admin email."
        );
      }

      clearStaffAuthSession();
      navigate(returnPath, { replace: true });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setStatus(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="sa-login-shell">
      <div className="sa-login-card">
        <div className="sa-login-brand">
          <img src={logo} className="sa-login-logo" alt="EduClear" />
          <h1>Super Admin</h1>
          <p>Platform sign-in — separate from your school dashboard session.</p>
        </div>

        <form onSubmit={handleLogin} className="sa-login-form">
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>

          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {status ? (
            <p className="sa-login-status" role="status">
              {status}
            </p>
          ) : null}

          <button type="submit" className="sa-login-submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in to Super Admin"}
          </button>
        </form>
      </div>
    </div>
  );
}
