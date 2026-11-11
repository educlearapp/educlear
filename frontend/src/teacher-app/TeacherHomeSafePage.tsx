import { useState } from "react";
import TeacherHomeSafeCollections from "./TeacherHomeSafeCollections";
import TeacherHomeSafeEarlyDeparture, {
  collectionMethodForTeacherHomeSafeSelection,
} from "./TeacherHomeSafeEarlyDeparture";

export { collectionMethodForTeacherHomeSafeSelection };

type HomeSafeArea = "collections" | "early";

/**
 * Teacher HomeSafe shell: Collections & Groups | Early Departure.
 * Collections reads school-owned HomeSafeCollection* records via teacher-app APIs.
 * Early Departure preserves the existing dismissal workflow.
 */
export default function TeacherHomeSafePage() {
  const [area, setArea] = useState<HomeSafeArea>("collections");

  return (
    <div className="teacher-homesafe">
      <h1 className="teacher-page-heading">HomeSafe</h1>

      <div className="teacher-homesafe-module-nav" role="tablist" aria-label="HomeSafe areas">
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
        <TeacherHomeSafeCollections />
      ) : (
        <TeacherHomeSafeEarlyDeparture />
      )}
    </div>
  );
}
