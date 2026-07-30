/**
 * Owner Location Test Mode — read-only simulation wizard.
 * Never creates clock, GPS-attempt, attendance, or payroll records.
 * Never shows fake / hard-coded map centres. Mock GPS is DEV-preview only.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { EduClockEntranceRow } from "../educlock/educlockApi";
import { resolveGpsSignalStatus } from "./geofenceCapture";
import {
  fetchCampusBoundaryZone,
  testOwnerLocation,
  type OwnerLocationTestResult,
} from "./geofenceApi";
import GeofenceLocationTestMap from "./GeofenceLocationTestMap";
import SecureConnectionNotice from "./SecureConnectionNotice";
import {
  isOwnerSecureContext,
  logInsecureContextDiagnostics,
  SECURE_CONNECTION_MESSAGE,
} from "./secureConnectionMessage";

const GPS_FAIL_MESSAGE = "We couldn't determine your current location.";

type Props = {
  campusId: string;
  campusName: string;
  onClose: () => void;
  /** Existing campus entrances (real school data only). */
  existingEntrances?: EduClockEntranceRow[];
  /**
   * DEV preview routes only. Ignored unless import.meta.env.DEV is true.
   * Live EduClock Geofences must never pass these.
   */
  mockLocation?: {
    latitude: number;
    longitude: number;
    accuracyMetres: number;
  } | null;
  /** DEV preview routes only. Ignored unless import.meta.env.DEV is true. */
  demoResult?: OwnerLocationTestResult | null;
};

const GOLD = "#c9a227";
const BLACK = "#0a0a0a";
const WHITE = "#f8fafc";

const shell: CSSProperties = {
  marginTop: 12,
  borderRadius: 18,
  border: "1px solid rgba(201,162,39,0.4)",
  background: BLACK,
  color: WHITE,
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  height: "min(94dvh, 900px)",
  maxHeight: "94dvh",
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
};

const btnPrimary: CSSProperties = { ...btnBase, background: GOLD, color: "#111" };
const btnSecondary: CSSProperties = {
  ...btnBase,
  background: "#171717",
  color: WHITE,
  border: "1px solid #333",
};

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid #333",
  background: "#171717",
  color: WHITE,
  padding: "12px 14px",
  fontSize: 16,
  fontWeight: 600,
};

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 20_000,
  maximumAge: 0,
};

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

function campusBoundaryLabel(result: OwnerLocationTestResult | null): string {
  if (!result) return "—";
  if (!result.campusBoundaryAvailable) return "Not saved yet";
  if (result.isInsideCampusBoundary === true) return "Inside";
  if (result.isInsideCampusBoundary === false) return "Outside";
  return "—";
}

function polygonEnforcementLabel(result: OwnerLocationTestResult | null): string {
  if (!result) return "—";
  return result.polygonRuleEnabled ? "Enabled" : "Not enabled yet";
}

/** Preview injection is only honoured in Vite DEV builds. */
function allowPreviewInjection(): boolean {
  return Boolean(import.meta.env.DEV);
}

export default function OwnerLocationTestWizard({
  campusId,
  campusName,
  onClose,
  existingEntrances = [],
  mockLocation = null,
  demoResult = null,
}: Props) {
  const previewOk = allowPreviewInjection();
  const effectiveMock = previewOk ? mockLocation : null;
  const effectiveDemo = previewOk ? demoResult : null;

  const [secureContextOk] = useState(() => isOwnerSecureContext());
  const [live, setLive] = useState<{
    latitude: number;
    longitude: number;
    accuracyMetres: number | null;
  } | null>(null);
  const [lastGpsAt, setLastGpsAt] = useState<string | null>(null);
  const [geoError, setGeoError] = useState("");
  const [gpsFailed, setGpsFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState("");
  const [result, setResult] = useState<OwnerLocationTestResult | null>(effectiveDemo);
  const [boundaryRing, setBoundaryRing] = useState<
    Array<{ latitude: number; longitude: number }>
  >([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [latManual, setLatManual] = useState("");
  const [lngManual, setLngManual] = useState("");
  const watchIdRef = useRef<number | null>(null);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => () => stopWatch(), [stopWatch]);

  useEffect(() => {
    if (!secureContextOk) logInsecureContextDiagnostics("OwnerLocationTestWizard");
  }, [secureContextOk]);

  useEffect(() => {
    let cancelled = false;
    fetchCampusBoundaryZone(campusId)
      .then((res) => {
        if (cancelled) return;
        const verts = res.zone?.vertices || [];
        if (verts.length >= 3) {
          setBoundaryRing(
            verts.map((v) => ({ latitude: v.latitude, longitude: v.longitude }))
          );
        } else {
          setBoundaryRing([]);
        }
      })
      .catch(() => {
        if (!cancelled) setBoundaryRing([]);
      });
    return () => {
      cancelled = true;
    };
  }, [campusId]);

  useEffect(() => {
    if (!effectiveMock) return;
    setLive({
      latitude: effectiveMock.latitude,
      longitude: effectiveMock.longitude,
      accuracyMetres: effectiveMock.accuracyMetres,
    });
    setLastGpsAt(new Date().toISOString());
    setGpsFailed(false);
  }, [effectiveMock]);

  const startCapture = useCallback(() => {
    setGeoError("");
    setApiError("");
    setGpsFailed(false);
    if (effectiveMock) {
      setLive({
        latitude: effectiveMock.latitude,
        longitude: effectiveMock.longitude,
        accuracyMetres: effectiveMock.accuracyMetres,
      });
      setLastGpsAt(new Date().toISOString());
      return;
    }
    if (!navigator.geolocation) {
      setGpsFailed(true);
      setGeoError(GPS_FAIL_MESSAGE);
      return;
    }
    if (!isOwnerSecureContext()) {
      logInsecureContextDiagnostics("OwnerLocationTestWizard.capture");
      setGeoError(SECURE_CONNECTION_MESSAGE);
      return;
    }
    stopWatch();
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const latitude = pos.coords.latitude;
        const longitude = pos.coords.longitude;
        const accuracyMetres =
          pos.coords.accuracy == null || !Number.isFinite(pos.coords.accuracy)
            ? null
            : pos.coords.accuracy;
        setLive({ latitude, longitude, accuracyMetres });
        setLastGpsAt(new Date().toISOString());
        setGeoError("");
        setGpsFailed(false);
      },
      () => {
        setGpsFailed(true);
        setGeoError(GPS_FAIL_MESSAGE);
      },
      GEO_OPTIONS
    );
  }, [effectiveMock, stopWatch]);

  useEffect(() => {
    if (effectiveMock) return;
    if (!secureContextOk) return;
    startCapture();
    return () => stopWatch();
  }, [secureContextOk, effectiveMock, startCapture, stopWatch]);

  function applyManualCoordinates() {
    const latitude = Number(latManual);
    const longitude = Number(lngManual);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      setApiError("Enter a valid latitude.");
      return;
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setApiError("Enter a valid longitude.");
      return;
    }
    setLive({ latitude, longitude, accuracyMetres: 5 });
    setLastGpsAt(new Date().toISOString());
    setGpsFailed(false);
    setGeoError("");
    setApiError("");
  }

  async function runTest() {
    setApiError("");
    if (!secureContextOk && !effectiveMock) {
      setGeoError(SECURE_CONNECTION_MESSAGE);
      return;
    }
    if (!live) {
      setApiError("Wait for a real GPS reading before checking.");
      return;
    }
    if (live.accuracyMetres == null || !Number.isFinite(live.accuracyMetres)) {
      setApiError("Wait for a GPS reading with accuracy, then try again.");
      return;
    }
    setBusy(true);
    try {
      const res = await testOwnerLocation({
        campusId,
        latitude: live.latitude,
        longitude: live.longitude,
        accuracyMetres: live.accuracyMetres,
      });
      setResult(res);
    } catch (err: unknown) {
      setApiError(err instanceof Error ? err.message : "Could not test this location.");
    } finally {
      setBusy(false);
    }
  }

  const hasRealCoords = Boolean(live && Number.isFinite(live.latitude) && Number.isFinite(live.longitude));
  const canCheck =
    hasRealCoords &&
    live!.accuracyMetres != null &&
    Number.isFinite(live!.accuracyMetres) &&
    (secureContextOk || Boolean(effectiveMock)) &&
    !busy;

  const gps = resolveGpsSignalStatus(live?.accuracyMetres);
  const accepted = result?.currentEntranceRuleWouldAccept === true;

  const mapBoundary = result?.map.boundary?.length
    ? result.map.boundary
    : boundaryRing;
  const mapEntrances = result?.map.entrances?.length
    ? result.map.entrances
    : existingEntrances
        .filter((e) => e.isActive && e.latitude != null && e.longitude != null)
        .map((e) => ({
          id: e.id,
          name: e.name,
          latitude: e.latitude as number,
          longitude: e.longitude as number,
          allowedRadiusMetres: e.allowedRadiusMetres,
          isNearest: false,
        }));

  // You-are-here marker: real GPS / manual only — never demo result without live coords.
  const mapCurrent = live;

  return (
    <div style={shell} data-testid="owner-location-test-wizard">
      <div
        style={{
          padding: "14px 14px 10px",
          borderBottom: "1px solid #262626",
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "flex-start",
        }}
      >
        <div>
          <div style={{ fontWeight: 900, fontSize: 18 }}>Test your location setup</div>
          <div style={{ color: "#a3a3a3", fontSize: 13, marginTop: 6, lineHeight: 1.45 }}>
            Stand where a staff member would clock in. EduClear will check your current position
            without creating a clock-in record.
          </div>
          <div
            data-testid="location-test-campus-name"
            style={{ color: GOLD, fontSize: 13, fontWeight: 800, marginTop: 8 }}
          >
            {campusName}
          </div>
        </div>
        <button type="button" style={{ ...btnSecondary, padding: "10px 12px", minHeight: 40 }} onClick={onClose}>
          Close
        </button>
      </div>

      <div style={{ flex: "1 1 55%", minHeight: 240, position: "relative" }}>
        <GeofenceLocationTestMap
          fill
          boundary={mapBoundary}
          entrances={mapEntrances}
          current={
            mapCurrent
              ? {
                  latitude: mapCurrent.latitude,
                  longitude: mapCurrent.longitude,
                  accuracyMetres: mapCurrent.accuracyMetres,
                }
              : null
          }
          nearestEntranceId={result?.nearestActiveEntranceId ?? null}
          entranceRadiusMetres={result?.entranceRadiusMetres ?? null}
          waitingLabel={
            boundaryRing.length >= 3
              ? "Loading campus map…"
              : "Waiting for your location…"
          }
        />
      </div>

      <div
        style={{
          flex: "0 0 auto",
          maxHeight: "48%",
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: 12,
          display: "grid",
          gap: 10,
          borderTop: "1px solid rgba(201,162,39,0.35)",
          background: "#0f0f0f",
        }}
      >
        <SecureConnectionNotice show={!secureContextOk && !effectiveMock} style={{ marginTop: 0 }} />

        <div
          style={{
            borderRadius: 14,
            border: `1px solid ${gps.color}55`,
            background: "#171717",
            padding: 12,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 13 }}>
            <span>GPS quality</span>
            <span style={{ color: gps.color }}>
              {gps.emoji} {gps.label}
              {gps.tier !== "unknown" ? ` (${gps.rangeLabel})` : ""}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              fontSize: 11,
              color: "#a3a3a3",
            }}
          >
            <div>
              Accuracy
              <div style={{ color: WHITE, fontWeight: 700 }}>
                {live?.accuracyMetres != null ? `±${Math.round(live.accuracyMetres)} m` : "—"}
              </div>
            </div>
            <div>
              Last update
              <div style={{ color: WHITE, fontWeight: 700 }}>{formatClock(lastGpsAt)}</div>
            </div>
            <div>
              Latitude
              <div style={{ color: WHITE, fontWeight: 700 }} data-testid="location-test-lat">
                {live ? live.latitude.toFixed(6) : "—"}
              </div>
            </div>
            <div>
              Longitude
              <div style={{ color: WHITE, fontWeight: 700 }} data-testid="location-test-lng">
                {live ? live.longitude.toFixed(6) : "—"}
              </div>
            </div>
          </div>
          {gps.tip && hasRealCoords ? (
            <p style={{ margin: "8px 0 0", color: GOLD, fontSize: 12 }}>{gps.tip}</p>
          ) : null}
          {!hasRealCoords && !gpsFailed ? (
            <p style={{ margin: "8px 0 0", color: "#a3a3a3", fontSize: 12 }}>
              Requesting your real GPS position…
            </p>
          ) : null}
        </div>

        {result ? (
          <div
            role="status"
            data-testid="location-test-result"
            style={{
              borderRadius: 14,
              border: `1px solid ${accepted ? "#22c55e66" : "#ef444466"}`,
              background: accepted ? "#052e16" : "#3f1d1d",
              padding: 14,
            }}
          >
            <div style={{ fontWeight: 800, fontSize: 12, color: "#a3a3a3", letterSpacing: 0.3 }}>
              Current clock-in rule
            </div>
            <div
              style={{
                marginTop: 6,
                fontWeight: 900,
                fontSize: 18,
                color: accepted ? "#86efac" : "#fecaca",
                display: "flex",
                gap: 8,
                alignItems: "center",
              }}
            >
              <span aria-hidden="true">{accepted ? "✓" : "✕"}</span>
              <span>{accepted ? "Would be accepted" : "Would be rejected"}</span>
            </div>
            {!accepted && result.rejectionReason ? (
              <p style={{ margin: "10px 0 0", color: "#fecaca", fontSize: 13, lineHeight: 1.45 }}>
                <strong style={{ color: WHITE }}>Reason:</strong> {result.rejectionReason}
              </p>
            ) : null}
            <div style={{ marginTop: 12, display: "grid", gap: 8, fontSize: 13, color: "#e7e5e4" }}>
              <div>
                <span style={{ color: "#a3a3a3" }}>Nearest entrance:</span>{" "}
                <strong>{result.nearestEntranceName || "None"}</strong>
              </div>
              <div>
                <span style={{ color: "#a3a3a3" }}>Distance:</span>{" "}
                <strong>
                  {result.distanceToNearestEntranceMetres != null
                    ? `${result.distanceToNearestEntranceMetres} m`
                    : "—"}
                </strong>
              </div>
              <div>
                <span style={{ color: "#a3a3a3" }}>Allowed radius:</span>{" "}
                <strong>
                  {result.entranceRadiusMetres != null ? `${result.entranceRadiusMetres} m` : "—"}
                </strong>
              </div>
              <div>
                <span style={{ color: "#a3a3a3" }}>GPS accuracy:</span>{" "}
                <strong>±{Math.round(result.reportedAccuracyMetres)} m</strong>
              </div>
              <div>
                <span style={{ color: "#a3a3a3" }}>Campus boundary:</span>{" "}
                <strong>{campusBoundaryLabel(result)}</strong>
              </div>
              <div>
                <span style={{ color: "#a3a3a3" }}>Polygon enforcement:</span>{" "}
                <strong>{polygonEnforcementLabel(result)}</strong>
              </div>
            </div>
          </div>
        ) : null}

        {geoError ? (
          <p role="alert" data-testid="location-test-gps-fail" style={{ color: "#fca5a5", margin: 0, fontSize: 13 }}>
            {geoError}
          </p>
        ) : null}
        {apiError ? (
          <p role="alert" style={{ color: "#fca5a5", margin: 0, fontSize: 13 }}>
            {apiError}
          </p>
        ) : null}

        {gpsFailed || geoError === GPS_FAIL_MESSAGE ? (
          <div style={{ display: "grid", gap: 8 }}>
            <button type="button" style={btnPrimary} onClick={startCapture}>
              Try Again
            </button>
            <button
              type="button"
              style={btnSecondary}
              onClick={() => setAdvancedOpen(true)}
            >
              Enter Coordinates Manually (Advanced)
            </button>
          </div>
        ) : null}

        {advancedOpen ? (
          <div style={{ display: "grid", gap: 8 }}>
            <input
              value={latManual}
              onChange={(e) => setLatManual(e.target.value)}
              placeholder="Latitude"
              style={inputStyle}
              inputMode="decimal"
            />
            <input
              value={lngManual}
              onChange={(e) => setLngManual(e.target.value)}
              placeholder="Longitude"
              style={inputStyle}
              inputMode="decimal"
            />
            <button type="button" style={btnSecondary} onClick={applyManualCoordinates}>
              Use these coordinates
            </button>
          </div>
        ) : !gpsFailed ? (
          <button
            type="button"
            style={{ ...btnSecondary, fontSize: 13 }}
            onClick={() => setAdvancedOpen(true)}
          >
            Enter Coordinates Manually (Advanced)
          </button>
        ) : null}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            position: "sticky",
            bottom: 0,
            paddingTop: 4,
            background: "#0f0f0f",
          }}
        >
          <button
            type="button"
            style={{
              ...btnPrimary,
              opacity: canCheck ? 1 : 0.45,
              cursor: canCheck ? "pointer" : "not-allowed",
            }}
            disabled={!canCheck}
            onClick={() => void runTest()}
          >
            {busy ? "Checking…" : result ? "Check Again" : "Check My Current Location"}
          </button>
          <button type="button" style={btnSecondary} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
