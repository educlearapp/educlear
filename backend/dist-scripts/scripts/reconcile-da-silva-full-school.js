"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Full Da Silva school reconciliation — all learners, parents, billing links.
 *
 * Usage:
 *   npx tsx scripts/reconcile-da-silva-full-school.ts [--apply] [schoolId] [projectId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const daSilvaFullReconciliation_1 = require("../src/services/daSilvaMigration/daSilvaFullReconciliation");
const prisma_1 = require("../src/prisma");
const apply = process.argv.includes("--apply");
const args = process.argv.slice(2).filter((a) => a !== "--apply");
const schoolId = args[0] || activateDaSilvaSubscription_1.DA_SILVA_ACADEMY_SCHOOL_ID;
const projectId = args[1] || "";
async function main() {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new Error(`School not found: ${schoolId}`);
    const report = await (0, daSilvaFullReconciliation_1.runDaSilvaFullSchoolReconciliation)({
        schoolId: school.id,
        projectId: projectId || undefined,
        apply,
    });
    const outPath = path_1.default.join(process.cwd(), "reconcile-da-silva-full-school.json");
    fs_1.default.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log("Learners reconciled:", `${report.totals.learnersInDbBefore} → ${report.totals.learnersInDbAfter}`);
    console.log("Parents reconciled:", report.parents.parentsRepaired);
    console.log("Duplicates:", report.totals.duplicatesMerged, "merged,", report.totals.duplicatesFlagged, "flagged");
    console.log("ACTIVE:", report.totals.activeFinal);
    console.log("HISTORICAL:", report.totals.historicalFinal);
    console.log("UI aligned:", report.uiAligned ? "yes" : "no");
    console.log("Audit", report.auditPass ? "PASS" : "FAIL");
    console.log(`\nReport: ${outPath}`);
    if (!apply) {
        console.log("\nDry run only — re-run with --apply to persist.");
    }
}
main()
    .catch((e) => {
    if (e instanceof Error) {
        console.error(e.message);
        if (e.stack)
            console.error(e.stack);
    }
    else {
        console.error(e);
    }
    process.exit(1);
})
    .finally(() => prisma_1.prisma.$disconnect());
