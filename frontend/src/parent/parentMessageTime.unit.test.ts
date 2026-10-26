/**
 * Run: npx tsx src/parent/parentMessageTime.unit.test.ts
 */
import assert from "node:assert/strict";
import { formatParentMessageDateTime } from "./parentMessageTime";

assert.equal(formatParentMessageDateTime(""), "");
assert.equal(formatParentMessageDateTime(null), "");
assert.equal(formatParentMessageDateTime("not-a-date"), "");

const sample = formatParentMessageDateTime("2026-10-25T16:30:00.000Z");
assert.ok(sample.length > 0, "formats valid ISO");
assert.ok(/\d/.test(sample), "includes digits");
// en-ZA Africa/Johannesburg: 16:30Z → 18:30
assert.ok(sample.includes("18:30") || sample.includes("6:30"), `expected SA local time in "${sample}"`);

console.log("✓ formatParentMessageDateTime en-ZA Africa/Johannesburg");
