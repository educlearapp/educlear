/**
 * Mobile-first Add / Edit Entrance wizard (Phase 2B).
 * Saves EduClockEntrance only — no duplicate GeofenceZone entrance records.
 * Staff clock GPS uses the active campus boundary polygon (entrance radius is reference-only).
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  createEduClockEntrance,
  updateEduClockEntrance,
  type EduClockEntranceRow,
} from "../educlock/educlockApi";
import {
  checkCampusBoundaryContainment,
  fetchCampusBoundaryZone,
} from "./geofenceApi";
import {
  ENTRANCE_TYPE_OPTIONS,
  ENTRANCE_WIZARD_RADIUS_DEFAULT,
  boundaryStatusLabel,
  gpsStatusForEntrance,
  validateEntranceDetails,
  validateEntranceLocation,
  type EntranceTypeCode,
  type EntranceWizardStep,
} from "./entranceWizardLogic";
import GeofenceEntranceMap from "./GeofenceEntranceMap";
import SecureConnectionNotice from "./SecureConnectionNotice";
import {
  isOwnerSecureContext,
  logInsecureContextDiagnostics,
  SECURE_CONNECTION_MESSAGE,
} from "./secureConnectionMessage";

type Props = {
  campusId: string;
  campusName: string;
  existingEntrances: EduClockEntranceRow[];
  /** null = create */
  entrance: EduClockEntranceRow | null;
  onClose: () => void;
  onSaved: (entrance: EduClockEntranceRow) => void;
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

const inputStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  borderRadius: 12,
  border: "1px solid #333",
  background: "#171717",
  color: WHITE,
  padding: "12px 14px",
  fontSize: 16, // prevent Safari zoom
  fontWeight: 600,
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

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: GOLD,
  color: "#111",
};

const btnSecondary: CSSProperties = {
  ...btnBase,
  background: "#171717",
  color: WHITE,
  border: "1px solid #333",
};

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
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

export default function GeofenceEntranceWizard({
  campusId,
  campusName,
  existingEntrances,
  entrance,
  onClose,
  onSaved,
}: Props) {
  const isEdit = Boolean(entrance?.id);
  const [step, setStep] = useState<EntranceWizardStep>(1);
  const [name, setName] = useState(entrance?.name || "");
  const [entranceType, setEntranceType] = useState<EntranceTypeCode | "">(
    (entrance?.entranceType as EntranceTypeCode) || ""
  );
  const [customTypeLabel, setCustomTypeLabel] = useState(entrance?.customTypeLabel || "");
  const [radius, setRadius] = useState(
    String(entrance?.allowedRadiusMetres ?? ENTRANCE_WIZARD_RADIUS_DEFAULT)
  );
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [latManual, setLatManual] = useState(
    entrance?.latitude == null ? "" : String(entrance.latitude)
  );
  const [lngManual, setLngManual] = useState(
    entrance?.longitude == null ? "" : String(entrance.longitude)
  );

  const [marker, setMarker] = useState<{ latitude: number; longitude: number } | null>(
    entrance?.latitude != null && entrance?.longitude != null
      ? { latitude: entrance.latitude, longitude: entrance.longitude }
      : null
  );
  const [live, setLive] = useState<{
    latitude: number;
    longitude: number;
    accuracyMetres: number | null;
  } | null>(null);
  const [accuracyAtCapture, setAccuracyAtCapture] = useState<number | null>(
    null
  );
  const [lastGpsAt, setLastGpsAt] = useState<string | null>(null);
  const [boundaryRing, setBoundaryRing] = useState<
    Array<{ latitude: number; longitude: number }>
  >([]);
  const [boundaryStatus, setBoundaryStatus] = useState<
    "NO_BOUNDARY" | "INSIDE" | "OUTSIDE" | null
  >(null);
  const [confirmOutside, setConfirmOutside] = useState(false);
  const [error, setError] = useState("");
  const [geoError, setGeoError] = useState("");
  const [saving, setSaving] = useState(false);
  const [secureContextOk] = useState(() => isOwnerSecureContext());
  const [success, setSuccess] = useState(false);

  const watchIdRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchCampusBoundaryZone(campusId)
      .then((res) => {
        if (cancelled) return;
        const verts = res.zone?.vertices || [];
        setBoundaryRing(
          verts.map((v) => ({ latitude: v.latitude, longitude: v.longitude }))
        );
      })
      .catch(() => {
        if (!cancelled) setBoundaryRing([]);
      });
    return () => {
      cancelled = true;
    };
  }, [campusId]);

  const stopWatch = useCallback(() => {
    if (watchIdRef.current != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
  }, []);

  useEffect(() => () => stopWatch(), [stopWatch]);

  useEffect(() => {
    if (!marker) {
      setBoundaryStatus(null);
      return;
    }
    let cancelled = false;
    void checkCampusBoundaryContainment({
      campusId,
      latitude: marker.latitude,
      longitude: marker.longitude,
    })
      .then((res) => {
        if (!cancelled) {
          setBoundaryStatus(res.status);
          if (res.status !== "OUTSIDE") setConfirmOutside(false);
        }
      })
      .catch(() => {
        if (!cancelled) setBoundaryStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [campusId, marker]);

  function captureLocation() {
    setGeoError("");
    setError("");
    if (!navigator.geolocation) {
      setGeoError("Location is not available on this phone or browser.");
      return;
    }
    if (!isOwnerSecureContext()) {
      logInsecureContextDiagnostics("EntranceSetupWizard");
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
        setMarker({ latitude, longitude });
        setAccuracyAtCapture(accuracyMetres);
        setLatManual(String(latitude));
        setLngManual(String(longitude));
        setGeoError("");
      },
      (err) => {
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
  }

  function goNextFromDetails() {
    const check = validateEntranceDetails({
      name,
      entranceType,
      customTypeLabel,
      allowedRadiusMetres: radius,
    });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError("");
    setStep(2);
  }

  function goNextFromLocation() {
    const check = validateEntranceLocation({
      latitude: marker?.latitude ?? null,
      longitude: marker?.longitude ?? null,
    });
    if (!check.ok) {
      setError(check.error);
      return;
    }
    setError("");
    stopWatch();
    setStep(3);
  }

  async function save() {
    const details = validateEntranceDetails({
      name,
      entranceType,
      customTypeLabel,
      allowedRadiusMetres: radius,
    });
    if (!details.ok) {
      setError(details.error);
      return;
    }
    const loc = validateEntranceLocation({
      latitude: marker?.latitude ?? null,
      longitude: marker?.longitude ?? null,
    });
    if (!loc.ok) {
      setError(loc.error);
      return;
    }
    if (boundaryStatus === "OUTSIDE" && !confirmOutside) {
      setError(
        "This entrance is outside the saved campus boundary. Check the location before saving."
      );
      return;
    }

    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        entranceType: entranceType as EntranceTypeCode,
        customTypeLabel: entranceType === "OTHER" ? customTypeLabel.trim() : null,
        latitude: marker!.latitude,
        longitude: marker!.longitude,
        allowedRadiusMetres: Number(radius.trim()),
        captureAccuracyMetres: accuracyAtCapture,
        confirmOutsideBoundary: confirmOutside || boundaryStatus !== "OUTSIDE",
        isActive: entrance?.isActive ?? true,
      };
      const saved = isEdit
        ? await updateEduClockEntrance(entrance!.id, payload)
        : await createEduClockEntrance(campusId, payload);
      setSuccess(true);
      window.setTimeout(() => onSaved(saved), 900);
    } catch (err: unknown) {
      const e = err as Error & { code?: string };
      if (e.code === "EDUCLOCK_ENTRANCE_OUTSIDE_BOUNDARY") {
        setBoundaryStatus("OUTSIDE");
        setError(
          "This entrance is outside the saved campus boundary. Check the location before saving."
        );
      } else {
        setError(e.message || "Could not save entrance.");
      }
    } finally {
      setSaving(false);
    }
  }

  const gps = gpsStatusForEntrance(live?.accuracyMetres ?? accuracyAtCapture);
  const otherEntrances = existingEntrances
    .filter((e) => e.id !== entrance?.id && e.latitude != null && e.longitude != null)
    .map((e) => ({
      id: e.id,
      name: e.name,
      latitude: e.latitude as number,
      longitude: e.longitude as number,
    }));

  const steps = [
    { n: 1 as const, label: "Details" },
    { n: 2 as const, label: "Location" },
    { n: 3 as const, label: "Review" },
  ];

  if (success) {
    return (
      <div style={{ ...shell, padding: 24, justifyContent: "center" }} data-testid="geofence-entrance-wizard">
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 28, color: GOLD, fontWeight: 900 }}>✓</div>
          <div style={{ fontWeight: 900, fontSize: 18, marginTop: 12 }}>
            Entrance saved successfully.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={shell} data-testid="geofence-entrance-wizard" data-step={step}>
      <div
        style={{
          flex: "0 0 auto",
          padding: "12px 14px",
          borderBottom: "1px solid #262626",
          background: "#111",
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>
            {isEdit ? "Edit Entrance" : "Add Entrance"}
          </div>
          <div style={{ fontSize: 12, color: "#a3a3a3" }}>{campusName}</div>
        </div>
        <button type="button" style={{ ...btnSecondary, padding: "10px 12px", minHeight: 40 }} onClick={onClose}>
          Cancel Setup
        </button>
      </div>

      <div
        style={{
          flex: "0 0 auto",
          display: "flex",
          gap: 6,
          padding: "10px 14px",
          borderBottom: "1px solid #1f1f1f",
        }}
      >
        {steps.map((s) => (
          <div
            key={s.n}
            style={{
              flex: 1,
              textAlign: "center",
              padding: "8px 4px",
              borderRadius: 10,
              fontSize: 12,
              fontWeight: 800,
              background: step === s.n ? "rgba(201,162,39,0.2)" : "#171717",
              color: step === s.n ? GOLD : "#737373",
              border: step === s.n ? `1px solid ${GOLD}` : "1px solid #262626",
            }}
          >
            {s.n}. {s.label}
          </div>
        ))}
      </div>

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        {step === 1 ? (
          <div style={{ padding: 14, display: "grid", gap: 12 }}>
            <label style={{ fontSize: 13, fontWeight: 700 }}>
              Entrance name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Main Gate"
                style={{ ...inputStyle, marginTop: 6 }}
                autoComplete="off"
              />
            </label>

            <div>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>Entrance type</div>
              <div style={{ display: "grid", gap: 8 }}>
                {ENTRANCE_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.code}
                    type="button"
                    onClick={() => setEntranceType(opt.code)}
                    style={{
                      ...btnSecondary,
                      textAlign: "left",
                      borderColor: entranceType === opt.code ? GOLD : "#333",
                      background: entranceType === opt.code ? "rgba(201,162,39,0.15)" : "#171717",
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {entranceType === "OTHER" ? (
              <label style={{ fontSize: 13, fontWeight: 700 }}>
                Custom label
                <input
                  value={customTypeLabel}
                  onChange={(e) => setCustomTypeLabel(e.target.value)}
                  placeholder="Describe this entrance"
                  style={{ ...inputStyle, marginTop: 6 }}
                />
              </label>
            ) : null}

            <label style={{ fontSize: 13, fontWeight: 700 }}>
              Clock-in radius (metres)
              <input
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                inputMode="numeric"
                style={{ ...inputStyle, marginTop: 6 }}
              />
              <div style={{ fontSize: 12, color: "#a3a3a3", fontWeight: 500, marginTop: 6, lineHeight: 1.4 }}>
                Reference only. Staff clock in and out from anywhere inside the campus boundary.
              </div>
            </label>
          </div>
        ) : null}

        {step === 2 ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 420 }}>
            <div style={{ flex: "1 1 60%", minHeight: 240, position: "relative" }}>
              <GeofenceEntranceMap
                fill
                boundary={boundaryRing}
                existingEntrances={otherEntrances}
                live={live}
                marker={marker}
                onMarkerMove={(lat, lng) => {
                  setMarker({ latitude: lat, longitude: lng });
                  setLatManual(String(lat));
                  setLngManual(String(lng));
                }}
              />
            </div>
            <div style={{ flex: "0 0 auto", padding: 12, display: "grid", gap: 10 }}>
              <SecureConnectionNotice show={!secureContextOk} style={{ marginTop: 0 }} />
              <button
                type="button"
                style={{
                  ...btnPrimary,
                  opacity: secureContextOk ? 1 : 0.45,
                  cursor: secureContextOk ? "pointer" : "not-allowed",
                }}
                disabled={!secureContextOk}
                onClick={captureLocation}
              >
                Use My Current Location
              </button>

              <div
                style={{
                  borderRadius: 14,
                  border: `1px solid ${gps.color}55`,
                  background: "#171717",
                  padding: 12,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 800, fontSize: 13 }}>
                  <span>GPS Status</span>
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
                      {live?.accuracyMetres != null
                        ? `±${Math.round(live.accuracyMetres)} m`
                        : accuracyAtCapture != null
                          ? `±${Math.round(accuracyAtCapture)} m`
                          : "—"}
                    </div>
                  </div>
                  <div>
                    Last update
                    <div style={{ color: WHITE, fontWeight: 700 }}>{formatClock(lastGpsAt)}</div>
                  </div>
                  <div>
                    Latitude
                    <div style={{ color: WHITE, fontWeight: 700 }}>
                      {marker ? marker.latitude.toFixed(6) : "—"}
                    </div>
                  </div>
                  <div>
                    Longitude
                    <div style={{ color: WHITE, fontWeight: 700 }}>
                      {marker ? marker.longitude.toFixed(6) : "—"}
                    </div>
                  </div>
                </div>
                {gps.tip ? (
                  <p style={{ margin: "8px 0 0", color: GOLD, fontSize: 12 }}>{gps.tip}</p>
                ) : null}
              </div>

              {boundaryStatus ? (
                <div
                  style={{
                    borderRadius: 12,
                    padding: 10,
                    background: boundaryStatus === "OUTSIDE" ? "#3f1d1d" : "#171717",
                    border: `1px solid ${boundaryStatus === "OUTSIDE" ? "#ef4444" : "#333"}`,
                    fontSize: 13,
                    fontWeight: 700,
                  }}
                >
                  {boundaryStatusLabel(boundaryStatus)}
                  {boundaryStatus === "OUTSIDE" ? (
                    <div style={{ fontWeight: 500, marginTop: 6, color: "#fecaca", fontSize: 12 }}>
                      This entrance is outside the saved campus boundary. Check the location before
                      saving.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {geoError ? <p style={{ color: "#fca5a5", margin: 0, fontSize: 13 }}>{geoError}</p> : null}

              <button
                type="button"
                style={{ ...btnSecondary, fontSize: 13 }}
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                {advancedOpen ? "Hide advanced details" : "Advanced details"}
              </button>
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
                  <button
                    type="button"
                    style={btnSecondary}
                    onClick={() => {
                      const lat = Number(latManual);
                      const lng = Number(lngManual);
                      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
                        setError("Enter valid latitude and longitude.");
                        return;
                      }
                      setMarker({ latitude: lat, longitude: lng });
                      setError("");
                    }}
                  >
                    Apply coordinates
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div style={{ padding: 14, display: "grid", gap: 12 }}>
            <div style={{ borderRadius: 14, background: "#171717", border: "1px solid #333", padding: 12 }}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Review</div>
              <div style={{ fontSize: 13, color: "#d4d4d4", lineHeight: 1.55 }}>
                <div>
                  <strong style={{ color: WHITE }}>Name:</strong> {name.trim()}
                </div>
                <div>
                  <strong style={{ color: WHITE }}>Type:</strong>{" "}
                  {entranceType === "OTHER"
                    ? customTypeLabel.trim()
                    : ENTRANCE_TYPE_OPTIONS.find((o) => o.code === entranceType)?.label}
                </div>
                <div>
                  <strong style={{ color: WHITE }}>Clock-in radius:</strong> {radius.trim()} m
                </div>
                <div>
                  <strong style={{ color: WHITE }}>GPS accuracy:</strong>{" "}
                  {accuracyAtCapture != null ? `±${Math.round(accuracyAtCapture)} m` : "—"}
                </div>
                <div>
                  <strong style={{ color: WHITE }}>Boundary:</strong>{" "}
                  {boundaryStatusLabel(boundaryStatus)}
                </div>
              </div>
            </div>

            <GeofenceEntranceMap
              height={220}
              boundary={boundaryRing}
              existingEntrances={otherEntrances}
              live={null}
              marker={marker}
              onMarkerMove={(lat, lng) => {
                setMarker({ latitude: lat, longitude: lng });
                setLatManual(String(lat));
                setLngManual(String(lng));
              }}
            />

            {boundaryStatus === "OUTSIDE" ? (
              <label
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  fontSize: 13,
                  background: "#3f1d1d",
                  borderRadius: 12,
                  padding: 12,
                  border: "1px solid #ef4444",
                }}
              >
                <input
                  type="checkbox"
                  checked={confirmOutside}
                  onChange={(e) => setConfirmOutside(e.target.checked)}
                  style={{ width: 18, height: 18, marginTop: 2 }}
                />
                <span>
                  I checked the map and want to save this entrance outside the campus boundary.
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? (
        <p style={{ color: "#fca5a5", fontSize: 13, margin: "0 14px 8px" }} role="alert">
          {error}
        </p>
      ) : null}

      <div
        style={{
          flex: "0 0 auto",
          padding: "10px 12px 14px",
          borderTop: "1px solid rgba(201,162,39,0.3)",
          display: "grid",
          gap: 8,
          background: "#0f0f0f",
        }}
      >
        {step === 1 ? (
          <button type="button" style={btnPrimary} onClick={goNextFromDetails}>
            Continue
          </button>
        ) : null}
        {step === 2 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}>
            <button type="button" style={btnSecondary} onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" style={btnPrimary} onClick={goNextFromLocation}>
              Continue
            </button>
          </div>
        ) : null}
        {step === 3 ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 8 }}>
            <button type="button" style={btnSecondary} onClick={() => setStep(2)} disabled={saving}>
              Back
            </button>
            <button type="button" style={btnPrimary} onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save Entrance"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
