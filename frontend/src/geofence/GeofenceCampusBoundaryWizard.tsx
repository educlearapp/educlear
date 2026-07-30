/**
 * Campus Boundary wizard — Geofence Engine (EduClock consumer).
 * Phase 2A: Save Each Corner. Phase 2D: Draw Boundary (recommended).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { saveCampusBoundaryPolygon } from "./geofenceApi";
import {
  buildBoundaryProgressRows,
  canAddCorner,
  canFinishBoundary,
  GEOFENCE_POLYGON_MIN_VERTICES,
  resolveGpsSignalStatus,
  type DraftCorner,
} from "./geofenceCapture";
import type { DrawEntranceOverlay } from "./geofenceDrawBoundary";
import GeofenceDrawBoundaryWizard from "./GeofenceDrawBoundaryWizard";
import GeofenceLiveMap from "./GeofenceLiveMap";
import SecureConnectionNotice from "./SecureConnectionNotice";
import {
  isOwnerSecureContext,
  logInsecureContextDiagnostics,
  SECURE_CONNECTION_MESSAGE,
} from "./secureConnectionMessage";

type WizardStep = "choose" | "save_each_corner" | "draw_boundary";

type Props = {
  campusId: string;
  campusName: string;
  entrances?: DrawEntranceOverlay[];
  onClose: () => void;
  onSaved: () => void;
};

const GOLD = "#c9a227";
const BLACK = "#0a0a0a";
const WHITE = "#f8fafc";

const shellStyle: CSSProperties = {
  marginTop: 12,
  borderRadius: 18,
  border: "1px solid rgba(201,162,39,0.4)",
  background: BLACK,
  color: WHITE,
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  overflow: "hidden",
};

const btnBase: CSSProperties = {
  border: "none",
  borderRadius: 14,
  padding: "14px 16px",
  fontWeight: 800,
  fontSize: 15,
  cursor: "pointer",
  minHeight: 48,
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: GOLD,
  color: "#111827",
  boxShadow: "0 4px 14px rgba(201,162,39,0.35)",
};

const btnSecondary: CSSProperties = {
  ...btnBase,
  background: "#171717",
  color: WHITE,
  border: "1px solid #333",
};

const btnDanger: CSSProperties = {
  ...btnBase,
  background: "transparent",
  color: "#fca5a5",
  border: "1px solid #7f1d1d",
};

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 0,
};

function newCornerId(): string {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatClock(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function GeofenceCampusBoundaryWizard({
  campusId,
  campusName,
  entrances = [],
  onClose,
  onSaved,
}: Props) {
  const [step, setStep] = useState<WizardStep>("choose");
  const [corners, setCorners] = useState<DraftCorner[]>([]);
  const [paused, setPaused] = useState(false);
  const [live, setLive] = useState<{
    latitude: number;
    longitude: number;
    accuracyMetres: number | null;
  } | null>(null);
  const [lastGpsAt, setLastGpsAt] = useState<string | null>(null);
  const [geoError, setGeoError] = useState("");
  const [actionError, setActionError] = useState("");
  const [successFlash, setSuccessFlash] = useState("");
  const [highlightCount, setHighlightCount] = useState(false);
  const [animateCornerKey, setAnimateCornerKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [secureContextOk] = useState(() => isOwnerSecureContext());

  const watchIdRef = useRef<number | null>(null);
  const pausedRef = useRef(false);
  const hasLiveFixRef = useRef(false);
  const flashTimerRef = useRef<number | null>(null);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
    };
  }, []);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  const startWatch = useCallback(() => {
    stopWatch();
    setGeoError("");
    if (!navigator.geolocation) {
      setGeoError("Location is not available on this phone or browser.");
      return;
    }
    if (!isOwnerSecureContext()) {
      logInsecureContextDiagnostics("GeofenceCampusBoundaryWizard");
      setGeoError(SECURE_CONNECTION_MESSAGE);
      return;
    }
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (pausedRef.current) return;
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        const accuracyMetres =
          pos.coords.accuracy == null || !Number.isFinite(pos.coords.accuracy)
            ? null
            : pos.coords.accuracy;
        setGeoError("");
        hasLiveFixRef.current = true;
        setLive({ latitude, longitude, accuracyMetres });
        setLastGpsAt(new Date().toISOString());
      },
      (err) => {
        // Keep showing the last good fix; only surface hard errors when we have no position yet.
        if (hasLiveFixRef.current && err.code !== 1) return;
        if (err.code === 1) {
          setGeoError("Location permission is off. Turn it on for this site, then try again.");
        } else if (err.code === 3) {
          setGeoError("Location timed out. Step outside and try again.");
        } else {
          setGeoError("Could not read your location. Check location services and try again.");
        }
      },
      GEO_OPTIONS
    );
  }, [stopWatch]);

  useEffect(() => {
    if (step !== "save_each_corner") {
      stopWatch();
      return;
    }
    if (!paused) startWatch();
    else stopWatch();
    return () => stopWatch();
  }, [step, paused, startWatch, stopWatch]);

  function flashSuccess(message: string) {
    setSuccessFlash(message);
    setHighlightCount(true);
    if (flashTimerRef.current != null) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      setSuccessFlash("");
      setHighlightCount(false);
    }, 2200);
  }

  function confirmCancel() {
    if (corners.length > 0) {
      const ok = window.confirm(
        "Cancel setup? Corners saved in this session will be discarded (nothing is written until you Complete Boundary)."
      );
      if (!ok) return;
    }
    onClose();
  }

  function saveCorner() {
    setActionError("");
    if (!live) {
      setActionError("Waiting for your location…");
      return;
    }
    const check = canAddCorner(corners, live);
    if (!check.ok) {
      setActionError(
        check.error.includes("Too close")
          ? "You are still too close to the last corner. Walk a little further, then try again."
          : check.error
      );
      return;
    }
    const corner: DraftCorner = {
      id: newCornerId(),
      latitude: live.latitude,
      longitude: live.longitude,
      accuracyMetres: live.accuracyMetres,
      capturedAt: new Date().toISOString(),
    };
    setCorners((prev) => [...prev, corner]);
    setAnimateCornerKey(corner.id);
    flashSuccess("Corner saved successfully.");
  }

  function undoCorner() {
    setActionError("");
    setSuccessFlash("");
    setCorners((prev) => prev.slice(0, -1));
  }

  async function finishBoundary() {
    setActionError("");
    const check = canFinishBoundary(corners);
    if (!check.ok) {
      setActionError(check.error);
      return;
    }
    setSaving(true);
    try {
      await saveCampusBoundaryPolygon({
        campusId,
        name: `${campusName} Campus Boundary`,
        vertices: corners.map((c) => ({
          latitude: c.latitude,
          longitude: c.longitude,
          accuracyMetres: c.accuracyMetres,
          capturedAt: c.capturedAt,
        })),
        metadata: {
          captureMethod: "SAVE_EACH_CORNER",
          cornerCount: corners.length,
        },
      });
      onSaved();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not save the campus boundary.");
    } finally {
      setSaving(false);
    }
  }

  const gps = resolveGpsSignalStatus(live?.accuracyMetres);
  const canComplete = corners.length >= GEOFENCE_POLYGON_MIN_VERTICES;
  const progressRows = buildBoundaryProgressRows(corners.length);

  if (step === "draw_boundary") {
    return (
      <GeofenceDrawBoundaryWizard
        campusId={campusId}
        campusName={campusName}
        entrances={entrances}
        onClose={onClose}
        onSaved={onSaved}
        onBackToMethods={() => setStep("choose")}
      />
    );
  }

  if (step === "choose") {
    return (
      <div style={shellStyle} data-testid="geofence-campus-boundary-wizard">
        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 0.2 }}>
                Set Campus Boundary
              </div>
              <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 6 }}>{campusName}</div>
            </div>
            <button type="button" style={{ ...btnSecondary, padding: "10px 12px" }} onClick={confirmCancel}>
              Close
            </button>
          </div>

          <SecureConnectionNotice show={!secureContextOk} />

          <p style={{ margin: "16px 0 0", color: "#d4d4d4", fontSize: 14, lineHeight: 1.5 }}>
            Mark the outline of your school property. Staff clock-in stays the same until you
            approve polygon checks later.
          </p>

          <div style={{ marginTop: 18, display: "grid", gap: 14 }}>
            <div
              style={{
                borderRadius: 16,
                border: "1px solid rgba(201,162,39,0.55)",
                background: "#141414",
                padding: 14,
              }}
            >
              <div
                style={{
                  display: "inline-block",
                  fontSize: 11,
                  fontWeight: 900,
                  letterSpacing: 0.4,
                  textTransform: "uppercase",
                  color: "#111827",
                  background: GOLD,
                  borderRadius: 999,
                  padding: "4px 10px",
                  marginBottom: 8,
                }}
              >
                Recommended
              </div>
              <div style={{ fontWeight: 900, fontSize: 16 }}>Draw Boundary</div>
              <p style={{ margin: "8px 0 12px", color: "#d4d4d4", fontSize: 13, lineHeight: 1.5 }}>
                Draw the school property boundary directly on the map. Tap around the outside edge
                of the property and adjust the points until the boundary is correct.
              </p>
              <button type="button" style={btnPrimary} onClick={() => setStep("draw_boundary")}>
                Draw Boundary
              </button>
            </div>

            <div
              style={{
                borderRadius: 16,
                border: "1px solid #333",
                background: "#111",
                padding: 14,
              }}
            >
              <div style={{ fontWeight: 900, fontSize: 16 }}>Save Each Corner</div>
              <p style={{ margin: "8px 0 12px", color: "#a3a3a3", fontSize: 13, lineHeight: 1.5 }}>
                Stand at each corner of the property and save your GPS location.
              </p>
              <button
                type="button"
                style={btnSecondary}
                onClick={() => {
                  setStep("save_each_corner");
                  setPaused(false);
                }}
              >
                Save Each Corner
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Mobile-first capture layout: map ~75%, controls in bottom panel.
  return (
    <div
      style={{
        ...shellStyle,
        display: "flex",
        flexDirection: "column",
        height: "min(94dvh, 900px)",
        maxHeight: "94dvh",
      }}
      data-testid="geofence-campus-boundary-wizard"
      data-step="save_each_corner"
    >
      <style>{`
        @keyframes geofenceFlashIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes geofenceCountPulse {
          0%, 100% { transform: scale(1); }
          40% { transform: scale(1.08); }
        }
        .geofence-corner-pulse {
          animation: geofenceCountPulse 0.7s ease;
        }
      `}</style>

      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "10px 12px",
          borderBottom: "1px solid #262626",
          background: "#111",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>Campus Boundary</div>
          <div
            style={{
              fontSize: 12,
              color: "#a3a3a3",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {campusName}
            {paused ? " · Paused" : ""}
          </div>
        </div>
        <button
          type="button"
          style={{ ...btnSecondary, padding: "10px 12px", minHeight: 40, fontSize: 13 }}
          onClick={confirmCancel}
          disabled={saving}
        >
          Cancel Setup
        </button>
      </div>

      <div style={{ flex: "1 1 78%", minHeight: 280, position: "relative" }}>
        <GeofenceLiveMap
          corners={corners}
          live={live}
          fill
          animateCornerKey={animateCornerKey}
        />
        {successFlash ? (
          <div
            style={{
              position: "absolute",
              left: 12,
              right: 12,
              top: 12,
              padding: "12px 14px",
              borderRadius: 14,
              background: "rgba(10,10,10,0.92)",
              border: `1px solid ${GOLD}`,
              color: WHITE,
              fontWeight: 700,
              fontSize: 14,
              boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              animation: "geofenceFlashIn 0.25s ease",
              zIndex: 500,
            }}
          >
            {successFlash}
          </div>
        ) : null}
      </div>

      <div
        style={{
          flex: "0 0 auto",
          maxHeight: "36%",
          display: "flex",
          flexDirection: "column",
          background: "#0f0f0f",
          borderTop: `1px solid rgba(201,162,39,0.35)`,
          boxShadow: "0 -10px 30px rgba(0,0,0,0.35)",
        }}
      >
        <div
          style={{
            flex: "1 1 auto",
            overflowY: "auto",
            WebkitOverflowScrolling: "touch",
            padding: "8px 12px 4px",
            minHeight: 0,
          }}
        >
          {corners.length === 0 ? (
            <p style={{ margin: "0 0 8px", color: "#d4d4d4", fontSize: 12, lineHeight: 1.35 }}>
              Walk to the first corner of your school property. Wait for a good GPS signal. Tap Save
              This Corner. Repeat until the whole school boundary has been marked.
            </p>
          ) : null}

          <div
            style={{
              borderRadius: 14,
              border: `1px solid ${gps.color}55`,
              background: "#171717",
              padding: "8px 10px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 12, letterSpacing: 0.4 }}>GPS Status</div>
              <div style={{ fontWeight: 800, fontSize: 13, color: gps.color }}>
                {gps.emoji} {gps.label}
                {gps.tier !== "unknown" ? (
                  <span style={{ color: "#a3a3a3", fontWeight: 600 }}> ({gps.rangeLabel})</span>
                ) : null}
              </div>
            </div>
            <div
              style={{
                marginTop: 6,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 4,
                fontSize: 11,
                color: "#a3a3a3",
              }}
            >
              <div>
                Accuracy
                <div style={{ color: WHITE, fontWeight: 700, marginTop: 1 }}>
                  {live?.accuracyMetres != null
                    ? `±${Math.round(live.accuracyMetres)} m`
                    : paused
                      ? "Paused"
                      : "Finding…"}
                </div>
              </div>
              <div>
                Last update
                <div style={{ color: WHITE, fontWeight: 700, marginTop: 1 }}>
                  {paused ? "Paused" : formatClock(lastGpsAt)}
                </div>
              </div>
              <div>
                Latitude
                <div style={{ color: WHITE, fontWeight: 700, marginTop: 1, fontSize: 11 }}>
                  {live ? live.latitude.toFixed(6) : "—"}
                </div>
              </div>
              <div>
                Longitude
                <div style={{ color: WHITE, fontWeight: 700, marginTop: 1, fontSize: 11 }}>
                  {live ? live.longitude.toFixed(6) : "—"}
                </div>
              </div>
            </div>
            {gps.tip ? (
              <p style={{ margin: "6px 0 0", color: GOLD, fontSize: 12, lineHeight: 1.3 }}>
                {gps.tip}
              </p>
            ) : null}
          </div>

          <div
            style={{
              marginTop: 8,
              borderRadius: 14,
              border: "1px solid #262626",
              background: "#141414",
              padding: "8px 10px",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 900, fontSize: 12 }}>Campus Boundary</div>
              <div
                style={{
                  fontWeight: 900,
                  fontSize: 12,
                  color: highlightCount ? GOLD : WHITE,
                  animation: highlightCount ? "geofenceCountPulse 0.7s ease" : undefined,
                }}
              >
                Corners Saved: {corners.length}
              </div>
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: "6px 0 0",
                padding: 0,
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "2px 8px",
              }}
            >
              {progressRows.map((row) => (
                <li
                  key={row.key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "1px 0",
                    fontSize: 12,
                    color: row.done ? WHITE : "#737373",
                    fontWeight: row.done ? 700 : 500,
                  }}
                >
                  <span style={{ color: row.done ? "#22c55e" : "#525252", width: 14 }}>
                    {row.done ? "✓" : "○"}
                  </span>
                  {row.label}
                </li>
              ))}
            </ul>
          </div>

          {geoError ? (
            <p style={{ color: "#fca5a5", fontSize: 12, marginTop: 6, marginBottom: 0 }}>{geoError}</p>
          ) : null}
          {actionError ? (
            <p style={{ color: "#fca5a5", fontSize: 12, marginTop: 6, marginBottom: 0 }}>{actionError}</p>
          ) : null}
          {!canComplete ? (
            <p style={{ color: "#a3a3a3", fontSize: 11, marginTop: 6, marginBottom: 0 }}>
              Save at least 3 corners before completing the campus boundary.
            </p>
          ) : null}
        </div>

        <div style={{ flex: "0 0 auto", padding: "8px 12px 12px", background: "#0f0f0f" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 0.7fr 1fr",
              gap: 8,
            }}
          >
            <button
              type="button"
              style={{ ...btnPrimary, padding: "12px 10px", fontSize: 14 }}
              onClick={saveCorner}
              disabled={paused || saving || !live}
            >
              Save This Corner
            </button>
            <button
              type="button"
              style={{ ...btnSecondary, padding: "12px 10px", fontSize: 14 }}
              onClick={undoCorner}
              disabled={corners.length === 0 || saving}
            >
              Undo
            </button>
            <button
              type="button"
              style={{ ...btnSecondary, padding: "12px 10px", fontSize: 13 }}
              onClick={() => setPaused((p) => !p)}
              disabled={saving}
            >
              {paused ? "Resume Setup" : "Pause Setup"}
            </button>
          </div>

          <button
            type="button"
            style={{
              ...btnPrimary,
              width: "100%",
              marginTop: 8,
              opacity: canComplete && !saving ? 1 : 0.45,
              cursor: canComplete && !saving ? "pointer" : "not-allowed",
            }}
            onClick={() => void finishBoundary()}
            disabled={!canComplete || saving}
          >
            {saving ? "Saving…" : "Complete Boundary"}
          </button>
        </div>
      </div>
    </div>
  );
}
