/**
 * LOCAL DEV ONLY — Phase 2C Owner Location Test + secure-connection preview.
 * /__local/geofence-location-test-preview
 */
import { useMemo, useState } from "react";
import OwnerLocationTestWizard from "./OwnerLocationTestWizard";
import SecureConnectionNotice from "./SecureConnectionNotice";
import type { OwnerLocationTestResult } from "./geofenceApi";
import {
  SECURE_CONNECTION_MESSAGE,
  SECURE_CONNECTION_TITLE,
} from "./secureConnectionMessage";

const demoAccepted: OwnerLocationTestResult = {
  campusId: "local-preview-campus",
  campusName: "Da Silva Academy",
  campusActive: true,
  campusBoundaryAvailable: true,
  isInsideCampusBoundary: true,
  nearestActiveEntranceId: "ent-main",
  nearestActiveEntranceName: "Main Gate",
  nearestEntranceName: "Main Gate",
  distanceToNearestEntranceMetres: 4.8,
  entranceRadiusMetres: 10,
  isWithinEntranceRadius: true,
  reportedAccuracyMetres: 5,
  accuracyAcceptedByCurrentClockRule: true,
  currentEntranceRuleWouldAccept: true,
  polygonRuleEnabled: false,
  futurePolygonAwareRuleWouldAccept: true,
  simulatedOverallResult: {
    currentClockRule: "ACCEPTED",
    futurePolygonAwareRule: "ACCEPTED",
    polygonEnforcement: "NOT_ENABLED",
  },
  rejectionReason: null,
  rejectionCode: null,
  activeEntranceCount: 1,
  gpsReadyEntranceCount: 1,
  simulationOnly: true,
  recordsCreated: { eduClockEvent: 0, eduClockGpsAttempt: 0, attendance: 0, payroll: 0 },
  map: {
    boundary: [
      { latitude: -26.205, longitude: 28.046 },
      { latitude: -26.205, longitude: 28.048 },
      { latitude: -26.203, longitude: 28.048 },
      { latitude: -26.203, longitude: 28.046 },
    ],
    entrances: [
      {
        id: "ent-main",
        name: "Main Gate",
        latitude: -26.2041,
        longitude: 28.0473,
        allowedRadiusMetres: 10,
        isNearest: true,
      },
    ],
    current: { latitude: -26.20412, longitude: 28.04732, accuracyMetres: 5 },
  },
};

const demoRejected: OwnerLocationTestResult = {
  ...demoAccepted,
  distanceToNearestEntranceMetres: 38.4,
  isWithinEntranceRadius: false,
  isInsideCampusBoundary: false,
  currentEntranceRuleWouldAccept: false,
  futurePolygonAwareRuleWouldAccept: false,
  rejectionReason: "You are 38.4 m from Main Gate. The allowed radius is 10 m.",
  rejectionCode: "OUTSIDE_ENTRANCE_RADIUS",
  simulatedOverallResult: {
    currentClockRule: "REJECTED",
    futurePolygonAwareRule: "REJECTED",
    polygonEnforcement: "NOT_ENABLED",
  },
  map: {
    ...demoAccepted.map,
    current: { latitude: -26.20445, longitude: 28.0473, accuracyMetres: 5 },
  },
};

export default function OwnerLocationTestPreviewPage() {
  const [mode, setMode] = useState<"accepted" | "rejected" | "insecure">("accepted");
  const mockNear = useMemo(
    () => ({ latitude: -26.2041, longitude: 28.0473, accuracyMetres: 5 }),
    []
  );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a0a",
        color: "#f8fafc",
        padding: 12,
        maxWidth: 390,
        margin: "0 auto",
        boxSizing: "border-box",
      }}
      data-testid="location-test-preview"
    >
      <h1 style={{ fontSize: 18, margin: "8px 0" }}>Phase 2C preview</h1>
      <p style={{ color: "#a3a3a3", fontSize: 13, lineHeight: 1.45 }}>
        Owner Location Test Mode. Viewport target 390×844.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {(["accepted", "rejected", "insecure"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            style={{
              borderRadius: 10,
              border: mode === m ? "1px solid #c9a227" : "1px solid #333",
              background: mode === m ? "#c9a227" : "#171717",
              color: mode === m ? "#111" : "#f8fafc",
              padding: "8px 10px",
              fontWeight: 700,
              fontSize: 12,
            }}
          >
            {m}
          </button>
        ))}
      </div>
      {mode === "insecure" ? (
        <div>
          <SecureConnectionNotice show />
          <p style={{ fontSize: 12, color: "#525252", marginTop: 12 }}>
            Title: {SECURE_CONNECTION_TITLE}
          </p>
          <p style={{ fontSize: 12, color: "#525252" }}>Message: {SECURE_CONNECTION_MESSAGE}</p>
        </div>
      ) : (
        <OwnerLocationTestWizard
          campusId="local-preview-campus"
          campusName="Da Silva Academy (preview)"
          onClose={() => undefined}
          mockLocation={mockNear}
          demoResult={mode === "accepted" ? demoAccepted : demoRejected}
        />
      )}
    </div>
  );
}
