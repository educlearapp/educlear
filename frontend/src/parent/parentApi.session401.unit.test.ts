/**
 * Parent session 401 handling: zombie localStorage sessions must clear.
 * Run: npx tsx src/parent/parentApi.session401.unit.test.ts
 */
import assert from "node:assert/strict";
import { ApiError } from "../api";
import {
  clearParentSession,
  getParentSession,
  getParentToken,
  isParentSessionUnauthorized,
  parentApiFetch,
  setParentSession,
} from "./parentApi";

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => {
    store.set(k, String(v));
  },
  removeItem: (k: string) => {
    store.delete(k);
  },
};

assert.equal(isParentSessionUnauthorized(new ApiError("Invalid or expired parent session", 401)), true);
assert.equal(isParentSessionUnauthorized(new ApiError("Parent authentication required", 401)), true);
assert.equal(isParentSessionUnauthorized(new ApiError("Request failed with status 401", 401)), true);
assert.equal(isParentSessionUnauthorized(new ApiError("Server error", 500)), false);
assert.equal(isParentSessionUnauthorized(new Error("Invalid or expired parent session")), true);
assert.equal(isParentSessionUnauthorized(null), false);

store.clear();
setParentSession("stale-parent-jwt", {
  parent: { id: "p1", firstName: "A", surname: "B", school: { id: "s1", name: "School" } },
});
assert.ok(getParentToken());
assert.ok(getParentSession()?.parent?.id);

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () =>
  new Response(JSON.stringify({ success: false, error: "Invalid or expired parent session" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

let threw = false;
try {
  await parentApiFetch("/api/parent-portal/dashboard");
} catch (e) {
  threw = true;
  assert.ok(e instanceof ApiError);
  assert.equal(e.status, 401);
  assert.equal(e.message, "Invalid or expired parent session");
}
assert.equal(threw, true);
assert.equal(getParentToken(), "", "401 must clear parentPortalToken");
assert.equal(getParentSession(), null, "401 must clear parentPortalSession cache");

globalThis.fetch = originalFetch;
clearParentSession();
console.log("✓ parentApi session 401 clears zombie token+session (status-based)");
