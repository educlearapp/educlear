import { useState } from "react";
import AdminHomeSafeEarlyDeparture from "./AdminHomeSafeEarlyDeparture";
import HomeSafeCollectionsPrototype from "./collections-prototype/HomeSafeCollectionsPrototype";
import "../teacher-app/teacherApp.css";
import "./homesafe.css";

type HomeSafeArea = "collections" | "early";

/**
 * HomeSafe admin shell: Collections & Groups (verified UX, live local persistence) | Early Departure.
 * Collections uses /api/homesafe/collections (Prisma). Local __local prototype routes stay demo/in-memory.
 */
export default function AdminHomeSafePage() {
  const [area, setArea] = useState<HomeSafeArea>("collections");

  return (
    <div className="admin-homesafe">
      <div className="admin-homesafe-module-nav" role="tablist" aria-label="HomeSafe areas">
        <button
          type="button"
          role="tab"
          aria-selected={area === "collections"}
          className={area === "collections" ? "active" : ""}
          onClick={() => setArea("collections")}
        >
          Collections & Groups
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={area === "early"}
          className={area === "early" ? "active" : ""}
          onClick={() => setArea("early")}
        >
          Early Departure
        </button>
      </div>

      {area === "collections" ? (
        <HomeSafeCollectionsPrototype mode="live" />
      ) : (
        <AdminHomeSafeEarlyDeparture />
      )}
    </div>
  );
}
