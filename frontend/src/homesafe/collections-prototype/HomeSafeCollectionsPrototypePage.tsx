import HomeSafeCollectionsPrototype from "./HomeSafeCollectionsPrototype";
import { HS_CG_PROTO_REVISION } from "./prototypeMeta";
import "../homesafe.css";

/**
 * DEV-only standalone page — no auth, no API.
 * Route: /__local/homesafe-collections-prototype
 */
export default function HomeSafeCollectionsPrototypePage() {
  return (
    <div
      className="admin-homesafe"
      style={{
        maxWidth: 1180,
        margin: "0 auto",
        minHeight: "100vh",
        background: "#f7f7f5",
        color: "#111",
      }}
    >
      <div className="admin-homesafe-head" style={{ marginBottom: 8 }}>
        <h1 style={{ color: "#111", fontSize: 22, margin: 0 }}>HomeSafe — Collections & Groups</h1>
        <p className="admin-homesafe-muted" style={{ margin: "4px 0 0", fontSize: 13 }}>
          Local prototype · {HS_CG_PROTO_REVISION}
        </p>
      </div>
      <HomeSafeCollectionsPrototype />
    </div>
  );
}
