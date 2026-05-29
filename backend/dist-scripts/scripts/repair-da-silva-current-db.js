"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Repair current Da Silva DB from staged SA-SAMS (learners/parents) + Kid-e-Sys (billing only).
 *
 * Usage:
 *   npx tsx scripts/repair-da-silva-current-db.ts [--apply] [schoolId] [projectId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const activateDaSilvaSubscription_1 = require("../src/services/activateDaSilvaSubscription");
const daSilvaCurrentDbRepair_1 = require("../src/services/daSilvaMigration/daSilvaCurrentDbRepair");
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
    console.log(`=== Da Silva current DB repair (${apply ? "APPLY" : "dry-run"}) ===`);
    console.log(`School: ${school.name} (${school.id})`);
    const report = await (0, daSilvaCurrentDbRepair_1.runDaSilvaCurrentDbRepair)({
        schoolId: school.id,
        projectId: projectId || undefined,
        apply,
    });
    const outPath = path_1.default.join(process.cwd(), "repair-da-silva-current-db.json");
    fs_1.default.writeFileSync(outPath, JSON.stringify(report, null, 2));
    const { audit, learners, parents, billing } = report;
    console.log("\nLearners repaired:", learners.updated + learners.created > 0
        ? learners.updated + learners.created
        : learners.matched);
    console.log("Parents repaired:", parents.parentsUpdated + parents.parentsCreated);
    console.log("Profiles showing:", audit.profilesShowing ? "yes" : "no");
    console.log("Invoices showing:", audit.invoicesShowing ? "yes" : "no");
    console.log("Payments showing:", audit.paymentsShowing ? "yes" : "no");
    console.log("Statements showing:", audit.statementsShowing ? "yes" : "no");
    console.log("Audit", audit.auditPass ? "PASS" : "FAIL");
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
