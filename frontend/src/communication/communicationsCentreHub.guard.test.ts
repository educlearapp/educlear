/**
 * Communications Centre Phase 1/2 — structural guard.
 * Run: npx tsx src/communication/communicationsCentreHub.guard.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hubCss = fs.readFileSync(path.join(here, "communicationsCentreHub.css"), "utf8");
const hubTsx = fs.readFileSync(path.join(here, "CommunicationsCentreHub.tsx"), "utf8");
const announceTsx = fs.readFileSync(path.join(here, "AnnouncementsPanel.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(here, "../SchoolDashboard.tsx"), "utf8");
const parentCss = fs.readFileSync(path.join(here, "../parent/parentPortal.css"), "utf8");

assert.ok(hubCss.includes(".communications-centre-hub"), "hub CSS is scoped");
assert.equal(hubCss.includes(".parent-portal-root"), false, "hub CSS must not target parent portal");
assert.equal(hubCss.includes(".parent-finance-hub"), false, "hub CSS must not target finance hub");
assert.equal(parentCss.includes(".communications-centre-hub"), false, "parent portal CSS untouched by hub");

assert.ok(hubTsx.includes("TeacherInbox"), "Messages tab reuses TeacherInbox");
assert.ok(hubTsx.includes("AnnouncementsPanel"), "Announcements tab present");
assert.ok(hubTsx.includes("EventsPanel") || hubTsx.includes("<EventsPanel"), "Events tab wired");
assert.ok(hubTsx.includes("Notifications · soon"), "Notifications future tab labelled");
assert.equal(hubTsx.includes("Events · soon"), false, "Events placeholder removed");

assert.ok(announceTsx.includes("/api/school-announcements"), "lifecycle API mounted in UI");
assert.ok(announceTsx.includes("publish"), "publish control present");
assert.ok(announceTsx.includes("unpublish"), "unpublish control present");
assert.ok(announceTsx.includes("archive"), "archive control present");
assert.ok(announceTsx.includes("SCHOOL_ADMIN"), "admin gate mentioned in UI");
assert.equal(
  announceTsx.includes("/api/teacher-app/notices"),
  false,
  "Phase 2 management uses school-announcements, not direct teacher-app publish form"
);

const eventsTsx = fs.readFileSync(path.join(here, "EventsPanel.tsx"), "utf8");
assert.ok(eventsTsx.includes("/api/school-events"), "events API used");
assert.ok(eventsTsx.includes("cancel"), "cancel control present");

assert.ok(dashboard.includes("CommunicationsCentreHub"), "dashboard mounts hub");
assert.ok(dashboard.includes('"communicationsHub"') || dashboard.includes("'communicationsHub'"), "page key wired");
assert.ok(dashboard.includes("Delivery Queue"), "legacy engine renamed Delivery Queue");

console.log("communicationsCentreHub.guard.test: PASS");
