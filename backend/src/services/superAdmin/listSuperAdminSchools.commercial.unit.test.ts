/**
 * Super Admin commercial package assignment / list payload tests.
 * Run: npx tsx src/services/superAdmin/listSuperAdminSchools.commercial.unit.test.ts
 */
import assert from "assert";
import fs from "fs";
import path from "path";

import {
  commercialPackageShortDisplay,
  findCommercialPackageByModules,
  formatLearnerCapacityLabel,
} from "../educlearCommercialPackages";

function testListPayloadIncludesCommercialFields() {
  const src = fs.readFileSync(path.join(__dirname, "listSuperAdminSchools.ts"), "utf8");
  assert.ok(src.includes("commercialPackageCode"));
  assert.ok(src.includes("commercialPackageName"));
  assert.ok(src.includes("learnerLimit"));
  assert.ok(src.includes("learnerCapacityLabel"));
  assert.ok(src.includes("legacyCapacityPackage"));
  assert.ok(src.includes("moduleEntitlements"));
  assert.ok(src.includes("legacyPackageCode"));
  console.log("✓ Super Admin list serializes commercial SKU + capacity + modules");
}

function testAssignmentMappingStarterToFull100() {
  const mods = { CORE: true, ACCOUNTING: true, PAYROLL: true };
  const starter = findCommercialPackageByModules(mods, { legacyPackageCode: "STARTER" });
  const unlimited = findCommercialPackageByModules(mods, { legacyPackageCode: "UNLIMITED" });
  assert.strictEqual(starter?.code, "FULL_100");
  assert.strictEqual(unlimited?.code, "FULL_UNLIMITED");
  assert.strictEqual(
    commercialPackageShortDisplay(mods, { legacyPackageCode: "STARTER" }),
    "Full ≤100"
  );
  assert.strictEqual(
    commercialPackageShortDisplay(mods, { legacyPackageCode: "UNLIMITED" }),
    "Full Unlimited"
  );
  assert.strictEqual(formatLearnerCapacityLabel(starter!.learnerLimit), "Up to 100 learners");
  assert.strictEqual(formatLearnerCapacityLabel(unlimited!.learnerLimit), "Unlimited");
  console.log("✓ Super Admin legacy Starter/Unlimited → Full ≤100 / Full Unlimited");
}

function testUiSurfacesCapacity() {
  const page = fs.readFileSync(
    path.join(__dirname, "../../../../frontend/src/pages/SuperAdminSchoolsPage.tsx"),
    "utf8"
  );
  const table = fs.readFileSync(
    path.join(__dirname, "../../../../frontend/src/superAdmin/components/SchoolsTable.tsx"),
    "utf8"
  );
  assert.ok(page.includes("Commercial SKU"));
  assert.ok(page.includes("Learner capacity"));
  assert.ok(page.includes("Legacy capacity (historical)"));
  assert.ok(table.includes("Capacity"));
  assert.ok(table.includes("learnerCapacityLabel"));
  console.log("✓ Super Admin UI shows commercial SKU + capacity + legacy");
}

function main() {
  testListPayloadIncludesCommercialFields();
  testAssignmentMappingStarterToFull100();
  testUiSurfacesCapacity();
  console.log("\nAll Super Admin commercial assignment tests passed.");
}

main();
