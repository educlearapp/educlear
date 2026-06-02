import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  detectActiveSessionKind,
  performInactivityLogout,
  type ActiveSessionKind,
} from "./sessionLogout";

const WARNING_MS = 4 * 60 * 1000;
const LOGOUT_MS = 5 * 60 * 1000;
const ACTIVITY_THROTTLE_MS = 1000;

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousedown",
  "mousemove",
  "keydown",
  "click",
  "scroll",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
];

export default function InactivityLogoutManager() {
  const location = useLocation();
  const [warningOpen, setWarningOpen] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionKindRef = useRef<ActiveSessionKind | null>(null);
  const throttledUntilRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) {
      clearTimeout(warningTimerRef.current);
      warningTimerRef.current = null;
    }
    if (logoutTimerRef.current) {
      clearTimeout(logoutTimerRef.current);
      logoutTimerRef.current = null;
    }
  }, []);

  const scheduleTimers = useCallback(() => {
    clearTimers();
    const kind = sessionKindRef.current;
    if (!kind) return;

    const now = Date.now();
    const idleMs = now - lastActivityRef.current;
    const warningDelay = Math.max(0, WARNING_MS - idleMs);
    const logoutDelay = Math.max(0, LOGOUT_MS - idleMs);

    warningTimerRef.current = setTimeout(() => {
      if (!sessionKindRef.current) return;
      setWarningOpen(true);
    }, warningDelay);

    logoutTimerRef.current = setTimeout(() => {
      const activeKind = sessionKindRef.current;
      if (!activeKind) return;
      setWarningOpen(false);
      performInactivityLogout(activeKind);
    }, logoutDelay);
  }, [clearTimers]);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    setWarningOpen(false);
    scheduleTimers();
  }, [scheduleTimers]);

  const onActivity = useCallback(() => {
    const now = Date.now();
    if (now < throttledUntilRef.current) return;
    throttledUntilRef.current = now + ACTIVITY_THROTTLE_MS;
    resetActivity();
  }, [resetActivity]);

  const stayLoggedIn = useCallback(() => {
    resetActivity();
  }, [resetActivity]);

  useEffect(() => {
    const kind = detectActiveSessionKind(location.pathname);
    sessionKindRef.current = kind;

    if (!kind) {
      clearTimers();
      setWarningOpen(false);
      return;
    }

    lastActivityRef.current = Date.now();
    scheduleTimers();

    const listenerOptions: AddEventListenerOptions = { passive: true, capture: true };
    for (const eventName of ACTIVITY_EVENTS) {
      window.addEventListener(eventName, onActivity, listenerOptions);
    }

    return () => {
      clearTimers();
      for (const eventName of ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, onActivity, listenerOptions);
      }
    };
  }, [location.pathname, onActivity, scheduleTimers, clearTimers]);

  if (!warningOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="inactivity-logout-title"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        background: "rgba(0,0,0,0.72)",
      }}
    >
      <div
        style={{
          width: "min(440px, 100%)",
          borderRadius: 14,
          border: "2px solid #d4af37",
          background: "#0a0a0a",
          color: "#fff",
          padding: "24px 22px",
          boxShadow: "0 0 24px rgba(212, 175, 55, 0.25)",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <h2 id="inactivity-logout-title" style={{ margin: "0 0 12px", color: "#d4af37", fontSize: "1.15rem" }}>
          Session timeout
        </h2>
        <p style={{ margin: "0 0 20px", lineHeight: 1.55, color: "rgba(255,255,255,0.9)" }}>
          You will be logged out in 1 minute due to inactivity.
        </p>
        <button
          type="button"
          onClick={stayLoggedIn}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            border: "none",
            background: "#d4af37",
            color: "#111",
            fontWeight: 800,
            fontSize: 15,
            cursor: "pointer",
          }}
        >
          Stay logged in
        </button>
      </div>
    </div>
  );
}
