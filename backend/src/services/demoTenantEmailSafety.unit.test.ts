/**
 * Demo-tenant outbound email safety — unit tests (mocked providers, no real mail).
 *
 * Run:
 *   npx tsx src/services/demoTenantEmailSafety.unit.test.ts
 */
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

import {
  DEMO_NOT_DELIVERED_LABEL,
  buildDemoEmailSimulation,
  labelDemoEmailSubject,
} from "./demoTenantSafety";

function testSimulationShape() {
  const sim = buildDemoEmailSimulation("prospect@example.com");
  assert.equal(sim.demoSimulated, true);
  assert.equal(sim.demoLabel, DEMO_NOT_DELIVERED_LABEL);
  assert.ok(String(sim.messageId).startsWith("demo-not-delivered:"));
  assert.deepEqual(sim.accepted, ["prospect@example.com"]);
  assert.deepEqual(sim.rejected, []);
  assert.equal(sim.response, DEMO_NOT_DELIVERED_LABEL);
  console.log("✓ demo simulation shape labelled DEMO — NOT DELIVERED");
}

function testSubjectLabel() {
  assert.equal(labelDemoEmailSubject("Welcome"), `[${DEMO_NOT_DELIVERED_LABEL}] Welcome`);
  assert.ok(labelDemoEmailSubject(`[${DEMO_NOT_DELIVERED_LABEL}] x`).includes(DEMO_NOT_DELIVERED_LABEL));
  console.log("✓ demo subject labelling");
}

function testSendSchoolEmailSourceGatesDemoBeforeResend() {
  const src = fs.readFileSync(path.join(__dirname, "schoolEmailService.ts"), "utf8");
  const fnStart = src.indexOf("export async function sendSchoolEmail");
  assert.ok(fnStart > 0, "sendSchoolEmail export must exist");
  const fn = src.slice(fnStart, src.indexOf("export async function testSchoolEmailConnection"));
  assert.ok(fn.includes("isDemoTenantSchool"), "sendSchoolEmail must check isDemoTenantSchool");
  assert.ok(fn.includes("buildDemoEmailSimulation"), "must return demo simulation");
  const demoIdx = fn.indexOf("isDemoTenantSchool(sid)");
  const resendIdx = fn.indexOf("sendWithResend({");
  const smtpIdx = fn.indexOf("createPlatformTransport()");
  assert.ok(demoIdx > 0, "demo gate present in sendSchoolEmail");
  assert.ok(resendIdx > demoIdx, "demo gate must run before sendWithResend inside sendSchoolEmail");
  assert.ok(smtpIdx > demoIdx, "demo gate must run before platform SMTP inside sendSchoolEmail");
  console.log("✓ sendSchoolEmail gates demo before Resend and SMTP");
}

function testSendMailWithSettingsAlsoGated() {
  const src = fs.readFileSync(path.join(__dirname, "schoolEmailService.ts"), "utf8");
  const fn = src.slice(src.indexOf("export async function sendMailWithSettings"));
  assert.ok(fn.includes("isDemoTenantSchool"), "sendMailWithSettings must check demo flag");
  console.log("✓ sendMailWithSettings demo-gated");
}

function testNoGlobalKillSwitchInSeedOrGate() {
  const gate = fs.readFileSync(path.join(__dirname, "demoTenantSafety.ts"), "utf8");
  assert.ok(!gate.includes("DISABLE_OUTBOUND_EMAIL"), "demo gate must not set global kill switch");
  const seed = fs.readFileSync(
    path.join(__dirname, "../../scripts/seed-educlear-demo-school-ONCE.ts"),
    "utf8"
  );
  assert.ok(seed.includes("isDemoTenant: true"), "seed must set trusted isDemoTenant flag");
  assert.ok(!seed.includes('DISABLE_OUTBOUND_EMAIL="true"'), "seed must not enable global kill switch");
  console.log("✓ no global DISABLE_OUTBOUND_EMAIL in demo gate/seed");
}

function testFlagNotIdentifiableByNameOrEmail() {
  const src = fs.readFileSync(path.join(__dirname, "demoTenantSafety.ts"), "utf8");
  assert.ok(src.includes("isDemoTenant"), "uses School.isDemoTenant");
  assert.ok(!/name\s*===|email\s*===|cmpbdigd|educlear demo school/i.test(src), "must not key off name/email/old id");
  console.log("✓ demo identity is isDemoTenant flag only");
}

function testSuperAdminOnlyMutationPath() {
  const route = fs.readFileSync(path.join(__dirname, "../routes/superAdminSchools.ts"), "utf8");
  assert.ok(route.includes("setSchoolDemoTenantFlag"), "super-admin route can set flag");
  assert.ok(route.includes("Super Admin required to set isDemoTenant"), "requires super admin");
  const schools = fs.readFileSync(path.join(__dirname, "../routes/schools.ts"), "utf8");
  assert.ok(!schools.includes("isDemoTenant"), "school profile route must not accept isDemoTenant");
  console.log("✓ demo flag mutable only via Super Admin path; school route cannot set it");
}

function testEmailProviderMarksSimulated() {
  const src = fs.readFileSync(
    path.join(__dirname, "../communication/communicationProviders/emailProvider.ts"),
    "utf8"
  );
  assert.ok(src.includes("demoSimulated"), "communications provider must surface simulated=true");
  console.log("✓ communications email provider surfaces demoSimulated");
}

function testPayrollBypassPathsGated() {
  const src = fs.readFileSync(path.join(__dirname, "../routes/payroll.ts"), "utf8");
  assert.ok(src.includes("isDemoTenantSchool"), "payroll email routes must check demo flag");
  assert.ok(src.includes("DEMO_NOT_DELIVERED_LABEL"), "payroll demo responses labelled");
  console.log("✓ payroll alternate SMTP paths demo-gated");
}

function main() {
  testSimulationShape();
  testSubjectLabel();
  testSendSchoolEmailSourceGatesDemoBeforeResend();
  testSendMailWithSettingsAlsoGated();
  testNoGlobalKillSwitchInSeedOrGate();
  testFlagNotIdentifiableByNameOrEmail();
  testSuperAdminOnlyMutationPath();
  testEmailProviderMarksSimulated();
  testPayrollBypassPathsGated();
  console.log("\nAll demoTenantEmailSafety unit checks passed.");
}

main();
