/**
 * Communications Centre Phase 1/2/P1 — structural guard.
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
const docsTsx = fs.readFileSync(path.join(here, "DocumentsPanel.tsx"), "utf8");
const notifTsx = fs.readFileSync(path.join(here, "NotificationsOverviewPanel.tsx"), "utf8");
const queueTsx = fs.readFileSync(path.join(here, "CommunicationCentre.tsx"), "utf8");
const dashboard = fs.readFileSync(path.join(here, "../SchoolDashboard.tsx"), "utf8");
const parentCss = fs.readFileSync(path.join(here, "../parent/parentPortal.css"), "utf8");

assert.ok(hubCss.includes(".communications-centre-hub"), "hub CSS is scoped");
assert.equal(hubCss.includes(".parent-portal-root"), false, "hub CSS must not target parent portal");
assert.equal(hubCss.includes(".parent-finance-hub"), false, "hub CSS must not target finance hub");
assert.equal(parentCss.includes(".communications-centre-hub"), false, "parent portal CSS untouched by hub");

assert.ok(hubTsx.includes("TeacherInbox"), "Messages tab reuses TeacherInbox");
assert.ok(hubTsx.includes("AnnouncementsPanel"), "Announcements tab present");
assert.ok(hubTsx.includes("EventsPanel") || hubTsx.includes("<EventsPanel"), "Events tab wired");
assert.ok(hubTsx.includes("DocumentsPanel"), "Documents tab wired");
assert.ok(hubTsx.includes("NotificationsOverviewPanel"), "Notifications overview wired");
assert.ok(hubTsx.includes("CommunicationCentre"), "Delivery Queue reuses CommunicationCentre");
assert.ok(hubTsx.includes("Delivery Queue"), "Delivery Queue tab labelled");
assert.equal(hubTsx.includes("Notifications · soon"), false, "Notifications placeholder removed");
assert.equal(hubTsx.includes("Events · soon"), false, "Events placeholder removed");

assert.ok(docsTsx.includes("/api/school-parent-documents"), "documents API used");
assert.ok(notifTsx.includes("/api/school-notifications-overview"), "notifications overview API used");
assert.ok(notifTsx.includes("mock_ok"), "distinguishes mock_ok");
assert.equal(/onClick=\{[^}]*resend/i.test(notifTsx), false, "no resend click handlers");
assert.equal(notifTsx.includes("Resend"), false, "no Resend button label");

assert.ok(queueTsx.includes("Confirm process") || queueTsx.includes("confirmProcess"), "process confirmation present");
assert.ok(queueTsx.includes("never processed on page load") || queueTsx.includes("Queue is never processed"), "no auto-process copy");
assert.ok(queueTsx.includes("Delivery Queue"), "legacy heading Delivery Queue");

assert.ok(announceTsx.includes("/api/school-announcements"), "lifecycle API mounted in UI");
assert.ok(announceTsx.includes("/api/school-announcements/preview"), "recipient preview wired");
assert.ok(announceTsx.includes("all_parents"), "All Parents audience mode");
assert.ok(announceTsx.includes("by_class"), "By Class audience mode");
assert.ok(announceTsx.includes("individual"), "Individual Parents audience mode");
assert.ok(announceTsx.includes("Preview recipients"), "preview action present");
assert.ok(announceTsx.includes("publish"), "publish control present");
assert.ok(announceTsx.includes("unpublish"), "unpublish control present");
assert.ok(announceTsx.includes("archive"), "archive control present");
assert.ok(announceTsx.includes("SCHOOL_ADMIN"), "admin gate mentioned in UI");
assert.equal(announceTsx.includes("/api/communication/sms"), false, "announcements must not call SMS");
assert.equal(announceTsx.includes("TeacherInbox"), false, "announcements panel must not embed inbox");
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
