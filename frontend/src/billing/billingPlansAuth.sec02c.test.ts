/**
 * SEC-02C — BillingPlans / LearnerBillingPlanTab call-site guards.
 * Run from frontend: npx --yes tsx src/billing/billingPlansAuth.sec02c.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasPermission, permissionsForRole } from "../users/permissions";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const billingPlansSrc = fs.readFileSync(path.join(__dirname, "BillingPlans.tsx"), "utf8");
const billingTabSrc = fs.readFileSync(
  path.join(__dirname, "../learner/LearnerBillingPlanTab.tsx"),
  "utf8"
);

assert.ok(
  /billing-plan[\s\S]{0,300}staffAuthHeaders\(\)|staffAuthHeaders\(\)[\s\S]{0,300}billing-plan/.test(
    billingPlansSrc
  ),
  "BillingPlans PATCH includes staffAuthHeaders"
);
assert.ok(
  /hasPermission\(\s*getSchoolSessionUser\(\),\s*"billingPlans",\s*"edit"\s*\)/.test(
    billingPlansSrc
  ),
  "BillingPlans gates mutations on billingPlans.edit"
);
assert.ok(
  /canEditBillingPlans/.test(billingPlansSrc) &&
    /disabled=\{planActionBusy \|\| !canEditBillingPlans\}/.test(billingPlansSrc),
  "Save button disabled without billingPlans.edit"
);
assert.ok(
  /if \(!canEditBillingPlans\)[\s\S]{0,120}Permission denied: billingPlans\.edit/.test(
    billingPlansSrc
  ),
  "savePlan blocks view-only users before fetch"
);

assert.ok(
  /billing-plan[\s\S]{0,200}method:\s*"PATCH"|method:\s*"PATCH"[\s\S]{0,200}billing-plan/.test(
    billingTabSrc
  ),
  "LearnerBillingPlanTab uses dedicated PATCH"
);
assert.ok(
  /\.\.\.staffAuthHeaders\(\)/.test(billingTabSrc),
  "LearnerBillingPlanTab sends staffAuthHeaders"
);

const owner = {
  appRole: "Owner",
  isActive: true,
  permissions: permissionsForRole("Owner"),
};
const finance = {
  appRole: "Finance",
  isActive: true,
  permissions: permissionsForRole("Finance"),
};
const admin = {
  appRole: "Admin",
  isActive: true,
  permissions: permissionsForRole("Admin"),
};
const teacher = {
  appRole: "Teacher",
  isActive: true,
  permissions: permissionsForRole("Teacher"),
};
const viewer = {
  appRole: "Viewer",
  isActive: true,
  permissions: permissionsForRole("Viewer"),
};

assert.equal(hasPermission(owner, "billingPlans", "edit"), true);
assert.equal(hasPermission(finance, "billingPlans", "edit"), true);
assert.equal(hasPermission(admin, "billingPlans", "edit"), false);
assert.equal(hasPermission(admin, "billingPlans", "view"), true);
assert.equal(hasPermission(teacher, "billingPlans", "edit"), false);
assert.equal(hasPermission(viewer, "billingPlans", "edit"), false);

console.log("✓ SEC-02C BillingPlans / LearnerBillingPlanTab auth guards passed");
