/**
 * School-wide staff notice publisher role gate (Communications Phase 1).
 * Run: npx tsx src/routes/parentPortal.staffNoticePublisher.unit.test.ts
 */
import assert from "assert";
import { isSchoolWideNoticePublisherRole } from "./parentPortal";

assert.equal(isSchoolWideNoticePublisherRole({ superAdmin: true }), true);
assert.equal(isSchoolWideNoticePublisherRole({ appRole: "Owner" }), true);
assert.equal(isSchoolWideNoticePublisherRole({ appRole: "Admin" }), true);
assert.equal(isSchoolWideNoticePublisherRole({ role: "SCHOOL_ADMIN" }), true);
assert.equal(isSchoolWideNoticePublisherRole({ appRole: "Teacher", role: "STAFF" }), false);
assert.equal(isSchoolWideNoticePublisherRole({ appRole: "Finance", role: "FINANCE" }), false);
assert.equal(isSchoolWideNoticePublisherRole({}), false);

console.log("parentPortal.staffNoticePublisher.unit.test: PASS");
