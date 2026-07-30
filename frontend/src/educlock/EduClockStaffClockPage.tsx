import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchStaffClockHistory,
  fetchStaffClockStatus,
  postStaffClockIn,
  postStaffClockOut,
  type EduClockStaffStatus,
} from "./educlockApi";
import {
  buildClockPayloadFromCapture,
  buildClockPayloadFromGeoFailure,
  captureStaffGeolocation,
  formatClockSuccessMessage,
  resolveClockErrorMessage,
  type EduClockClockGpsPayload,
  type EduClockGeoFailure,
} from "./educlockStaffGeolocation";

type Phase = "idle" | "locating" | "submitting" | "error";
type ClockAction = "in" | "out";

function makeIdempotencyKey(op: string): string {
  return `${op}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readEventField(
  event: Record<string, unknown> | undefined,
  key: string
): string | null {
  if (!event) return null;
  const v = event[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export default function EduClockStaffClockPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pendingAction, setPendingAction] = useState<ClockAction | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [status, setStatus] = useState<EduClockStaffStatus | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [liveClock, setLiveClock] = useState("");
  const inFlight = useRef(false);
  const actionKeyRef = useRef<string | null>(null);
  const lastActionRef = useRef<ClockAction | null>(null);
  const geoRequestCountRef = useRef(0);

  const busy = phase === "locating" || phase === "submitting";

  const reload = useCallback(async () => {
    const token = localStorage.getItem("token");
    const schoolId = localStorage.getItem("schoolId");
    if (!token || !schoolId) {
      navigate("/educlock/login", { replace: true });
      return;
    }
    try {
      const [st, hist] = await Promise.all([fetchStaffClockStatus(), fetchStaffClockHistory()]);
      setStatus(st);
      setHistory((hist.shifts || []) as Array<Record<string, unknown>>);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load EduClock status");
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const tick = () => {
      // Display-only live clock; official times always come from the server.
      const now = new Date();
      setLiveClock(
        now.toLocaleTimeString("en-ZA", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
          timeZone: status?.timezone || "Africa/Johannesburg",
        })
      );
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status?.timezone]);

  async function submitClock(action: ClockAction, gps: EduClockClockGpsPayload, geoFailure: EduClockGeoFailure | null) {
    const key = actionKeyRef.current || makeIdempotencyKey(action);
    actionKeyRef.current = key;
    setPhase("submitting");
    setPendingAction(action);
    try {
      const result =
        action === "in"
          ? await postStaffClockIn({ idempotencyKey: key, gps })
          : await postStaffClockOut({ idempotencyKey: key, gps });
      const event = (result.event || {}) as Record<string, unknown>;
      setSuccess(
        formatClockSuccessMessage({
          action,
          backendMessage: result.message ? String(result.message) : undefined,
          schoolLocalTimeDisplay: readEventField(event, "schoolLocalTimeDisplay"),
          matchedEntranceName: readEventField(event, "matchedEntranceName"),
          campusName: readEventField(event, "campusName"),
        })
      );
      setStatus((result.status as EduClockStaffStatus) || null);
      setError("");
      setPhase("idle");
      setPendingAction(null);
      actionKeyRef.current = null;
      lastActionRef.current = null;
      await reload();
    } catch (err: unknown) {
      const backendMessage = err instanceof Error ? err.message : undefined;
      setError(resolveClockErrorMessage({ backendMessage, geoFailure }));
      setSuccess("");
      setPhase("error");
      // Keep lastActionRef for deliberate Retry (new key). Clear in-flight key so Retry is fresh.
      actionKeyRef.current = null;
    } finally {
      inFlight.current = false;
      setPendingAction(null);
    }
  }

  async function runClockAction(action: ClockAction, opts?: { newKey?: boolean }) {
    if (inFlight.current || busy) return;
    inFlight.current = true;
    lastActionRef.current = action;
    if (opts?.newKey || !actionKeyRef.current) {
      actionKeyRef.current = makeIdempotencyKey(action);
    }
    setError("");
    setSuccess("");
    setPhase("locating");
    setPendingAction(action);
    geoRequestCountRef.current += 1;

    const capture = await captureStaffGeolocation();
    if (!capture.ok) {
      await submitClock(action, buildClockPayloadFromGeoFailure(capture.failure), capture.failure);
      return;
    }
    await submitClock(action, buildClockPayloadFromCapture(capture.location), null);
  }

  function onClockIn() {
    void runClockAction("in", { newKey: true });
  }

  function onClockOut() {
    void runClockAction("out", { newKey: true });
  }

  function onRetry() {
    const action = lastActionRef.current;
    if (!action) {
      setPhase("idle");
      setError("");
      return;
    }
    // Deliberate Retry after a completed rejection uses a new idempotency key.
    void runClockAction(action, { newKey: true });
  }

  if (loading) {
    return (
      <main className="teacher-app-main" style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
        <h1 className="teacher-app-title">EduClock</h1>
        <p className="teacher-muted">Loading…</p>
      </main>
    );
  }

  if (!status) {
    return (
      <main className="teacher-app-main" style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
        <h1 className="teacher-app-title">EduClock</h1>
        <p className="teacher-error">{error || "Unable to load status"}</p>
        <Link to="/educlock/login" className="teacher-touch-btn">
          Sign in
        </Link>
      </main>
    );
  }

  const blocked = status.readiness === "BLOCKED" || status.canClock === false;
  const clockedIn =
    status.currentStatus === "CLOCKED_IN" || status.currentStatus === "MISSING_CLOCK_OUT";

  const locatingLabel = "Checking your location…";
  const submittingLabel =
    pendingAction === "out" || (phase === "submitting" && clockedIn)
      ? "Clocking out…"
      : "Clocking in…";
  const buttonLabel = (() => {
    if (phase === "locating") return locatingLabel;
    if (phase === "submitting") return submittingLabel;
    return clockedIn ? "Clock Out" : "Clock In";
  })();

  return (
    <main className="teacher-app-main" style={{ maxWidth: 480, margin: "0 auto", padding: 16 }}>
      <h1 className="teacher-app-title" style={{ color: "#d4af37" }}>
        EduClock
      </h1>
      <p className="teacher-muted" style={{ marginTop: 0 }}>
        {status.employeeFirstName} {status.employeeLastName}
      </p>
      <p style={{ fontWeight: 700, marginTop: 4 }}>Emp. no. {status.employeeNumber || "—"}</p>

      <section
        style={{
          marginTop: 20,
          padding: 16,
          borderRadius: 14,
          background: "#111827",
          color: "#f8fafc",
        }}
      >
        <div style={{ fontSize: 13, color: "#94a3b8" }}>School-local (server)</div>
        <div style={{ fontSize: 28, fontWeight: 800, marginTop: 4 }}>
          {status.schoolLocalTimeDisplay || "—"}
        </div>
        <div style={{ fontSize: 14, marginTop: 4 }}>{status.schoolLocalDate}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          Display clock: {liveClock} · TZ {status.timezone}
        </div>
        <div style={{ marginTop: 12, fontWeight: 800 }}>
          Status:{" "}
          {status.currentStatus === "CLOCKED_IN"
            ? "Clocked In"
            : status.currentStatus === "MISSING_CLOCK_OUT"
              ? "Missing Clock Out"
              : status.currentStatus === "BLOCKED"
                ? "Blocked"
                : "Clocked Out"}
        </div>
        {status.activeClockIn ? (
          <div style={{ marginTop: 8, fontSize: 14 }}>
            Clocked in at {String(status.activeClockIn.schoolLocalTimeDisplay || "")}
            {status.currentShiftDurationDisplay
              ? ` · ${status.currentShiftDurationDisplay}`
              : ""}
          </div>
        ) : null}
      </section>

      {blocked ? (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#fffbeb" }}>
          <strong>Clocking blocked</strong>
          <p style={{ margin: "8px 0 0", color: "#92400e" }}>
            {status.readinessReason || (status.readinessReasons || []).join(", ")}
          </p>
          <Link to="/educlock/activate" className="teacher-touch-btn" style={{ marginTop: 12 }}>
            Check activation
          </Link>
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          {!clockedIn ? (
            <button
              type="button"
              className="teacher-touch-btn primary"
              disabled={busy}
              onClick={onClockIn}
              style={{ width: "100%", minHeight: 64, fontSize: 18, fontWeight: 800 }}
              data-educlock-geo-requests={geoRequestCountRef.current}
            >
              {buttonLabel}
            </button>
          ) : (
            <button
              type="button"
              className="teacher-touch-btn primary"
              disabled={busy}
              onClick={onClockOut}
              style={{
                width: "100%",
                minHeight: 64,
                fontSize: 18,
                fontWeight: 800,
                background: "#b91c1c",
              }}
            >
              {buttonLabel}
            </button>
          )}
          {phase === "locating" || phase === "submitting" ? (
            <p className="teacher-muted" style={{ marginTop: 10 }} aria-live="polite">
              {phase === "locating" ? locatingLabel : submittingLabel}
            </p>
          ) : null}
        </div>
      )}

      {success ? (
        <p role="status" style={{ color: "#15803d", fontWeight: 700, marginTop: 14 }}>
          {success}
        </p>
      ) : null}
      {error ? (
        <div style={{ marginTop: 14 }}>
          <p role="alert" className="teacher-error" style={{ margin: 0 }}>
            {error}
          </p>
          {phase === "error" && !blocked ? (
            <button
              type="button"
              className="teacher-touch-btn"
              onClick={onRetry}
              style={{ marginTop: 10 }}
              disabled={busy}
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>Recent shifts</h2>
        {history.length === 0 ? (
          <p className="teacher-muted">No completed shifts yet.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {history.map((shift, idx) => {
              const cin = shift.clockIn as Record<string, unknown> | undefined;
              const cout = shift.clockOut as Record<string, unknown> | undefined;
              return (
                <li
                  key={String(cout?.id || idx)}
                  style={{
                    padding: "10px 0",
                    borderBottom: "1px solid #e5e7eb",
                    fontSize: 14,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{String(shift.schoolLocalDate || "")}</div>
                  <div>
                    {String(cin?.schoolLocalTimeDisplay || "")} →{" "}
                    {String(cout?.schoolLocalTimeDisplay || "")} ·{" "}
                    {String(shift.durationDisplay || "")}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
