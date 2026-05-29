"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT = void 0;
exports.previewDaSilvaSasamsClassesLearners = previewDaSilvaSasamsClassesLearners;
exports.previewDaSilvaSasamsParentsLinks = previewDaSilvaSasamsParentsLinks;
exports.previewDaSilvaKideesysBillingMatch = previewDaSilvaKideesysBillingMatch;
exports.previewDaSilvaBillingImport = previewDaSilvaBillingImport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const daSilvaMigrationStrategy_1 = require("./daSilvaMigrationStrategy");
const daSilvaConstants_1 = require("./daSilvaConstants");
const daSilvaParentLearnerMatching_1 = require("./daSilvaParentLearnerMatching");
const daSilvaKideesysBillingMatch_1 = require("./daSilvaKideesysBillingMatch");
const parsers_1 = require("./parsers");
const daSilvaKideesysBillingReconciliationReport_1 = require("./daSilvaKideesysBillingReconciliationReport");
const daSilvaUploadManifest_1 = require("./daSilvaUploadManifest");
const daSilvaMigrationService_1 = require("./daSilvaMigrationService");
const sasamsParsers_1 = require("./sasamsParsers");
const parsers_2 = require("./parsers");
function sasamsPathsFromManifest(staged) {
    return {
        classListDir: staged.classListDir,
        learnerRegister: staged.learnerRegister,
        parentRegister: staged.parentRegister,
    };
}
function learnersForParentPreview(staged, schoolId) {
    return (async () => {
        if (schoolId) {
            const db = await prisma_1.prisma.learner.findMany({
                where: { schoolId },
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    className: true,
                    admissionNo: true,
                    idNumber: true,
                },
            });
            if (db.length > 0)
                return db;
        }
        const rows = (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)(sasamsPathsFromManifest(staged));
        return rows.map((r) => ({
            id: r.matchKey,
            firstName: r.firstName,
            lastName: r.lastName,
            className: r.canonicalClassName,
            admissionNo: r.admissionNo,
            idNumber: r.idNumber,
        }));
    })();
}
/** Parent link rows expected from parent_learner_links.xls (Da Silva Academy). */
var daSilvaConstants_2 = require("./daSilvaConstants");
Object.defineProperty(exports, "DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT", { enumerable: true, get: function () { return daSilvaConstants_2.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT; } });
async function previewDaSilvaSasamsClassesLearners(opts) {
    const uploadManifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(opts.schoolId, opts.projectId);
    const staged = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(uploadManifest);
    const errors = [];
    const classListFilesFound = staged.classListFiles
        .map((p) => path_1.default.basename(p))
        .sort();
    const { classrooms, learners: parsedClassListLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(staged.classListDir);
    const perClassCountsMap = new Map();
    for (const learner of parsedClassListLearners) {
        const name = learner.canonicalClassName || learner.className;
        perClassCountsMap.set(name, (perClassCountsMap.get(name) || 0) + 1);
    }
    const perClassCounts = Array.from(perClassCountsMap.entries())
        .map(([classroomName, count]) => ({ classroomName, count }))
        .sort((a, b) => a.classroomName.localeCompare(b.classroomName));
    console.log("[sasams-preview]", {
        classListFiles: classListFilesFound.length,
        parsedLearners: parsedClassListLearners.length,
        classrooms: classrooms.length,
        perClassCounts,
    });
    const headerDetection = (0, sasamsParsers_1.detectSasamsClassListHeaders)(staged.classListDir);
    if (!headerDetection.files.length) {
        errors.push("No class list files with detectable SA-SAMS headers");
    }
    if (parsedClassListLearners.length === 0) {
        errors.push("No learners parsed from staged SA-SAMS class lists");
    }
    const classroomValidation = (0, daSilvaMigrationService_1.validateDaSilvaClassroomsFromKidESys)(staged.classListDir);
    errors.push(...classroomValidation.errors);
    let learnerParseAudit = {
        classListParsed: parsedClassListLearners.length,
        registerParsed: 0,
        mergedTotal: 0,
        enrichedFromRegister: 0,
        registerOnlySkipped: 0,
        missingDob: 0,
        missingGender: 0,
        missingId: 0,
        perClassroomCounts: [],
    };
    if (fs_1.default.existsSync(staged.learnerRegister)) {
        const auditHolder = { audit: learnerParseAudit };
        (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)({
            ...sasamsPathsFromManifest(staged),
            learnerRegister: staged.learnerRegister,
        }, auditHolder);
        learnerParseAudit = auditHolder.audit;
    }
    else {
        learnerParseAudit = (0, daSilvaMigrationService_1.buildDaSilvaLearnerParseAudit)(parsedClassListLearners, parsedClassListLearners, {
            classListParsed: parsedClassListLearners.length,
            registerParsed: 0,
            mergedTotal: parsedClassListLearners.length,
            enrichedFromRegister: 0,
            registerOnlySkipped: 0,
        });
        errors.push("learner_register.xls not uploaded — ID/DOB/gender enrichment unavailable");
    }
    const sasamsCount = learnerParseAudit.classListParsed;
    if (sasamsCount !== daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT) {
        errors.push(`Expected ${daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT} SA-SAMS class-list learners, parsed ${sasamsCount}`);
    }
    if (fs_1.default.existsSync(staged.learnerRegister)) {
        if (learnerParseAudit.missingDob > 0) {
            errors.push(`DOB missing on ${learnerParseAudit.missingDob}/${learnerParseAudit.mergedTotal} learners after register merge (expected 0)`);
        }
        if (learnerParseAudit.missingGender > 0) {
            errors.push(`Gender missing on ${learnerParseAudit.missingGender}/${learnerParseAudit.mergedTotal} learners after register merge (expected 0)`);
        }
    }
    const passed = errors.length === 0 &&
        sasamsCount === daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT &&
        parsedClassListLearners.length === daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT &&
        (!fs_1.default.existsSync(staged.learnerRegister) ||
            (learnerParseAudit.missingDob === 0 && learnerParseAudit.missingGender === 0));
    return {
        success: true,
        passed,
        headerDetection,
        classroomValidation,
        learnerParseAudit,
        learnersPerClass: learnerParseAudit.perClassroomCounts,
        sasamsClassListLearners: sasamsCount,
        expectedSasamsLearners: daSilvaConstants_1.DA_SILVA_EXPECTED_SASAMS_CLASS_LIST_LEARNER_COUNT,
        crecheSupplementExpected: daSilvaConstants_1.DA_SILVA_EXPECTED_CRECHE_SUPPLEMENT_LEARNER_COUNT,
        finalLearnersExpected: daSilvaConstants_1.DA_SILVA_EXPECTED_FINAL_LEARNER_COUNT,
        totalLearners: learnerParseAudit.mergedTotal,
        missingId: learnerParseAudit.missingId,
        missingDob: learnerParseAudit.missingDob,
        missingGender: learnerParseAudit.missingGender,
        classListFilesFound,
        debug: {
            classListFilesFound: classListFilesFound.length,
            learnersParsedPerClass: perClassCounts,
            missingDob: learnerParseAudit.missingDob,
            missingId: learnerParseAudit.missingId,
            missingGender: learnerParseAudit.missingGender,
        },
        errors,
    };
}
async function previewDaSilvaSasamsParentsLinks(opts) {
    const uploadManifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(opts.schoolId, opts.projectId);
    const staged = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(uploadManifest);
    const errors = [];
    const parentRegisterPath = staged.parentRegister;
    const parentLearnerLinksPath = staged.parentLearnerLinks;
    const registerCount = !(0, sasamsParsers_1.isSasamsHrStaffRegister)(parentRegisterPath)
        ? (0, sasamsParsers_1.parseSasamsParentRegister)(parentRegisterPath).length
        : 0;
    const linksCount = (0, sasamsParsers_1.parseSasamsParentLearnerLinks)(parentLearnerLinksPath).length;
    const combined = (0, sasamsParsers_1.parseSasamsParentSources)(parentRegisterPath, parentLearnerLinksPath);
    const learners = await learnersForParentPreview(staged, opts.schoolId);
    if (!learners.length) {
        errors.push("No learners available for parent matching — upload class lists or import learners");
    }
    const audit = (0, daSilvaParentLearnerMatching_1.auditParentMatches)(combined, learners);
    const matchedLinks = audit.rows.filter((r) => r.matched).length;
    if (combined.length === 0) {
        errors.push("No parent link rows parsed from parent_register or parent_learner_links");
    }
    if (matchedLinks === 0 && combined.length > 0) {
        errors.push("Parent link matches = 0 — check parent_learner_links.xls parsing");
    }
    if (audit.unmatchedParents.length > daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED) {
        errors.push(`${audit.unmatchedParents.length} parent row(s) could not be matched to learners (max ${daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED})`);
    }
    if (audit.duplicateMatches.length > 0) {
        errors.push(`${audit.duplicateMatches.length} parent row(s) have ambiguous learner matches`);
    }
    const sampleUnmatched = audit.unmatchedParents.slice(0, 12).map((r) => ({
        parentFirstName: r.parentFirstName,
        parentSurname: r.parentSurname,
        learnerName: r.learnerName,
        learnerAdmissionNo: r.learnerAdmissionNo,
        learnerClassName: r.learnerClassName,
    }));
    const passed = errors.length === 0 && matchedLinks > 0;
    return {
        success: true,
        passed,
        parentRegisterRows: registerCount,
        parentLinksRows: linksCount,
        combinedParentRows: combined.length,
        matchedLinks,
        unmatchedParents: audit.unmatchedParents.length,
        duplicateMatches: audit.duplicateMatches.length,
        expectedParentLinks: daSilvaConstants_1.DA_SILVA_EXPECTED_PARENT_LINK_MATCH_COUNT,
        sampleUnmatched,
        debug: {
            parentLinkRowsParsed: linksCount,
            parentRegisterRowsParsed: registerCount,
            parentLinksMatched: matchedLinks,
            parentLinksUnmatched: audit.unmatchedParents.length,
            sampleUnmatched,
        },
        errors,
    };
}
async function previewDaSilvaKideesysBillingMatch(opts) {
    const uploadManifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(opts.schoolId, opts.projectId);
    const staged = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(uploadManifest);
    const errors = [];
    const ageParsed = (0, parsers_1.parseAgeAnalysisFileWithAudit)(staged.ageAnalysis);
    if (!ageParsed.accounts.length) {
        errors.push("Age analysis parser produced 0 accounts");
    }
    if (ageParsed.audit.headerRowIndex === null) {
        errors.push("Age analysis parser could not detect header row");
    }
    const accounts = ageParsed.accounts;
    const { learners: sasamsClassLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(staged.classListDir);
    const classListLearners = (0, sasamsParsers_1.sasamsLearnersToParsedLearners)(sasamsClassLearners);
    const dbLearners = await prisma_1.prisma.learner.findMany({
        where: { schoolId: opts.schoolId },
        select: { id: true, firstName: true, lastName: true, className: true, admissionNo: true, idNumber: true },
    });
    const dbForMatch = dbLearners.length > 0
        ? dbLearners.map((l) => ({
            id: l.id,
            firstName: l.firstName,
            lastName: l.lastName,
            className: l.className,
            matchKey: (0, parsers_2.buildLearnerMatchKey)(`${l.firstName} ${l.lastName}`, l.className || ""),
            idNumber: l.idNumber,
            admissionNo: l.admissionNo,
        }))
        : (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)(sasamsPathsFromManifest(staged)).map((r) => ({
            id: r.matchKey,
            firstName: r.firstName,
            lastName: r.lastName,
            className: r.canonicalClassName,
            matchKey: r.matchKey,
            idNumber: r.idNumber,
            admissionNo: r.admissionNo,
        }));
    if (!dbForMatch.length) {
        errors.push("No learners for billing match — complete SA-SAMS learner preview first");
    }
    const billingPlanItems = (0, parsers_1.parseBillingPlanFile)(staged.billingPlan);
    const transactions = (0, parsers_1.parseTransactionListFile)(staged.transactions);
    const contacts = (0, parsers_1.parseContactListFile)(staged.contactList);
    const { audit, report } = (0, daSilvaKideesysBillingMatch_1.matchKideesysBillingAccountsWithSecondPass)({
        accounts,
        dbLearners: dbForMatch,
        classListLearners,
        mergedFamilyAccountNos: [],
        billingPlanItems,
        transactions,
        contacts,
    });
    const matchedAccounts = audit.matched.filter((r) => r.learnerId).length;
    const unmatchedAccounts = audit.unmatchedAccounts.length;
    const totalAccounts = accounts.length;
    const matchRatio = totalAccounts > 0 ? matchedAccounts / totalAccounts : 0;
    const sampleUnmatched = audit.unmatchedAccounts.slice(0, 12).map((r) => ({
        accountNo: r.accountNo,
        fullName: r.fullName,
    }));
    if (matchedAccounts < daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MIN_MATCHED) {
        errors.push(`Billing match too low: ${matchedAccounts}/${totalAccounts} (need at least ${daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MIN_MATCHED}); review reconciliation report`);
    }
    const reportPath = path_1.default.join(process.cwd(), "kideesys-billing-reconciliation-report.txt");
    fs_1.default.writeFileSync(reportPath, (0, daSilvaKideesysBillingReconciliationReport_1.formatKideesysBillingReconciliationReportText)(report, opts.schoolId));
    const passed = errors.length === 0;
    console.log("[billing-match-preview]", {
        totalAccounts,
        matchedAccounts,
        firstPassMatched: report.firstPassMatched,
        secondPassAutoMatched: report.secondPassAutoMatched,
        unmatchedAccounts,
        manualReview: report.manualReviewRequired.length,
        matchRatio,
        reconciliationReport: reportPath,
        sampleUnmatched: sampleUnmatched.slice(0, 5),
    });
    return {
        success: true,
        passed,
        totalAccounts,
        matchedAccounts,
        unmatchedAccounts,
        matchRatio,
        minRatioRequired: daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MIN_RATIO,
        maxUnmatchedAllowed: daSilvaMigrationStrategy_1.DA_SILVA_BILLING_MATCH_MAX_UNMATCHED,
        sampleUnmatched,
        debug: {
            billingAccountsParsed: totalAccounts,
            billingAccountsMatched: matchedAccounts,
            billingAccountsUnmatched: unmatchedAccounts,
            firstPassMatched: report.firstPassMatched,
            secondPassAutoMatched: report.secondPassAutoMatched,
            manualReviewRequired: report.manualReviewRequired.length,
            reconciliationReportPath: reportPath,
            sampleUnmatched,
        },
        errors,
    };
}
async function previewDaSilvaBillingImport(opts) {
    const uploadManifest = (0, daSilvaUploadManifest_1.requireStagingUploadManifest)(opts.schoolId, opts.projectId);
    const staged = (0, daSilvaUploadManifest_1.pathsFromStagingUploadManifest)(uploadManifest);
    const errors = [];
    const transactionParseErrors = [];
    let transactionRowCount = 0;
    try {
        const txns = (0, parsers_1.parseTransactionListFile)(staged.transactions);
        transactionRowCount = txns.length;
        if (transactionRowCount < 1) {
            transactionParseErrors.push("Transaction list parsed 0 rows");
        }
    }
    catch (e) {
        transactionParseErrors.push(e instanceof Error ? e.message : "Failed to parse transaction list");
    }
    const stagingValidation = (0, daSilvaMigrationService_1.validateDaSilvaBillingStaging)({
        classListDir: staged.classListDir,
        billingPlan: staged.billingPlan,
        ageAnalysis: staged.ageAnalysis,
    });
    errors.push(...stagingValidation.errors);
    errors.push(...transactionParseErrors);
    const passed = errors.length === 0 && stagingValidation.passed;
    return {
        success: true,
        passed,
        stagingValidation,
        transactionRowCount,
        transactionParseErrors,
        errors,
    };
}
