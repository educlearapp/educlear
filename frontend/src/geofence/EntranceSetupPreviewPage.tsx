/**
 * LOCAL DEV ONLY — Phase 2B entrance wizard preview (no auth).
 * /__local/geofence-entrance-preview
 */
import GeofenceEntranceWizard from "./EntranceSetupWizard";

export default function EntranceSetupPreviewPage() {
  return (
    <div style={{ minHeight: "100vh", background: "#050505", padding: 8, boxSizing: "border-box" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>
        <GeofenceEntranceWizard
          campusId="local-preview-campus"
          campusName="Main Campus"
          existingEntrances={[]}
          entrance={null}
          onClose={() => window.alert("Preview close")}
          onSaved={() => window.alert("Preview saved")}
        />
      </div>
    </div>
  );
}
