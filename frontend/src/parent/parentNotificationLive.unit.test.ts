/**
 * Phase 4C — foreground notification detection / chime eligibility.
 * Run: npx tsx src/parent/parentNotificationLive.unit.test.ts
 */
import assert from "assert";
import {
  countUnread,
  diffNewNotifications,
  isForegroundSoundEligibleType,
  shouldPlayChimeForNewRows,
} from "./parentNotificationLive";
import { isWithinQuietHours, parseQuietHm } from "./parentNotificationSound";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

assert.equal(isForegroundSoundEligibleType("TEACHER_MESSAGE"), true);
assert.equal(isForegroundSoundEligibleType("SCHOOL_NOTICE"), true);
assert.equal(isForegroundSoundEligibleType("INVOICE_READY"), false);

const rows = [
  { id: "a", type: "TEACHER_MESSAGE", isRead: false },
  { id: "b", type: "SCHOOL_NOTICE", isRead: true },
];
assert.equal(countUnread(rows), 1);

const seed = diffNewNotifications(new Set(), rows, false);
assert.equal(seed.newRows.length, 0, "seed must not treat history as new");
assert.equal(seed.nextSeeded, true);
assert.equal(seed.nextKnown.size, 2);

const second = diffNewNotifications(seed.nextKnown, [...rows, { id: "c", type: "SCHOOL_EVENT", isRead: false }], true);
assert.equal(second.newRows.length, 1);
assert.equal(second.newRows[0].id, "c");

const night = new Date();
night.setHours(23, 0, 0, 0);
assert.equal(isWithinQuietHours(night, "22:00", "06:00"), true);
assert.equal(parseQuietHm("22:00"), 22 * 60);

assert.equal(
  shouldPlayChimeForNewRows([{ id: "c", type: "SCHOOL_EVENT" }], {
    soundEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    isWithinQuietHours,
  }),
  true
);
assert.equal(
  shouldPlayChimeForNewRows([{ id: "c", type: "SCHOOL_EVENT" }], {
    soundEnabled: false,
    quietHoursStart: null,
    quietHoursEnd: null,
    isWithinQuietHours,
  }),
  false
);
assert.equal(
  shouldPlayChimeForNewRows([{ id: "c", type: "SCHOOL_EVENT" }], {
    soundEnabled: true,
    quietHoursStart: "22:00",
    quietHoursEnd: "06:00",
    now: night,
    isWithinQuietHours,
  }),
  false
);
assert.equal(
  shouldPlayChimeForNewRows([{ id: "c", type: "INVOICE_READY" }], {
    soundEnabled: true,
    quietHoursStart: null,
    quietHoursEnd: null,
    isWithinQuietHours,
  }),
  false
);

// Multi-child / multi-id batch still one decision (caller plays once)
const multi = shouldPlayChimeForNewRows(
  [
    { id: "1", type: "SCHOOL_NOTICE" },
    { id: "2", type: "SCHOOL_NOTICE" },
  ],
  { soundEnabled: true, quietHoursStart: null, quietHoursEnd: null, isWithinQuietHours }
);
assert.equal(multi, true);

const here = path.dirname(fileURLToPath(import.meta.url));
const chime = path.resolve(here, "../../public/parent-pwa/educlear-parent-chime.wav");
assert.ok(fs.existsSync(chime), "chime asset missing");
assert.ok(fs.statSync(chime).size > 1000);

const sw = fs.readFileSync(path.resolve(here, "../../public/parent-sw.js"), "utf8");
assert.ok(sw.includes("panel=alerts"));
assert.ok(sw.includes("educlear-parent-open-alerts"));
assert.ok(sw.includes("visibilityState === \"visible\""));

const teacherSw = fs.readFileSync(path.resolve(here, "../../public/teacher-sw.js"), "utf8");
assert.equal(teacherSw.includes("panel=alerts"), false);

const appSrc = fs.readFileSync(path.join(here, "ParentPortalApp.tsx"), "utf8");
assert.ok(appSrc.includes("useParentNotificationLive"));
assert.ok(appSrc.includes("clearParentAppBadge"));

console.log("parentNotificationLive.unit.test: PASS");
