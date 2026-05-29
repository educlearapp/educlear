"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSasamsIngestPaths = resolveSasamsIngestPaths;
exports.dryRunSasamsSchoolImport = dryRunSasamsSchoolImport;
exports.importSasamsSchoolData = importSasamsSchoolData;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const classroomNormalization_1 = require("../../utils/classroomNormalization");
const learnerBillingPlanStore_1 = require("../../utils/learnerBillingPlanStore");
const billingLedgerStore_1 = require("../../utils/billingLedgerStore");
const parentPortalService_1 = require("../parentPortalService");
const daSilvaMigrationService_1 = require("../daSilvaMigration/daSilvaMigrationService");
const sasamsLearnerProfileWrite_1 = require("../daSilvaMigration/sasamsLearnerProfileWrite");
const daSilvaParentLearnerMatching_1 = require("../daSilvaMigration/daSilvaParentLearnerMatching");
const daSilvaMigrationStrategy_1 = require("../daSilvaMigration/daSilvaMigrationStrategy");
const sasamsParsers_1 = require("../daSilvaMigration/sasamsParsers");
function pathExists(p) {
    return fs_1.default.existsSync(p);
}
function firstExistingFileOptional(candidates) {
    for (const c of candidates) {
        if (pathExists(c))
            return c;
    }
    return undefined;
}
function resolveParentLearnerLinksPath(sasamsDir) {
    const direct = firstExistingFileOptional([
        path_1.default.join(sasamsDir, "parent_learner_links.xls"),
        path_1.default.join(sasamsDir, "parent_learner_links.xlsx"),
    ]);
    if (direct)
        return direct;
    if (!pathExists(sasamsDir)) {
        return path_1.default.join(sasamsDir, "parent_learner_links.xls");
    }
    const matches = fs_1.default
        .readdirSync(sasamsDir)
        .filter((f) => /parent_learner_links/i.test(f) && /\.xls(x)?$/i.test(f));
    if (matches.length === 1)
        return path_1.default.join(sasamsDir, matches[0]);
    if (matches.length > 1) {
        throw new Error(`Multiple parent_learner_links files in ${sasamsDir}: ${matches.join(", ")}`);
    }
    return path_1.default.join(sasamsDir, "parent_learner_links.xls");
}
/** Resolve SA-SAMS file paths from a Desktop folder or `.../sasams` directory. */
function resolveSasamsIngestPaths(sourceRoot) {
    const base = sourceRoot.trim();
    const sasamsDir = pathExists(path_1.default.join(base, "sasams")) ? path_1.default.join(base, "sasams") : base;
    const core = (0, daSilvaMigrationStrategy_1.resolveDaSilvaSasamsPaths)(base);
    return {
        classListDir: core.classListDir,
        learnerRegister: core.learnerRegister,
        parentRegister: core.parentRegister,
        parentLearnerLinks: resolveParentLearnerLinksPath(sasamsDir),
    };
}
function canonicalClassroomName(className) {
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(className);
    return norm.classroomName || className;
}
function learnerNotesFromAdmissionDate(admissionDate) {
    if (!admissionDate)
        return null;
    const iso = admissionDate.toISOString().slice(0, 10);
    return `Enrolment date: ${iso}`;
}
async function findExistingLearnerId(opts) {
    if (opts.admissionNo) {
        const byAdm = await prisma_1.prisma.learner.findUnique({
            where: {
                schoolId_admissionNo: {
                    schoolId: opts.schoolId,
                    admissionNo: opts.admissionNo,
                },
            },
            select: { id: true },
        });
        if (byAdm)
            return byAdm.id;
    }
    const byName = await prisma_1.prisma.learner.findFirst({
        where: {
            schoolId: opts.schoolId,
            firstName: opts.firstName,
            lastName: opts.lastName,
            className: opts.className || null,
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
    });
    return byName?.id || null;
}
function validateClassroomsFromFiles(classListDir) {
    const errors = [];
    if (!pathExists(classListDir)) {
        errors.push(`Class list folder not found: ${classListDir}`);
        return { passed: false, classrooms: 0, classListFiles: 0, errors };
    }
    const { classrooms, learners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(classListDir);
    const rows = classrooms.map((c) => ({
        canonicalName: canonicalClassroomName(c.className),
        sourceFile: c.sourceFile,
        learnerCount: learners.filter((l) => canonicalClassroomName(l.className) === canonicalClassroomName(c.className)).length,
    }));
    const byKey = new Map();
    for (const row of rows) {
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(row.canonicalName);
        const key = norm.matchKey || row.canonicalName.toLowerCase();
        const list = byKey.get(key) || [];
        list.push(row);
        byKey.set(key, list);
    }
    const duplicates = [...byKey.entries()].filter(([, list]) => list.length > 1);
    if (duplicates.length) {
        errors.push(`Duplicate classrooms: ${duplicates
            .map(([, list]) => `${list[0].canonicalName} (${list.map((r) => r.sourceFile).join(", ")})`)
            .join("; ")}`);
    }
    const empty = rows.filter((r) => r.learnerCount === 0);
    if (empty.length) {
        errors.push(`Empty class files (0 learners): ${empty.map((r) => r.sourceFile).join(", ")}`);
    }
    if (learners.length === 0) {
        errors.push("No learners parsed from SA-SAMS class lists");
    }
    if (rows.length === 0) {
        errors.push("No classrooms parsed from SA-SAMS class lists");
    }
    return {
        passed: errors.length === 0,
        classrooms: new Set(rows.map((r) => r.canonicalName)).size,
        classListFiles: rows.length,
        errors,
    };
}
function dryRunSasamsSchoolImport(paths) {
    const errors = [];
    const classroomCheck = validateClassroomsFromFiles(paths.classListDir);
    errors.push(...classroomCheck.errors);
    if (!pathExists(paths.learnerRegister)) {
        errors.push(`SA-SAMS learner register not found: ${paths.learnerRegister}`);
    }
    if (!pathExists(paths.parentRegister)) {
        errors.push(`SA-SAMS parent register not found: ${paths.parentRegister}`);
    }
    if (!pathExists(paths.parentLearnerLinks)) {
        errors.push(`SA-SAMS parent_learner_links not found: ${paths.parentLearnerLinks}`);
    }
    const parentRegisterIsHrStaff = pathExists(paths.parentRegister) && (0, sasamsParsers_1.isSasamsHrStaffRegister)(paths.parentRegister);
    const auditHolder = {
        audit: {
            classListParsed: 0,
            registerParsed: 0,
            mergedTotal: 0,
            enrichedFromRegister: 0,
            registerOnlySkipped: 0,
            missingDob: 0,
            missingGender: 0,
            missingId: 0,
            perClassroomCounts: [],
        },
    };
    if (pathExists(paths.learnerRegister) && classroomCheck.passed) {
        (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)({
            classListDir: paths.classListDir,
            learnerRegister: paths.learnerRegister,
            parentRegister: paths.parentRegister,
        }, auditHolder);
    }
    else {
        const { learners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(paths.classListDir);
        auditHolder.audit = (0, daSilvaMigrationService_1.buildDaSilvaLearnerParseAudit)(learners, learners, {
            classListParsed: learners.length,
            registerParsed: 0,
            mergedTotal: learners.length,
            enrichedFromRegister: 0,
            registerOnlySkipped: 0,
        });
    }
    const registerCount = pathExists(paths.parentRegister) && !parentRegisterIsHrStaff
        ? (0, sasamsParsers_1.parseSasamsParentRegister)(paths.parentRegister).length
        : 0;
    const linksCount = pathExists(paths.parentLearnerLinks)
        ? (0, sasamsParsers_1.parseSasamsParentLearnerLinks)(paths.parentLearnerLinks).length
        : 0;
    const combinedParents = pathExists(paths.parentRegister)
        ? (0, sasamsParsers_1.parseSasamsParentSources)(paths.parentRegister, paths.parentLearnerLinks)
        : [];
    const stagingLearners = (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)({
        classListDir: paths.classListDir,
        learnerRegister: paths.learnerRegister,
        parentRegister: paths.parentRegister,
    }).map((r) => ({
        id: r.matchKey,
        firstName: r.firstName,
        lastName: r.lastName,
        className: r.canonicalClassName,
        admissionNo: r.admissionNo,
        idNumber: r.idNumber,
    }));
    let unmatchedParentLinks = 0;
    let duplicateParentMatches = 0;
    if (combinedParents.length > 0) {
        if (stagingLearners.length === 0) {
            errors.push("No parsed learners available to match parent links");
        }
        else {
            const parentAudit = (0, daSilvaParentLearnerMatching_1.auditParentMatches)(combinedParents, stagingLearners);
            unmatchedParentLinks = parentAudit.unmatchedParents.length;
            duplicateParentMatches = parentAudit.duplicateMatches.length;
            if (duplicateParentMatches > 0) {
                errors.push(`${duplicateParentMatches} parent row(s) have ambiguous learner matches`);
            }
            if (unmatchedParentLinks > 0) {
                errors.push(`${unmatchedParentLinks} parent link row(s) could not be matched to learners`);
            }
        }
    }
    else if (!pathExists(paths.parentLearnerLinks)) {
        errors.push("No parent rows parsed — parent_learner_links file is required");
    }
    else {
        errors.push("No parent rows parsed from parent_learner_links");
    }
    const parentsDetected = new Set(combinedParents.map((p) => `${p.firstName}|${p.surname}|${p.cellNo}|${p.idNumber || ""}`)).size;
    const passed = errors.length === 0;
    return {
        passed,
        classListFiles: classroomCheck.classListFiles,
        learnersDetected: auditHolder.audit.mergedTotal,
        classroomsDetected: classroomCheck.classrooms,
        parentsDetected,
        parentLinksDetected: combinedParents.length,
        missingLearnerId: auditHolder.audit.missingId,
        missingDob: auditHolder.audit.missingDob,
        missingGender: auditHolder.audit.missingGender,
        unmatchedParentLinks,
        duplicateParentMatches,
        errors,
        learnerParseAudit: auditHolder.audit,
    };
}
async function assertSchoolReadyForSasamsImport(schoolId) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: schoolId },
        select: { id: true },
    });
    if (!school)
        throw new Error(`School not found: ${schoolId}`);
    if ((0, billingLedgerStore_1.readSchoolLedger)(schoolId).length > 0) {
        throw new Error("BLOCKED: billing ledger already has entries — SA-SAMS import is profile-only");
    }
    if (Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).length > 0) {
        throw new Error("BLOCKED: learner billing plans already exist — run Kid-e-Sys billing separately");
    }
}
async function auditImportedSchool(schoolId, dryRun) {
    const learners = await prisma_1.prisma.learner.findMany({
        where: { schoolId },
        select: {
            firstName: true,
            lastName: true,
            className: true,
            grade: true,
            gender: true,
            idNumber: true,
            birthDate: true,
            homeLanguage: true,
            citizenship: true,
        },
    });
    const parents = await prisma_1.prisma.parent.findMany({
        where: { schoolId },
        select: {
            firstName: true,
            surname: true,
            cellNo: true,
            email: true,
            idNumber: true,
            familyAccountId: true,
        },
    });
    const ledgerCount = (0, billingLedgerStore_1.readSchoolLedger)(schoolId).length;
    const planCount = Object.keys((0, learnerBillingPlanStore_1.readSchoolBillingPlans)(schoolId)).length;
    const familyAccounts = await prisma_1.prisma.familyAccount.count({ where: { schoolId } });
    const profilesPopulated = learners.length === dryRun.learnersDetected &&
        learners.every((l) => l.firstName && l.lastName && l.className && l.grade) &&
        learners.filter((l) => !l.gender).length === dryRun.missingGender &&
        learners.filter((l) => !l.birthDate).length === dryRun.missingDob &&
        learners.filter((l) => !l.idNumber).length === dryRun.missingLearnerId;
    const parentsPopulated = parents.length > 0 &&
        parents.every((p) => p.firstName && p.surname && p.cellNo) &&
        parents.every((p) => p.familyAccountId == null);
    const auditPass = dryRun.passed &&
        profilesPopulated &&
        parentsPopulated &&
        ledgerCount === 0 &&
        planCount === 0 &&
        familyAccounts === 0;
    return { profilesPopulated, parentsPopulated, auditPass };
}
async function importSasamsSchoolData(opts) {
    const dryRun = dryRunSasamsSchoolImport(opts.paths);
    if (opts.dryRunOnly) {
        return {
            learnersImported: 0,
            classroomsImported: 0,
            parentsImported: 0,
            parentLinksImported: 0,
            missingLearnerId: dryRun.missingLearnerId,
            missingDob: dryRun.missingDob,
            missingGender: dryRun.missingGender,
            dobWritten: 0,
            genderWritten: 0,
            idNumbersWritten: 0,
            homeLanguageWritten: 0,
            citizenshipWritten: 0,
            profilesPopulated: false,
            parentsPopulated: false,
            auditPass: dryRun.passed,
            dryRun,
        };
    }
    if (!dryRun.passed) {
        throw new Error(`SA-SAMS validation failed: ${dryRun.errors.join("; ")}`);
    }
    await assertSchoolReadyForSasamsImport(opts.schoolId);
    const existingLearners = await prisma_1.prisma.learner.count({ where: { schoolId: opts.schoolId } });
    const existingParents = await prisma_1.prisma.parent.count({ where: { schoolId: opts.schoolId } });
    if (!opts.allowExistingLearners && (existingLearners > 0 || existingParents > 0)) {
        throw new Error(`BLOCKED: school already has ${existingLearners} learner(s) and ${existingParents} parent(s). Run school-data-cleanup.ts --apply first.`);
    }
    const { classrooms } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(opts.paths.classListDir);
    const classroomRows = classrooms.map((c) => ({
        canonicalName: canonicalClassroomName(c.className),
    }));
    const seenClassrooms = new Set();
    for (const row of classroomRows) {
        if (seenClassrooms.has(row.canonicalName))
            continue;
        seenClassrooms.add(row.canonicalName);
        await prisma_1.prisma.classroom.upsert({
            where: { schoolId_name: { schoolId: opts.schoolId, name: row.canonicalName } },
            create: { schoolId: opts.schoolId, name: row.canonicalName },
            update: {},
        });
    }
    const classroomsImported = seenClassrooms.size;
    const dbClassroomNames = new Set((await prisma_1.prisma.classroom.findMany({
        where: { schoolId: opts.schoolId },
        select: { name: true },
    })).map((c) => c.name));
    const auditHolder = {
        audit: {
            classListParsed: 0,
            registerParsed: 0,
            mergedTotal: 0,
            enrichedFromRegister: 0,
            registerOnlySkipped: 0,
            missingDob: 0,
            missingGender: 0,
            missingId: 0,
            perClassroomCounts: [],
        },
    };
    const learnerRows = (0, daSilvaMigrationService_1.parseDaSilvaLearnersFromSasams)({
        classListDir: opts.paths.classListDir,
        learnerRegister: opts.paths.learnerRegister,
        parentRegister: opts.paths.parentRegister,
    }, auditHolder);
    const { learners: classListLearners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(opts.paths.classListDir);
    const registerLearners = (0, sasamsParsers_1.parseSasamsLearnerRegister)(opts.paths.learnerRegister);
    const mergedForDates = (0, sasamsParsers_1.mergeSasamsLearnerSources)(classListLearners, registerLearners, {
        classListParsed: classListLearners.length,
        registerParsed: registerLearners.length,
        mergedTotal: 0,
        enrichedFromRegister: 0,
        registerOnlySkipped: 0,
    });
    const admissionByMatchKey = new Map(mergedForDates.map((l) => [l.matchKey, l.admissionDate]));
    let fieldWrites = {
        dobWritten: 0,
        genderWritten: 0,
        idNumbersWritten: 0,
        homeLanguageWritten: 0,
        citizenshipWritten: 0,
    };
    for (const row of learnerRows) {
        if (!dbClassroomNames.has(row.canonicalClassName)) {
            throw new Error(`Classroom "${row.canonicalClassName}" missing after classroom import`);
        }
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(row.canonicalClassName);
        const notes = learnerNotesFromAdmissionDate(admissionByMatchKey.get(row.matchKey) ?? null);
        let learnerId = await findExistingLearnerId({
            schoolId: opts.schoolId,
            firstName: row.firstName,
            lastName: row.lastName,
            className: row.canonicalClassName,
            admissionNo: row.admissionNo,
        });
        const learnerData = {
            schoolId: opts.schoolId,
            firstName: row.firstName,
            lastName: row.lastName,
            grade: row.grade || norm.gradeLabel || "",
            className: row.canonicalClassName,
            notes,
            enrollmentStatus: "ACTIVE",
            totalFee: 0,
            tuitionFee: 0,
        };
        if (learnerId) {
            const existing = await prisma_1.prisma.learner.findUnique({
                where: { id: learnerId },
                select: {
                    admissionNo: true,
                    idNumber: true,
                    birthDate: true,
                    gender: true,
                    homeLanguage: true,
                    citizenship: true,
                },
            });
            const profileData = (0, sasamsLearnerProfileWrite_1.buildSasamsLearnerProfileWriteData)({
                admissionNo: row.admissionNo,
                idNumber: row.idNumber,
                birthDate: row.birthDate,
                gender: row.gender,
                homeLanguage: row.homeLanguage,
                citizenship: row.citizenship,
            }, existing || undefined);
            fieldWrites = (0, sasamsLearnerProfileWrite_1.mergeProfileWriteCounts)(fieldWrites, (0, sasamsLearnerProfileWrite_1.countProfileFieldsWritten)(profileData));
            await prisma_1.prisma.learner.update({
                where: { id: learnerId },
                data: { ...learnerData, ...profileData },
            });
        }
        else {
            const profileData = (0, sasamsLearnerProfileWrite_1.buildSasamsLearnerProfileWriteData)({
                admissionNo: row.admissionNo,
                idNumber: row.idNumber,
                birthDate: row.birthDate,
                gender: row.gender,
                homeLanguage: row.homeLanguage,
                citizenship: row.citizenship,
            });
            fieldWrites = (0, sasamsLearnerProfileWrite_1.mergeProfileWriteCounts)(fieldWrites, (0, sasamsLearnerProfileWrite_1.countProfileFieldsWritten)(profileData));
            const created = await prisma_1.prisma.learner.create({ data: { ...learnerData, ...profileData } });
            learnerId = created.id;
        }
    }
    const learnersImported = await prisma_1.prisma.learner.count({ where: { schoolId: opts.schoolId } });
    const dbLearners = await prisma_1.prisma.learner.findMany({
        where: { schoolId: opts.schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            className: true,
            admissionNo: true,
            idNumber: true,
        },
    });
    const learnersById = new Map(dbLearners.map((l) => [l.id, l]));
    const indexes = (0, daSilvaParentLearnerMatching_1.buildLearnerMatchIndexes)(dbLearners);
    const sasamsParents = (0, sasamsParsers_1.parseSasamsParentSources)(opts.paths.parentRegister, opts.paths.parentLearnerLinks);
    const parentIds = new Set();
    let parentLinksImported = 0;
    for (const parentRow of sasamsParents) {
        const match = (0, daSilvaParentLearnerMatching_1.matchParentToLearner)(parentRow, indexes, learnersById);
        if (!match.learnerId || match.ambiguous)
            continue;
        const parentId = await upsertSasamsParent(opts.schoolId, parentRow);
        parentIds.add(parentId);
        await prisma_1.prisma.parentLearnerLink.upsert({
            where: { parentId_learnerId: { parentId, learnerId: match.learnerId } },
            create: {
                schoolId: opts.schoolId,
                parentId,
                learnerId: match.learnerId,
                relation: parentRow.relation,
                isPrimary: true,
            },
            update: { relation: parentRow.relation },
        });
        parentLinksImported += 1;
    }
    const postAudit = await auditImportedSchool(opts.schoolId, dryRun);
    return {
        learnersImported,
        classroomsImported,
        parentsImported: parentIds.size,
        parentLinksImported,
        missingLearnerId: dryRun.missingLearnerId,
        missingDob: dryRun.missingDob,
        missingGender: dryRun.missingGender,
        dobWritten: fieldWrites.dobWritten,
        genderWritten: fieldWrites.genderWritten,
        idNumbersWritten: fieldWrites.idNumbersWritten,
        homeLanguageWritten: fieldWrites.homeLanguageWritten,
        citizenshipWritten: fieldWrites.citizenshipWritten,
        profilesPopulated: postAudit.profilesPopulated,
        parentsPopulated: postAudit.parentsPopulated,
        auditPass: postAudit.auditPass,
        dryRun,
    };
}
async function upsertSasamsParent(schoolId, parentRow) {
    const digitsOnly = (value) => String(value || "").replace(/\D/g, "");
    const cleanedIdDigits = digitsOnly(parentRow.idNumber);
    const cleanedIdNumber = cleanedIdDigits.length >= 13 ? cleanedIdDigits.slice(0, 13) : null;
    const phone = (0, parentPortalService_1.normalizeSaPhone)(parentRow.cellNo || parentRow.homeNo || "");
    const cellNo = phone?.localCell || parentRow.cellNo || "0000000000";
    if (cleanedIdNumber) {
        const byId = await prisma_1.prisma.parent.findFirst({
            where: { schoolId, idNumber: cleanedIdNumber, familyAccountId: null },
            select: { id: true },
        });
        if (byId) {
            await prisma_1.prisma.parent.update({
                where: { id: byId.id },
                data: {
                    email: parentRow.email || undefined,
                    cellNo: cellNo && cellNo !== "0000000000" ? cellNo : undefined,
                    idNumber: cleanedIdNumber,
                    relationship: parentRow.relation,
                    workNo: parentRow.workNo || undefined,
                    homeNo: parentRow.homeNo || undefined,
                    outstandingAmount: 0,
                },
            });
            return byId.id;
        }
    }
    if (parentRow.email) {
        const byEmail = await prisma_1.prisma.parent.findFirst({
            where: { schoolId, email: parentRow.email, familyAccountId: null },
            select: { id: true },
        });
        if (byEmail) {
            await prisma_1.prisma.parent.update({
                where: { id: byEmail.id },
                data: {
                    idNumber: cleanedIdNumber || undefined,
                    cellNo: cellNo && cellNo !== "0000000000" ? cellNo : undefined,
                    relationship: parentRow.relation,
                    workNo: parentRow.workNo || undefined,
                    homeNo: parentRow.homeNo || undefined,
                    outstandingAmount: 0,
                },
            });
            return byEmail.id;
        }
    }
    const existingParent = await prisma_1.prisma.parent.findFirst({
        where: {
            schoolId,
            firstName: parentRow.firstName,
            surname: parentRow.surname,
            cellNo,
            familyAccountId: null,
        },
        select: { id: true },
    });
    if (existingParent) {
        await prisma_1.prisma.parent.update({
            where: { id: existingParent.id },
            data: {
                email: parentRow.email || null,
                idNumber: cleanedIdNumber,
                relationship: parentRow.relation,
                workNo: parentRow.workNo || null,
                homeNo: parentRow.homeNo || null,
                outstandingAmount: 0,
            },
        });
        return existingParent.id;
    }
    const created = await prisma_1.prisma.parent.create({
        data: {
            schoolId,
            familyAccountId: null,
            firstName: parentRow.firstName,
            surname: parentRow.surname,
            cellNo,
            email: parentRow.email || null,
            idNumber: cleanedIdNumber,
            relationship: parentRow.relation,
            workNo: parentRow.workNo || null,
            homeNo: parentRow.homeNo || null,
            outstandingAmount: 0,
        },
        select: { id: true },
    });
    return created.id;
}
