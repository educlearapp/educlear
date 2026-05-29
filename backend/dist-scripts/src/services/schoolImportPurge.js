"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.purgeImportedSchoolData = purgeImportedSchoolData;
exports.clearJsonStoresForSchools = clearJsonStoresForSchools;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prisma_1 = require("../prisma");
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const JSON_STORE_FILES = [
    "billing-ledger.json",
    "learner-billing-plans.json",
    "kidesys-transaction-history.json",
    "user-access.json",
    "family-account-audit.json",
    "banking-imports.json",
    "communication-store.json",
    "legal-document-history.json",
];
/** Remove imported school operational data; keeps School row and users. */
async function purgeImportedSchoolData(schoolId) {
    const removed = {};
    const run = async (key, fn) => {
        const r = await fn();
        if (r.count)
            removed[key] = r.count;
    };
    await run("communicationRecipient", () => prisma_1.prisma.communicationRecipient.deleteMany({ where: { message: { schoolId } } }));
    await run("communicationLog", () => prisma_1.prisma.communicationLog.deleteMany({ where: { schoolId } }));
    await run("communicationMessage", () => prisma_1.prisma.communicationMessage.deleteMany({ where: { schoolId } }));
    await run("communicationCampaign", () => prisma_1.prisma.communicationCampaign.deleteMany({ where: { schoolId } }));
    await run("communicationTemplate", () => prisma_1.prisma.communicationTemplate.deleteMany({ where: { schoolId } }));
    await run("parentTeacherMessage", () => prisma_1.prisma.parentTeacherMessage.deleteMany({ where: { schoolId } }));
    await run("parentTeacherThread", () => prisma_1.prisma.parentTeacherThread.deleteMany({ where: { schoolId } }));
    await run("parentLearnerLink", () => prisma_1.prisma.parentLearnerLink.deleteMany({ where: { schoolId } }));
    await run("learnerIncident", () => prisma_1.prisma.learnerIncident.deleteMany({ where: { schoolId } }));
    await run("learnerResult", () => prisma_1.prisma.learnerResult.deleteMany({ where: { schoolId } }));
    await run("learnerReport", () => prisma_1.prisma.learnerReport.deleteMany({ where: { schoolId } }));
    await run("billingDepositAllocation", () => prisma_1.prisma.billingDepositAllocation.deleteMany({ where: { deposit: { schoolId } } }));
    await run("billingDepositHistoryEntry", () => prisma_1.prisma.billingDepositHistoryEntry.deleteMany({ where: { deposit: { schoolId } } }));
    await run("billingDeposit", () => prisma_1.prisma.billingDeposit.deleteMany({ where: { schoolId } }));
    await run("bankTransaction", () => prisma_1.prisma.bankTransaction.deleteMany({ where: { schoolId } }));
    await run("bankStatementImport", () => prisma_1.prisma.bankStatementImport.deleteMany({ where: { schoolId } }));
    await run("accountingJournalLine", () => prisma_1.prisma.accountingJournalLine.deleteMany({ where: { journal: { schoolId } } }));
    await run("accountingJournal", () => prisma_1.prisma.accountingJournal.deleteMany({ where: { schoolId } }));
    await run("supplierInvoicePayment", () => prisma_1.prisma.supplierInvoicePayment.deleteMany({ where: { invoice: { schoolId } } }));
    await run("supplierInvoiceLine", () => prisma_1.prisma.supplierInvoiceLine.deleteMany({ where: { invoice: { schoolId } } }));
    await run("supplierInvoice", () => prisma_1.prisma.supplierInvoice.deleteMany({ where: { schoolId } }));
    await run("supplier", () => prisma_1.prisma.supplier.deleteMany({ where: { schoolId } }));
    await run("expenseCategory", () => prisma_1.prisma.expenseCategory.deleteMany({ where: { schoolId } }));
    await run("payslip", () => prisma_1.prisma.payslip.deleteMany({ where: { schoolId } }));
    await run("payrollEmailLog", () => prisma_1.prisma.payrollEmailLog.deleteMany({ where: { schoolId } }));
    await run("payrollItem", () => prisma_1.prisma.payrollItem.deleteMany({
        where: { payrollRunEmployee: { payrollRun: { schoolId } } },
    }));
    await run("payrollRunEmployee", () => prisma_1.prisma.payrollRunEmployee.deleteMany({ where: { payrollRun: { schoolId } } }));
    await run("payrollRun", () => prisma_1.prisma.payrollRun.deleteMany({ where: { schoolId } }));
    await run("payrollSetting", () => prisma_1.prisma.payrollSetting.deleteMany({ where: { schoolId } }));
    await run("learner", () => prisma_1.prisma.learner.deleteMany({ where: { schoolId } }));
    await run("parentOnboarding", () => prisma_1.prisma.parentOnboarding.deleteMany({ where: { schoolId } }));
    await run("parentOutreachQueue", () => prisma_1.prisma.parentOutreachQueue.deleteMany({ where: { schoolId } }));
    await run("parentNotification", () => prisma_1.prisma.parentNotification.deleteMany({ where: { schoolId } }));
    await run("pushSubscription", () => prisma_1.prisma.pushSubscription.deleteMany({ where: { schoolId } }));
    await run("parent", () => prisma_1.prisma.parent.deleteMany({ where: { schoolId } }));
    await run("familyAccount", () => prisma_1.prisma.familyAccount.deleteMany({ where: { schoolId } }));
    await run("homeworkPost", () => prisma_1.prisma.homeworkPost.deleteMany({ where: { schoolId } }));
    await run("schoolNotice", () => prisma_1.prisma.schoolNotice.deleteMany({ where: { schoolId } }));
    await run("parentDocument", () => prisma_1.prisma.parentDocument.deleteMany({ where: { schoolId } }));
    await run("classroom", () => prisma_1.prisma.classroom.deleteMany({ where: { schoolId } }));
    await run("employee", () => prisma_1.prisma.employee.deleteMany({ where: { schoolId } }));
    await run("letter", () => prisma_1.prisma.letter.deleteMany({ where: { schoolId } }));
    await run("letterTemplate", () => prisma_1.prisma.letterTemplate.deleteMany({ where: { schoolId } }));
    await run("feeStructure", () => prisma_1.prisma.feeStructure.deleteMany({ where: { schoolId } }));
    await run("schoolFeeSetting", () => prisma_1.prisma.schoolFeeSetting.deleteMany({ where: { schoolId } }));
    await run("teacherPerformance", () => prisma_1.prisma.teacherPerformance.deleteMany({ where: { schoolId } }));
    await run("billingSettings", () => prisma_1.prisma.billingSettings.deleteMany({ where: { schoolId } }));
    await run("schoolEmailSettings", () => prisma_1.prisma.schoolEmailSettings.deleteMany({ where: { schoolId } }));
    await run("schoolCommunicationProfile", () => prisma_1.prisma.schoolCommunicationProfile.deleteMany({ where: { schoolId } }));
    return removed;
}
function clearJsonStoresForSchools(schoolIds) {
    const idSet = new Set(schoolIds);
    const applied = [];
    for (const file of JSON_STORE_FILES) {
        const filePath = path_1.default.join(DATA_DIR, file);
        if (!fs_1.default.existsSync(filePath))
            continue;
        const parsed = JSON.parse(fs_1.default.readFileSync(filePath, "utf8"));
        let changed = false;
        if (file === "billing-ledger.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({
                        file,
                        action: "removed",
                        detail: `${sid}: ${obj[sid].length} ledger entries`,
                    });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "learner-billing-plans.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({
                        file,
                        action: "removed",
                        detail: `${sid}: ${Object.keys(obj[sid]).length} learner plan(s)`,
                    });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "kidesys-transaction-history.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({
                        file,
                        action: "removed",
                        detail: `${sid}: ${obj[sid].length} history row(s)`,
                    });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "user-access.json" && parsed && typeof parsed === "object") {
            const store = parsed;
            const before = Object.keys(store.users).length;
            for (const [uid, meta] of Object.entries(store.users)) {
                if (idSet.has(String(meta.schoolId || "")))
                    delete store.users[uid];
            }
            const removed = before - Object.keys(store.users).length;
            if (removed) {
                applied.push({ file, action: "removed", detail: `${removed} user access record(s)` });
                fs_1.default.writeFileSync(filePath, JSON.stringify(store, null, 2), "utf8");
            }
            continue;
        }
        if (file === "family-account-audit.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj[sid]) {
                    applied.push({ file, action: "removed", detail: `${sid}: ${obj[sid].length} audit row(s)` });
                    delete obj[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "banking-imports.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            const before = obj.imports.length;
            obj.imports = obj.imports.filter((r) => !idSet.has(String(r.schoolId || "")));
            const removed = before - obj.imports.length;
            if (removed) {
                applied.push({ file, action: "filtered", detail: `${removed} import(s)` });
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            }
            continue;
        }
        if (file === "communication-store.json" && parsed && typeof parsed === "object") {
            const obj = parsed;
            for (const sid of schoolIds) {
                if (obj.schools[sid]) {
                    applied.push({ file, action: "removed", detail: sid });
                    delete obj.schools[sid];
                    changed = true;
                }
            }
            if (changed)
                fs_1.default.writeFileSync(filePath, JSON.stringify(obj, null, 2), "utf8");
            continue;
        }
        if (file === "legal-document-history.json" && Array.isArray(parsed)) {
            const arr = parsed;
            const before = arr.length;
            const next = arr.filter((r) => !idSet.has(String(r.schoolId || "")));
            const removed = before - next.length;
            if (removed) {
                applied.push({ file, action: "filtered", detail: `${removed} row(s)` });
                fs_1.default.writeFileSync(filePath, JSON.stringify(next, null, 2), "utf8");
            }
        }
    }
    return applied;
}
