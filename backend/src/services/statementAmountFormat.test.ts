/**
 * Presentation-only amount formatting for Kid-e-Sys-aligned statements.
 * Run: npx tsx src/services/statementAmountFormat.test.ts
 */
import assert from "node:assert/strict";
import {
  formatStatementAmountCell,
  formatStatementBalanceCell,
  formatStatementSignedMoney,
  signedStatementAmount,
} from "./statementAmountFormat";

function main() {
  // Mandatory examples from the redesign brief (display only).
  assert.equal(formatStatementSignedMoney(3190.7), "R3,190.70");
  assert.equal(formatStatementSignedMoney(-309.3), "-R309.30");
  assert.equal(formatStatementSignedMoney(0), "R0.00");

  // Single Amount column = amountIn - amountOut (never reverse underlying parts).
  assert.equal(signedStatementAmount(1200, 0), 1200);
  assert.equal(signedStatementAmount(0, 200), -200);
  assert.equal(formatStatementAmountCell(signedStatementAmount(1200, 0)), "R1,200.00");
  assert.equal(formatStatementAmountCell(signedStatementAmount(0, 200)), "-R200.00");
  assert.equal(formatStatementAmountCell(null), "");
  assert.equal(formatStatementBalanceCell(null), "—");
  assert.equal(formatStatementBalanceCell(-56300), "-R56,300.00");
  assert.equal(formatStatementBalanceCell(39600), "R39,600.00");

  console.log("statementAmountFormat.test.ts: OK");
}

main();
