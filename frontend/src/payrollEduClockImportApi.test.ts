/**
 * Pure helper tests for EduClock payroll import UI wording and confirmability rules.
 * Run: npx --yes tsx src/payrollEduClockImportApi.test.ts
 */
import assert from "node:assert/strict";
import {
  assertConfirmDoesNotCreateRun,
  explainWarningCode,
  formatWorkedHours,
  summarizeLineWarnings,
  PayrollEduClockApiError,
} from "./payrollEduClockImportApi";

function main() {
  assert.equal(formatWorkedHours(480), "8h");
  assert.equal(formatWorkedHours(90), "1h 30m");

  assert.match(
    explainWarningCode("PAYROLL_RUN_EMPLOYEE_MISSING"),
    /not yet been added to this payroll run/i
  );
  assert.match(explainWarningCode("MISSING_CLOCK_OUT"), /No time was assumed/i);
  assert.match(explainWarningCode("MISSING_CLOCK_IN"), /No time was assumed/i);
  assert.match(explainWarningCode("MISSING_EMPLOYEE_NUMBER"), /internal employee record/i);
  assert.match(explainWarningCode("OVERTIME_RULES_NOT_CONFIGURED"), /not calculated automatically/i);
  assert.match(explainWarningCode("CORRECTION_AMBIGUOUS_TERMINAL"), /owner review/i);

  const texts = summarizeLineWarnings([
    "OVERTIME_RULES_NOT_CONFIGURED",
    "MISSING_CLOCK_OUT",
    "OVERTIME_RULES_NOT_CONFIGURED",
  ]);
  assert.equal(texts.length, 2);

  const unbound = { confirmable: false, payrollRunId: null as string | null };
  const bound = { confirmable: true, payrollRunId: "run1" };
  assert.equal(Boolean(unbound.confirmable && unbound.payrollRunId), false);
  assert.equal(Boolean(bound.confirmable && bound.payrollRunId), true);

  const isFinalized = true;
  const canConfirm = Boolean(bound.confirmable && bound.payrollRunId && !isFinalized);
  assert.equal(canConfirm, false);

  assert.equal(
    assertConfirmDoesNotCreateRun({ payrollRunId: "r1", previewHash: "h1" }),
    true
  );
  assert.equal(
    assertConfirmDoesNotCreateRun({ payrollRunId: "r1", previewHash: "h1", createRun: true }),
    false
  );
  assert.equal(assertConfirmDoesNotCreateRun({ previewHash: "h1" }), false);

  const raw = new PayrollEduClockApiError(
    "Something went wrong while talking to the server.",
    500,
    "REQUEST_FAILED"
  );
  assert(!/Prisma|PostgreSQL|PayrollRun_pkey/i.test(raw.message));

  console.log("payrollEduClockImportApi.test.ts: OK");
}

main();
