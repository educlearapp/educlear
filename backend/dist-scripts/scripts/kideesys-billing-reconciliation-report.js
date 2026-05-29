"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Kid-e-Sys billing match + second-pass reconciliation report (dry-run).
 *
 * Usage:
 *   npx tsx scripts/kideesys-billing-reconciliation-report.ts [schoolId] [projectId]
 */
require("dotenv/config");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../src/prisma");
const daSilvaKideesysBillingReconciliationReport_1 = require("../src/services/daSilvaMigration/daSilvaKideesysBillingReconciliationReport");
const daSilvaKideesysBillingMatch_1 = require("../src/services/daSilvaMigration/daSilvaKideesysBillingMatch");
const daSilvaMigrationStrategy_1 = require("../src/services/daSilvaMigration/daSilvaMigrationStrategy");
const daSilvaStagedPaths_1 = require("../src/services/daSilvaMigration/daSilvaStagedPaths");
const parsers_1 = require("../src/services/daSilvaMigration/parsers");
const sasamsParsers_1 = require("../src/services/daSilvaMigration/sasamsParsers");
const daSilvaFinalImportGate_1 = require("../src/services/daSilvaMigration/daSilvaFinalImportGate");
const schoolIdArg = process.argv[2] || "";
const projectIdArg = process.argv[3] || "";
async function resolveSchoolId() {
    const hint = schoolIdArg.trim();
    const school = (hint
        ? await prisma_1.prisma.school.findUnique({ where: { id: hint }, select: { id: true, name: true } })
        : null) ||
        (await prisma_1.prisma.school.findFirst({
            where: { name: daSilvaFinalImportGate_1.DA_SILVA_FINAL_IMPORT_EXPECTED.schoolName },
            select: { id: true, name: true },
        }));
    if (!school)
        throw new Error("School not found — pass schoolId");
    return school;
}
async function resolveProjectId(schoolId) {
    if (projectIdArg)
        return projectIdArg;
    const stagingRoot = path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId);
    if (!fs_1.default.existsSync(stagingRoot))
        throw new Error(`No staging folder for school ${schoolId}`);
    const manifests = fs_1.default
        .readdirSync(stagingRoot)
        .filter((f) => f.startsWith("dasilva-") && f.endsWith(".manifest.json"))
        .map((f) => ({ file: f, mtime: fs_1.default.statSync(path_1.default.join(stagingRoot, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
    if (!manifests.length)
        throw new Error("No Da Silva manifest — pass projectId");
    const raw = JSON.parse(fs_1.default.readFileSync(path_1.default.join(stagingRoot, manifests[0].file), "utf8"));
    return String(raw.projectId || "").trim() || manifests[0].file.replace(/^dasilva-/, "").replace(/\.manifest\.json$/, "");
}
function findStagedFile(schoolId, relativeName) {
    const root = path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId);
    const matches = [];
    const walk = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return;
        for (const ent of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const p = path_1.default.join(dir, ent.name);
            if (ent.isDirectory())
                walk(p);
            else if (ent.name.toLowerCase() === relativeName.toLowerCase())
                matches.push(p);
        }
    };
    walk(root);
    matches.sort((a, b) => fs_1.default.statSync(b).mtimeMs - fs_1.default.statSync(a).mtimeMs);
    if (!matches.length)
        throw new Error(`Staged file not found: ${relativeName} under ${root}`);
    return matches[0];
}
async function main() {
    const school = await resolveSchoolId();
    const projectId = await resolveProjectId(school.id);
    const ageAnalysis = findStagedFile(school.id, "age_analysis.xls");
    const billingPlan = findStagedFile(school.id, "billing_plan_summary.xls");
    const transactionsPath = findStagedFile(school.id, "transaction_list.xls");
    const sasamsClassLists = path_1.default.join(path_1.default.dirname(ageAnalysis), "..", "sasams", "class_lists");
    const classListDir = fs_1.default.existsSync(sasamsClassLists)
        ? sasamsClassLists
        : path_1.default.dirname(findStagedFile(school.id, "1A.xls"));
    const staged = {
        ...(0, daSilvaStagedPaths_1.resolveDaSilvaStagedPaths)(school.id, projectId),
        classListDir,
        ageAnalysis,
        billingPlan,
        transactions: transactionsPath,
    };
    const ageParsed = (0, parsers_1.parseAgeAnalysisFileWithAudit)(staged.ageAnalysis);
    if (!ageParsed.accounts.length || ageParsed.audit.headerRowIndex === null) {
        console.error("Age analysis parser failure: no accounts or header row detected");
        process.exit(1);
    }
    const { learners: sasamsClassLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(staged.classListDir);
    const classListLearners = (0, sasamsParsers_1.sasamsLearnersToParsedLearners)(sasamsClassLearners);
    const dbLearners = await prisma_1.prisma.learner.findMany({
        where: { schoolId: school.id },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            className: true,
            idNumber: true,
            admissionNo: true,
        },
    });
    const dbForMatch = dbLearners.length > 0
        ? dbLearners.map((l) => ({
            id: l.id,
            firstName: l.firstName,
            lastName: l.lastName,
            className: l.className,
            matchKey: (0, parsers_1.buildLearnerMatchKey)(`${l.firstName} ${l.lastName}`, l.className || ""),
            idNumber: l.idNumber,
            admissionNo: l.admissionNo,
        }))
        : classListLearners.map((l) => ({
            id: l.matchKey,
            firstName: l.firstName,
            lastName: l.lastName,
            className: l.className,
            matchKey: l.matchKey,
            idNumber: l.idNumber,
            admissionNo: l.admissionNo,
        }));
    if (!dbForMatch.length) {
        console.error("No DB learners and no SA-SAMS class-list learners for billing match");
        process.exit(1);
    }
    const secondPassPaths = (0, daSilvaMigrationStrategy_1.discoverBillingSecondPassPaths)(staged.ageAnalysis);
    const billingPlanItems = (secondPassPaths.billingPlan && fs_1.default.existsSync(secondPassPaths.billingPlan)
        ? (0, parsers_1.parseBillingPlanFile)(secondPassPaths.billingPlan)
        : null) ||
        (fs_1.default.existsSync(staged.billingPlan) ? (0, parsers_1.parseBillingPlanFile)(staged.billingPlan) : []);
    let transactionParseErrors = [];
    let transactions = [];
    const txnPath = secondPassPaths.transactions && fs_1.default.existsSync(secondPassPaths.transactions)
        ? secondPassPaths.transactions
        : fs_1.default.existsSync(staged.transactions)
            ? staged.transactions
            : "";
    if (txnPath) {
        try {
            transactions = (0, parsers_1.parseTransactionListFile)(txnPath);
        }
        catch (e) {
            transactionParseErrors.push(e instanceof Error ? e.message : "Transaction parse failed");
        }
    }
    let contacts = [];
    try {
        const contactPath = secondPassPaths.contactList && fs_1.default.existsSync(secondPassPaths.contactList)
            ? secondPassPaths.contactList
            : findStagedFile(school.id, "contact_list.xls");
        contacts = (0, parsers_1.parseContactListFile)(contactPath);
    }
    catch {
        contacts = [];
    }
    const { audit, report } = (0, daSilvaKideesysBillingMatch_1.matchKideesysBillingAccountsWithSecondPass)({
        accounts: ageParsed.accounts,
        dbLearners: dbForMatch,
        classListLearners,
        mergedFamilyAccountNos: [],
        billingPlanItems,
        transactions,
        contacts,
    });
    const txtPath = path_1.default.join(process.cwd(), "kideesys-billing-reconciliation-report.txt");
    const jsonPath = path_1.default.join(process.cwd(), "kideesys-billing-reconciliation-report.json");
    const text = (0, daSilvaKideesysBillingReconciliationReport_1.formatKideesysBillingReconciliationReportText)(report, school.name);
    fs_1.default.writeFileSync(txtPath, text);
    fs_1.default.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(text);
    console.log(`\nWrote ${txtPath}`);
    console.log(`Wrote ${jsonPath}`);
    const matched = audit.matched.filter((r) => r.learnerId).length;
    const validationOk = matched >= daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MIN_MATCHED &&
        transactionParseErrors.length === 0 &&
        ageParsed.audit.headerRowIndex !== null;
    console.log(JSON.stringify({
        schoolId: school.id,
        projectId,
        totalAccounts: report.totalAccounts,
        firstPassMatched: report.firstPassMatched,
        secondPassAutoMatched: report.secondPassAutoMatched,
        totalMatched: matched,
        stillUnmatched: report.stillUnmatched,
        manualReview: report.manualReviewRequired.length,
        validationPassed: validationOk,
        transactionParseErrors,
    }, null, 2));
    if (!validationOk)
        process.exit(1);
}
main()
    .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
})
    .finally(() => prisma_1.prisma.$disconnect());
