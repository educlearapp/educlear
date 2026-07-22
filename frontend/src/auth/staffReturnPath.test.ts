import assert from "node:assert/strict";
import { safeStaffReturnPath } from "./staffReturnPath";

assert.equal(safeStaffReturnPath("/admin/homesafe"), "/admin/homesafe");
assert.equal(safeStaffReturnPath("/admin/homesafe/"), "/admin/homesafe");
assert.equal(safeStaffReturnPath("/dashboard"), "/dashboard");
assert.equal(safeStaffReturnPath("/dashboard/billing/fees"), "/dashboard/billing/fees");
assert.equal(safeStaffReturnPath("/learners/abc"), "/learners/abc");
assert.equal(safeStaffReturnPath("/teacher-performance"), "/teacher-performance");

assert.equal(safeStaffReturnPath(null), null);
assert.equal(safeStaffReturnPath(""), null);
assert.equal(safeStaffReturnPath("https://evil.example/admin/homesafe"), null);
assert.equal(safeStaffReturnPath("//evil.example"), null);
assert.equal(safeStaffReturnPath("/teacher/homesafe"), null);
assert.equal(safeStaffReturnPath("/parent"), null);
assert.equal(safeStaffReturnPath("/super-admin"), null);
assert.equal(safeStaffReturnPath("/login"), null);

console.log("staffReturnPath.test.ts: PASS");
