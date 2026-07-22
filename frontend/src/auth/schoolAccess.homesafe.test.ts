import assert from "node:assert/strict";
import { canAccessSchoolPage } from "./schoolAccess";
import type { SchoolSessionUser } from "./schoolSession";
import { permissionsForRole } from "../users/permissions";

const store = new Map<string, string>();
(globalThis as { localStorage?: Storage }).localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => store.clear(),
  key: () => null,
  length: 0,
};

function user(appRole: string): SchoolSessionUser {
  return {
    appRole,
    permissions: permissionsForRole(appRole as "Owner" | "Admin" | "Finance" | "Teacher" | "Viewer"),
    isActive: true,
  };
}

assert.equal(canAccessSchoolPage("homesafe", user("Owner")), true);
assert.equal(canAccessSchoolPage("homesafe", user("Admin")), true);
assert.equal(canAccessSchoolPage("homesafe", user("Finance")), false);
assert.equal(canAccessSchoolPage("homesafe", user("Teacher")), false);
assert.equal(canAccessSchoolPage("homesafe", user("Viewer")), true);

console.log("schoolAccess.homesafe.test.ts: PASS");
