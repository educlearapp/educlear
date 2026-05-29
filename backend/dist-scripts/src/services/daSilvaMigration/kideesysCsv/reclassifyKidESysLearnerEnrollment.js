"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reclassifyKidESysLearnerEnrollment = reclassifyKidESysLearnerEnrollment;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const classroomNormalization_1 = require("../../../utils/classroomNormalization");
const kideesysChildClassifier_1 = require("./kideesysChildClassifier");
const kideesysChildLearnerResolve_1 = require("./kideesysChildLearnerResolve");
const kideesysCsvParser_1 = require("./kideesysCsvParser");
/** One child_id → one learner; split siblings wrongly merged via account_no. */
async function splitSharedLearnersPerChildId(opts) {
    const learnerToChildIds = new Map();
    for (const [childId, learnerId] of opts.childIdToLearnerId) {
        const list = learnerToChildIds.get(learnerId) || [];
        list.push(childId);
        learnerToChildIds.set(learnerId, list);
    }
    let split = 0;
    for (const [, childIds] of learnerToChildIds) {
        if (childIds.length <= 1)
            continue;
        childIds.sort();
        for (let i = 1; i < childIds.length; i++) {
            const childId = childIds[i];
            const row = opts.childById.get(childId);
            if (!row)
                continue;
            opts.childIdToLearnerId.delete(childId);
            const newId = await ensureLearnerForChildRow({
                prisma: opts.prisma,
                schoolId: opts.schoolId,
                childId,
                row,
                childIdToLearnerId: opts.childIdToLearnerId,
                accountLearnerSeq: opts.accountLearnerSeq,
                dryRun: opts.dryRun,
            });
            if (newId && !newId.startsWith("dry-run-"))
                split += 1;
        }
    }
    return split;
}
function findLatestKidESysManifest(schoolId) {
    const stagingRoot = path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId);
    if (!fs_1.default.existsSync(stagingRoot))
        return null;
    const candidates = fs_1.default
        .readdirSync(stagingRoot)
        .filter((name) => name.startsWith("kideesys-csv-") && name.endsWith(".manifest.json"))
        .map((name) => ({
        name,
        mtime: fs_1.default.statSync(path_1.default.join(stagingRoot, name)).mtimeMs,
    }))
        .sort((a, b) => b.mtime - a.mtime);
    if (!candidates.length)
        return null;
    return JSON.parse(fs_1.default.readFileSync(path_1.default.join(stagingRoot, candidates[0].name), "utf8"));
}
function parseBirthDate(raw) {
    const v = String(raw || "").trim();
    if (!v)
        return null;
    const d = new Date(v.includes("/") ? v.replace(/\//g, "-") : v);
    return Number.isNaN(d.getTime()) ? null : d;
}
function seedAccountLearnerSeqFromExisting(existing) {
    const accountLearnerSeq = new Map();
    for (const row of existing) {
        const adm = String(row.admissionNo || "").trim();
        if (!adm)
            continue;
        const dash = adm.indexOf("-");
        if (dash === -1) {
            accountLearnerSeq.set(adm, Math.max(accountLearnerSeq.get(adm) || 0, 1));
            continue;
        }
        const base = adm.slice(0, dash);
        const seq = Number.parseInt(adm.slice(dash + 1), 10);
        if (base && Number.isFinite(seq)) {
            accountLearnerSeq.set(base, Math.max(accountLearnerSeq.get(base) || 0, seq));
        }
    }
    return accountLearnerSeq;
}
function allocateAdmissionNo(accountNo, seq) {
    const trimmed = String(accountNo || "").trim();
    if (!trimmed)
        return null;
    const next = (seq.get(trimmed) || 0) + 1;
    seq.set(trimmed, next);
    return next === 1 ? trimmed : `${trimmed}-${next}`;
}
async function ensureLearnerForChildRow(opts) {
    const existing = opts.childIdToLearnerId.get(opts.childId);
    if (existing)
        return existing;
    const firstName = (0, kideesysCsvParser_1.pickCsvField)(opts.row, ["child_name", "first_name", "firstname", "name"]);
    const lastName = (0, kideesysCsvParser_1.pickCsvField)(opts.row, [
        "child_surname",
        "last_name",
        "lastname",
        "surname",
        "family_name",
    ]);
    const accountNo = (0, kideesysCsvParser_1.pickCsvField)(opts.row, [
        "account_no",
        "account_number",
        "account_ref",
        "account_id",
        "billing_account",
        "account",
    ]) || null;
    const classification = (0, kideesysChildClassifier_1.classifyKidESysChildRow)(opts.row);
    const isHistorical = classification.enrollmentStatus === "HISTORICAL";
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(classification.hasValidClassroom ? classification.classroomRaw : "");
    const canonicalClassName = isHistorical
        ? null
        : norm.classroomName || classification.classroomRaw || null;
    const grade = isHistorical
        ? "Historical"
        : norm.gradeLabel ||
            classification.classroomRaw.replace(/[A-Za-z]+$/, "").trim() ||
            "Unknown";
    const idNumber = (0, kideesysCsvParser_1.pickCsvField)(opts.row, ["child_id_no", "id_number", "identity_number", "id_no", "sa_id"]) || null;
    const birthRaw = (0, kideesysCsvParser_1.pickCsvField)(opts.row, [
        "date_of_birth",
        "dob",
        "birth_date",
        "birthdate",
        "birthday",
    ]);
    const admissionNo = accountNo ? allocateAdmissionNo(accountNo, opts.accountLearnerSeq) : null;
    if (opts.dryRun) {
        const placeholder = `dry-run-${opts.childId}`;
        opts.childIdToLearnerId.set(opts.childId, placeholder);
        return placeholder;
    }
    const created = await opts.prisma.learner.create({
        data: {
            schoolId: opts.schoolId,
            firstName: firstName || "Unknown",
            lastName: lastName || "",
            birthDate: parseBirthDate(birthRaw),
            idNumber,
            grade,
            className: canonicalClassName,
            enrollmentStatus: classification.enrollmentStatus,
            admissionNo,
            totalFee: 0,
            tuitionFee: 0,
        },
        select: { id: true },
    });
    opts.childIdToLearnerId.set(opts.childId, created.id);
    return created.id;
}
async function applyCsvRowToLearner(opts) {
    const classification = (0, kideesysChildClassifier_1.classifyKidESysChildRow)(opts.row);
    const isHistorical = classification.enrollmentStatus === "HISTORICAL";
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(classification.hasValidClassroom ? classification.classroomRaw : "");
    const canonicalClassName = isHistorical
        ? null
        : norm.classroomName || classification.classroomRaw || null;
    const grade = isHistorical
        ? "Historical"
        : norm.gradeLabel ||
            classification.classroomRaw.replace(/[A-Za-z]+$/, "").trim() ||
            "Unknown";
    const firstName = (0, kideesysCsvParser_1.pickCsvField)(opts.row, ["child_name", "first_name", "firstname", "name"]);
    const lastName = (0, kideesysCsvParser_1.pickCsvField)(opts.row, [
        "child_surname",
        "last_name",
        "lastname",
        "surname",
        "family_name",
    ]);
    const idNumber = (0, kideesysCsvParser_1.pickCsvField)(opts.row, ["child_id_no", "id_number", "identity_number", "id_no", "sa_id"]) || null;
    const birthRaw = (0, kideesysCsvParser_1.pickCsvField)(opts.row, [
        "date_of_birth",
        "dob",
        "birth_date",
        "birthdate",
        "birthday",
    ]);
    const existing = await opts.prisma.learner.findUnique({
        where: { id: opts.learnerId },
        select: { gender: true, schoolId: true, firstName: true, lastName: true },
    });
    if (!existing || existing.schoolId !== opts.schoolId) {
        return { genderBackfilled: false };
    }
    const resolvedFirst = firstName || existing.firstName;
    const resolvedLast = lastName || existing.lastName;
    const gender = (0, kideesysChildLearnerResolve_1.resolveLearnerGenderFromSources)({
        existingGender: existing.gender,
        idNumber,
        firstName: resolvedFirst,
        lastName: resolvedLast,
        sasams: opts.sasams,
    });
    const data = {
        enrollmentStatus: classification.enrollmentStatus,
        className: canonicalClassName,
        grade,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        idNumber,
        birthDate: parseBirthDate(birthRaw),
    };
    const hadGender = Boolean(String(existing.gender || "").trim());
    if (gender) {
        data.gender = gender;
    }
    if (!opts.dryRun) {
        await opts.prisma.learner.update({ where: { id: opts.learnerId }, data });
    }
    return { genderBackfilled: Boolean(gender) && !hadGender };
}
async function reclassifyKidESysLearnerEnrollment(opts) {
    const { prisma, schoolId, sourcePath, dryRun = false } = opts;
    const bundle = (0, kideesysCsvParser_1.loadKidESysCsvBundle)(sourcePath);
    const sasamsRoot = opts.sasamsDesktopRoot || path_1.default.dirname(bundle.sourcePath) || sourcePath;
    const sasams = (0, kideesysChildLearnerResolve_1.buildSasamsGenderIndex)(sasamsRoot);
    const latestManifest = opts.manifest ?? findLatestKidESysManifest(schoolId);
    const mergedManifest = {
        ...(0, kideesysChildLearnerResolve_1.mergeKidESysChildIdManifests)(schoolId),
        ...(latestManifest?.childIdToLearnerId || {}),
    };
    const childIdToLearnerId = await (0, kideesysChildLearnerResolve_1.resolveChildIdToLearnerMap)({
        prisma,
        schoolId,
        bundle,
        manifestMap: mergedManifest,
    });
    const childFile = bundle.filesFound.child;
    const rawRows = (0, kideesysCsvParser_1.parseCsvFile)(childFile);
    const childById = new Map();
    for (const row of rawRows) {
        const childId = (0, kideesysChildLearnerResolve_1.pickChildIdFromRow)(row);
        if (childId)
            childById.set(childId, row);
    }
    const existingAdmissionRows = await prisma.learner.findMany({
        where: { schoolId, admissionNo: { not: null } },
        select: { admissionNo: true },
    });
    const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);
    const splitCount = await splitSharedLearnersPerChildId({
        prisma,
        schoolId,
        childIdToLearnerId,
        childById,
        accountLearnerSeq,
        dryRun,
    });
    let created = 0;
    let updated = 0;
    let genderBackfilled = 0;
    for (const [childId, row] of childById) {
        let learnerId = childIdToLearnerId.get(childId);
        if (!learnerId) {
            const newId = await ensureLearnerForChildRow({
                prisma,
                schoolId,
                childId,
                row,
                childIdToLearnerId,
                accountLearnerSeq,
                dryRun,
            });
            if (newId) {
                learnerId = newId;
                created += 1;
            }
        }
        if (!learnerId || learnerId.startsWith("dry-run-"))
            continue;
        const { genderBackfilled: gb } = await applyCsvRowToLearner({
            prisma,
            schoolId,
            learnerId,
            row,
            sasams,
            dryRun,
        });
        if (gb)
            genderBackfilled += 1;
        updated += 1;
    }
    if (!dryRun) {
        const stagingRoot = path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId);
        if (fs_1.default.existsSync(stagingRoot)) {
            for (const name of fs_1.default.readdirSync(stagingRoot)) {
                if (!name.startsWith("kideesys-csv-") || !name.endsWith(".manifest.json"))
                    continue;
                const manifestPath = path_1.default.join(stagingRoot, name);
                try {
                    const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf8"));
                    manifest.childIdToLearnerId = Object.fromEntries(childIdToLearnerId);
                    fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
                }
                catch {
                    /* non-fatal */
                }
            }
        }
    }
    const activeAfter = await prisma.learner.count({
        where: { schoolId, enrollmentStatus: "ACTIVE" },
    });
    const historicalAfter = await prisma.learner.count({
        where: { schoolId, enrollmentStatus: "HISTORICAL" },
    });
    return {
        schoolId,
        sourcePath,
        csvChildRows: rawRows.length,
        csvUniqueChildIds: childById.size,
        manifestMapped: Object.keys(mergedManifest).length,
        resolvedMapped: childIdToLearnerId.size,
        splitFromSharedLearner: splitCount,
        created,
        updated,
        activeAfter,
        historicalAfter,
        genderBackfilled,
        dryRun,
    };
}
