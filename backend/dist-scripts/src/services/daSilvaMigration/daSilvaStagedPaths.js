"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DA_SILVA_CONTACT_LIST_MISSING_MESSAGE = void 0;
exports.daSilvaUploadRoot = daSilvaUploadRoot;
exports.resolveDaSilvaStagedPaths = resolveDaSilvaStagedPaths;
exports.isDaSilvaClassListUploadField = isDaSilvaClassListUploadField;
exports.isDaSilvaContactListUploadField = isDaSilvaContactListUploadField;
exports.pickDaSilvaContactListUpload = pickDaSilvaContactListUpload;
exports.saveDaSilvaContactListUpload = saveDaSilvaContactListUpload;
exports.requireDaSilvaStagedFile = requireDaSilvaStagedFile;
exports.saveDaSilvaClassListUploads = saveDaSilvaClassListUploads;
exports.readDaSilvaStagedUploadStatus = readDaSilvaStagedUploadStatus;
exports.assertDaSilvaStagedSlot = assertDaSilvaStagedSlot;
exports.ensureDaSilvaStagingDirs = ensureDaSilvaStagingDirs;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaUploadManifest_1 = require("./daSilvaUploadManifest");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
exports.DA_SILVA_CONTACT_LIST_MISSING_MESSAGE = "Kid-e-Sys contact list was not uploaded. Please upload 04 Contact List into the Contact List slot.";
const DA_SILVA_CONTACT_LIST_UPLOAD_FIELDS = new Set([
    "contactList",
    "contact_list",
    "contactListFile",
    "kidEsyContactList",
    "kideesysContactList",
]);
function daSilvaUploadRoot(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads");
}
function resolveDaSilvaStagedPaths(schoolId, projectId) {
    const root = daSilvaUploadRoot(schoolId, projectId);
    return {
        classListDir: path_1.default.join(root, "sasams", "class_lists"),
        learnerRegister: path_1.default.join(root, "sasams", "learner_register.xls"),
        parentLearnerLinks: path_1.default.join(root, "sasams", "parent_learner_links.xls"),
        parentRegister: path_1.default.join(root, "sasams", "parent_register.xls"),
        contactList: path_1.default.join(root, "kideesys", "contact_list.xls"),
        employeeContactList: path_1.default.join(root, "kideesys", "employee_contact_list.xls"),
        billingPlan: path_1.default.join(root, "kideesys", "billing_plan_summary.xls"),
        ageAnalysis: path_1.default.join(root, "kideesys", "age_analysis.xls"),
        transactions: path_1.default.join(root, "kideesys", "transaction_list.xls"),
    };
}
function isClassListSpreadsheetName(name) {
    return /\.xlsx?$/i.test(name);
}
/** SA-SAMS class-list multipart field names (DaSilvaMigrationPanel uses `classListFiles`). */
function isDaSilvaClassListUploadField(fieldName) {
    const field = fieldName.trim();
    if (field === "classListFiles" || field === "classListFile" || field === "classLists") {
        return true;
    }
    return /^classListFiles\[\d*\]$/i.test(field);
}
/** Kid-e-Sys contact list multipart field names (Da Silva upload wizard). */
function isDaSilvaContactListUploadField(fieldName) {
    return DA_SILVA_CONTACT_LIST_UPLOAD_FIELDS.has(fieldName.trim());
}
function isDaSilvaContactListOriginalName(originalName) {
    const name = String(originalName || "").trim().toLowerCase();
    if (!name)
        return false;
    if (name.includes("employee_contact") || name.includes("employee contact"))
        return false;
    if (name.includes("contact_list") || name.includes("04_contact"))
        return true;
    return name.includes("contact");
}
function pickDaSilvaContactListUpload(grouped, allFiles) {
    for (const field of DA_SILVA_CONTACT_LIST_UPLOAD_FIELDS) {
        const file = grouped[field]?.[0];
        if (file)
            return file;
    }
    for (const file of allFiles || []) {
        if (isDaSilvaContactListUploadField(String(file.fieldname || "")))
            return file;
        const original = String(file.originalname || file.filename || "");
        if (isDaSilvaContactListOriginalName(original))
            return file;
    }
    return undefined;
}
function saveDaSilvaContactListUpload(contactListPath, file) {
    fs_1.default.mkdirSync(path_1.default.dirname(contactListPath), { recursive: true });
    fs_1.default.copyFileSync(file.path, contactListPath);
}
/** Returns filePath when present on disk; otherwise throws with a friendly message (never raw ENOENT). */
function requireDaSilvaStagedFile(filePath, friendlyMessage) {
    if (!fs_1.default.existsSync(filePath)) {
        throw new Error(friendlyMessage);
    }
    return filePath;
}
function saveDaSilvaClassListUploads(classListDir, files) {
    fs_1.default.mkdirSync(classListDir, { recursive: true });
    const saved = [];
    for (const file of files) {
        const base = path_1.default.basename(String(file.originalname || file.filename || "").trim());
        if (!base || !isClassListSpreadsheetName(base))
            continue;
        const dest = path_1.default.join(classListDir, base);
        fs_1.default.copyFileSync(file.path, dest);
        saved.push(base);
    }
    return saved.sort((a, b) => a.localeCompare(b));
}
function readDaSilvaStagedUploadStatus(schoolId, projectId) {
    const paths = resolveDaSilvaStagedPaths(schoolId, projectId);
    let classListFiles = 0;
    if (fs_1.default.existsSync(paths.classListDir)) {
        classListFiles = fs_1.default
            .readdirSync(paths.classListDir)
            .filter((f) => isClassListSpreadsheetName(f)).length;
    }
    const manifestPath = (0, daSilvaUploadManifest_1.stagingUploadManifestPath)(schoolId, projectId);
    const manifest = (0, daSilvaUploadManifest_1.loadStagingUploadManifest)(schoolId, projectId);
    const gate = (0, daSilvaUploadManifest_1.assertDaSilvaMigrationManifestReady)(manifest);
    return {
        classListFiles,
        learnerRegister: fs_1.default.existsSync(paths.learnerRegister),
        parentLearnerLinks: fs_1.default.existsSync(paths.parentLearnerLinks),
        parentRegister: fs_1.default.existsSync(paths.parentRegister),
        contactList: fs_1.default.existsSync(paths.contactList),
        employeeContactList: fs_1.default.existsSync(paths.employeeContactList),
        billingPlan: fs_1.default.existsSync(paths.billingPlan),
        ageAnalysis: fs_1.default.existsSync(paths.ageAnalysis),
        transactions: fs_1.default.existsSync(paths.transactions),
        manifestPath: fs_1.default.existsSync(manifestPath) ? manifestPath : null,
        manifestReady: gate.ready,
        manifestErrors: gate.errors,
    };
}
function assertDaSilvaStagedSlot(schoolId, projectId, slot) {
    const status = readDaSilvaStagedUploadStatus(schoolId, projectId);
    if (slot === "classListFiles") {
        if (status.classListFiles < 1) {
            throw new Error("Upload SA-SAMS class list files first");
        }
        return;
    }
    if (slot === "manifestPath" || slot === "manifestReady" || slot === "manifestErrors") {
        if (!status.manifestReady) {
            throw new Error(status.manifestErrors.join("; ") || "Upload manifest is not ready");
        }
        return;
    }
    if (!status[slot]) {
        if (slot === "contactList") {
            throw new Error(exports.DA_SILVA_CONTACT_LIST_MISSING_MESSAGE);
        }
        const labels = {
            learnerRegister: "SA-SAMS learner_register.xls",
            parentLearnerLinks: "SA-SAMS parent_learner_links.xls",
            parentRegister: "SA-SAMS parent_register.xls",
            contactList: exports.DA_SILVA_CONTACT_LIST_MISSING_MESSAGE,
            employeeContactList: "Missing Kid-e-Sys Employee Contact List. Please upload 06 Employees into Employee Contact List slot.",
            billingPlan: "Kid-e-Sys billing plan summary",
            ageAnalysis: "Kid-e-Sys age analysis",
            transactions: "Kid-e-Sys transaction list",
        };
        throw new Error(`Missing staged upload: ${labels[slot]}`);
    }
}
function ensureDaSilvaStagingDirs(schoolId, projectId) {
    const paths = resolveDaSilvaStagedPaths(schoolId, projectId);
    fs_1.default.mkdirSync(paths.classListDir, { recursive: true });
    fs_1.default.mkdirSync(path_1.default.dirname(paths.learnerRegister), { recursive: true });
    fs_1.default.mkdirSync(path_1.default.dirname(paths.billingPlan), { recursive: true });
    return paths;
}
