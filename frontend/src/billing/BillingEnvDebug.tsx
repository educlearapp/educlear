import { useEffect, useState } from "react";
import { API_URL } from "../api";
import { fetchBillingServerEnv } from "./billingApi";

const BUILD_LABEL =
  import.meta.env.VITE_FEE_CHECK_BUILD_ID ||
  import.meta.env.VITE_APP_VERSION ||
  "dev";

/** Visible only with `?debug=true` or `localStorage.showBillingDebug=true`. */
export function isBillingDebugVisible(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("debug") === "true") {
      return true;
    }
    return localStorage.getItem("showBillingDebug") === "true";
  } catch {
    return false;
  }
}

type BillingEnvDebugProps = {
  schoolId?: string | null;
};

/** Temporary cross-device billing/API diagnostics (payments regression). */
export default function BillingEnvDebug({ schoolId }: BillingEnvDebugProps) {
  const [visible, setVisible] = useState(isBillingDebugVisible);

  useEffect(() => {
    const sync = () => setVisible(isBillingDebugVisible());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  if (!visible) return null;
  const email = String(localStorage.getItem("userEmail") || "").trim() || "—";
  const role = String(localStorage.getItem("userRole") || "").trim() || "—";
  const sid = String(schoolId || localStorage.getItem("schoolId") || "").trim() || "—";
  const [serverEnv, setServerEnv] = useState<{
    databaseHost?: string;
    nodeEnv?: string;
    gitCommit?: string;
    serverTime?: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchBillingServerEnv()
      .then((data) => {
        if (cancelled || !data || typeof data !== "object") return;
        setServerEnv({
          databaseHost: String((data as { databaseHost?: string }).databaseHost || "—"),
          nodeEnv: String((data as { nodeEnv?: string }).nodeEnv || "—"),
          gitCommit: String((data as { gitCommit?: string }).gitCommit || "—"),
          serverTime: String((data as { serverTime?: string }).serverTime || ""),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      role="status"
      aria-label="Billing environment debug"
      style={{
        marginBottom: 10,
        padding: "8px 12px",
        borderRadius: 8,
        border: "1px dashed rgba(212, 175, 55, 0.55)",
        background: "rgba(15, 23, 42, 0.04)",
        fontSize: 11,
        lineHeight: 1.45,
        color: "#475569",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <strong style={{ color: "#0f172a" }}>Billing debug</strong>
      {" · "}
      build {BUILD_LABEL}
      {" · "}
      API {API_URL}
      {" · "}
      {email} ({role})
      {" · "}
      school {sid}
      {serverEnv ? (
        <>
          {" · "}
          backend {serverEnv.nodeEnv} @ {serverEnv.databaseHost}
          {" · "}
          commit {serverEnv.gitCommit}
          {serverEnv.serverTime ? ` · srv ${serverEnv.serverTime}` : ""}
        </>
      ) : (
        <> · backend …</>
      )}
    </div>
  );
}
