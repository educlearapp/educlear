/**
 * Micro-benchmark: weekly period column expansion Period 1–7 vs 1–8 (+ optional Intervention).
 * Run: npx ts-node --transpile-only src/utils/attendanceSessions.perf.bench.ts
 */
import { PERIOD_REGISTER_COLUMNS } from "./attendanceSessionKeys";
import { periodLabel } from "./attendancePeriods";

const LEGACY_COLUMNS = [
  "PERIOD_1",
  "PERIOD_2",
  "PERIOD_3",
  "PERIOD_4",
  "PERIOD_5",
  "PERIOD_6",
  "PERIOD_7",
] as const;

function buildColumns(
  dates: string[],
  periods: readonly string[],
  interventionDates: Set<string>
) {
  const columns: Array<{ key: string; sessionLabel: string }> = [];
  for (const date of dates) {
    for (const period of periods) {
      columns.push({ key: `${date}|${period}`, sessionLabel: periodLabel(period) });
    }
    if (interventionDates.has(date)) {
      columns.push({ key: `${date}|INTERVENTION`, sessionLabel: periodLabel("INTERVENTION") });
    }
  }
  return columns;
}

const dates = ["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"];
const interventionDates = new Set(["2026-08-04"]);
const learners = 200;
const ITER = 5000;

function time(label: string, fn: () => void): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < ITER; i += 1) fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  console.log(`${label}: ${ms.toFixed(2)}ms for ${ITER} builds (~${(ms / ITER).toFixed(4)}ms/build)`);
  return ms;
}

const legacyMs = time("legacy P1-7 columns", () => {
  const cols = buildColumns(dates, LEGACY_COLUMNS, new Set());
  // simulate cell fill cost proportional to columns × learners
  let cells = 0;
  for (let l = 0; l < learners; l += 1) cells += cols.length;
  if (cells < 0) throw new Error("unreachable");
});

const newMs = time("new P1-8 + Intervention columns", () => {
  const cols = buildColumns(dates, PERIOD_REGISTER_COLUMNS, interventionDates);
  let cells = 0;
  for (let l = 0; l < learners; l += 1) cells += cols.length;
  if (cells < 0) throw new Error("unreachable");
});

const ratio = newMs / legacyMs;
const extraCols = PERIOD_REGISTER_COLUMNS.length * dates.length + interventionDates.size;
const legacyCols = LEGACY_COLUMNS.length * dates.length;
console.log(
  `column count legacy=${legacyCols} new=${extraCols} (+${(((extraCols - legacyCols) / legacyCols) * 100).toFixed(1)}%)`
);
console.log(`runtime ratio new/legacy=${ratio.toFixed(3)} (expect ~${(extraCols / legacyCols).toFixed(2)}x from column growth)`);
if (ratio > 1.5) {
  console.error("PERF REGRESSION: >50% slower than legacy column build");
  process.exit(1);
}
console.log("attendanceSessions.perf.bench.ts: OK (no measurable regression beyond expected column growth)");
