/**
 * Run: npx ts-node --transpile-only src/utils/schoolLocalTime.test.ts
 */
import { resolveSchoolLocalParts, formatSchoolLocalTimeDisplay } from "./schoolLocalTime";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function run() {
  const instant = new Date("2026-07-15T08:00:00.000Z");
  const parts = resolveSchoolLocalParts(instant, "Africa/Johannesburg");
  assert(parts.schoolLocalDate === "2026-07-15", `expected date 2026-07-15 got ${parts.schoolLocalDate}`);
  assert(parts.schoolLocalTime === "10:00:00", `expected 10:00:00 got ${parts.schoolLocalTime}`);
  assert(formatSchoolLocalTimeDisplay("10:00:00") === "10:00", "display time HH:mm");
  console.log("schoolLocalTime tests passed");
}

run();
