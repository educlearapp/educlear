/**
 * Draw Campus Boundary wizard (Phase 2D).
 * Map tap drawing + review/save. Does not change staff clock GPS behaviour.
 *
 * Controls use a mode-aware primary action area + "More" overflow panel so the
 * mobile viewport (390 px) stays clean. Tablet/desktop sees all controls inline.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchCampusBoundaryZone, saveCampusBoundaryPolygon } from "./geofenceApi";
import GeofenceDrawBoundaryMap, { type DrawMapMode } from "./GeofenceDrawBoundaryMap";
import {
  classifyEntrancesAgainstBoundary,
  collectShapeWarnings,
  formatAreaLabel,
  formatPerimeterLabel,
  GEOFENCE_POLYGON_MIN_VERTICES,
  newDrawPointId,
  polygonAreaSquareMetres,
  polygonPerimeterMetres,
  validateDrawnPolygon,
  type DrawEntranceOverlay,
  type DrawPoint,
} from "./geofenceDrawBoundary";
import {
  isOwnerSecureContext,
  logInsecureContextDiagnostics,
  SECURE_CONNECTION_MESSAGE,
} from "./secureConnectionMessage";
import SecureConnectionNotice from "./SecureConnectionNotice";

type DrawStep = "draw" | "review";

type Props = {
  campusId: string;
  campusName: string;
  entrances: DrawEntranceOverlay[];
  onClose: () => void;
  onSaved: () => void;
  onBackToMethods: () => void;
};

const GOLD = "#c9a227";
const BLACK = "#0a0a0a";
const WHITE = "#f8fafc";

const btnBase: CSSProperties = {
  border: "none",
  borderRadius: 14,
  padding: "12px 14px",
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
  minHeight: 48,
  touchAction: "manipulation",
  WebkitTapHighlightColor: "transparent",
};

const btnPrimary: CSSProperties = {
  ...btnBase,
  background: GOLD,
  color: "#111827",
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

/** "More" overflow button — three dots */
const btnMore: CSSProperties = {
  ...btnBase,
  background: "#171717",
  color: WHITE,
  border: "1px solid #333",
  padding: "12px 16px",
  minWidth: 48,
  letterSpacing: 2,
  flexShrink: 0,
};

export default function GeofenceDrawBoundaryWizard({
  campusId,
  campusName,
  entrances,
  onClose,
  onSaved,
  onBackToMethods,
}: Props) {
  const [step, setStep] = useState<DrawStep>("draw");
  const [points, setPoints] = useState<DrawPoint[]>([]);
  const [closed, setClosed] = useState(false);
  const [mode, setMode] = useState<DrawMapMode>("navigate");
  const [savedBoundary, setSavedBoundary] = useState<
    Array<{ latitude: number; longitude: number }>
  >([]);
  const [hasSavedBoundary, setHasSavedBoundary] = useState(false);
  const [live, setLive] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoError, setGeoError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);
  const [locateToken, setLocateToken] = useState(0);
  const [loadingBoundary, setLoadingBoundary] = useState(true);
  const [secureContextOk] = useState(() => isOwnerSecureContext());
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close the "More" panel when clicking/tapping outside it.
  useEffect(() => {
    if (!moreOpen) return;
    function handleOutside(e: MouseEvent | TouchEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [moreOpen]);

  const activeEntrances = useMemo(
    () =>
      entrances.filter(
        (e) =>
          e.isActive &&
          Number.isFinite(e.latitude) &&
          Number.isFinite(e.longitude)
      ),
    [entrances]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingBoundary(true);
    fetchCampusBoundaryZone(campusId)
      .then((res) => {
        if (cancelled) return;
        const verts = res.zone?.vertices || [];
        if (verts.length >= 3) {
          const ring = verts.map((v) => ({
            latitude: v.latitude,
            longitude: v.longitude,
          }));
          setSavedBoundary(ring);
          setHasSavedBoundary(true);
          setPoints(
            verts.map((v) => ({
              id: newDrawPointId(),
              latitude: v.latitude,
              longitude: v.longitude,
            }))
          );
          setClosed(true);
          setMode("navigate");
        }
      })
      .catch(() => {
        if (!cancelled) setSavedBoundary([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingBoundary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [campusId]);

  const requestLocate = useCallback(() => {
    setGeoError("");
    if (!navigator.geolocation) {
      setGeoError("Location is not available on this device.");
      setLocateToken((n) => n + 1);
      return;
    }
    if (!isOwnerSecureContext()) {
      logInsecureContextDiagnostics("GeofenceDrawBoundaryWizard");
      setGeoError(SECURE_CONNECTION_MESSAGE);
      setLocateToken((n) => n + 1);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLive({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocateToken((n) => n + 1);
      },
      (err) => {
        if (err.code === 1) {
          setGeoError("Location permission is off. You can still draw if the school is already on the map.");
        } else if (err.code === 3) {
          setGeoError("Location timed out. You can still draw from the map.");
        } else {
          setGeoError("Could not read location. You can still draw if the school is on the map.");
        }
        setLocateToken((n) => n + 1);
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 }
    );
  }, []);

  // Auto-locate once when there is no boundary/entrance anchor.
  useEffect(() => {
    if (loadingBoundary) return;
    if (savedBoundary.length >= 3 || activeEntrances.length > 0) return;
    requestLocate();
  }, [loadingBoundary, savedBoundary.length, activeEntrances.length, requestLocate]);

  function startDrawing() {
    setActionError("");
    setStep("draw");
    if (hasSavedBoundary && points.length >= 3 && closed) {
      const ok = window.confirm(
        "Start a new drawing? Your unsaved edits will be cleared. The saved boundary stays until you save a replacement."
      );
      if (!ok) return;
      setPoints([]);
      setClosed(false);
    }
    setMode("drawing");
  }

  function editExisting() {
    setActionError("");
    setStep("draw");
    if (points.length < 3 && savedBoundary.length >= 3) {
      setPoints(
        savedBoundary.map((p) => ({
          id: newDrawPointId(),
          latitude: p.latitude,
          longitude: p.longitude,
        }))
      );
      setClosed(true);
    }
    setMode("editing");
  }

  function addPoint(lat: number, lng: number) {
    setActionError("");
    setPoints((prev) => {
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        const dist = Math.hypot(lat - last.latitude, lng - last.longitude);
        // Rough screen-duplicate guard; full validation on finish.
        if (dist < 1e-7) return prev;
      }
      return [...prev, { id: newDrawPointId(), latitude: lat, longitude: lng }];
    });
    setClosed(false);
  }

  function movePoint(id: string, lat: number, lng: number) {
    setPoints((prev) =>
      prev.map((p) => (p.id === id ? { ...p, latitude: lat, longitude: lng } : p))
    );
  }

  function insertPoint(afterIndex: number, lat: number, lng: number) {
    setPoints((prev) => {
      const next = [...prev];
      next.splice(afterIndex + 1, 0, {
        id: newDrawPointId(),
        latitude: lat,
        longitude: lng,
      });
      return next;
    });
  }

  function removePoint(id: string) {
    setPoints((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (next.length < GEOFENCE_POLYGON_MIN_VERTICES) setClosed(false);
      return next;
    });
  }

  function undoLast() {
    setActionError("");
    setPoints((prev) => {
      const next = prev.slice(0, -1);
      if (next.length < GEOFENCE_POLYGON_MIN_VERTICES) setClosed(false);
      return next;
    });
  }

  function clearDrawing() {
    const ok = window.confirm("Clear the unsaved drawing?");
    if (!ok) return;
    setPoints([]);
    setClosed(false);
    setMode("drawing");
    setActionError("");
  }

  function finishDrawing() {
    setActionError("");
    if (points.length < GEOFENCE_POLYGON_MIN_VERTICES) {
      setActionError(`Add at least ${GEOFENCE_POLYGON_MIN_VERTICES} points before finishing.`);
      return;
    }
    const check = validateDrawnPolygon(points);
    if (!check.ok) {
      setActionError(check.error);
      return;
    }
    const confirmClose = window.confirm(
      "Finish drawing? EduClock will close the polygon by connecting the last point to the start."
    );
    if (!confirmClose) return;
    setClosed(true);
    setMode("navigate");
    setStep("review");
  }

  function closeAtStart() {
    if (points.length < GEOFENCE_POLYGON_MIN_VERTICES) {
      setActionError(`Add at least ${GEOFENCE_POLYGON_MIN_VERTICES} points before closing.`);
      return;
    }
    const check = validateDrawnPolygon(points);
    if (!check.ok) {
      setActionError(check.error);
      return;
    }
    setClosed(true);
    setMode("navigate");
    setStep("review");
  }

  function cancelWizard() {
    if (points.length > 0) {
      const ok = window.confirm(
        "Cancel without saving? The existing saved boundary (if any) will stay unchanged."
      );
      if (!ok) return;
    }
    onClose();
  }

  async function saveBoundary() {
    setActionError("");
    const check = validateDrawnPolygon(points);
    if (!check.ok) {
      setActionError(check.error);
      setStep("draw");
      setMode("editing");
      return;
    }
    if (hasSavedBoundary) {
      const ok = window.confirm(
        "You are replacing the current campus boundary. The previous version will remain in EduClock’s history."
      );
      if (!ok) return;
    }
    const classification = classifyEntrancesAgainstBoundary(points, activeEntrances);
    const areaSquareMetres = Math.round(polygonAreaSquareMetres(points) * 100) / 100;
    const perimeterMetres = Math.round(polygonPerimeterMetres(points) * 100) / 100;
    setSaving(true);
    try {
      await saveCampusBoundaryPolygon({
        campusId,
        name: `${campusName} Campus Boundary`,
        vertices: points.map((p) => ({
          latitude: p.latitude,
          longitude: p.longitude,
          accuracyMetres: null,
          capturedAt: new Date().toISOString(),
        })),
        metadata: {
          captureMethod: "DRAW_ON_MAP",
          pointCount: points.length,
          areaSquareMetres,
          perimeterMetres,
          entrancesInside: classification.inside.length,
          entrancesOutside: classification.outside.length,
        },
      });
      onSaved();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Could not save the campus boundary.");
    } finally {
      setSaving(false);
    }
  }

  const classification = classifyEntrancesAgainstBoundary(points, activeEntrances);
  const area = polygonAreaSquareMetres(points);
  const perimeter = polygonPerimeterMetres(points);
  const warnings = collectShapeWarnings(points);
  const canFinish = points.length >= GEOFENCE_POLYGON_MIN_VERTICES;

  if (step === "review") {
    return (
      <div
        data-testid="geofence-draw-boundary-review"
        style={{
          marginTop: 12,
          borderRadius: 18,
          border: "1px solid rgba(201,162,39,0.4)",
          background: BLACK,
          color: WHITE,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          height: "min(94dvh, 900px)",
          maxHeight: "94dvh",
        }}
      >
        <div style={{ padding: "14px 16px", borderBottom: "1px solid #262626" }}>
          <div style={{ fontWeight: 900, fontSize: 17 }}>Review campus boundary</div>
          <div style={{ fontSize: 13, color: "#a3a3a3", marginTop: 4 }}>{campusName}</div>
          <div style={{ fontSize: 12, color: GOLD, marginTop: 8, fontWeight: 700 }}>
            Capture method: Drawn on Map
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 220 }}>
          <GeofenceDrawBoundaryMap
            points={points}
            closed
            mode="navigate"
            savedBoundary={savedBoundary}
            entrances={activeEntrances}
            live={live}
            onAddPoint={() => undefined}
            onMovePoint={() => undefined}
            onInsertPoint={() => undefined}
            onRemovePoint={() => undefined}
            onCloseAtStart={() => undefined}
          />
        </div>
        <div style={{ padding: 14, display: "grid", gap: 10, borderTop: "1px solid #262626" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
            <div>Points: <strong>{points.length}</strong></div>
            <div>Perimeter: <strong>{formatPerimeterLabel(perimeter)}</strong></div>
            <div>Area: <strong>{formatAreaLabel(area)}</strong></div>
            <div>
              Entrances: <strong>{classification.inside.length} in</strong> /{" "}
              <strong>{classification.outside.length} out</strong>
            </div>
          </div>
          {classification.outside.length > 0 ? (
            <div
              role="status"
              style={{
                padding: 10,
                borderRadius: 12,
                background: "#422006",
                border: "1px solid #9a3412",
                color: "#fdba74",
                fontSize: 13,
                lineHeight: 1.45,
                fontWeight: 600,
              }}
            >
              {classification.outside.length} entrance
              {classification.outside.length === 1 ? " is" : "s are"} outside the proposed
              boundary. This will not affect staff clocking, but you may want to review their
              positions.
            </div>
          ) : null}
          {warnings.map((w) => (
            <div key={w} style={{ color: "#fbbf24", fontSize: 13, fontWeight: 600 }}>
              {w}
            </div>
          ))}
          {actionError ? (
            <div role="alert" style={{ color: "#fca5a5", fontWeight: 700, fontSize: 13 }}>
              {actionError}
            </div>
          ) : null}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" style={btnSecondary} onClick={() => { setStep("draw"); setMode("editing"); }}>
              Edit Boundary
            </button>
            <button type="button" style={btnPrimary} disabled={saving} onClick={() => void saveBoundary()}>
              {saving ? "Saving…" : "Save Boundary"}
            </button>
            <button
              type="button"
              style={btnSecondary}
              onClick={() => {
                setPoints([]);
                setClosed(false);
                setMode("drawing");
                setStep("draw");
              }}
            >
              Start Again
            </button>
            <button type="button" style={btnDanger} onClick={cancelWizard}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="geofence-draw-boundary-wizard"
      style={{
        marginTop: 12,
        borderRadius: 18,
        border: "1px solid rgba(201,162,39,0.4)",
        background: BLACK,
        color: WHITE,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        height: "min(94dvh, 900px)",
        maxHeight: "94dvh",
      }}
    >
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #262626" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Draw Campus Boundary</div>
            <div style={{ fontSize: 12, color: "#a3a3a3", marginTop: 4 }}>{campusName}</div>
          </div>
          <button type="button" style={{ ...btnSecondary, padding: "8px 12px", minHeight: 40 }} onClick={cancelWizard}>
            Cancel
          </button>
        </div>
        <SecureConnectionNotice show={!secureContextOk} />
        <div style={{ marginTop: 8, fontSize: 12, color: "#d4d4d4", lineHeight: 1.45 }}>
          Mode:{" "}
          <strong style={{ color: GOLD }}>
            {mode === "drawing" ? "Drawing" : mode === "editing" ? "Editing points" : "Navigate map"}
          </strong>
          {" · "}
          Points: <strong>{points.length}</strong>
          {closed ? " · Closed" : ""}
        </div>
        {hasSavedBoundary ? (
          <div style={{ marginTop: 8, fontSize: 12, color: "#94a3b8" }}>
            A saved boundary is shown (grey dashed). It is not replaced until you save.
          </div>
        ) : null}
      </div>

      <div style={{ flex: 1, minHeight: 240, position: "relative" }}>
        {loadingBoundary ? (
          <div style={{ padding: 24, color: "#a3a3a3", fontWeight: 700 }}>Loading boundary…</div>
        ) : (
          <GeofenceDrawBoundaryMap
            points={points}
            closed={closed}
            mode={mode}
            savedBoundary={savedBoundary}
            entrances={activeEntrances}
            live={live}
            locateToken={locateToken}
            onAddPoint={addPoint}
            onMovePoint={movePoint}
            onInsertPoint={insertPoint}
            onRemovePoint={removePoint}
            onCloseAtStart={closeAtStart}
          />
        )}
      </div>

      {/* ── Control strip: mode-aware primary + More overflow panel ─────── */}
      <div style={{ borderTop: "1px solid #262626", padding: "10px 12px" }}>
        {/* Status messages */}
        {geoError ? (
          <div role="status" style={{ color: "#fdba74", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {geoError}
          </div>
        ) : null}
        {actionError ? (
          <div role="alert" style={{ color: "#fca5a5", fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
            {actionError}
          </div>
        ) : null}
        {classification.outside.length > 0 && points.length >= 3 ? (
          <div style={{ color: "#fdba74", fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {classification.outside.length} entrance
            {classification.outside.length === 1 ? "" : "s"} outside proposed boundary (advisory only).
          </div>
        ) : null}

        {/* ── NAVIGATE mode ─── */}
        {mode === "navigate" && (
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <button
              type="button"
              style={{ ...btnPrimary, flex: 1 }}
              onClick={startDrawing}
            >
              {hasSavedBoundary && points.length >= 3 ? "Redraw Boundary" : "Start Drawing"}
            </button>
            {hasSavedBoundary && points.length >= 3 ? (
              <button
                type="button"
                style={{ ...btnSecondary, flex: 1 }}
                onClick={editExisting}
              >
                Edit Boundary
              </button>
            ) : null}
            {/* More ⋯ */}
            <div ref={moreRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                style={btnMore}
                aria-label="More options"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                ···
              </button>
              {moreOpen && (
                <div
                  data-testid="more-menu"
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    right: 0,
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    borderRadius: 14,
                    padding: 8,
                    display: "grid",
                    gap: 6,
                    minWidth: 180,
                    zIndex: 9999,
                  }}
                >
                  <button type="button" style={{ ...btnSecondary, padding: "10px 14px", fontSize: 13 }}
                    onClick={() => { setMoreOpen(false); requestLocate(); }}>
                    Locate School
                  </button>
                  <button type="button" style={{ ...btnDanger, padding: "10px 14px", fontSize: 13 }}
                    onClick={() => { setMoreOpen(false); cancelWizard(); }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── DRAWING mode ─── */}
        {mode === "drawing" && (
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <button
              type="button"
              style={{ ...btnPrimary, flex: 1 }}
              disabled={!canFinish}
              onClick={finishDrawing}
            >
              Finish Drawing
            </button>
            <button
              type="button"
              style={{ ...btnSecondary, flex: "0 0 auto", padding: "12px 16px" }}
              disabled={points.length === 0}
              onClick={undoLast}
            >
              Undo
            </button>
            {/* More ⋯ */}
            <div ref={moreRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                style={btnMore}
                aria-label="More options"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                ···
              </button>
              {moreOpen && (
                <div
                  data-testid="more-menu"
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    right: 0,
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    borderRadius: 14,
                    padding: 8,
                    display: "grid",
                    gap: 6,
                    minWidth: 180,
                    zIndex: 9999,
                  }}
                >
                  <button type="button" style={{ ...btnSecondary, padding: "10px 14px", fontSize: 13 }}
                    onClick={() => { setMoreOpen(false); clearDrawing(); }}>
                    Clear Drawing
                  </button>
                  <button type="button" style={{ ...btnSecondary, padding: "10px 14px", fontSize: 13 }}
                    onClick={() => { setMoreOpen(false); setMode("navigate"); }}>
                    Cancel Drawing
                  </button>
                  <button type="button" style={{ ...btnSecondary, padding: "10px 14px", fontSize: 13 }}
                    onClick={() => { setMoreOpen(false); requestLocate(); }}>
                    Locate School
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── EDITING mode ─── */}
        {mode === "editing" && (
          <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
            <button
              type="button"
              style={{ ...btnPrimary, flex: 1 }}
              disabled={!canFinish}
              onClick={finishDrawing}
            >
              Review Boundary
            </button>
            <button
              type="button"
              style={{ ...btnSecondary, flex: "0 0 auto", padding: "12px 16px" }}
              onClick={() => setMode("navigate")}
            >
              Done Editing
            </button>
            {/* More ⋯ */}
            <div ref={moreRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                style={btnMore}
                aria-label="More options"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((o) => !o)}
              >
                ···
              </button>
              {moreOpen && (
                <div
                  data-testid="more-menu"
                  style={{
                    position: "absolute",
                    bottom: "calc(100% + 6px)",
                    right: 0,
                    background: "#1a1a1a",
                    border: "1px solid #333",
                    borderRadius: 14,
                    padding: 8,
                    display: "grid",
                    gap: 6,
                    minWidth: 180,
                    zIndex: 9999,
                  }}
                >
                  <button type="button" style={{ ...btnSecondary, padding: "10px 14px", fontSize: 13 }}
                    disabled={points.length === 0}
                    onClick={() => { setMoreOpen(false); undoLast(); }}>
                    Undo Last Point
                  </button>
                  <button type="button" style={{ ...btnSecondary, padding: "10px 14px", fontSize: 13 }}
                    disabled={points.length === 0}
                    onClick={() => { setMoreOpen(false); clearDrawing(); }}>
                    Clear Boundary
                  </button>
                  <button type="button" style={{ ...btnSecondary, padding: "10px 14px", fontSize: 13 }}
                    onClick={() => { setMoreOpen(false); requestLocate(); }}>
                    Locate School
                  </button>
                  <button type="button" style={{ ...btnDanger, padding: "10px 14px", fontSize: 13 }}
                    onClick={() => { setMoreOpen(false); cancelWizard(); }}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div style={{ fontSize: 12, color: "#a3a3a3", lineHeight: 1.4, marginTop: 8 }}>
          {mode === "drawing"
            ? "Tap the map to add points. Tap the first point to close the shape."
            : mode === "editing"
            ? "Drag points to adjust. Tap between two points to insert. Tap a point to remove it."
            : "Press Start Drawing to begin, or Edit Boundary to adjust an existing one."}
        </div>
      </div>
    </div>
  );
}
