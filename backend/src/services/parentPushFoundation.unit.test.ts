/**
 * Phase 4A unit checks — no HTTP, no live push.
 * Run: npx tsx src/services/parentPushFoundation.unit.test.ts
 */
import assert from "assert";
import {
  isHttpsOrLocalEndpoint,
  phase4bDeliveryContract,
  serializePreference,
  validateQuietHours,
} from "./parentPushFoundation";

assert.equal(isHttpsOrLocalEndpoint("https://fcm.googleapis.com/fcm/send/abc"), true);
assert.equal(isHttpsOrLocalEndpoint("http://evil.example/push"), false);
assert.equal(isHttpsOrLocalEndpoint("http://127.0.0.1:9999/push"), true);
assert.equal(isHttpsOrLocalEndpoint("not-a-url"), false);

assert.equal(validateQuietHours(null, null), null);
assert.equal(validateQuietHours("22:00", "06:30"), null);
assert.ok(validateQuietHours("22:00", null));
assert.ok(validateQuietHours("25:00", "06:00"));
assert.ok(validateQuietHours("9:00", "10:00"));

const defaults = serializePreference(null, "school-1", "parent-1");
assert.equal(defaults.pushEnabled, false);
assert.equal(defaults.lockScreenPreview, false);
assert.equal(defaults.soundEnabled, false);
assert.equal(defaults.pushTeacherMessages, true);

// Phase 4B (0a003fb) flipped documentation status from "deferred" → "implemented".
// External send remains gated by WEB_PUSH_DELIVERY_ENABLED (default unset/off).
const contract = phase4bDeliveryContract();
assert.equal(contract.status, "implemented");
assert.equal(contract.featureFlag, "WEB_PUSH_DELIVERY_ENABLED");
assert.ok(contract.neverInclude.includes("billing"));

console.log("parentPushFoundation.unit.test: PASS");
