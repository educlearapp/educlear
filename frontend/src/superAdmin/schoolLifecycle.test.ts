/**
 * Super Admin school lifecycle UI — unit tests (no API).
 * Run from frontend: npx --yes tsx src/superAdmin/schoolLifecycle.test.ts
 */
import {
  LITTLE_SCIENTISTS_SCHOOL_ID,
  DEFAULT_SCHOOL_LIFECYCLE_FILTER,
  allowedLifecycleTargets,
  buildLifecycleConfirmation,
  countSchoolsByLifecycle,
  filterSchoolsByLifecycle,
  isProtectedOperatingSchoolId,
  lifecycleBadgeLabel,
  needsLifecycleConfirmation,
  parseSchoolLifecycleStatus,
} from "./schoolLifecycle";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(parseSchoolLifecycleStatus(null) === "ACTIVE", "existing school default ACTIVE");
assert(parseSchoolLifecycleStatus("Trial") === "TRIAL", "title-case Trial");
assert(parseSchoolLifecycleStatus("Suspended") === "ACTIVE", "subscription Suspended does not become lifecycle");

const schools = [
  { id: "cmpideqeq0000108xb6ouv9zi", schoolName: "Da Silva Academy", lifecycleStatus: "ACTIVE" as const },
  { id: "cmq4xjckq00at60gqg4eb956h", schoolName: "MBB", lifecycleStatus: "ACTIVE" as const },
  { id: "cmt1e8bjp0jo8lcjeketlynhl", schoolName: "Fly Eagle Primary School", lifecycleStatus: "ACTIVE" as const },
  { id: LITTLE_SCIENTISTS_SCHOOL_ID, schoolName: "Little Scientists Lab Club", lifecycleStatus: "ACTIVE" as const },
  { id: "trial-1", schoolName: "Trial School", lifecycleStatus: "TRIAL" as const },
  { id: "inactive-1", schoolName: "Inactive School", lifecycleStatus: "INACTIVE" as const },
  { id: "arch-1", schoolName: "Archived School", lifecycleStatus: "ARCHIVED" as const },
];

const counts = countSchoolsByLifecycle(schools);
assert(counts.active === 4 && counts.trial === 1 && counts.inactive === 1 && counts.archived === 1, "counts");
assert(filterSchoolsByLifecycle(schools, "ACTIVE").every((s) => s.lifecycleStatus === "ACTIVE"), "Active filter");
assert(filterSchoolsByLifecycle(schools, "TRIAL").length === 1, "Trial filter");
assert(filterSchoolsByLifecycle(schools, "INACTIVE").length === 1, "Inactive filter");
assert(filterSchoolsByLifecycle(schools, "ARCHIVED").length === 1, "Archived filter");
assert(filterSchoolsByLifecycle(schools, "all").length === schools.length, "All filter");

assert(lifecycleBadgeLabel("ACTIVE") === "ACTIVE", "ACTIVE badge");
assert(lifecycleBadgeLabel("TRIAL") === "TRIAL", "TRIAL badge");
assert(lifecycleBadgeLabel("INACTIVE") === "INACTIVE", "INACTIVE badge");
assert(lifecycleBadgeLabel("ARCHIVED") === "ARCHIVED", "ARCHIVED badge");
assert(DEFAULT_SCHOOL_LIFECYCLE_FILTER === "ACTIVE", "default filter Active");

assert(needsLifecycleConfirmation("ACTIVE", "TRIAL") === false, "ACTIVE→TRIAL");
assert(needsLifecycleConfirmation("TRIAL", "ACTIVE") === false, "TRIAL→ACTIVE");
assert(needsLifecycleConfirmation("ACTIVE", "INACTIVE") === false, "ACTIVE→INACTIVE");
assert(needsLifecycleConfirmation("ACTIVE", "ARCHIVED") === true, "ACTIVE→ARCHIVED confirm");
assert(needsLifecycleConfirmation("ARCHIVED", "ACTIVE") === true, "reactivation confirm");

const archive = buildLifecycleConfirmation({
  schoolName: "Little Scientists Lab Club",
  from: "ACTIVE",
  to: "ARCHIVED",
});
assert(archive.title === "Archive Little Scientists Lab Club?", "archive confirmation title");
assert(archive.message.includes("Current status: ACTIVE"), "archive current status");
assert(archive.message.includes("New status: ARCHIVED"), "archive new status");
assert(archive.message.includes("records will be preserved"), "archive preservation copy");

assert(isProtectedOperatingSchoolId("cmpideqeq0000108xb6ouv9zi"), "Da Silva protected in UI");
assert(isProtectedOperatingSchoolId("cmq4xjckq00at60gqg4eb956h"), "MBB protected in UI");
assert(isProtectedOperatingSchoolId("cmt1e8bjp0jo8lcjeketlynhl"), "Fly Eagle protected in UI");
assert(!isProtectedOperatingSchoolId(LITTLE_SCIENTISTS_SCHOOL_ID), "Little Scientists can be archived");
assert(allowedLifecycleTargets(LITTLE_SCIENTISTS_SCHOOL_ID).includes("ARCHIVED"), "LSLC archive allowed");
assert(!allowedLifecycleTargets("cmpideqeq0000108xb6ouv9zi").includes("ARCHIVED"), "Da Silva archive hidden");
assert(!allowedLifecycleTargets("cmq4xjckq00at60gqg4eb956h").includes("ARCHIVED"), "MBB archive hidden");
assert(!allowedLifecycleTargets("cmt1e8bjp0jo8lcjeketlynhl").includes("ARCHIVED"), "Fly Eagle archive hidden");

console.log("SUPER ADMIN SCHOOL LIFECYCLE UI TESTS PASS");
