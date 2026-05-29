/**
 * Audit-only: classify Da Silva production learners vs Kid-e-Sys 05_class_list (ACTIVE source of truth).
 *
 * Usage:
 *   npx tsx scripts/class-list-active-learner-audit.ts [classListDir] [schoolId]
 *
 * Writes:
 *   class-list-active-learner-audit.json
 *   class-list-active-learner-audit.txt
 */
import "dotenv/config";

import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import {
  DA_SILVA_SCHOOL_NAME,
  getDaSilvaResolvedSchoolId,
  setDaSilvaResolvedSchoolId,
} from "../src/services/activateDaSilvaSubscription";
import {
  buildLearnerMatchKey,
  parseClassListFile,
  type ParsedLearner,
} from "../src/services/daSilvaMigration/parsers";
import { DA_SILVA_EXPECTED_LEARNER_COUNT } from "../src/services/daSilvaMigration/daSilvaMigrationService";
import { readSchoolBillingPlans } from "../src/utils/learnerBillingPlanStore";
import { readSchoolLedger } from "../src/utils/billingLedgerStore";
import { readSchoolKidesysHistory } from "../src/utils/kidesysTransactionHistoryStore";
import { normalizeClassroomInput } from "../src/utils/classroomNormalization";

const prisma = new PrismaClient();

const CLASS_LIST_FILES = [
  "creche.xls",
  "Grade_RA.xls",
  "Grade_RB.xls",
  "Grade_1A.xls",
  "Grade_1B.xls",
  "Grade_1C.xls",
  "Grade_2A.xls",
  "Grade_2B.xls",
  "Grade_3A.xls",
  "Grade_3B.xls",
  "Grade_4A.xls",
  "Grade_4B.xls",
  "Grade_5A.xls",
  "Grade_5B.xls",
  "Grade_6A.xls",
  "Grade-6B.xls",
  "Grade_6C.xls",
  "Grade_7A.xls",
  "Grade_7B.xls",
  "Grade_8A.xls",
  "Grade_8B.xls",
] as const;

type Category = "ACTIVE" | "HISTORICAL" | "DUPLICATE_ORPHAN";

type ClassifiedLearner = {
  id: string;
  firstName: string;
  lastName: string;
  className: string | null;
  admissionNo: string | null;
  matchKey: string;
  category: Category;
  subReason: string;
  createdAt: string;
  historySignals: {
    ledgerRows: number;
    billingPlanItems: number;
    kidesysHistoryRows: number;
    parentLinks: number;
  };
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Ignore hyphens/punctuation differences between Kid-e-Sys exports and DB names. */
function normNameKey(s: string): string {
  return norm(s).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function learnerFullName(firstName: string, lastName: string): string {
  return `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
}

function uniqueLearnersByMatchKey(learners: ParsedLearner[]): ParsedLearner[] {
  const map = new Map<string, ParsedLearner>();
  for (const l of learners) {
    if (!map.has(l.matchKey)) map.set(l.matchKey, l);
  }
  return Array.from(map.values());
}

function parseExplicitClassLists(classListDir: string): {
  classrooms: Array<{ className: string; sourceFile: string; rawCount: number }>;
  learners: ParsedLearner[];
  missingFiles: string[];
} {
  const missingFiles: string[] = [];
  const classrooms: Array<{ className: string; sourceFile: string; rawCount: number }> = [];
  const learners: ParsedLearner[] = [];

  for (const file of CLASS_LIST_FILES) {
    const filePath = path.join(classListDir, file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
      continue;
    }
    const parsed = parseClassListFile(filePath);
    classrooms.push({
      className: parsed.classroom.className,
      sourceFile: parsed.classroom.sourceFile,
      rawCount: parsed.learners.length,
    });
    learners.push(...parsed.learners);
  }

  return { classrooms, learners, missingFiles };
}

async function resolveSchoolId(argSchoolId?: string): Promise<string> {
  if (argSchoolId) {
    setDaSilvaResolvedSchoolId(argSchoolId);
    return argSchoolId;
  }

  const byId = await prisma.school.findUnique({
    where: { id: getDaSilvaResolvedSchoolId() },
    select: { id: true, name: true },
  });
  if (byId) return byId.id;

  const byName = await prisma.school.findFirst({
    where: { name: DA_SILVA_SCHOOL_NAME },
    select: { id: true, name: true },
  });
  if (byName) {
    setDaSilvaResolvedSchoolId(byName.id);
    return byName.id;
  }

  throw new Error(`School not found: ${DA_SILVA_SCHOOL_NAME}`);
}

function sampleNames(rows: ClassifiedLearner[], limit = 12): string[] {
  return rows.slice(0, limit).map((r) => {
    const cls = r.className ? ` (${r.className})` : "";
    const adm = r.admissionNo ? ` [${r.admissionNo}]` : "";
    return `${r.firstName} ${r.lastName}${cls}${adm} — ${r.subReason}`;
  });
}

async function main(): Promise<void> {
  const classListDir =
    process.argv[2] || path.join(process.env.HOME || "", "Desktop", "05_class_list");
  const schoolId = await resolveSchoolId(process.argv[3]);

  if (!fs.existsSync(classListDir)) {
    throw new Error(`Class list folder not found: ${classListDir}`);
  }

  const { classrooms, learners: rawClassLearners, missingFiles } =
    parseExplicitClassLists(classListDir);
  const activeFromFiles = uniqueLearnersByMatchKey(rawClassLearners);
  const activeMatchKeys = new Set(activeFromFiles.map((l) => l.matchKey));

  const activeByNormName = new Map<string, ParsedLearner[]>();
  for (const l of activeFromFiles) {
    for (const nameKey of [norm(l.fullName), normNameKey(l.fullName)]) {
      const arr = activeByNormName.get(nameKey) || [];
      if (!arr.some((x) => x.matchKey === l.matchKey)) arr.push(l);
      activeByNormName.set(nameKey, arr);
    }
  }

  function nameHitsFor(full: string): ParsedLearner[] {
    const seen = new Set<string>();
    const out: ParsedLearner[] = [];
    for (const key of [norm(full), normNameKey(full)]) {
      for (const hit of activeByNormName.get(key) || []) {
        if (seen.has(hit.matchKey)) continue;
        seen.add(hit.matchKey);
        out.push(hit);
      }
    }
    return out;
  }

  const dbLearners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const classroomNames = new Set(
    (
      await prisma.classroom.findMany({
        where: { schoolId },
        select: { name: true },
      })
    ).map((c) => c.name)
  );

  const parentLinkCounts = new Map<string, number>();
  const linkRows = await prisma.parentLearnerLink.groupBy({
    by: ["learnerId"],
    where: { schoolId },
    _count: { learnerId: true },
  });
  for (const row of linkRows) {
    parentLinkCounts.set(row.learnerId, row._count.learnerId);
  }

  const ledger = readSchoolLedger(schoolId);
  const plans = readSchoolBillingPlans(schoolId);
  const history = readSchoolKidesysHistory(schoolId);

  const ledgerByLearner = new Map<string, number>();
  const ledgerByAccount = new Map<string, number>();
  for (const entry of ledger) {
    const lid = String(entry.learnerId || "").trim();
    if (lid) ledgerByLearner.set(lid, (ledgerByLearner.get(lid) || 0) + 1);
    const acc = String(entry.accountNo || "").trim();
    if (acc) ledgerByAccount.set(acc, (ledgerByAccount.get(acc) || 0) + 1);
  }

  const historyByAccount = new Map<string, number>();
  for (const entry of history) {
    const acc = String(entry.accountNo || "").trim();
    if (!acc) continue;
    historyByAccount.set(acc, (historyByAccount.get(acc) || 0) + 1);
  }

  const nameClassGroups = new Map<string, typeof dbLearners>();
  for (const l of dbLearners) {
    const key = norm(`${l.firstName}|${l.lastName}|${l.className || ""}`);
    const arr = nameClassGroups.get(key) || [];
    arr.push(l);
    nameClassGroups.set(key, arr);
  }

  const duplicateNameClassKeys = new Set(
    [...nameClassGroups.entries()].filter(([, arr]) => arr.length > 1).map(([k]) => k)
  );

  const claimedActiveKeys = new Map<string, string>();

  const classified: ClassifiedLearner[] = [];

  for (const learner of dbLearners) {
    const fullName = learnerFullName(learner.firstName, learner.lastName);
    const className = String(learner.className || "").trim();
    const matchKey = buildLearnerMatchKey(fullName, className);
    const nameClassKey = norm(`${learner.firstName}|${learner.lastName}|${className}`);
    const admissionNo = String(learner.admissionNo || "").trim();

    const historySignals = {
      ledgerRows:
        (ledgerByLearner.get(learner.id) || 0) +
        (admissionNo ? ledgerByAccount.get(admissionNo) || 0 : 0),
      billingPlanItems: Array.isArray(plans[learner.id]) ? plans[learner.id].length : 0,
      kidesysHistoryRows: admissionNo ? historyByAccount.get(admissionNo) || 0 : 0,
      parentLinks: parentLinkCounts.get(learner.id) || 0,
    };

    const hasHistory =
      historySignals.ledgerRows > 0 ||
      historySignals.billingPlanItems > 0 ||
      historySignals.kidesysHistoryRows > 0;

    const isOrphanClass = !className || !classroomNames.has(className);
    const isDuplicateRow = duplicateNameClassKeys.has(nameClassKey);
    const inClassList = activeMatchKeys.has(matchKey);
    const nameHits = nameHitsFor(fullName);
    const uniqueNameOnClassList = nameHits.length === 1 ? nameHits[0] : null;

    let category: Category;
    let subReason: string;

    if (inClassList) {
      const prior = claimedActiveKeys.get(matchKey);
      if (prior) {
        category = "DUPLICATE_ORPHAN";
        subReason = `Duplicate import row — class list already claimed by learner ${prior}`;
      } else {
        claimedActiveKeys.set(matchKey, learner.id);
        category = "ACTIVE";
        subReason = "Matches uploaded class list (matchKey)";
      }
    } else if (uniqueNameOnClassList) {
      const listClass =
        normalizeClassroomInput(uniqueNameOnClassList.className).classroomName ||
        uniqueNameOnClassList.className;
      const prior = claimedActiveKeys.get(uniqueNameOnClassList.matchKey);
      if (prior) {
        category = "DUPLICATE_ORPHAN";
        subReason = `Duplicate import row — class list name claimed by learner ${prior}`;
      } else {
        claimedActiveKeys.set(uniqueNameOnClassList.matchKey, learner.id);
        category = "ACTIVE";
        subReason = `On class list as "${listClass}" — production className "${className || "(null)"}" mismatch`;
      }
    } else if (hasHistory) {
      category = "HISTORICAL";
      const parts: string[] = ["Not on current class lists"];
      if (historySignals.kidesysHistoryRows) {
        parts.push(`${historySignals.kidesysHistoryRows} Kid-e-Sys history row(s)`);
      }
      if (historySignals.ledgerRows) parts.push(`${historySignals.ledgerRows} ledger row(s)`);
      if (historySignals.billingPlanItems) {
        parts.push(`${historySignals.billingPlanItems} billing plan item(s)`);
      }
      if (isOrphanClass) parts.push("orphan/missing classroom");
      if (isDuplicateRow) parts.push("duplicate name+class in DB");
      subReason = parts.join("; ");
    } else if (isOrphanClass) {
      category = "DUPLICATE_ORPHAN";
      subReason = !className
        ? "Orphan — no classroom assigned"
        : `Orphan — classroom "${className}" not in school`;
    } else if (isDuplicateRow) {
      category = "DUPLICATE_ORPHAN";
      subReason = "Duplicate name+class row with no class-list or billing history";
    } else if (!fullName || norm(fullName).length < 2) {
      category = "DUPLICATE_ORPHAN";
      subReason = "Invalid/empty learner name";
    } else {
      category = "DUPLICATE_ORPHAN";
      subReason = "No class-list match and no billing/history — import artifact";
    }

    classified.push({
      id: learner.id,
      firstName: learner.firstName,
      lastName: learner.lastName,
      className: learner.className,
      admissionNo: learner.admissionNo,
      matchKey,
      category,
      subReason,
      createdAt: learner.createdAt.toISOString(),
      historySignals,
    });
  }

  const byCategory = {
    ACTIVE: classified.filter((r) => r.category === "ACTIVE"),
    HISTORICAL: classified.filter((r) => r.category === "HISTORICAL"),
    DUPLICATE_ORPHAN: classified.filter((r) => r.category === "DUPLICATE_ORPHAN"),
  };

  const claimedClassListKeys = new Set(claimedActiveKeys.keys());
  const classListNotInProduction = activeFromFiles.filter((l) => !claimedClassListKeys.has(l.matchKey));

  const duplicateExtraRows =
    byCategory.DUPLICATE_ORPHAN.filter((r) => r.subReason.includes("Duplicate import row")).length;

  const liveSnapshotPath = path.join(process.cwd(), "da-silva-live-snapshot-replace.json");
  let liveSnapshotNote: Record<string, unknown> | null = null;
  if (fs.existsSync(liveSnapshotPath)) {
    try {
      const snap = JSON.parse(fs.readFileSync(liveSnapshotPath, "utf8")) as {
        liveBefore?: { learners?: number };
        expected?: { learners?: number };
        generatedAt?: string;
      };
      const liveLearners = snap.liveBefore?.learners;
      if (typeof liveLearners === "number" && liveLearners > dbLearners.length) {
        liveSnapshotNote = {
          source: "da-silva-live-snapshot-replace.json",
          capturedAt: snap.generatedAt,
          liveLearnerCount: liveLearners,
          expectedActive: snap.expected?.learners ?? DA_SILVA_EXPECTED_LEARNER_COUNT,
          excessRows: liveLearners - (snap.expected?.learners ?? DA_SILVA_EXPECTED_LEARNER_COUNT),
          currentDbLearnerCount: dbLearners.length,
          interpretation:
            "Live once had duplicate/import rows on top of 396 class-list learners. Current DB row count may differ after partial cleanup.",
        };
      }
    } catch {
      liveSnapshotNote = null;
    }
  }

  const corruptClassRows = classified.filter((r) =>
    String(r.className || "").startsWith("|grade")
  );

  const report = {
    generatedAt: new Date().toISOString(),
    mode: "audit-only",
    schoolId,
    classListDir,
    liveSnapshot536: liveSnapshotNote,
    classListFiles: CLASS_LIST_FILES.length,
    missingClassListFiles: missingFiles,
    classListParse: {
      rawRows: rawClassLearners.length,
      uniqueActiveMatchKeys: activeFromFiles.length,
      expectedActive: DA_SILVA_EXPECTED_LEARNER_COUNT,
      classroomsFromFiles: classrooms.length,
      perFile: classrooms,
    },
    production: {
      totalLearners: dbLearners.length,
      totalClassrooms: classroomNames.size,
      parentLinks: linkRows.length,
      ledgerEntries: ledger.length,
      kidesysHistoryRows: history.length,
      billingPlanLearners: Object.keys(plans).length,
    },
    summary: {
      totalProductionLearners: dbLearners.length,
      totalActiveFromClassLists: activeFromFiles.length,
      totalActiveInProduction: byCategory.ACTIVE.length,
      totalHistorical: byCategory.HISTORICAL.length,
      totalDuplicateOrphan: byCategory.DUPLICATE_ORPHAN.length,
      checksum:
        byCategory.ACTIVE.length +
        byCategory.HISTORICAL.length +
        byCategory.DUPLICATE_ORPHAN.length,
      projectedDashboardLearnerCount: activeFromFiles.length,
      projectedDashboardLearnerCountStrictMatchKeyOnly: byCategory.ACTIVE.length,
      projectedClassroomCount: classroomNames.size,
      whyNot396:
        dbLearners.length - DA_SILVA_EXPECTED_LEARNER_COUNT ===
        byCategory.HISTORICAL.length + byCategory.DUPLICATE_ORPHAN.length
          ? "536 = 396 ACTIVE + historical + duplicate/orphan"
          : "See breakdown — counts may overlap sub-reasons",
      excessOverActive: dbLearners.length - byCategory.ACTIVE.length,
      duplicateExtraActiveSlots: duplicateExtraRows,
      classListKeysMissingFromProduction: classListNotInProduction.length,
      activeWithClassNameMismatch: byCategory.ACTIVE.filter((r) =>
        r.subReason.includes("mismatch")
      ).length,
      productionRowsWithCorruptClassLabel: corruptClassRows.length,
    },
    breakdown: {
      duplicateSubReasons: countBy(
        byCategory.DUPLICATE_ORPHAN.map((r) => r.subReason.split(" — ")[0])
      ),
      historicalWithOrphanClass: byCategory.HISTORICAL.filter((r) =>
        r.subReason.includes("orphan")
      ).length,
      historicalWithParentLinks: byCategory.HISTORICAL.filter((r) => r.historySignals.parentLinks > 0)
        .length,
      activeMismatchByCorruptClassroom: countBy(
        byCategory.ACTIVE.filter((r) => r.subReason.includes("mismatch")).map((r) =>
          String(r.className || "(null)")
        )
      ),
    },
    samples: {
      ACTIVE: sampleNames(byCategory.ACTIVE),
      HISTORICAL: sampleNames(byCategory.HISTORICAL),
      DUPLICATE_ORPHAN: sampleNames(byCategory.DUPLICATE_ORPHAN),
      classListNotInProduction: classListNotInProduction.slice(0, 15).map(
        (l) => `${l.fullName} (${l.className}) — ${l.matchKey}`
      ),
    },
    classroomProductionVsActive: [...classroomNames]
      .sort()
      .map((name) => {
        const prod = dbLearners.filter((l) => l.className === name).length;
        const active = byCategory.ACTIVE.filter((l) => l.className === name).length;
        const expected = activeFromFiles.filter((l) => {
          const canonical =
            normalizeClassroomInput(l.className).classroomName || l.className;
          return canonical === name;
        }).length;
        return { classroom: name, productionRows: prod, activeRows: active, classListRows: expected };
      }),
  };

  const txtLines = [
    "=== Da Silva class-list ACTIVE learner audit (read-only) ===",
    `Generated: ${report.generatedAt}`,
    `School: ${schoolId}`,
    `Class lists: ${classListDir}`,
    "",
    "--- Totals ---",
    `Production learners (dashboard today): ${report.summary.totalProductionLearners}`,
    `ACTIVE from class lists (unique):     ${report.summary.totalActiveFromClassLists}`,
    `ACTIVE matched in production:         ${report.summary.totalActiveInProduction}`,
    `HISTORICAL (off list, has history): ${report.summary.totalHistorical}`,
    `DUPLICATE / ORPHAN:                 ${report.summary.totalDuplicateOrphan}`,
    `Checksum (must equal production):   ${report.summary.checksum}`,
    "",
    "--- Projected (if only ACTIVE counted) ---",
    `Dashboard learners: ${report.summary.projectedDashboardLearnerCount}`,
    `Classrooms:         ${report.summary.projectedClassroomCount}`,
    "",
    ...(report.liveSnapshot536
      ? [
          "--- Live production snapshot (prior capture) ---",
          `Recorded live learners: ${(report.liveSnapshot536 as { liveLearnerCount: number }).liveLearnerCount}`,
          `Expected ACTIVE (class lists): ${(report.liveSnapshot536 as { expectedActive: number }).expectedActive}`,
          `Excess rows on live: ${(report.liveSnapshot536 as { excessRows: number }).excessRows}`,
          `Current DB connected for this audit: ${report.summary.totalProductionLearners}`,
          "",
        ]
      : []),
    `Class-list mismatch ACTIVE recoveries: ${report.summary.activeWithClassNameMismatch ?? 0}`,
    `Corrupt |grade* class labels in DB: ${report.summary.productionRowsWithCorruptClassLabel ?? 0}`,
    "",
    "--- Samples: ACTIVE ---",
    ...report.samples.ACTIVE.map((s) => `  • ${s}`),
    "",
    "--- Samples: HISTORICAL ---",
    ...report.samples.HISTORICAL.map((s) => `  • ${s}`),
    "",
    "--- Samples: DUPLICATE / ORPHAN ---",
    ...report.samples.DUPLICATE_ORPHAN.map((s) => `  • ${s}`),
  ];

  const outJson = path.join(process.cwd(), "class-list-active-learner-audit.json");
  const outTxt = path.join(process.cwd(), "class-list-active-learner-audit.txt");
  fs.writeFileSync(outJson, JSON.stringify(report, null, 2));
  fs.writeFileSync(outTxt, txtLines.join("\n"));

  console.log(txtLines.join("\n"));
  console.log(`\nWrote ${outJson}`);
  console.log(`Wrote ${outTxt}`);
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    out[v] = (out[v] || 0) + 1;
  }
  return out;
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
