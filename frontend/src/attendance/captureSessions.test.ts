/**
 * Capture session helper tests.
 * Run: npx --yes tsx src/attendance/captureSessions.test.ts
 */
import assert from "assert";
import {
  SUBJECTS_EMPTY_MESSAGE,
  defaultSessionForMode,
  periodModeFallbackSessions,
  resolveSelectedSessionLabel,
} from "./captureSessions";
import { DEFAULT_ATTENDANCE_PERIOD } from "./periodOptions";

assert.ok(periodModeFallbackSessions().some((s) => s.period === "PERIOD_8"));
assert.ok(periodModeFallbackSessions().some((s) => s.period === "INTERVENTION"));
assert.strictEqual(defaultSessionForMode("PERIODS", []), DEFAULT_ATTENDANCE_PERIOD);
assert.strictEqual(
  defaultSessionForMode("SUBJECTS", [{ period: "SLOT_abc", label: "Mathematics" }]),
  "SLOT_abc"
);
assert.strictEqual(defaultSessionForMode("SUBJECTS", []), "");
assert.strictEqual(
  resolveSelectedSessionLabel("SLOT_1", [{ period: "SLOT_1", label: "Mathematics (Session 1)" }], "SUBJECTS"),
  "Mathematics (Session 1)"
);
assert.ok(SUBJECTS_EMPTY_MESSAGE.includes("No subject sessions"));
console.log("captureSessions.test.ts: OK");
