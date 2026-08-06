/**
 * Additional pure tests: export data shape consistency helpers.
 * Run: npx ts-node --transpile-only src/attendance/weeklyPeriodSubjectRegister.calc.test.ts
 *
 * Note: lives under frontend for co-location with export builders; run via ts-node from frontend
 * or duplicate assertions in backend unit tests (backend already covers calc rules).
 */
import assert from "assert";

// Mirror backend compute rules for frontend documentation/tests
function computeSessionPercentage(opts: {
  present: number;
  late: number;
  absent: number;
  excused: number;
}): number | null {
  const eligible = opts.present + opts.late + opts.absent + opts.excused;
  const attended = opts.present + opts.late;
  if (eligible === 0) return null;
  return Math.round((attended / eligible) * 1000) / 10;
}

function resolveMode(
  requested: "Automatic" | "Periods" | "Subjects",
  classroom: "PERIODS" | "SUBJECTS" | null
): "PERIODS" | "SUBJECTS" {
  if (requested === "Periods") return "PERIODS";
  if (requested === "Subjects") return "SUBJECTS";
  return classroom === "SUBJECTS" ? "SUBJECTS" : "PERIODS";
}

assert.strictEqual(computeSessionPercentage({ present: 0, late: 0, absent: 0, excused: 0 }), null);
assert.strictEqual(computeSessionPercentage({ present: 3, late: 0, absent: 1, excused: 0 }), 75);
assert.strictEqual(resolveMode("Automatic", "SUBJECTS"), "SUBJECTS");
assert.strictEqual(resolveMode("Automatic", "PERIODS"), "PERIODS");
console.log("weeklyPeriodSubjectRegister.calc.test.ts: OK");
