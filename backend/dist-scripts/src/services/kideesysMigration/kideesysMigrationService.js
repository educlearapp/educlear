"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createKideesysProjectId = void 0;
exports.saveKideesysPreview = saveKideesysPreview;
exports.loadKideesysPreview = loadKideesysPreview;
exports.validateKideesysPortalUploads = validateKideesysPortalUploads;
exports.getKideesysStagingSummary = getKideesysStagingSummary;
exports.approveKideesysImport = approveKideesysImport;
exports.applyKideesysImport = applyKideesysImport;
exports.loadKideesysPostImportReport = loadKideesysPostImportReport;
exports.purgeSchoolForKideesysReimport = purgeSchoolForKideesysReimport;
exports.rollbackKideesysImport = rollbackKideesysImport;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../../prisma");
const kideesysMigrationValidate_1 = require("../kideesysMigrationValidate");
const daSilvaMigrationService_1 = require("../daSilvaMigration/daSilvaMigrationService");
const kideesysBundleBuilder_1 = require("./kideesysBundleBuilder");
Object.defineProperty(exports, "createKideesysProjectId", { enumerable: true, get: function () { return kideesysBundleBuilder_1.createKideesysProjectId; } });
const kideesysBillingReconciliation_1 = require("./kideesysBillingReconciliation");
const STAGING_ROOT = path_1.default.join(process.cwd(), "uploads", "migration-staging");
function previewPath(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, `kideesys-${projectId}.preview.json`);
}
function reportPath(schoolId, projectId) {
    return path_1.default.join(STAGING_ROOT, schoolId, `kideesys-${projectId}.report.json`);
}
function ensureDir(dir) {
    if (!fs_1.default.existsSync(dir))
        fs_1.default.mkdirSync(dir, { recursive: true });
}
function copyUploadedFiles(schoolId, projectId, classified) {
    const uploadRoot = path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads");
    const classDir = path_1.default.join(uploadRoot, "05_class_list");
    fs_1.default.mkdirSync(classDir, { recursive: true });
    for (const f of classified.classListFiles) {
        fs_1.default.copyFileSync(f.path, path_1.default.join(classDir, f.originalname));
    }
    const singles = [
        [classified.contactList, "04_contact_list.xls"],
        [classified.employees, "06_employees.xls"],
        [classified.billingPlan, "03_billing_plan.xls"],
        [classified.ageAnalysis, "02_age_analysis.xls"],
        [classified.transactions, "01_transactions.xls"],
    ];
    for (const [file, destName] of singles) {
        const dest = path_1.default.join(uploadRoot, destName);
        fs_1.default.mkdirSync(path_1.default.dirname(dest), { recursive: true });
        fs_1.default.copyFileSync(file.path, dest);
    }
    return {
        classListDir: classDir,
        contactList: path_1.default.join(uploadRoot, "04_contact_list.xls"),
        employees: path_1.default.join(uploadRoot, "06_employees.xls"),
        billingPlan: path_1.default.join(uploadRoot, "03_billing_plan.xls"),
        ageAnalysis: path_1.default.join(uploadRoot, "02_age_analysis.xls"),
        transactions: path_1.default.join(uploadRoot, "01_transactions.xls"),
    };
}
function saveKideesysPreview(preview) {
    ensureDir(path_1.default.join(STAGING_ROOT, preview.schoolId));
    fs_1.default.writeFileSync(previewPath(preview.schoolId, preview.projectId), JSON.stringify(preview, null, 2));
}
function loadKideesysPreview(schoolId, projectId) {
    const file = previewPath(schoolId, projectId);
    if (!fs_1.default.existsSync(file))
        return null;
    return JSON.parse(fs_1.default.readFileSync(file, "utf8"));
}
async function validateKideesysPortalUploads(opts) {
    const school = await prisma_1.prisma.school.findUnique({
        where: { id: opts.schoolId },
        select: { id: true, name: true },
    });
    if (!school)
        throw new Error("School not found");
    const classified = (0, kideesysMigrationValidate_1.classifyKideesysUploadFiles)(opts.files);
    const missing = [];
    if (!classified.classListFiles.length)
        missing.push("05_class_list (Grade_*.xls)");
    if (!classified.contactList)
        missing.push("04_contact_list");
    if (!classified.employees)
        missing.push("06_employees");
    if (!classified.billingPlan)
        missing.push("03_billing_plan");
    if (!classified.ageAnalysis)
        missing.push("02_age_analysis");
    if (!classified.transactions)
        missing.push("01_transactions");
    if (missing.length) {
        throw new Error(`Missing Kid-e-Sys export file(s): ${missing.join("; ")}`);
    }
    const paths = copyUploadedFiles(opts.schoolId, opts.projectId, classified);
    const preview = (0, kideesysBundleBuilder_1.buildKideesysMigrationPreview)({
        schoolId: opts.schoolId,
        projectId: opts.projectId,
        paths,
    });
    await (0, daSilvaMigrationService_1.saveDaSilvaStaging)(preview.bundle);
    saveKideesysPreview(preview);
    return preview;
}
async function getKideesysStagingSummary(schoolId, projectId) {
    const preview = loadKideesysPreview(schoolId, projectId);
    if (preview)
        return preview;
    const bundle = (0, daSilvaMigrationService_1.loadDaSilvaStaging)(schoolId, projectId);
    if (!bundle)
        return null;
    return (0, kideesysBundleBuilder_1.buildKideesysMigrationPreview)({
        schoolId,
        projectId,
        paths: {
            classListDir: path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads", "05_class_list"),
            contactList: path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads", "04_contact_list.xls"),
            employees: path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads", "06_employees.xls"),
            billingPlan: path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads", "03_billing_plan.xls"),
            ageAnalysis: path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads", "02_age_analysis.xls"),
            transactions: path_1.default.join(STAGING_ROOT, schoolId, projectId, "uploads", "01_transactions.xls"),
        },
    });
}
async function approveKideesysImport(opts) {
    const preview = loadKideesysPreview(opts.schoolId, opts.projectId);
    if (!preview)
        throw new Error("Staging not found — upload and validate first");
    if (preview.confirmToken !== opts.confirmToken) {
        throw new Error("Confirm token mismatch — re-run validation");
    }
    if (!preview.canApply) {
        throw new Error("Cannot approve while blocking errors remain");
    }
    return { approved: true, preview };
}
async function applyKideesysImport(opts) {
    const approved = await approveKideesysImport(opts);
    let result;
    try {
        result = await (0, daSilvaMigrationService_1.commitDaSilvaMigration)({
            schoolId: opts.schoolId,
            projectId: opts.projectId,
            confirmToken: approved.preview.bundle.confirmToken,
        });
    }
    catch (e) {
        if (e instanceof kideesysBillingReconciliation_1.KideesysMigrationGateError) {
            const failedReport = {
                projectId: opts.projectId,
                schoolId: opts.schoolId,
                importedAt: new Date().toISOString(),
                imported: {},
                activeLearnersInDb: 0,
                historicalLearnersInDb: 0,
                reconciliation: approved.preview.bundle.reconciliation.totals,
                balanceVarianceCount: approved.preview.balanceValidation.varianceCount,
                billingHealth: e.audit,
                success: false,
            };
            ensureDir(path_1.default.join(STAGING_ROOT, opts.schoolId));
            fs_1.default.writeFileSync(reportPath(opts.schoolId, opts.projectId), JSON.stringify(failedReport, null, 2));
            throw new Error(e.message);
        }
        throw e;
    }
    const activeDb = await prisma_1.prisma.learner.count({
        where: { schoolId: opts.schoolId, enrollmentStatus: "ACTIVE" },
    });
    const historicalDb = await prisma_1.prisma.learner.count({
        where: { schoolId: opts.schoolId, enrollmentStatus: "HISTORICAL" },
    });
    const billingHealth = await (0, kideesysBillingReconciliation_1.auditKideesysMigrationHealth)(opts.schoolId, approved.preview.bundle);
    const report = {
        projectId: opts.projectId,
        schoolId: opts.schoolId,
        importedAt: new Date().toISOString(),
        imported: result.imported,
        activeLearnersInDb: activeDb,
        historicalLearnersInDb: historicalDb,
        reconciliation: approved.preview.bundle.reconciliation.totals,
        balanceVarianceCount: approved.preview.balanceValidation.varianceCount,
        billingHealth,
        success: true,
    };
    ensureDir(path_1.default.join(STAGING_ROOT, opts.schoolId));
    fs_1.default.writeFileSync(reportPath(opts.schoolId, opts.projectId), JSON.stringify(report, null, 2));
    return { success: true, imported: result.imported, report };
}
function loadKideesysPostImportReport(schoolId, projectId) {
    const file = reportPath(schoolId, projectId);
    if (!fs_1.default.existsSync(file))
        return null;
    return JSON.parse(fs_1.default.readFileSync(file, "utf8"));
}
async function purgeSchoolForKideesysReimport(schoolId) {
    const { purgeImportedSchoolData, clearJsonStoresForSchools } = await Promise.resolve().then(() => __importStar(require("../schoolImportPurge")));
    const prismaRemoved = await purgeImportedSchoolData(schoolId);
    const jsonStores = clearJsonStoresForSchools([schoolId]);
    const stagingDir = path_1.default.join(STAGING_ROOT, schoolId);
    let stagingCleared = false;
    if (fs_1.default.existsSync(stagingDir)) {
        fs_1.default.rmSync(stagingDir, { recursive: true, force: true });
        stagingCleared = true;
    }
    return { success: true, prismaRemoved, jsonStores, stagingCleared };
}
async function rollbackKideesysImport(opts) {
    return (0, daSilvaMigrationService_1.rollbackDaSilvaMigration)(opts);
}
