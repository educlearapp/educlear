import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  fetchStaffClockHistory,
  fetchStaffClockStatus,
  postStaffAbsence,
  postStaffClockIn,
  postStaffClockOut,
  postStaffMovementLeave,
  postStaffMovementReturn,
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
import {
  buildLocationHelpContent,
  detectDeviceGuidanceKind,
  queryGeolocationPermissionState,
  shouldShowLocationHelp,
  type EduClockLocationHelpContent,
  type EduClockPermissionQueryState,
} from "./educlockLocationPermissionHelp";
import {
  STAFF_ABSENCE_REASONS,
  STAFF_ABSENCE_REASON_LABELS,
  absenceNoteRequired,
  formatSchoolLocalDateLong,
  isAbsentStaffStatus,
  validateStaffAbsenceForm,
} from "./educlockAbsenceUi";
import {
  STAFF_MOVEMENT_REASON_LABELS,
  STAFF_MOVEMENT_REASONS,
  formatElapsedAwayMs,
  movementDestinationRequired,
  movementNoteRequired,
  validateStaffMovementForm,
} from "./educlockMovementUi";

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
  const [permissionState, setPermissionState] = useState<EduClockPermissionQueryState | null>(null);
  const [showLocationHelp, setShowLocationHelp] = useState(false);
  const [locationHelp, setLocationHelp] = useState<EduClockLocationHelpContent>(() =>
    buildLocationHelpContent(detectDeviceGuidanceKind())
  );
  const [lastGeoFailure, setLastGeoFailure] = useState<EduClockGeoFailure | null>(null);
  const [absenceStep, setAbsenceStep] = useState<null | "form" | "confirm">(null);
  const [absenceReason, setAbsenceReason] = useState("");
  const [absenceNote, setAbsenceNote] = useState("");
  const [absenceError, setAbsenceError] = useState("");
  const [absenceSaving, setAbsenceSaving] = useState(false);
  const [movementStep, setMovementStep] = useState<null | "form" | "confirm">(null);
  const [movementReason, setMovementReason] = useState("");
  const [movementDestination, setMovementDestination] = useState("");
  const [movementNote, setMovementNote] = useState("");
  const [movementError, setMovementError] = useState("");
  const [movementSaving, setMovementSaving] = useState(false);
  const [movementElapsedMs, setMovementElapsedMs] = useState(0);
  const inFlight = useRef(false);
  const actionKeyRef = useRef<string | null>(null);
  const lastActionRef = useRef<ClockAction | null>(null);
  const geoRequestCountRef = useRef(0);

  const busy = phase === "locating" || phase === "submitting";

  const refreshPermissionState = useCallback(async () => {
    const state = await queryGeolocationPermissionState();
    setPermissionState(state);
    setLocationHelp(buildLocationHelpContent(detectDeviceGuidanceKind()));
    return state;
  }, []);

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
    void refreshPermissionState();
  }, [reload, refreshPermissionState]);

  useEffect(() => {
    const onForeground = () => {
      // Re-check permission only — never auto clock.
      if (document.visibilityState === "visible") {
        void refreshPermissionState();
      }
    };
    const onPageShow = () => {
      void refreshPermissionState();
    };
    document.addEventListener("visibilitychange", onForeground);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onForeground);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onPageShow);
    };
  }, [refreshPermissionState]);

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

  useEffect(() => {
    const departedAt = status?.openMovement?.departedAtUtc;
    const serverNow = status?.serverTimeUtc;
    if (!departedAt || !status?.offPremises) {
      setMovementElapsedMs(0);
      return;
    }
    const departedMs = Date.parse(String(departedAt));
    const serverMs = Date.parse(String(serverNow || "")) || Date.now();
    const loadedAt = Date.now();
    const tick = () => {
      const elapsed = Math.max(0, serverMs + (Date.now() - loadedAt) - departedMs);
      setMovementElapsedMs(elapsed);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [status?.offPremises, status?.openMovement?.departedAtUtc, status?.serverTimeUtc]);

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
      setLastGeoFailure(null);
      setShowLocationHelp(false);
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

    const perm = await refreshPermissionState();
    const capture = await captureStaffGeolocation();
    if (!capture.ok) {
      setLastGeoFailure(capture.failure);
      const help = shouldShowLocationHelp({
        permissionQueryState: perm,
        geoFailureCode: capture.failure.locationError,
      });
      setShowLocationHelp(help);
      if (help) {
        setLocationHelp(buildLocationHelpContent(detectDeviceGuidanceKind()));
      }
      await submitClock(action, buildClockPayloadFromGeoFailure(capture.failure), capture.failure);
      return;
    }
    setLastGeoFailure(null);
    setShowLocationHelp(false);
    await submitClock(action, buildClockPayloadFromCapture(capture.location), null);
  }

  function onClockIn() {
    void runClockAction("in", { newKey: true });
  }

  function onClockOut() {
    void runClockAction("out", { newKey: true });
  }

  function onRetryLocation() {
    const action = lastActionRef.current;
    if (!action) {
      // Retry Location without a prior clock action: only re-check permission / capture readiness.
      void (async () => {
        setError("");
        setSuccess("");
        setPhase("locating");
        const perm = await refreshPermissionState();
        const capture = await captureStaffGeolocation();
        setPhase("idle");
        if (!capture.ok) {
          setLastGeoFailure(capture.failure);
          setError(capture.failure.staffMessage);
          const help = shouldShowLocationHelp({
            permissionQueryState: perm,
            geoFailureCode: capture.failure.locationError,
          });
          setShowLocationHelp(help);
          if (help) setLocationHelp(buildLocationHelpContent(detectDeviceGuidanceKind()));
          return;
        }
        setLastGeoFailure(null);
        setShowLocationHelp(false);
        setError("");
        setSuccess("Location ready. Press Clock In or Clock Out to continue.");
      })();
      return;
    }
    // Deliberate Retry after a completed rejection uses a new idempotency key and re-attempts clock.
    void runClockAction(action, { newKey: true });
  }

  function onShowLocationHelp() {
    setLocationHelp(buildLocationHelpContent(detectDeviceGuidanceKind()));
    setShowLocationHelp(true);
  }

  function resetAbsenceForm() {
    setAbsenceStep(null);
    setAbsenceReason("");
    setAbsenceNote("");
    setAbsenceError("");
    setAbsenceSaving(false);
  }

  function onOpenAbsenceForm() {
    setError("");
    setSuccess("");
    setAbsenceError("");
    setAbsenceStep("form");
  }

  function onAbsenceContinue() {
    const check = validateStaffAbsenceForm({ reason: absenceReason, note: absenceNote });
    if (!check.ok) {
      setAbsenceError(check.error);
      return;
    }
    setAbsenceError("");
    setAbsenceStep("confirm");
  }

  async function onConfirmAbsence() {
    const check = validateStaffAbsenceForm({ reason: absenceReason, note: absenceNote });
    if (!check.ok) {
      setAbsenceError(check.error);
      setAbsenceStep("form");
      return;
    }
    if (absenceSaving) return;
    setAbsenceSaving(true);
    setAbsenceError("");
    try {
      await postStaffAbsence({
        reason: absenceReason,
        note: absenceNote.trim() ? absenceNote.trim() : null,
      });
      resetAbsenceForm();
      setSuccess("");
      await reload();
    } catch (err: unknown) {
      setAbsenceError(err instanceof Error ? err.message : "Failed to report absence");
      setAbsenceSaving(false);
    }
  }

  function resetMovementForm() {
    setMovementStep(null);
    setMovementReason("");
    setMovementDestination("");
    setMovementNote("");
    setMovementError("");
    setMovementSaving(false);
  }

  function onOpenMovementForm() {
    setError("");
    setSuccess("");
    setMovementError("");
    setMovementStep("form");
  }

  function onMovementContinue() {
    const check = validateStaffMovementForm({
      reason: movementReason,
      destination: movementDestination,
      note: movementNote,
    });
    if (!check.ok) {
      setMovementError(check.error);
      return;
    }
    setMovementError("");
    setMovementStep("confirm");
  }

  async function captureOptionalMovementGps(): Promise<Record<string, unknown> | null> {
    const capture = await captureStaffGeolocation();
    if (!capture.ok) return null;
    return {
      latitude: capture.location.latitude,
      longitude: capture.location.longitude,
      accuracyMetres: capture.location.accuracyMetres,
    };
  }

  async function onConfirmLeavePremises() {
    const check = validateStaffMovementForm({
      reason: movementReason,
      destination: movementDestination,
      note: movementNote,
    });
    if (!check.ok) {
      setMovementError(check.error);
      setMovementStep("form");
      return;
    }
    if (movementSaving) return;
    setMovementSaving(true);
    setMovementError("");
    try {
      const gps = await captureOptionalMovementGps();
      await postStaffMovementLeave({
        reason: movementReason,
        destination: movementDestination.trim() ? movementDestination.trim() : null,
        note: movementNote.trim() ? movementNote.trim() : null,
        gps,
        idempotencyKey: makeIdempotencyKey("leave"),
      });
      resetMovementForm();
      setSuccess("");
      await reload();
    } catch (err: unknown) {
      setMovementError(err instanceof Error ? err.message : "Failed to record departure");
      setMovementSaving(false);
    }
  }

  async function onReturnToPremises() {
    if (movementSaving) return;
    setMovementSaving(true);
    setMovementError("");
    setError("");
    try {
      const gps = await captureOptionalMovementGps();
      await postStaffMovementReturn({
        gps,
        idempotencyKey: makeIdempotencyKey("return"),
      });
      setMovementSaving(false);
      await reload();
    } catch (err: unknown) {
      setMovementError(err instanceof Error ? err.message : "Failed to record return");
      setMovementSaving(false);
    }
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
  const missingClockOut = status.currentStatus === "MISSING_CLOCK_OUT";
  const clockedIn = status.currentStatus === "CLOCKED_IN";
  const reportedAbsent = isAbsentStaffStatus(status.currentStatus);
  const offPremises = Boolean(status.offPremises || status.openMovement);
  const canReportAbsent =
    Boolean(status.canReportAbsent) &&
    !blocked &&
    !clockedIn &&
    !missingClockOut &&
    !reportedAbsent;
  const canLeavePremises =
    Boolean(status.canLeavePremises) && clockedIn && !offPremises && !missingClockOut && !blocked;
  const showClockActions =
    !blocked && !reportedAbsent && absenceStep == null && movementStep == null && !offPremises;

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

  const deniedHelpVisible =
    showLocationHelp ||
    shouldShowLocationHelp({
      permissionQueryState: permissionState,
      geoFailureCode: lastGeoFailure?.locationError,
    });

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
          {reportedAbsent
            ? "Absent Reported"
            : offPremises
              ? "Off Premises"
            : status.currentStatus === "CLOCKED_IN"
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
            {!missingClockOut && status.currentShiftDurationDisplay
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
      ) : reportedAbsent ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "#f5f3ff",
            border: "1px solid #ddd6fe",
          }}
        >
          <strong style={{ color: "#5b21b6", fontSize: 18 }}>Absent Reported</strong>
          <p style={{ margin: "8px 0 0", fontWeight: 700 }}>
            Reason:{" "}
            {String(
              status.absence?.reasonLabel ||
                STAFF_ABSENCE_REASON_LABELS[
                  status.absence?.reason as keyof typeof STAFF_ABSENCE_REASON_LABELS
                ] ||
                "—"
            )}
          </p>
          {status.absence?.reportedTimeDisplay ? (
            <p className="teacher-muted" style={{ margin: "6px 0 0" }}>
              Reported at {String(status.absence.reportedTimeDisplay)}
            </p>
          ) : null}
          <p style={{ margin: "12px 0 0", color: "#5b21b6", lineHeight: 1.45 }}>
            If your circumstances change and you need to report for work, contact management to
            correct today’s attendance status.
          </p>
        </section>
      ) : offPremises ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "#ecfeff",
            border: "1px solid #a5f3fc",
          }}
        >
          <strong style={{ color: "#155e75", fontSize: 18 }}>OFF PREMISES</strong>
          <p style={{ margin: "8px 0 0", fontWeight: 700 }}>
            Left at {String(status.openMovement?.departedTimeDisplay || "—")}
          </p>
          <p style={{ margin: "6px 0 0", fontWeight: 700 }}>
            Reason:{" "}
            {String(
              status.openMovement?.reasonLabel ||
                STAFF_MOVEMENT_REASON_LABELS[
                  status.openMovement?.reason as keyof typeof STAFF_MOVEMENT_REASON_LABELS
                ] ||
                "—"
            )}
          </p>
          {status.openMovement?.destination ? (
            <p style={{ margin: "6px 0 0" }}>Destination: {String(status.openMovement.destination)}</p>
          ) : null}
          <p style={{ margin: "10px 0 0", fontSize: 22, fontWeight: 800, color: "#155e75" }}>
            Away {formatElapsedAwayMs(movementElapsedMs || Number(status.openMovement?.elapsedAwayMs || 0))}
          </p>
          {movementError ? (
            <p role="alert" className="teacher-error" style={{ marginTop: 10 }}>
              {movementError}
            </p>
          ) : null}
          <button
            type="button"
            className="teacher-touch-btn primary"
            disabled={movementSaving || busy}
            onClick={() => void onReturnToPremises()}
            style={{ width: "100%", minHeight: 52, marginTop: 14, fontWeight: 800 }}
          >
            {movementSaving ? "Recording return…" : "I Have Returned"}
          </button>
        </section>
      ) : movementStep === "form" ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>Leave Premises</h2>
          <p className="teacher-muted" style={{ margin: "8px 0 0" }}>
            You remain clocked in. This records a temporary departure.
          </p>
          <label style={{ display: "block", marginTop: 14, fontWeight: 700 }}>
            Reason
            <select
              value={movementReason}
              onChange={(e) => {
                setMovementReason(e.target.value);
                setMovementError("");
              }}
              required
              style={{ display: "block", width: "100%", marginTop: 6, minHeight: 48, padding: 10 }}
            >
              <option value="">Select a reason</option>
              {STAFF_MOVEMENT_REASONS.map((code) => (
                <option key={code} value={code}>
                  {STAFF_MOVEMENT_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 14, fontWeight: 700 }}>
            Destination
            {movementDestinationRequired(movementReason) ? " (required)" : " (optional)"}
            <input
              value={movementDestination}
              onChange={(e) => setMovementDestination(e.target.value)}
              maxLength={200}
              style={{ display: "block", width: "100%", marginTop: 6, minHeight: 48, padding: 10, boxSizing: "border-box" }}
            />
          </label>
          <label style={{ display: "block", marginTop: 14, fontWeight: 700 }}>
            Additional note{movementNoteRequired(movementReason) ? " (required)" : " (optional)"}
            <textarea
              value={movementNote}
              onChange={(e) => setMovementNote(e.target.value)}
              rows={3}
              maxLength={500}
              style={{
                display: "block",
                width: "100%",
                marginTop: 6,
                padding: 10,
                boxSizing: "border-box",
              }}
            />
          </label>
          {movementError ? (
            <p role="alert" className="teacher-error" style={{ marginTop: 10 }}>
              {movementError}
            </p>
          ) : null}
          <button
            type="button"
            className="teacher-touch-btn primary"
            onClick={onMovementContinue}
            style={{ width: "100%", minHeight: 52, marginTop: 14, fontWeight: 800 }}
          >
            Continue
          </button>
          <button
            type="button"
            className="teacher-touch-btn"
            onClick={resetMovementForm}
            style={{ width: "100%", minHeight: 48, marginTop: 8 }}
          >
            Cancel
          </button>
        </section>
      ) : movementStep === "confirm" ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>Confirm departure</h2>
          <p style={{ marginTop: 12, lineHeight: 1.5 }}>
            Leave school premises now? You remain clocked in.
          </p>
          <p style={{ fontWeight: 700 }}>
            Reason:{" "}
            {STAFF_MOVEMENT_REASON_LABELS[movementReason as keyof typeof STAFF_MOVEMENT_REASON_LABELS] ||
              movementReason}
          </p>
          {movementDestination.trim() ? (
            <p style={{ marginTop: 8 }}>Destination: {movementDestination.trim()}</p>
          ) : null}
          {movementNote.trim() ? <p style={{ marginTop: 8 }}>Note: {movementNote.trim()}</p> : null}
          {movementError ? (
            <p role="alert" className="teacher-error" style={{ marginTop: 10 }}>
              {movementError}
            </p>
          ) : null}
          <button
            type="button"
            className="teacher-touch-btn primary"
            disabled={movementSaving}
            onClick={() => void onConfirmLeavePremises()}
            style={{ width: "100%", minHeight: 52, marginTop: 14, fontWeight: 800 }}
          >
            {movementSaving ? "Recording…" : "Leave Premises"}
          </button>
          <button
            type="button"
            className="teacher-touch-btn"
            disabled={movementSaving}
            onClick={resetMovementForm}
            style={{ width: "100%", minHeight: 48, marginTop: 8 }}
          >
            Cancel
          </button>
        </section>
      ) : absenceStep === "form" ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>Report Absence</h2>
          <p className="teacher-muted" style={{ margin: "8px 0 0" }}>
            {formatSchoolLocalDateLong(status.schoolLocalDate)}
          </p>
          <label style={{ display: "block", marginTop: 14, fontWeight: 700 }}>
            Reason
            <select
              value={absenceReason}
              onChange={(e) => {
                setAbsenceReason(e.target.value);
                setAbsenceError("");
              }}
              required
              style={{ display: "block", width: "100%", marginTop: 6, minHeight: 48, padding: 10 }}
            >
              <option value="">Select a reason</option>
              {STAFF_ABSENCE_REASONS.map((code) => (
                <option key={code} value={code}>
                  {STAFF_ABSENCE_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "block", marginTop: 14, fontWeight: 700 }}>
            Additional note{absenceNoteRequired(absenceReason) ? " (required)" : " (optional)"}
            <textarea
              value={absenceNote}
              onChange={(e) => setAbsenceNote(e.target.value)}
              rows={3}
              maxLength={500}
              style={{
                display: "block",
                width: "100%",
                marginTop: 6,
                padding: 10,
                boxSizing: "border-box",
              }}
            />
          </label>
          {absenceError ? (
            <p role="alert" className="teacher-error" style={{ marginTop: 10 }}>
              {absenceError}
            </p>
          ) : null}
          <button
            type="button"
            className="teacher-touch-btn primary"
            onClick={onAbsenceContinue}
            style={{ width: "100%", minHeight: 52, marginTop: 14, fontWeight: 800 }}
          >
            Continue
          </button>
          <button
            type="button"
            className="teacher-touch-btn"
            onClick={resetAbsenceForm}
            style={{ width: "100%", minHeight: 48, marginTop: 8 }}
          >
            Cancel
          </button>
        </section>
      ) : absenceStep === "confirm" ? (
        <section
          style={{
            marginTop: 16,
            padding: 16,
            borderRadius: 12,
            background: "#fff",
            border: "1px solid #e5e7eb",
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18 }}>Confirm absence</h2>
          <p style={{ marginTop: 12, lineHeight: 1.5 }}>
            Report yourself absent for {formatSchoolLocalDateLong(status.schoolLocalDate)}?
          </p>
          <p style={{ fontWeight: 700 }}>
            Reason:{" "}
            {STAFF_ABSENCE_REASON_LABELS[absenceReason as keyof typeof STAFF_ABSENCE_REASON_LABELS] ||
              absenceReason}
          </p>
          {absenceNote.trim() ? <p style={{ marginTop: 8 }}>Note: {absenceNote.trim()}</p> : null}
          {absenceError ? (
            <p role="alert" className="teacher-error" style={{ marginTop: 10 }}>
              {absenceError}
            </p>
          ) : null}
          <button
            type="button"
            className="teacher-touch-btn primary"
            disabled={absenceSaving}
            onClick={() => void onConfirmAbsence()}
            style={{ width: "100%", minHeight: 52, marginTop: 14, fontWeight: 800 }}
          >
            {absenceSaving ? "Reporting…" : "Report Absent"}
          </button>
          <button
            type="button"
            className="teacher-touch-btn"
            disabled={absenceSaving}
            onClick={resetAbsenceForm}
            style={{ width: "100%", minHeight: 48, marginTop: 8 }}
          >
            Cancel
          </button>
        </section>
      ) : (
        <div style={{ marginTop: 20 }}>
          {missingClockOut ? (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#fff7ed" }}>
              <strong>Missing clock-out</strong>
              <p style={{ margin: "8px 0 0", color: "#9a3412" }}>
                This shift is missing a clock-out from a previous attendance day. Ask the school
                owner to correct attendance. Duration is not accumulated.
              </p>
            </div>
          ) : !clockedIn ? (
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
              disabled={busy || offPremises}
              onClick={onClockOut}
              style={{
                width: "100%",
                minHeight: 64,
                fontSize: 18,
                fontWeight: 800,
                background: "#b91c1c",
                opacity: offPremises ? 0.45 : 1,
              }}
            >
              {buttonLabel}
            </button>
          )}
          {canLeavePremises ? (
            <button
              type="button"
              className="teacher-touch-btn"
              disabled={busy || movementSaving}
              onClick={onOpenMovementForm}
              style={{
                width: "100%",
                minHeight: 48,
                marginTop: 10,
                fontSize: 16,
                fontWeight: 600,
                background: "#fff",
                color: "#155e75",
                border: "1px solid #67e8f9",
              }}
            >
              Leave Premises
            </button>
          ) : null}
          {canReportAbsent && !clockedIn && !missingClockOut ? (
            <button
              type="button"
              className="teacher-touch-btn"
              disabled={busy}
              onClick={onOpenAbsenceForm}
              style={{
                width: "100%",
                minHeight: 48,
                marginTop: 10,
                fontSize: 16,
                fontWeight: 600,
                background: "#fff",
                color: "#334155",
                border: "1px solid #cbd5e1",
              }}
            >
              Report Absent
            </button>
          ) : null}
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
        </div>
      ) : null}

      {showClockActions ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <button
            type="button"
            className="teacher-touch-btn"
            onClick={onRetryLocation}
            disabled={busy}
          >
            Retry Location
          </button>
          <button
            type="button"
            className="teacher-touch-btn"
            onClick={onShowLocationHelp}
            disabled={busy}
          >
            Location Help
          </button>
        </div>
      ) : null}

      {deniedHelpVisible ? (
        <section
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            background: "#fff7ed",
            border: "1px solid #fdba74",
          }}
          data-educlock-location-help={locationHelp.kind}
        >
          <strong style={{ color: "#9a3412" }}>{locationHelp.title}</strong>
          <ol style={{ margin: "10px 0 0", paddingLeft: 18, color: "#7c2d12", lineHeight: 1.45 }}>
            {locationHelp.steps.map((step) => (
              <li key={step} style={{ marginBottom: 6 }}>
                {step}
              </li>
            ))}
          </ol>
          {locationHelp.note ? (
            <p style={{ margin: "8px 0 0", color: "#9a3412", fontSize: 13 }}>{locationHelp.note}</p>
          ) : null}
          {permissionState ? (
            <p style={{ margin: "8px 0 0", color: "#78716c", fontSize: 12 }}>
              Permission status: {permissionState}
            </p>
          ) : null}
        </section>
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
