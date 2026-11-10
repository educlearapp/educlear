/**
 * Run: npx tsx src/utils/httpHeaderAscii.test.ts
 */
import assert from "node:assert/strict";
import { ServerResponse } from "node:http";
import { toAsciiHttpHeaderValue, assertAsciiHttpHeaderValue } from "./httpHeaderAscii";
import {
  formatStatementPeriodHeaderLabel,
  formatStatementPeriodHttpWindow,
} from "./statementPeriod";

function main() {
  const now = new Date(2026, 10, 10, 12, 0, 0);
  const human = formatStatementPeriodHeaderLabel("Last 3 Months", now);
  assert.match(human, /\u2013|–/); // en-dash present in PDF/UI label

  const httpWindow = formatStatementPeriodHttpWindow("Last 3 Months", now);
  assert.equal(httpWindow, "2026-08-10 to 2026-11-10");
  assertAsciiHttpHeaderValue(httpWindow);

  // Reproduce production failure: Node rejects en-dash in header values.
  const res = new ServerResponse({} as any);
  assert.throws(() => {
    res.setHeader("X-EduClear-Statement-Window", human);
  }, /Invalid character in header content/i);

  const safe = toAsciiHttpHeaderValue(human);
  assert.doesNotThrow(() => {
    res.setHeader("X-EduClear-Statement-Window", safe);
  });
  assert.equal(toAsciiHttpHeaderValue("Last 3 Months (10 Aug 2026 – 10 Nov 2026)"), "Last 3 Months (10 Aug 2026 - 10 Nov 2026)");
  assert.equal(toAsciiHttpHeaderValue("All Time"), "All Time");

  console.log("httpHeaderAscii.test.ts: OK");
}

main();
