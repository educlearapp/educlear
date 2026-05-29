"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSasamsGenderIndex = buildSasamsGenderIndex;
exports.lookupSasamsGender = lookupSasamsGender;
exports.resolveLearnerGenderFromSources = resolveLearnerGenderFromSources;
exports.mergeKidESysChildIdManifests = mergeKidESysChildIdManifests;
exports.resolveChildIdToLearnerMap = resolveChildIdToLearnerMap;
exports.pickChildIdFromRow = pickChildIdFromRow;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const classroomNormalization_1 = require("../../../utils/classroomNormalization");
const learnerGender_1 = require("../../../utils/learnerGender");
const daSilvaMigrationStrategy_1 = require("../daSilvaMigrationStrategy");
const sasamsParsers_1 = require("../sasamsParsers");
const kideesysCsvParser_1 = require("./kideesysCsvParser");
function nameKey(firstName, lastName) {
    return `${String(firstName || "").trim().toLowerCase()}|${String(lastName || "").trim().toLowerCase()}`;
}
function normalizeIdKey(idNumber) {
    return String(idNumber || "").replace(/\D/g, "");
}
/** SA-SAMS class lists + learner register → gender lookup (child.csv has no gender column). */
function buildSasamsGenderIndex(desktopRoot) {
    const byIdNumber = new Map();
    const byNameKey = new Map();
    const ingest = (firstName, lastName, idNumber, genderRaw) => {
        const gender = (0, learnerGender_1.normalizeLearnerGender)(genderRaw);
        if (!gender)
            return;
        const idKey = normalizeIdKey(idNumber);
        if (idKey.length >= 10)
            byIdNumber.set(idKey, gender);
        const nk = nameKey(firstName, lastName);
        if (nk !== "|")
            byNameKey.set(nk, gender);
    };
    try {
        const paths = (0, daSilvaMigrationStrategy_1.resolveDaSilvaSasamsPaths)(desktopRoot);
        if (fs_1.default.existsSync(paths.classListDir)) {
            const { learners } = (0, sasamsParsers_1.parseSasamsClassListDirectory)(paths.classListDir);
            for (const l of learners) {
                ingest(l.firstName, l.lastName, l.idNumber, l.gender);
            }
        }
        if (fs_1.default.existsSync(paths.learnerRegister)) {
            const registerLearners = (0, sasamsParsers_1.parseSasamsLearnerRegister)(paths.learnerRegister);
            for (const l of registerLearners) {
                ingest(l.firstName, l.lastName, l.idNumber, l.gender);
            }
        }
    }
    catch {
        /* optional enrichment — CSV classification still runs */
    }
    return { byIdNumber, byNameKey };
}
function lookupSasamsGender(index, opts) {
    const idKey = normalizeIdKey(opts.idNumber);
    if (idKey.length >= 10) {
        const fromId = index.byIdNumber.get(idKey);
        if (fromId)
            return fromId;
    }
    return index.byNameKey.get(nameKey(opts.firstName, opts.lastName)) || null;
}
function resolveLearnerGenderFromSources(opts) {
    const preserved = (0, learnerGender_1.normalizeLearnerGender)(opts.existingGender);
    if (preserved)
        return preserved;
    if (opts.sasams && opts.firstName != null && opts.lastName != null) {
        const fromSasams = lookupSasamsGender(opts.sasams, {
            firstName: opts.firstName,
            lastName: opts.lastName,
            idNumber: opts.idNumber,
        });
        if (fromSasams)
            return fromSasams;
    }
    return (0, learnerGender_1.resolveLearnerGender)({ gender: null, idNumber: opts.idNumber });
}
function mergeKidESysChildIdManifests(schoolId) {
    const merged = {};
    const stagingRoot = path_1.default.join(process.cwd(), "uploads", "migration-staging", schoolId);
    if (!fs_1.default.existsSync(stagingRoot))
        return merged;
    for (const name of fs_1.default.readdirSync(stagingRoot)) {
        if (!name.endsWith(".manifest.json"))
            continue;
        try {
            const raw = JSON.parse(fs_1.default.readFileSync(path_1.default.join(stagingRoot, name), "utf8"));
            const map = (raw.childIdToLearnerId || {});
            for (const [childId, learnerId] of Object.entries(map)) {
                if (childId && learnerId)
                    merged[childId] = learnerId;
            }
        }
        catch {
            /* skip corrupt manifest */
        }
    }
    return merged;
}
function buildLearnerNameClassIndex(learners) {
    const byAdmission = new Map();
    const byNameClass = new Map();
    const byNameOnly = new Map();
    for (const l of learners) {
        const adm = String(l.admissionNo || "").trim();
        if (adm)
            byAdmission.set(adm, l.id);
        const base = adm.includes("-") ? adm.slice(0, adm.indexOf("-")) : adm;
        if (base)
            byAdmission.set(base, l.id);
        const nk = nameKey(l.firstName, l.lastName);
        const cls = String(l.className || "").trim().toLowerCase();
        if (nk !== "|") {
            byNameOnly.set(nk, l.id);
            if (cls)
                byNameClass.set(`${nk}|${cls}`, l.id);
        }
    }
    return { byAdmission, byNameClass, byNameOnly };
}
/**
 * Resolve every child.csv child_id to a DB learner id.
 * Uses merged manifests, then account_no/admission, then name+class, then name-only.
 */
async function resolveChildIdToLearnerMap(opts) {
    const { prisma, schoolId, bundle } = opts;
    const out = new Map(Object.entries(opts.manifestMap || {}));
    const dbLearners = await prisma.learner.findMany({
        where: { schoolId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            className: true,
            admissionNo: true,
        },
    });
    const index = buildLearnerNameClassIndex(dbLearners);
    for (const child of bundle.children) {
        const childId = String(child.childId || "").trim();
        if (!childId || out.has(childId))
            continue;
        const norm = (0, classroomNormalization_1.normalizeClassroomInput)(child.className);
        const className = norm.classroomName || child.className || "";
        const clsKey = className.trim().toLowerCase();
        const nk = nameKey(child.firstName, child.lastName);
        const byNc = index.byNameClass.get(`${nk}|${clsKey}`);
        if (byNc) {
            out.set(childId, byNc);
            continue;
        }
        const byName = index.byNameOnly.get(nk);
        if (byName)
            out.set(childId, byName);
    }
    return out;
}
function pickChildIdFromRow(row) {
    return (0, kideesysCsvParser_1.pickCsvField)(row, ["child_id", "id", "childid", "learner_id"]);
}
