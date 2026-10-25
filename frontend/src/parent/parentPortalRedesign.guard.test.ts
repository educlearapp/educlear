/**
 * Parent Portal 2.0 redesign guards — no invented operational tiles / no attendance as live feature.
 * Run: npx tsx src/parent/parentPortalRedesign.guard.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(dir, "ParentPortalApp.tsx"), "utf8");
const cssSrc = fs.readFileSync(path.join(dir, "parentPortal.css"), "utf8");
const learnersSrc = fs.readFileSync(path.join(dir, "parentPortalLearners.ts"), "utf8");

assert.ok(appSrc.includes("normalizeLinkedLearners"), "uses learner normalize helper");
assert.ok(appSrc.includes("resolveSelectedLearnerId"), "resolves selection including stale links");
assert.ok(appSrc.includes("formatOutstandingBalanceLabel"), "safe balance label");
assert.ok(appSrc.includes("parseBillingBalance"), "safe balance parse");
assert.ok(appSrc.includes("My children"), "My Children section present");
assert.ok(appSrc.includes("dashboardTiles"), "dashboard tiles defined");
assert.ok(appSrc.includes('label: "Finance"'), "Finance tile");
assert.ok(appSrc.includes('label: "Messages"'), "Messages tile");
assert.ok(appSrc.includes('label: "Homework"'), "Homework tile");
assert.ok(appSrc.includes('label: "Notices"'), "Notices tile");
assert.ok(appSrc.includes('label: "Events"'), "Events tile backed by SchoolEvent API");
assert.ok(appSrc.includes("ParentEventsPanel"), "Events panel mounted");
assert.ok(appSrc.includes('label: "Documents"'), "Documents tile");
assert.ok(appSrc.includes('label: "Incidents"'), "Incidents tile");
assert.ok(appSrc.includes('label: "Alerts"'), "Alerts tile");
assert.ok(appSrc.includes('label: "Settings"'), "Settings tile");
assert.ok(appSrc.includes("ParentPushSettings"), "Settings hosts push/notification preferences");
assert.ok(appSrc.includes("parentPortalPwaHead"), "Parent PWA head registration");
assert.ok(appSrc.includes("usePortalPwaHead"), "uses shared portal PWA head hook");
assert.equal(appSrc.includes("useParentPortalPushPreparation"), false, "placeholder SW prep hook removed from app");
assert.equal(appSrc.includes("push-sw-placeholder"), false, "no placeholder SW registration in app");

assert.equal(/label:\s*"Calendar"/.test(appSrc), false, "no invented Calendar tile (Events is the live surface)");
assert.equal(/label:\s*"Academic/.test(appSrc), false, "no Academic Progress tile");
assert.equal(/title:\s*"Attendance"/.test(appSrc), false, "no Attendance KPI as live feature");
assert.equal(/PayFast|payfast/.test(appSrc), false, "no PayFast integration in parent app");
assert.ok(appSrc.includes("upcomingEvents"), "dashboard upcoming events from API");

assert.ok(appSrc.includes("learners.map"), "renders all linked learners (map, not capped slice for children)");
assert.equal(/learners\.slice\(0,\s*[123]\)/.test(appSrc), false, "does not slice children list to 1–3");

assert.ok(cssSrc.includes(".parent-portal-root {"), "navy theme scoped under .parent-portal-root");
assert.ok(cssSrc.includes("--p-navy:"), "navy token present");
assert.ok(cssSrc.includes(".parent-portal-root .parent-portal-tile"), "tile styles scoped");
assert.ok(
  cssSrc.includes(".parent-portal-root .parent-portal-btn-primary:disabled"),
  "disabled primary button scoped under parent-portal-root"
);
assert.ok(
  cssSrc.includes("flex: 0 1 220px"),
  "child chips do not flex-grow across leftover desktop row"
);
assert.ok(learnersSrc.includes("resolveFamilyBillingLearnerIds"), "family billing scope helper");

console.log("parentPortalRedesign.guard.test: PASS");
