"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLearnerMatchKey = buildLearnerMatchKey;
exports.parseClassListFile = parseClassListFile;
exports.parseContactListFile = parseContactListFile;
exports.parseEmployeesFile = parseEmployeesFile;
exports.parseBillingPlanFile = parseBillingPlanFile;
exports.parseAgeAnalysisFile = parseAgeAnalysisFile;
exports.parseAgeAnalysisFileWithAudit = parseAgeAnalysisFileWithAudit;
exports.parseTransactionListFile = parseTransactionListFile;
exports.parseClassListDirectory = parseClassListDirectory;
exports.sheetPreview = sheetPreview;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const classroomNormalization_1 = require("../../utils/classroomNormalization");
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const ageAnalysisParser_1 = require("./ageAnalysisParser");
function canonicalClassMatchKey(className) {
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(className);
    return norm.matchKey || (0, kideesysSpreadsheet_1.normalizeMatchText)(className);
}
function buildLearnerMatchKey(fullName, className) {
    return `${(0, kideesysSpreadsheet_1.normalizeMatchText)(fullName)}|${canonicalClassMatchKey(className)}`;
}
function rowText(row, index) {
    return String(row[index] ?? "").trim();
}
function isClassSectionTitle(value) {
    const v = String(value || "").trim().replace(/\s+/g, " ");
    if (!v)
        return false;
    if (/total$/i.test(v))
        return false;
    if (/^\d+(\.\d+)?$/.test(v))
        return false;
    if (/^creche(\s+20\d{2})?$/i.test(v))
        return true;
    const withoutYear = v.replace(/\s+20\d{2}\s*$/i, "").trim();
    // Exclude fee descriptions like "GRADE 8" (no class stream letter).
    if (/^grade\s+\d{1,2}$/i.test(withoutYear))
        return false;
    return /^grade\b/i.test(withoutYear);
}
/** 05_class_list — one file per classroom. */
function parseClassListFile(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const sourceFile = path_1.default.basename(filePath);
    let className = "";
    let year = null;
    const learners = [];
    for (const row of sheet.rows) {
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        if (!className && isClassSectionTitle(c0)) {
            const parsed = (0, kideesysSpreadsheet_1.parseClassTitle)(c0);
            className = parsed.className;
            year = parsed.year;
            continue;
        }
        if (!className && isClassSectionTitle(c1)) {
            const parsed = (0, kideesysSpreadsheet_1.parseClassTitle)(c1);
            className = parsed.className;
            year = parsed.year;
            continue;
        }
        if (!className || !c1)
            continue;
        if (!(0, kideesysSpreadsheet_1.isNumericIndexCell)(c0))
            continue;
        const fullName = c1;
        const { firstName, lastName } = (0, kideesysSpreadsheet_1.splitFullName)(fullName);
        learners.push({
            fullName,
            firstName,
            lastName,
            className,
            matchKey: buildLearnerMatchKey(fullName, className),
            sourceFile,
        });
    }
    if (!className) {
        const stem = sourceFile.replace(/\.xls$/i, "").replace(/_/g, " ");
        const parsed = (0, kideesysSpreadsheet_1.parseClassTitle)(stem);
        className = parsed.className;
        year = parsed.year;
    }
    return {
        classroom: { className, year, sourceFile },
        learners,
    };
}
function parseParentHeader(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return null;
    const m = raw.match(/^(Father|Mother|Guardian|Step\s*Father|Step\s*Mother)\s*-\s*(.+)$/i);
    if (!m)
        return null;
    const relation = m[1].trim();
    const namePart = m[2].trim();
    const namePieces = namePart.split(/\s+/).filter(Boolean);
    const firstName = namePieces[0] || relation;
    const surname = namePieces.length > 1 ? namePieces.slice(1).join(" ") : namePart;
    return {
        relation,
        displayName: namePart,
        firstName,
        surname,
        cellNo: "",
        workNo: "",
        homeNo: "",
        email: "",
    };
}
/** 04_contact_list — learner blocks with two parent columns. */
function parseContactListFile(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const rows = sheet.rows;
    let className = "";
    const classByRow = rows.map((row) => {
        const c0 = rowText(row, 0);
        if (isClassSectionTitle(c0)) {
            className = (0, kideesysSpreadsheet_1.parseClassTitle)(c0).className;
        }
        return className;
    });
    const results = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        const c2 = rowText(row, 2);
        const c3 = rowText(row, 3);
        if (!c0 || c1 !== "Cell No")
            continue;
        const learnerClass = classByRow[i];
        if (!learnerClass)
            continue;
        const parents = [];
        for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
            const prev = rows[j];
            const p2 = parseParentHeader(rowText(prev, 2));
            const p3 = parseParentHeader(rowText(prev, 3));
            if (p2 || p3) {
                if (p2)
                    parents.unshift(p2);
                if (p3)
                    parents.unshift(p3);
                break;
            }
            if (rowText(prev, 1) === "Cell No" && rowText(prev, 0))
                break;
        }
        if (parents[0])
            parents[0].cellNo = c2;
        if (parents[1])
            parents[1].cellNo = c3;
        for (let j = i + 1; j < Math.min(rows.length, i + 5); j++) {
            const next = rows[j];
            const n1 = rowText(next, 1);
            const n2 = rowText(next, 2);
            const n3 = rowText(next, 3);
            if (n1 === "Work No") {
                if (parents[0])
                    parents[0].workNo = n2;
                if (parents[1])
                    parents[1].workNo = n3;
            }
            if (n1 === "Home No") {
                if (parents[0])
                    parents[0].homeNo = n2;
                if (parents[1])
                    parents[1].homeNo = n3;
            }
            if (n1 === "Email") {
                if (parents[0])
                    parents[0].email = n2;
                if (parents[1])
                    parents[1].email = n3;
            }
        }
        const { firstName, lastName } = (0, kideesysSpreadsheet_1.splitFullName)(c0);
        results.push({
            fullName: c0,
            firstName,
            lastName,
            className: learnerClass,
            matchKey: buildLearnerMatchKey(c0, learnerClass),
            parents: parents.filter((p) => p.firstName || p.surname),
        });
    }
    return results;
}
/** 06_employees */
function parseEmployeesFile(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const employees = [];
    let current = null;
    for (const row of sheet.rows) {
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        const c3 = rowText(row, 3);
        const c4 = rowText(row, 4);
        if (c0 && c0 === c0.toUpperCase() && c0.length > 3 && !/^\d+$/.test(c0)) {
            if (current)
                employees.push(current);
            const { firstName, lastName } = (0, kideesysSpreadsheet_1.splitFullName)(c0
                .toLowerCase()
                .replace(/\b\w/g, (ch) => ch.toUpperCase()));
            current = {
                fullName: c0,
                firstName,
                lastName,
                mobileNumber: "",
                physicalAddress: "",
                email: "",
            };
            if (/^\d{9,}$/.test(c1.replace(/\s/g, ""))) {
                current.mobileNumber = c1;
            }
            if (c3)
                current.physicalAddress = c3;
            if (c4 && c4.includes("@"))
                current.email = c4;
            continue;
        }
        if (current && /^\d{9,}$/.test(c1.replace(/\s/g, "")) && !current.mobileNumber) {
            current.mobileNumber = c1;
        }
    }
    if (current)
        employees.push(current);
    return employees;
}
/** 03_billing_plan_summary_by_child */
function parseBillingPlanFile(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    let className = "";
    let lastLearnerName = "";
    const items = [];
    const pushItem = (fullName, feeDescription, amount) => {
        if (!fullName || !className || !amount)
            return;
        items.push({
            fullName,
            className,
            matchKey: buildLearnerMatchKey(fullName, className),
            feeDescription,
            amount,
        });
    };
    for (const row of sheet.rows) {
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        const c2 = rowText(row, 2);
        const c3 = rowText(row, 3);
        if (isClassSectionTitle(c0)) {
            className = (0, kideesysSpreadsheet_1.parseClassTitle)(c0).className;
            lastLearnerName = "";
            continue;
        }
        if (!className)
            continue;
        if ((0, kideesysSpreadsheet_1.isNumericIndexCell)(c0) && c1) {
            if (/total$/i.test(c1))
                continue;
            lastLearnerName = c1;
            const amount = (0, kideesysSpreadsheet_1.parseAmount)(c3);
            if (c2 && amount)
                pushItem(c1, c2, amount);
            continue;
        }
        // Continuation fee rows (XML may omit empty leading cells so fee lands in c0 or c2).
        if (lastLearnerName) {
            const feeDesc = c2 || (c0 && !(0, kideesysSpreadsheet_1.isNumericIndexCell)(c0) ? c0 : "");
            const amount = (0, kideesysSpreadsheet_1.parseAmount)(c3 || (feeDesc === c0 ? c1 : ""));
            if (feeDesc && amount && !isClassSectionTitle(feeDesc)) {
                pushItem(lastLearnerName, feeDesc, amount);
            }
        }
    }
    return items;
}
/** 02_account_list_age_analysis */
function parseAgeAnalysisFile(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    return (0, ageAnalysisParser_1.parseAgeAnalysisSheet)(sheet).accounts;
}
function parseAgeAnalysisFileWithAudit(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    return (0, ageAnalysisParser_1.parseAgeAnalysisSheet)(sheet);
}
/** 01_transaction_list — Invoice and Payment sections. */
function parseTransactionListFile(filePath) {
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    let section = "";
    const transactions = [];
    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
        const row = sheet.rows[rowIndex];
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        const c2 = rowText(row, 2);
        const c3 = rowText(row, 3);
        const c4 = rowText(row, 4);
        const c5 = rowText(row, 5);
        const c6 = (0, kideesysSpreadsheet_1.parseAmount)(rowText(row, 6));
        if (c0 === "Invoice") {
            section = "invoice";
            continue;
        }
        if (c0 === "Payment") {
            section = "payment";
            continue;
        }
        if (!section || !(0, kideesysSpreadsheet_1.isNumericIndexCell)(c0))
            continue;
        if (!c1 || !c3)
            continue;
        const invMatch = c1.match(/^(Invoice|Payment)\s+(\d+)$/i);
        if (!invMatch)
            continue;
        const kind = invMatch[1].toLowerCase();
        const transactionNo = invMatch[2];
        const date = (0, kideesysSpreadsheet_1.parseKidEsysDate)(c2) || c2;
        const signedAmount = kind === "payment" && c6 > 0 ? -c6 : c6;
        const direction = kind === "invoice" ? "debit" : "credit";
        transactions.push({
            kind,
            reference: c1,
            transactionNo,
            date,
            accountNo: c3,
            fullName: c4,
            notes: c5,
            amount: Math.abs(c6),
            signedAmount,
            sourceFileRow: rowIndex + 1,
            direction,
        });
    }
    return transactions;
}
function parseClassListDirectory(dirPath) {
    const files = fs_1.default
        .readdirSync(dirPath)
        .filter((f) => f.toLowerCase().endsWith(".xls"))
        .map((f) => path_1.default.join(dirPath, f));
    const classrooms = [];
    const learners = [];
    for (const file of files) {
        const parsed = parseClassListFile(file);
        classrooms.push(parsed.classroom);
        learners.push(...parsed.learners);
    }
    return { classrooms, learners };
}
function sheetPreview(sheet, maxRows = 5) {
    return sheet.rows.slice(0, maxRows);
}
