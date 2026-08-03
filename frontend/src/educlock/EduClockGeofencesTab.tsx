import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import GeofenceCampusBoundaryWizard from "../geofence/GeofenceCampusBoundaryWizard";
import GeofenceEntranceWizard from "../geofence/EntranceSetupWizard";
import OwnerLocationTestWizard from "../geofence/OwnerLocationTestWizard";
import {
  createEduClockCampus,
  fetchOwnerEduClockCampuses,
  updateEduClockCampus,
  updateEduClockEntrance,
  type EduClockCampusRow,
  type EduClockEntranceRow,
  type EduClockGeofenceSummary,
} from "./educlockApi";
import {
  ENTRANCE_RADIUS_DEFAULT,
  evaluateEntranceGpsReadiness,
  summariseGeofences,
} from "./educlockGeofenceUi";
import {
  EduClockBadge,
  ownerButtonStyle,
  ownerCardStyle,
  ownerInputStyle,
  ownerSecondaryButtonStyle,
} from "./educlockOwnerUi";

const cardStyle: CSSProperties = ownerCardStyle;

export default function EduClockGeofencesTab() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [campuses, setCampuses] = useState<EduClockCampusRow[]>([]);
  const [summary, setSummary] = useState<EduClockGeofenceSummary | null>(null);
  const [campusName, setCampusName] = useState("");
  const [campusDescription, setCampusDescription] = useState("");
  const [campusTolerance, setCampusTolerance] = useState("4");
  const [busy, setBusy] = useState(false);
  const [boundaryCampusId, setBoundaryCampusId] = useState<string | null>(null);
  const [locationTestCampusId, setLocationTestCampusId] = useState<string | null>(null);
  const [entranceWizard, setEntranceWizard] = useState<{
    campusId: string;
    entrance: EduClockEntranceRow | null;
  } | null>(null);
  const loaded = useRef(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchOwnerEduClockCampuses();
      setCampuses(data.campuses || []);
      setSummary(
        data.summary ||
          summariseGeofences(data.campuses || [])
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load campuses");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void reload();
  }, [reload]);

  async function addCampus() {
    setBusy(true);
    setError("");
    try {
      await createEduClockCampus({
        name: campusName,
        description: campusDescription || null,
        toleranceMetres: Number(campusTolerance) || 4,
      });
      setCampusName("");
      setCampusDescription("");
      setCampusTolerance("4");
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create campus");
    } finally {
      setBusy(false);
    }
  }

  function openCreate(campusId: string) {
    setBoundaryCampusId(null);
    setLocationTestCampusId(null);
    setEntranceWizard({ campusId, entrance: null });
  }

  function openEdit(campusId: string, entrance: EduClockEntranceRow) {
    setBoundaryCampusId(null);
    setLocationTestCampusId(null);
    setEntranceWizard({ campusId, entrance });
  }

  async function toggleEntranceActive(entrance: EduClockEntranceRow) {
    const next = !entrance.isActive;
    const ok = window.confirm(
      next
        ? `Activate entrance “${entrance.name}”?`
        : `Deactivate entrance “${entrance.name}”? Entrances are for reference only; staff clock GPS uses the campus boundary.`
    );
    if (!ok) return;
    setBusy(true);
    setError("");
    try {
      await updateEduClockEntrance(entrance.id, { isActive: next });
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update entrance");
    } finally {
      setBusy(false);
    }
  }

  const gpsReadyCount = summary?.gpsReadyEntrances ?? 0;
  const showNoReadyWarning = !loading && (summary?.totalEntrances ?? 0) >= 0 && gpsReadyCount === 0;

  return (
    <div>
      <div style={{ ...cardStyle, maxWidth: 860 }}>
        <h3 style={{ marginTop: 0 }}>Geofences</h3>
        <p style={{ color: "#64748b", lineHeight: 1.55, marginBottom: 0 }}>
          Staff clock-in and clock-out accept any GPS point inside an active{" "}
          <strong>campus boundary</strong> polygon. Entrance coordinates and radius are for
          reference and setup only — they do not determine clock acceptance. Boundaries are stored
          in the shared <strong>Geofence Engine</strong>.
        </p>
      </div>

      {summary ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
            gap: 10,
            marginTop: 12,
            maxWidth: 860,
          }}
        >
          {[
            ["Campuses", summary.totalCampuses],
            ["Active campuses", summary.activeCampuses],
            ["Entrances", summary.totalEntrances],
            ["GPS ready", summary.gpsReadyEntrances],
            ["Not ready", summary.notReadyEntrances],
          ].map(([label, value]) => (
            <div key={String(label)} style={cardStyle}>
              <div style={{ fontSize: 12, color: "#64748b", fontWeight: 700 }}>{label}</div>
              <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {showNoReadyWarning ? (
        <div
          role="status"
          style={{
            marginTop: 12,
            maxWidth: 860,
            padding: 14,
            borderRadius: 12,
            background: "#fffbeb",
            border: "1px solid #fde68a",
            color: "#92400e",
            fontWeight: 600,
            lineHeight: 1.5,
          }}
        >
          No GPS-ready entrances are configured. Staff clock attempts will be blocked with “No
          EduClock entrance has been configured” until an active entrance has valid coordinates and
          radius.
        </div>
      ) : null}

      {error ? (
        <p role="alert" style={{ color: "#b91c1c" }}>
          {error}
        </p>
      ) : null}

      <section style={{ ...cardStyle, marginTop: 16, maxWidth: 860 }}>
        <h3 style={{ marginTop: 0 }}>Add Campus</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            placeholder="Campus name"
            value={campusName}
            onChange={(e) => setCampusName(e.target.value)}
            style={{ ...ownerInputStyle, minWidth: 180 }}
          />
          <input
            placeholder="Address or description"
            value={campusDescription}
            onChange={(e) => setCampusDescription(e.target.value)}
            style={{ ...ownerInputStyle, minWidth: 220, flex: 1 }}
          />
          <input
            placeholder="Perimeter tolerance (m)"
            title="Optional perimeter tolerance — not used for staff clock GPS (boundary containment is exact)"
            value={campusTolerance}
            onChange={(e) => setCampusTolerance(e.target.value)}
            style={{ ...ownerInputStyle, width: 170 }}
            inputMode="numeric"
          />
          <button
            type="button"
            style={ownerButtonStyle}
            disabled={busy || !campusName.trim()}
            onClick={() => void addCampus()}
          >
            Add Campus
          </button>
        </div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 8 }}>
          Staff clock GPS uses the active campus boundary polygon. Entrance Radius is reference-only.
        </div>
      </section>

      {loading ? (
        <p style={{ marginTop: 16 }}>Loading campuses…</p>
      ) : campuses.length === 0 ? (
        <p style={{ marginTop: 16, color: "#64748b" }}>No campuses added yet.</p>
      ) : (
        <div style={{ marginTop: 16, display: "grid", gap: 12, maxWidth: 860 }}>
          {campuses.map((campus) => (
            <div key={campus.id} style={cardStyle}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{campus.name}</div>
                  <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
                    {campus.description || "No address / description"}
                  </div>
                  <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
                    TZ {campus.timezone} · Perimeter:{" "}
                    {campus.perimeterStatus === "NOT_DRAWN" ? "Not drawn" : campus.perimeterStatus} ·
                    Future perimeter tolerance: {campus.toleranceMetres} m · Entrances:{" "}
                    {campus.entranceCount} · GPS ready: {campus.gpsReadyEntranceCount ?? 0} ·{" "}
                    {campus.isActive ? "Campus active" : "Campus inactive"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <button
                    type="button"
                    style={ownerSecondaryButtonStyle}
                    onClick={() => {
                      const next = window.prompt("Campus name", campus.name);
                      if (next == null) return;
                      void updateEduClockCampus(campus.id, { name: next })
                        .then(reload)
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : "Update failed")
                        );
                    }}
                  >
                    Edit campus
                  </button>
                  <button
                    type="button"
                    style={ownerSecondaryButtonStyle}
                    onClick={() =>
                      void updateEduClockCampus(campus.id, { isActive: !campus.isActive })
                        .then(reload)
                        .catch((err) =>
                          setError(err instanceof Error ? err.message : "Update failed")
                        )
                    }
                  >
                    {campus.isActive ? "Deactivate campus" : "Activate campus"}
                  </button>
                  <button
                    type="button"
                    style={ownerButtonStyle}
                    disabled={busy}
                    onClick={() => openCreate(campus.id)}
                  >
                    Add entrance
                  </button>
                  <button
                    type="button"
                    style={ownerSecondaryButtonStyle}
                    disabled={busy}
                    onClick={() => {
                      setEntranceWizard(null);
                      setBoundaryCampusId(null);
                      setLocationTestCampusId((cur) => (cur === campus.id ? null : campus.id));
                    }}
                  >
                    {locationTestCampusId === campus.id ? "Hide location test" : "Test My Location"}
                  </button>
                  <button
                    type="button"
                    style={ownerSecondaryButtonStyle}
                    disabled={busy}
                    onClick={() => {
                      setEntranceWizard(null);
                      setLocationTestCampusId(null);
                      setBoundaryCampusId((cur) => (cur === campus.id ? null : campus.id));
                    }}
                  >
                    {boundaryCampusId === campus.id ? "Hide boundary wizard" : "Set Campus Boundary"}
                  </button>
                </div>
              </div>

              {boundaryCampusId === campus.id ? (
                <GeofenceCampusBoundaryWizard
                  campusId={campus.id}
                  campusName={campus.name}
                  entrances={(campus.entrances || [])
                    .filter(
                      (e) =>
                        e.latitude != null &&
                        e.longitude != null &&
                        Number.isFinite(e.latitude) &&
                        Number.isFinite(e.longitude)
                    )
                    .map((e) => ({
                      id: e.id,
                      name: e.name,
                      entranceTypeLabel: e.entranceTypeLabel || e.entranceType || null,
                      latitude: Number(e.latitude),
                      longitude: Number(e.longitude),
                      allowedRadiusMetres: e.allowedRadiusMetres ?? 5,
                      isActive: e.isActive,
                    }))}
                  onClose={() => setBoundaryCampusId(null)}
                  onSaved={() => {
                    setBoundaryCampusId(null);
                    void reload();
                  }}
                />
              ) : null}

              {locationTestCampusId === campus.id ? (
                <OwnerLocationTestWizard
                  campusId={campus.id}
                  campusName={campus.name}
                  existingEntrances={campus.entrances || []}
                  onClose={() => setLocationTestCampusId(null)}
                />
              ) : null}

              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Entrances</div>
                {(campus.entrances || []).length === 0 ? (
                  <div style={{ fontSize: 13, color: "#64748b" }}>
                    No entrances yet. Examples: Main Gate, Staff Entrance, Transport Entrance.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {(campus.entrances || []).map((e) => {
                      const readiness =
                        e.gpsReady != null
                          ? {
                              gpsReady: e.gpsReady,
                              label: e.gpsReady ? ("READY" as const) : ("NOT READY" as const),
                              reasons: e.gpsReadinessReasons || [],
                            }
                          : evaluateEntranceGpsReadiness({
                              entranceIsActive: e.isActive,
                              campusIsActive: campus.isActive,
                              latitude: e.latitude,
                              longitude: e.longitude,
                              allowedRadiusMetres: e.allowedRadiusMetres ?? ENTRANCE_RADIUS_DEFAULT,
                            });
                      return (
                        <div
                          key={e.id}
                          style={{
                            border: "1px solid #e2e8f0",
                            borderRadius: 12,
                            padding: 12,
                            background: "#f8fafc",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 8,
                              justifyContent: "space-between",
                              alignItems: "flex-start",
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: 800 }}>{e.name}</div>
                              {e.entranceTypeLabel ? (
                                <div style={{ fontSize: 13, color: "#64748b" }}>{e.entranceTypeLabel}</div>
                              ) : null}
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                                <EduClockBadge
                                  label={readiness.label}
                                  tone={readiness.gpsReady ? "green" : "amber"}
                                />
                                <EduClockBadge
                                  label={e.isActive ? "Active" : "Inactive"}
                                  tone={e.isActive ? "blue" : "grey"}
                                />
                              </div>
                              <div style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>
                                Coordinates:{" "}
                                {e.latitude != null && e.longitude != null
                                  ? "Configured"
                                  : "Not configured"}{" "}
                                · Entrance Radius: {e.allowedRadiusMetres ?? ENTRANCE_RADIUS_DEFAULT}{" "}
                                m
                              </div>
                              {!readiness.gpsReady ? (
                                <div style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>
                                  {readiness.reasons.join(" · ")}
                                </div>
                              ) : null}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <button
                                type="button"
                                style={ownerSecondaryButtonStyle}
                                disabled={busy}
                                onClick={() => openEdit(campus.id, e)}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                style={ownerSecondaryButtonStyle}
                                disabled={busy}
                                onClick={() => void toggleEntranceActive(e)}
                              >
                                {e.isActive ? "Deactivate" : "Activate"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {entranceWizard?.campusId === campus.id ? (
                <GeofenceEntranceWizard
                  campusId={campus.id}
                  campusName={campus.name}
                  existingEntrances={campus.entrances || []}
                  entrance={entranceWizard.entrance}
                  onClose={() => setEntranceWizard(null)}
                  onSaved={() => {
                    setEntranceWizard(null);
                    void reload();
                  }}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
