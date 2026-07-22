/**
 * Teacher HomeSafe: already-dismissed card must show stored Collected by.
 * Run: npx tsx src/teacher-app/TeacherHomeSafePage.collectionMethod.test.ts
 */
import assert from "node:assert/strict";
import { collectionMethodForTeacherHomeSafeSelection } from "./TeacherHomeSafePage";

function learner(
  dismissedToday: boolean,
  collectionMethod?: string | null
) {
  return {
    dismissedToday,
    dismissalToday:
      dismissedToday && collectionMethod
        ? {
            displayName: "Test Learner",
            schoolLocalTimeDisplay: "15:00",
            collectionMethod,
          }
        : dismissedToday
          ? {
              displayName: "Test Learner",
              schoolLocalTimeDisplay: "15:00",
              collectionMethod: "",
            }
          : null,
  };
}

assert.equal(
  collectionMethodForTeacherHomeSafeSelection(learner(false)),
  "PARENT",
  "new dismissal defaults to PARENT"
);

assert.equal(
  collectionMethodForTeacherHomeSafeSelection(learner(true, "SCHOOL_TRANSPORT")),
  "SCHOOL_TRANSPORT",
  "School Transport → already dismissed shows SCHOOL_TRANSPORT"
);

assert.equal(
  collectionMethodForTeacherHomeSafeSelection(learner(true, "TAXI")),
  "TAXI",
  "Taxi → already dismissed shows TAXI"
);

assert.equal(
  collectionMethodForTeacherHomeSafeSelection(learner(true, "PARENT")),
  "PARENT",
  "Parent → already dismissed shows PARENT"
);

assert.equal(
  collectionMethodForTeacherHomeSafeSelection(learner(true, "TRANSPORT")),
  "TRANSPORT",
  "legacy Transport → already dismissed shows TRANSPORT"
);

assert.equal(
  collectionMethodForTeacherHomeSafeSelection(learner(true, "BOLT")),
  "BOLT",
  "Bolt preserved"
);

assert.notEqual(
  collectionMethodForTeacherHomeSafeSelection(learner(true, "SCHOOL_TRANSPORT")),
  "PARENT",
  "School Transport must not display as Parent"
);

assert.notEqual(
  collectionMethodForTeacherHomeSafeSelection(learner(true, "TAXI")),
  "PARENT",
  "Taxi must not display as Parent"
);

console.log("TeacherHomeSafePage.collectionMethod.test.ts: PASS");
