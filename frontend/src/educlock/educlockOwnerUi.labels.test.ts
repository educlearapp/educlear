/**
 * EduClock Build 3.5 — friendly label unit checks (no API / no schema).
 * Run from frontend: npx --yes tsx src/educlock/educlockOwnerUi.labels.test.ts
 */
import {
  READINESS_BUCKET_LABELS,
  STAFF_STATUS_LABELS,
  friendlyReadinessLabel,
  toneForBucket,
  toneForReadinessReason,
} from "./educlockOwnerUi";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const enumKeys = [
  "readyToActivate",
  "missingEmployeeNumber",
  "missingIdentityDocument",
  "invalidIdentityDocument",
  "alreadyActivated",
  "requiresManualReview",
  "NOT_ACTIVATED",
  "ACTIVE",
];

for (const key of enumKeys) {
  const label = friendlyReadinessLabel(key);
  assert(!label.includes("readyToActivate"), `enum leaked for ${key}`);
  assert(label !== key || key.includes(" "), `raw enum shown for ${key}: ${label}`);
}

assert(friendlyReadinessLabel("missingEmployeeNumber") === "Missing Employee Number", "emp no label");
assert(friendlyReadinessLabel("User Account Not Linked") === "User Account Not Linked", "reason passthrough");
assert(toneForBucket("readyToActivate") === "green", "ready tone");
assert(toneForBucket("invalidIdentityDocument") === "red", "invalid tone");
assert(toneForReadinessReason("Missing Employee Number") === "amber", "amber tone");
assert(Object.keys(READINESS_BUCKET_LABELS).length >= 5, "bucket map present");
assert(Object.keys(STAFF_STATUS_LABELS).length >= 3, "staff status map present");

console.log("EDUCLOCK BUILD 3.5 LABEL TESTS PASS");
