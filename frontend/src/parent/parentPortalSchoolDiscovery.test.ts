/**
 * Parent portal school discovery must use the sanitized public route.
 * Run: npx tsx src/parent/parentPortalSchoolDiscovery.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "ParentPortalApp.tsx"),
  "utf8"
);

assert.ok(source.includes('apiFetch("/api/public/schools", { skipAuth: true })'));
assert.ok(source.includes("apiFetch(`/api/public/schools/${encodeURIComponent(sid)}`, { skipAuth: true })"));
assert.equal(source.includes('apiFetch("/api/schools/"'), false);
assert.equal(source.includes("apiFetch(`/api/schools/"), false);

console.log("parentPortalSchoolDiscovery.test: PASS");
