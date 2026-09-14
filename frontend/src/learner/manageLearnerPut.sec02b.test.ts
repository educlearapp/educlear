/**
 * SEC-02B — frontend call-site source guards for generic learner PUT.
 * Run from frontend: npx --yes tsx src/learner/manageLearnerPut.sec02b.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const manageSrc = fs.readFileSync(path.join(__dirname, "ManageLearner.tsx"), "utf8");
const billingTabSrc = fs.readFileSync(path.join(__dirname, "LearnerBillingPlanTab.tsx"), "utf8");
const dashboardSrc = fs.readFileSync(
  path.join(__dirname, "../SchoolDashboard.tsx"),
  "utf8"
);

// ManageLearner profile Save must include staffAuthHeaders and must not send billingPlan.
assert.ok(
  /api\/learners\/\$\{learner\.id\}`[\s\S]{0,400}method:\s*"PUT"[\s\S]{0,400}\.\.\.staffAuthHeaders\(\)/.test(
    manageSrc
  ),
  "ManageLearner Save PUT includes staffAuthHeaders"
);
assert.ok(
  /firstName:\s*learner\.firstName\s*\|\|\s*""/.test(manageSrc),
  "profile payload preserved (firstName)"
);
assert.ok(
  /className:\s*learner\.className\s*\|\|\s*learner\.classroom/.test(manageSrc),
  "profile payload preserved (className)"
);
// Save body should not include billingPlan (enrollment-status / billing use other endpoints)
const savePutWindow = manageSrc.slice(
  manageSrc.indexOf("method: \"PUT\""),
  manageSrc.indexOf("method: \"PUT\"") + 2500
);
assert.ok(!/billingPlan\s*:/.test(savePutWindow), "ManageLearner Save PUT does not send billingPlan");

// Classroom reassignment in SchoolDashboard
assert.ok(
  /method:\s*"PUT"[\s\S]{0,200}\.\.\.staffAuthHeaders\(\)[\s\S]{0,300}className:\s*newClass/.test(
    dashboardSrc
  ),
  "classroom reassignment PUT includes staffAuthHeaders"
);

// LearnerBillingPlanTab must use dedicated PATCH billing-plan, not generic PUT.
assert.ok(
  /billing-plan[\s\S]{0,200}method:\s*"PATCH"|method:\s*"PATCH"[\s\S]{0,200}billing-plan/.test(
    billingTabSrc
  ),
  "LearnerBillingPlanTab uses PATCH billing-plan"
);
assert.ok(
  !/encodeURIComponent\(learnerKey\)\}`,\s*\{[\s\S]{0,80}method:\s*"PUT"/.test(billingTabSrc),
  "LearnerBillingPlanTab no longer uses generic learner PUT"
);
assert.ok(
  /\.\.\.staffAuthHeaders\(\)/.test(billingTabSrc),
  "LearnerBillingPlanTab still sends staffAuthHeaders"
);

console.log("✓ SEC-02B frontend PUT / billing-plan call-site guards passed");
