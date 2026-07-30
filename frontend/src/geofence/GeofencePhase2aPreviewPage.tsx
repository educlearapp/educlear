/**
 * LOCAL DEV ONLY — Phase 2A UX preview (no auth).
 * Route: /__local/geofence-corner-preview
 * Not shipped as a product feature; used for screenshots / mobile checks.
 */
import GeofenceCampusBoundaryWizard from "./GeofenceCampusBoundaryWizard";

export default function GeofencePhase2aPreviewPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#050505",
        padding: "8px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <GeofenceCampusBoundaryWizard
          campusId="local-preview-campus"
          campusName="Main Campus"
          onClose={() => {
            window.alert("Preview close");
          }}
          onSaved={() => {
            window.alert("Preview would save (API not required for UX shots)");
          }}
        />
      </div>
    </div>
  );
}
