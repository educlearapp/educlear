"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.canonicalFromClassListRaw = canonicalFromClassListRaw;
/**
 * Da Silva — learner.className label normalization only (class-list source of truth).
 *
 * Does NOT delete learners, touch invoices/payments/ledger, or change row counts.
 *
 * Usage:
 *   npx tsx scripts/normalize-classroom-labels-only.ts [classListDir] [schoolId]
 *   npx tsx scripts/normalize-classroom-labels-only.ts --apply [classListDir] [schoolId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const parsers_1 = require("../src/services/daSilvaMigration/parsers");
const daSilvaMigrationService_1 = require("../src/services/daSilvaMigration/daSilvaMigrationService");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const classroomNormalization_1 = require("../src/utils/classroomNormalization");
const learnerBillingPlanStore_1 = require("../src/utils/learnerBillingPlanStore");
const billingLedgerStore_1 = require("../src/utils/billingLedgerStore");
const kidesysTransactionHistoryStore_1 = require("../src/utils/kidesysTransactionHistoryStore");
const prisma = new client_1.PrismaClient();
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
];
/** Known corrupt production labels → class-list canonical (audit + user rules). */
const EXPLICIT_CLASS_REMAP = {
    "|grade Ra": "Grade RA",
    "|grade Rb": "Grade RB",
    "lgrade Ra": "Grade RA",
    "lgrade Rb": "Grade RB",
    "Pre-School Creche": "Creche",
    "Pre-school Creche": "Creche",
};
function norm(s) {
    return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function normNameKey(s) {
    return norm(s).replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}
function learnerFullName(firstName, lastName) {
    return `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
}
/** Canonical label from Kid-e-Sys class-list header (preserves Grade RA/RB from XLS). */
function canonicalFromClassListRaw(rawClassName) {
    const raw = String(rawClassName || "").trim();
    if (!raw)
        return raw;
    const explicit = EXPLICIT_CLASS_REMAP[raw];
    if (explicit)
        return explicit;
    if (/^grade\s+r[a-z]{1,2}$/i.test(raw)) {
        const m = raw.match(/^grade\s+r(.+)$/i);
        if (m)
            return `Grade R${m[1].toUpperCase()}`;
    }
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(raw);
    return norm.classroomName || raw;
}
function parseExplicitClassLists(classListDir) {
    const fileCanonicalByLearner = new Map();
    const fileCanonicalByMatchKey = new Map();
    const classrooms = [];
    for (const file of CLASS_LIST_FILES) {
        const filePath = path_1.default.join(classListDir, file);
        if (!fs_1.default.existsSync(filePath)) {
            throw new Error(`Missing class list file: ${filePath}`);
        }
        const parsed = (0, parsers_1.parseClassListFile)(filePath);
        const canonical = canonicalFromClassListRaw(parsed.classroom.className);
        classrooms.push({
            className: parsed.classroom.className,
            canonical,
            sourceFile: parsed.classroom.sourceFile,
            rawCount: parsed.learners.length,
        });
        for (const learner of parsed.learners) {
            fileCanonicalByMatchKey.set(learner.matchKey, canonical);
            fileCanonicalByLearner.set(learner.matchKey, canonical);
        }
    }
    return { fileCanonicalByLearner, fileCanonicalByMatchKey, classrooms };
}
function uniqueLearnersByMatchKey(learners) {
    const map = new Map();
    for (const l of learners) {
        if (!map.has(l.matchKey))
            map.set(l.matchKey, l);
    }
    return Array.from(map.values());
}
async function resolveSchoolId(argSchoolId) {
    if (argSchoolId) {
        (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(argSchoolId);
        return argSchoolId;
    }
    const byId = await prisma.school.findUnique({
        where: { id: (0, activateDaSilvaSubscription_1.getDaSilvaResolvedSchoolId)() },
        select: { id: true },
    });
    if (byId)
        return byId.id;
    const byName = await prisma.school.findFirst({
        where: { name: activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME },
        select: { id: true },
    });
    if (byName) {
        (0, activateDaSilvaSubscription_1.setDaSilvaResolvedSchoolId)(byName.id);
        return byName.id;
    }
    throw new Error(`School not found: ${activateDaSilvaSubscription_1.DA_SILVA_SCHOOL_NAME}`);
}
async function main() {
    const apply = process.argv.includes("--apply");
    const args = process.argv.filter((a) => a !== "--apply");
    const classListDir = args[2] || path_1.default.join(process.env.HOME || "", "Desktop", "05_class_list");
    const schoolId = await resolveSchoolId(args[3]);
    if (!fs_1.default.existsSync(classListDir)) {
        throw new Error(`Class list folder not found: ${classListDir}`);
    }
    const { fileCanonicalByMatchKey, classrooms } = parseExplicitClassLists(classListDir);
    const activeFromFiles = [];
    for (const file of CLASS_LIST_FILES) {
        activeFromFiles.push(...(0, parsers_1.parseClassListFile)(path_1.default.join(classListDir, file)).learners);
    }
    const activeUnique = uniqueLearnersByMatchKey(activeFromFiles);
    const activeByNormName = new Map();
    for (const l of activeUnique) {
        const targetClass = fileCanonicalByMatchKey.get(l.matchKey) || canonicalFromClassListRaw(l.className);
        for (const nameKey of [norm(l.fullName), normNameKey(l.fullName)]) {
            const arr = activeByNormName.get(nameKey) || [];
            if (!arr.some((x) => x.matchKey === l.matchKey)) {
                arr.push({ ...l, targetClass });
            }
            activeByNormName.set(nameKey, arr);
        }
    }
    const dbLearners = await prisma.learner.findMany({
        where: { schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            className: true,
        },
        orderBy: [{ className: "asc" }, { lastName: "asc" }, { firstName: "asc" }],
    });
    const beforeClassroomCount = new Set(dbLearners.map((l) => String(l.className || "").trim()).filter(Boolean)).size;
    const beforeByClass = {};
    for (const l of dbLearners) {
        const cn = String(l.className || "").trim() || "(null)";
        beforeByClass[cn] = (beforeByClass[cn] || 0) + 1;
    }
    const ledgerBefore = (0, billingLedgerStore_1.readSchoolLedger)(schoolId).length;
    const plansBefore = Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).length;
    const historyBefore = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId).length;
    const billingPlanItemCountBefore = Object.values((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
    const planned = [];
    for (const learner of dbLearners) {
        const fullName = learnerFullName(learner.firstName, learner.lastName);
        const current = String(learner.className || "").trim();
        const matchKey = (0, parsers_1.buildLearnerMatchKey)(fullName, current);
        let target = fileCanonicalByMatchKey.get(matchKey) ||
            EXPLICIT_CLASS_REMAP[current] ||
            null;
        let reason = "class-list matchKey";
        if (!target) {
            const hits = [];
            const seen = new Set();
            for (const nameKey of [norm(fullName), normNameKey(fullName)]) {
                for (const hit of activeByNormName.get(nameKey) || []) {
                    if (seen.has(hit.matchKey))
                        continue;
                    seen.add(hit.matchKey);
                    hits.push(hit);
                }
            }
            if (hits.length === 1) {
                target = hits[0].targetClass;
                reason = "class-list name recovery (className mismatch)";
            }
        }
        if (!target || target === current)
            continue;
        planned.push({
            id: learner.id,
            fullName,
            from: current,
            to: target,
            reason,
        });
    }
    const updatesByTarget = {};
    const updatesByFromTo = {};
    for (const u of planned) {
        updatesByTarget[u.to] = (updatesByTarget[u.to] || 0) + 1;
        const key = `${u.from} → ${u.to}`;
        updatesByFromTo[key] = (updatesByFromTo[key] || 0) + 1;
    }
    if (apply && planned.length > 0) {
        await prisma.$transaction(planned.map((u) => prisma.learner.update({
            where: { id: u.id },
            data: { className: u.to },
        })));
    }
    const afterLearners = apply
        ? await prisma.learner.findMany({
            where: { schoolId },
            select: { className: true },
        })
        : dbLearners.map((l) => {
            const hit = planned.find((p) => p.id === l.id);
            return { className: hit ? hit.to : l.className };
        });
    const afterByClass = {};
    for (const l of afterLearners) {
        const cn = String(l.className || "").trim() || "(null)";
        afterByClass[cn] = (afterByClass[cn] || 0) + 1;
    }
    const afterClassroomCount = new Set(afterLearners.map((l) => String(l.className || "").trim()).filter(Boolean)).size;
    const finalLearnerTotal = apply
        ? await prisma.learner.count({ where: { schoolId } })
        : dbLearners.length;
    const ledgerAfter = (0, billingLedgerStore_1.readSchoolLedger)(schoolId).length;
    const plansAfter = Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).length;
    const historyAfter = (0, kidesysTransactionHistoryStore_1.readSchoolKidesysHistory)(schoolId).length;
    const billingPlanItemCountAfter = Object.values((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
    const verification = {
        learnerCount396: finalLearnerTotal === daSilvaMigrationService_1.DA_SILVA_EXPECTED_LEARNER_COUNT,
        classroomCount21: afterClassroomCount === daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.classes,
        noBillingTouch: ledgerBefore === ledgerAfter &&
            plansBefore === plansAfter &&
            historyBefore === historyAfter &&
            billingPlanItemCountBefore === billingPlanItemCountAfter,
        classListCovers396: activeUnique.length === daSilvaMigrationService_1.DA_SILVA_EXPECTED_LEARNER_COUNT,
        allUpdatesMapped: planned.every((u) => u.to && u.from !== u.to),
    };
    const passed = Object.values(verification).every(Boolean);
    const report = {
        generatedAt: new Date().toISOString(),
        mode: apply ? "apply" : "dry-run",
        schoolId,
        classListDir,
        before: {
            classroomCount: beforeClassroomCount,
            learnerTotal: dbLearners.length,
            learnersByClass: beforeByClass,
        },
        plannedUpdates: {
            total: planned.length,
            byFromTo: updatesByFromTo,
            byTargetClass: updatesByTarget,
            rows: planned,
        },
        after: {
            classroomCount: afterClassroomCount,
            learnerTotal: finalLearnerTotal,
            learnersByClass: afterByClass,
        },
        classListCanonicalClassrooms: classrooms,
        billingUntouched: {
            ledgerEntries: { before: ledgerBefore, after: ledgerAfter },
            billingPlanLearners: { before: plansBefore, after: plansAfter },
            kidesysHistoryRows: { before: historyBefore, after: historyAfter },
            billingPlanItems: {
                before: billingPlanItemCountBefore,
                after: billingPlanItemCountAfter,
            },
        },
        verification,
        passed,
    };
    const outJson = path_1.default.join(process.cwd(), "classroom-label-normalization-report.json");
    const outTxt = path_1.default.join(process.cwd(), "classroom-label-normalization-report.txt");
    const txtLines = [
        "=== Da Silva classroom label normalization (learner.className only) ===",
        `Generated: ${report.generatedAt}`,
        `Mode: ${report.mode}`,
        `School: ${schoolId}`,
        "",
        "--- Before ---",
        `Classroom count (distinct learner.className): ${report.before.classroomCount}`,
        `Learner total: ${report.before.learnerTotal}`,
        "",
        "--- Updates ---",
        `Learners to update: ${report.plannedUpdates.total}`,
        ...Object.entries(report.plannedUpdates.byFromTo).map(([k, n]) => `  ${k}: ${n}`),
        "",
        "--- After (projected" + (apply ? "" : " dry-run") + ") ---",
        `Classroom count: ${report.after.classroomCount}`,
        `Learner total: ${report.after.learnerTotal}`,
        "",
        "Learners per class (after):",
        ...Object.entries(report.after.learnersByClass)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([c, n]) => `  ${c}: ${n}`),
        "",
        "--- Verification ---",
        ...Object.entries(report.verification).map(([k, v]) => `  ${k}: ${v ? "PASS" : "FAIL"}`),
        "",
        `Overall: ${passed ? "PASS" : "FAIL"}`,
    ];
    fs_1.default.writeFileSync(outJson, JSON.stringify(report, null, 2));
    fs_1.default.writeFileSync(outTxt, txtLines.join("\n"));
    console.log(txtLines.join("\n"));
    console.log(`\nWrote ${outJson}`);
    console.log(`Wrote ${outTxt}`);
    if (!passed) {
        process.exit(1);
    }
    if (!apply && planned.length > 0) {
        console.log("\nDry-run complete. Re-run with --apply to persist learner.className updates.");
    }
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
