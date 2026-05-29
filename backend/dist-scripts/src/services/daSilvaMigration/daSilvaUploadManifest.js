"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stagingUploadManifestPath = stagingUploadManifestPath;
exports.assertDaSilvaMigrationManifestReady = assertDaSilvaMigrationManifestReady;
exports.writeStagingUploadManifest = writeStagingUploadManifest;
exports.loadStagingUploadManifest = loadStagingUploadManifest;
exports.requireStagingUploadManifest = requireStagingUploadManifest;
exports.resolveManifestFilePath = resolveManifestFilePath;
exports.pathsFromStagingUploadManifest = pathsFromStagingUploadManifest;
exports.buildDaSilvaManifestDebugReport = buildDaSilvaManifestDebugReport;
exports.buildStagingUploadManifestFromDisk = buildStagingUploadManifestFromDisk;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaStagedPaths_1 = require("./daSilvaStagedPaths");
const MIN_CLASS_LIST_FILES = 20;
const SLOT_FRIENDLY = {
    "sasams.classLists": "SA-SAMS class list files (at least 20 .xls/.xlsx in class lists folder)",
    "sasams.learnerRegister": "SA-SAMS Learner Register — upload learner_register.xls",
    "sasams.parentLearnerLinks": "SA-SAMS Parent Learner Links — upload parent_learner_links.xls",
    "sasams.parentRegister": "SA-SAMS Parent Register — upload parent_register.xls",
    "kideesys.billingPlanSummary": "Kid-e-Sys Billing Plan Summary — upload billing plan summary",
    "kideesys.ageAnalysis": "Kid-e-Sys Age Analysis — upload account list / age analysis",
    "kideesys.transactionList": "Kid-e-Sys Transaction List — upload 01 Transaction List",
    "kideesys.contactList": "Missing Kid-e-Sys Contact List. Please upload 04 Contact List into Contact List slot.",
    "kideesys.employeeContactList": "Missing Kid-e-Sys Employee Contact List. Please upload 06 Employees into Employee Contact List slot.",
};
function stagingUploadManifestPath(schoolId, projectId) {
    return path_1.default.join((0, daSilvaStagedPaths_1.daSilvaUploadRoot)(schoolId, projectId), "manifest.json");
}
function isSpreadsheetName(name) {
    return /\.xlsx?$/i.test(name);
}
function fileStatOk(filePath) {
    if (!filePath || !fs_1.default.existsSync(filePath)) {
        return { exists: false, readable: false, size: 0 };
    }
    try {
        const stat = fs_1.default.statSync(filePath);
        if (!stat.isFile() || stat.size < 1) {
            return { exists: true, readable: false, size: stat.size };
        }
        fs_1.default.accessSync(filePath, fs_1.default.constants.R_OK);
        fs_1.default.readFileSync(filePath, { flag: "r" });
        return { exists: true, readable: true, size: stat.size };
    }
    catch {
        return { exists: true, readable: false, size: 0 };
    }
}
function checkFile(filePath, slotKey, errors) {
    const label = SLOT_FRIENDLY[slotKey] || slotKey;
    if (!filePath) {
        errors.push(label);
        return false;
    }
    const stat = fileStatOk(filePath);
    if (!stat.exists) {
        errors.push(label);
        return false;
    }
    if (!stat.readable) {
        errors.push(`${label} (file exists but is not readable)`);
        return false;
    }
    return true;
}
/** Strict gate: every required staged file must exist and be readable. Never throws ENOENT. */
function assertDaSilvaMigrationManifestReady(manifest) {
    const errors = [];
    if (!manifest) {
        return {
            ready: false,
            errors: ["Upload manifest not found. Upload all required files to staging first."],
        };
    }
    const classLists = (manifest.sasams?.classLists || []).filter(Boolean);
    if (classLists.length < MIN_CLASS_LIST_FILES) {
        errors.push(SLOT_FRIENDLY["sasams.classLists"] +
            ` (found ${classLists.length}, need at least ${MIN_CLASS_LIST_FILES})`);
    }
    else {
        let readableClassLists = 0;
        for (const filePath of classLists) {
            const stat = fileStatOk(filePath);
            if (stat.exists && stat.readable && isSpreadsheetName(path_1.default.basename(filePath))) {
                readableClassLists += 1;
            }
        }
        if (readableClassLists < MIN_CLASS_LIST_FILES) {
            errors.push(`${readableClassLists} of ${classLists.length} class list file(s) are readable spreadsheets (need ${MIN_CLASS_LIST_FILES})`);
        }
    }
    checkFile(manifest.sasams?.learnerRegister, "sasams.learnerRegister", errors);
    checkFile(manifest.sasams?.parentLearnerLinks, "sasams.parentLearnerLinks", errors);
    checkFile(manifest.sasams?.parentRegister, "sasams.parentRegister", errors);
    checkFile(manifest.kideesys?.billingPlanSummary, "kideesys.billingPlanSummary", errors);
    checkFile(manifest.kideesys?.ageAnalysis, "kideesys.ageAnalysis", errors);
    checkFile(manifest.kideesys?.transactionList, "kideesys.transactionList", errors);
    checkFile(manifest.kideesys?.contactList, "kideesys.contactList", errors);
    checkFile(manifest.kideesys?.employeeContactList, "kideesys.employeeContactList", errors);
    return { ready: errors.length === 0, errors };
}
function writeStagingUploadManifest(manifest) {
    const filePath = stagingUploadManifestPath(manifest.schoolId, manifest.projectId);
    fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
    fs_1.default.writeFileSync(filePath, JSON.stringify(manifest, null, 2), "utf8");
    return filePath;
}
function loadStagingUploadManifest(schoolId, projectId) {
    const filePath = stagingUploadManifestPath(schoolId, projectId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const raw = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
        return raw?.schoolId && raw?.projectId ? raw : null;
    }
    catch {
        return null;
    }
}
function requireStagingUploadManifest(schoolId, projectId) {
    const manifest = loadStagingUploadManifest(schoolId, projectId);
    const gate = assertDaSilvaMigrationManifestReady(manifest);
    if (!gate.ready) {
        throw new Error(gate.errors.join("; "));
    }
    return manifest;
}
/** Resolve manifest file paths to absolute paths under process.cwd() when relative. */
function resolveManifestFilePath(filePath) {
    if (!filePath)
        return filePath;
    if (path_1.default.isAbsolute(filePath))
        return filePath;
    return path_1.default.resolve(process.cwd(), filePath);
}
function pathsFromStagingUploadManifest(manifest) {
    const classListFiles = (manifest.sasams.classLists || []).map(resolveManifestFilePath);
    const classListDir = classListFiles.length > 0
        ? path_1.default.dirname(classListFiles[0])
        : path_1.default.join((0, daSilvaStagedPaths_1.daSilvaUploadRoot)(manifest.schoolId, manifest.projectId), "sasams", "class_lists");
    return {
        classListDir,
        classListFiles,
        learnerRegister: resolveManifestFilePath(manifest.sasams.learnerRegister),
        parentLearnerLinks: resolveManifestFilePath(manifest.sasams.parentLearnerLinks),
        parentRegister: resolveManifestFilePath(manifest.sasams.parentRegister),
        billingPlan: resolveManifestFilePath(manifest.kideesys.billingPlanSummary),
        ageAnalysis: resolveManifestFilePath(manifest.kideesys.ageAnalysis),
        transactions: resolveManifestFilePath(manifest.kideesys.transactionList),
        contactList: resolveManifestFilePath(manifest.kideesys.contactList),
        employeeContactList: resolveManifestFilePath(manifest.kideesys.employeeContactList),
    };
}
function buildDaSilvaManifestDebugReport(schoolId, projectId) {
    const manifestPath = stagingUploadManifestPath(schoolId, projectId);
    const manifestExists = fs_1.default.existsSync(manifestPath);
    const manifest = manifestExists ? loadStagingUploadManifest(schoolId, projectId) : null;
    const gate = assertDaSilvaMigrationManifestReady(manifest);
    const slotDefs = [
        { slot: "sasams.classLists", path: manifest?.sasams.classLists?.[0] ?? null },
        { slot: "sasams.learnerRegister", path: manifest?.sasams.learnerRegister ?? null },
        { slot: "sasams.parentLearnerLinks", path: manifest?.sasams.parentLearnerLinks ?? null },
        { slot: "sasams.parentRegister", path: manifest?.sasams.parentRegister ?? null },
        { slot: "kideesys.billingPlanSummary", path: manifest?.kideesys.billingPlanSummary ?? null },
        { slot: "kideesys.ageAnalysis", path: manifest?.kideesys.ageAnalysis ?? null },
        { slot: "kideesys.transactionList", path: manifest?.kideesys.transactionList ?? null },
        { slot: "kideesys.contactList", path: manifest?.kideesys.contactList ?? null },
        { slot: "kideesys.employeeContactList", path: manifest?.kideesys.employeeContactList ?? null },
    ];
    const classListPaths = (manifest?.sasams.classLists || []).map(resolveManifestFilePath);
    const classListFilenames = classListPaths.map((p) => path_1.default.basename(p));
    const slots = slotDefs.map(({ slot, path: filePath }) => {
        if (slot === "sasams.classLists") {
            const existing = classListPaths.filter((p) => fileStatOk(p).exists);
            const readable = classListPaths.filter((p) => fileStatOk(p).readable);
            return {
                slot,
                path: classListPaths[0] || null,
                exists: existing.length > 0,
                readable: readable.length >= MIN_CLASS_LIST_FILES,
                size: existing.reduce((sum, p) => sum + fileStatOk(p).size, 0),
                basename: classListFilenames.length > 0
                    ? `${classListFilenames.length} files (${readable.length} readable)`
                    : null,
            };
        }
        const resolved = filePath ? resolveManifestFilePath(filePath) : null;
        const stat = resolved ? fileStatOk(resolved) : { exists: false, readable: false, size: 0 };
        return {
            slot,
            path: resolved,
            exists: stat.exists,
            readable: stat.readable,
            size: stat.size,
            basename: resolved ? path_1.default.basename(resolved) : null,
        };
    });
    return {
        schoolId,
        projectId,
        manifestPath,
        manifestExists,
        manifestReady: gate.ready,
        manifestErrors: gate.errors,
        uploadedAt: manifest?.uploadedAt ?? null,
        classListsCount: classListPaths.length,
        classListFilenames,
        filesSavedCount: manifest?.filesSaved?.length ?? 0,
        slots,
    };
}
function buildStagingUploadManifestFromDisk(schoolId, projectId, filesSaved) {
    const root = (0, daSilvaStagedPaths_1.daSilvaUploadRoot)(schoolId, projectId);
    const classListDir = path_1.default.join(root, "sasams", "class_lists");
    const classLists = fs_1.default.existsSync(classListDir)
        ? fs_1.default
            .readdirSync(classListDir)
            .filter(isSpreadsheetName)
            .sort((a, b) => a.localeCompare(b))
            .map((name) => path_1.default.resolve(classListDir, name))
        : [];
    const abs = (rel) => path_1.default.resolve(root, rel);
    return {
        schoolId,
        projectId,
        uploadedAt: new Date().toISOString(),
        sasams: {
            classLists,
            learnerRegister: fs_1.default.existsSync(abs("sasams/learner_register.xls"))
                ? abs("sasams/learner_register.xls")
                : null,
            parentLearnerLinks: fs_1.default.existsSync(abs("sasams/parent_learner_links.xls"))
                ? abs("sasams/parent_learner_links.xls")
                : null,
            parentRegister: fs_1.default.existsSync(abs("sasams/parent_register.xls"))
                ? abs("sasams/parent_register.xls")
                : null,
        },
        kideesys: {
            billingPlanSummary: fs_1.default.existsSync(abs("kideesys/billing_plan_summary.xls"))
                ? abs("kideesys/billing_plan_summary.xls")
                : null,
            ageAnalysis: fs_1.default.existsSync(abs("kideesys/age_analysis.xls"))
                ? abs("kideesys/age_analysis.xls")
                : null,
            transactionList: fs_1.default.existsSync(abs("kideesys/transaction_list.xls"))
                ? abs("kideesys/transaction_list.xls")
                : null,
            contactList: fs_1.default.existsSync(abs("kideesys/contact_list.xls"))
                ? abs("kideesys/contact_list.xls")
                : null,
            employeeContactList: fs_1.default.existsSync(abs("kideesys/employee_contact_list.xls"))
                ? abs("kideesys/employee_contact_list.xls")
                : null,
        },
        filesSaved,
    };
}
