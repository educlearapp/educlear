/**
 * Da Silva — Classroom table name sync only (match learner.className).
 *
 * Renames existing Classroom rows; does NOT touch learners, billing, ledger, or counts.
 *
 * Usage:
 *   npx ts-node scripts/sync-classroom-table-names-only.ts [--apply] [schoolId]
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { prisma } from "../src/prisma";
import {
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import { DA_SILVA_EXPECTED_LEARNER_COUNT } from "../src/services/daSilvaMigration/daSilvaMigrationService";
import { DA_SILVA_FINAL_IMPORT_EXPECTED } from "../src/services/daSilvaMigration/daSilvaFinalImportGate";
import { readSchoolBillingPlans } from "../src/utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../src/utils/kidesysTransactionHistoryStore";

/** Old classroom.name → target (must match learner.className). */
const CLASSROOM_NAME_RENAMES: Record<string, string> = {
  "lgrade Ra": "Grade RA",
  "lgrade Rb": "Grade RB",
  "|grade Ra": "Grade RA",
  "|grade Rb": "Grade RB",
  "Pre-School Creche": "Creche",
  "Pre-school Creche": "Creche",
};

const EXPECTED_CLASSROOM_COUNT = DA_SILVA_FINAL_IMPORT_EXPECTED.classes;
const EXPECTED_LEARNER_COUNT = DA_SILVA_EXPECTED_LEARNER_COUNT;

async function resolveSchoolId(argSchoolId?: string): Promise<string> {
  if (argSchoolId) {
    setDaSilvaResolvedSchoolId(argSchoolId);
    return argSchoolId;
  }

  const byId = await prisma.school.findUnique({
    where: { id: getDaSilvaResolvedSchoolId() },
    select: { id: true },
  });
  if (byId) return byId.id;

  const byName = await prisma.school.findFirst({
    where: { name: DA_SILVA_SCHOOL_NAME },
    select: { id: true },
  });
  if (byName) {
    setDaSilvaResolvedSchoolId(byName.id);
    return byName.id;
  }

  throw new Error(`School not found: ${DA_SILVA_SCHOOL_NAME}`);
}

type ClassroomRow = { id: string; name: string };

function countOrphans(
  learners: Array<{ className: string | null }>,
  classroomNames: Set<string>
): number {
  return learners.filter((l) => {
    const cn = String(l.className || "").trim();
    return !cn || !classroomNames.has(cn);
  }).length;
}

/** Mirrors GET /classrooms dashboard join: every learner className has a registered classroom. */
function dashboardClassroomJoinPass(
  classrooms: ClassroomRow[],
  learnerClassNames: string[]
): boolean {
  const registered = new Set(classrooms.map((c) => c.name));
  return learnerClassNames.every((cn) => registered.has(cn));
}

async function loadSnapshot(schoolId: string) {
  const classrooms = await prisma.classroom.findMany({
    where: { schoolId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const learners = await prisma.learner.findMany({
    where: { schoolId },
    select: { id: true, className: true },
  });
  const learnerClassNames = [
    ...new Set(learners.map((l) => String(l.className || "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b));

  return { classrooms, learners, learnerClassNames };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const schoolId = await resolveSchoolId(
    process.argv.filter((a) => a !== "--apply")[2]
  );

  const ledgerBefore = readSchoolLedger(schoolId).length;
  const plansBefore = Object.keys(readSchoolBillingPlans(schoolId)).length;
  const historyBefore = readSchoolKidesysHistory(schoolId).length;

  const before = await loadSnapshot(schoolId);
  const beforeClassroomNames = before.classrooms.map((c) => c.name);
  const beforeOrphans = countOrphans(
    before.learners,
    new Set(beforeClassroomNames)
  );

  const planned = before.classrooms
    .map((c) => {
      const to = CLASSROOM_NAME_RENAMES[c.name];
      if (!to || to === c.name) return null;
      return { id: c.id, from: c.name, to };
    })
    .filter((x): x is { id: string; from: string; to: string } => Boolean(x));

  if (planned.length === 0) {
    console.log("No classroom renames required (names already match learner.className).");
  }

  const targetNames = new Set(
    before.classrooms.map((c) => CLASSROOM_NAME_RENAMES[c.name] || c.name)
  );
  if (targetNames.size !== before.classrooms.length) {
    throw new Error(
      `Rename would collapse classroom count: ${before.classrooms.length} → ${targetNames.size}`
    );
  }

  for (const row of planned) {
    const conflict = before.classrooms.find((c) => c.name === row.to && c.id !== row.id);
    if (conflict) {
      throw new Error(
        `Cannot rename "${row.from}" → "${row.to}": target name already used by classroom ${conflict.id}`
      );
    }
  }

  const missingLearnerTargets = new Set(
    before.learnerClassNames.filter((cn) => !targetNames.has(cn))
  );
  if (missingLearnerTargets.size) {
    throw new Error(
      `After rename, learner classNames still unmatched: ${[...missingLearnerTargets].join(", ")}`
    );
  }

  if (apply && planned.length > 0) {
    await prisma.$transaction(
      planned.map((row) =>
        prisma.classroom.update({
          where: { id: row.id },
          data: { name: row.to },
        })
      )
    );
  }

  const after = apply
    ? await loadSnapshot(schoolId)
    : {
        classrooms: before.classrooms.map((c) => {
          const hit = planned.find((p) => p.id === c.id);
          return hit ? { id: c.id, name: hit.to } : c;
        }),
        learners: before.learners,
        learnerClassNames: before.learnerClassNames,
      };

  const afterClassroomNames = after.classrooms.map((c) => c.name).sort((a, b) =>
    a.localeCompare(b)
  );
  const afterOrphans = countOrphans(
    after.learners,
    new Set(afterClassroomNames)
  );

  const learnerTotal = apply
    ? await prisma.learner.count({ where: { schoolId } })
    : before.learners.length;
  const classroomTotal = apply
    ? await prisma.classroom.count({ where: { schoolId } })
    : before.classrooms.length;

  const ledgerAfter = readSchoolLedger(schoolId).length;
  const plansAfter = Object.keys(readSchoolBillingPlans(schoolId)).length;
  const historyAfter = readSchoolKidesysHistory(schoolId).length;

  const verification = {
    learnerCount396: learnerTotal === EXPECTED_LEARNER_COUNT,
    classroomCount21: classroomTotal === EXPECTED_CLASSROOM_COUNT,
    orphanLearners0: afterOrphans === 0,
    dashboardClassroomJoin: dashboardClassroomJoinPass(
      after.classrooms,
      after.learnerClassNames
    ),
    noBillingTouch:
      ledgerBefore === ledgerAfter &&
      plansBefore === plansAfter &&
      historyBefore === historyAfter,
    idsPreserved: planned.every((p) => after.classrooms.some((c) => c.id === p.id)),
    onlyPlannedRenames:
      planned.length <= 3 &&
      planned.every((p) => Object.prototype.hasOwnProperty.call(CLASSROOM_NAME_RENAMES, p.from)),
  };

  const passed = Object.values(verification).every(Boolean);

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    schoolId,
    before: {
      classroomNames: beforeClassroomNames,
      classroomTotal: before.classrooms.length,
      learnerTotal: before.learners.length,
      orphanLearners: beforeOrphans,
    },
    plannedRenames: planned,
    after: {
      classroomNames: afterClassroomNames,
      classroomTotal: after.classrooms.length,
      learnerTotal,
      orphanLearners: afterOrphans,
    },
    verification,
    passed,
  };

  const outJson = path.join(process.cwd(), "classroom-table-sync-report.json");
  const outTxt = path.join(process.cwd(), "classroom-table-sync-report.txt");

  const txtLines = [
    "=== Da Silva classroom table sync (classroom rows only) ===",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    `School: ${schoolId}`,
    "",
    "--- Before classroom names ---",
    ...report.before.classroomNames.map((n) => `  ${n}`),
    `Classroom total: ${report.before.classroomTotal}`,
    `Learner total: ${report.before.learnerTotal}`,
    `Orphan learners: ${report.before.orphanLearners}`,
    "",
    "--- Planned renames ---",
    ...(planned.length
      ? planned.map((p) => `  ${p.from} → ${p.to} (id: ${p.id})`)
      : ["  (none)"]),
    "",
    "--- After classroom names ---",
    ...report.after.classroomNames.map((n) => `  ${n}`),
    `Classroom total: ${report.after.classroomTotal}`,
    `Learner total: ${report.after.learnerTotal}`,
    `Orphan learners: ${report.after.orphanLearners}`,
    "",
    "--- Verification ---",
    ...Object.entries(report.verification).map(([k, v]) => `  ${k}: ${v ? "PASS" : "FAIL"}`),
    "",
    `Overall: ${passed ? "PASS" : "FAIL"}`,
  ];

  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(outTxt, txtLines.join("\n"));
  console.log(txtLines.join("\n"));
  console.log(`\nWrote ${outJson}`);
  console.log(`Wrote ${outTxt}`);

  if (!passed) process.exit(1);
  if (!apply && planned.length > 0) {
    console.log("\nDry-run PASS. Re-run with --apply to persist classroom renames.");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
