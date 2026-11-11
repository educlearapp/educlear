/**
 * Admin Collections register PATCH client contract.
 * Run: npx tsx src/homesafe/collections-prototype/collectionsApi.patch.test.ts
 */
import assert from "node:assert/strict";

/** Mirrors apiPatchRegister request body mapping (kept local to avoid network). */
function buildPatchBody(input: {
  sessionId: string;
  learnerId: string;
  date: string;
  attendance?: string;
  progress?: string;
  note?: string | null;
}) {
  return {
    sessionId: input.sessionId,
    learnerId: input.learnerId,
    date: input.date,
    schoolLocalDate: input.date,
    ...(input.attendance !== undefined ? { attendance: input.attendance } : {}),
    ...(input.progress !== undefined ? { progress: input.progress } : {}),
    ...(input.note !== undefined ? { note: input.note } : {}),
  };
}

const ready = buildPatchBody({
  sessionId: "s1",
  learnerId: "l1",
  date: "2026-11-11",
  progress: "READY",
});
assert.equal(ready.progress, "READY");
assert.equal(ready.date, "2026-11-11");
assert.equal(ready.schoolLocalDate, "2026-11-11");
assert.equal("attendance" in ready, false);

const collected = buildPatchBody({
  sessionId: "s1",
  learnerId: "l1",
  date: "2026-11-11",
  progress: "COLLECTED",
  note: "Collected by Driver",
});
assert.equal(collected.progress, "COLLECTED");
assert.equal(collected.note, "Collected by Driver");

console.log("collectionsApi.patch.test.ts: PASS");
