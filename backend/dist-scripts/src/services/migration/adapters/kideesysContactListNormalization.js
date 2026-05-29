"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.correctKidESysContactListLeadingOPhone = correctKidESysContactListLeadingOPhone;
exports.isKidESysEmployeeContactExport = isKidESysEmployeeContactExport;
exports.isKidESysContactListExportFilename = isKidESysContactListExportFilename;
exports.isKidESysContactListLayout = isKidESysContactListLayout;
exports.normalizeKidESysContactListSheet = normalizeKidESysContactListSheet;
const kideesysSpreadsheet_1 = require("../../../utils/kideesysSpreadsheet");
const kideesysLearnerClassListNormalization_1 = require("./kideesysLearnerClassListNormalization");
const CONTACT_LIST_PHONE_FIELDS = ["Cell No", "Work No", "Home No"];
/**
 * Kid-e-Sys contact exports sometimes use capital O instead of leading 0 on mobiles.
 * Only the first character is corrected when the value is O + digits only.
 */
function correctKidESysContactListLeadingOPhone(raw) {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed)
        return { value: trimmed, corrected: false };
    const m = trimmed.match(/^O(\d+)$/);
    if (!m)
        return { value: trimmed, corrected: false };
    const to = `0${m[1]}`;
    return { value: to, corrected: true, from: trimmed, to };
}
function applyContactListPhoneCorrection(raw, field, rowNumber, state) {
    const result = correctKidESysContactListLeadingOPhone(raw);
    if (!result.corrected || !result.from || !result.to)
        return result.value;
    state.count += 1;
    if (!state.first) {
        state.first = { from: result.from, to: result.to, field, rowNumber };
    }
    return result.value;
}
const CONTACT_LIST_HEADERS = [
    "Learner Name",
    "Classroom",
    "Relationship",
    "Parent Name",
    "Cell No",
    "Work No",
    "Home No",
    "Email",
];
function rowText(row, index) {
    return String(row[index] ?? "").trim();
}
function filenameHaystack(filename) {
    const leaf = String(filename || "")
        .trim()
        .split(/[/\\]/)
        .pop();
    const base = String(leaf || "").replace(/\.[^.]+$/i, "");
    return `${base}${filename}`.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function isKidESysEmployeeContactExport(filename) {
    return filenameHaystack(filename).includes("employee");
}
function isKidESysContactListExportFilename(filename) {
    const haystack = filenameHaystack(filename);
    return haystack.includes("contactlist") && !haystack.includes("employee");
}
function parseParentHeaderCell(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return null;
    const m = raw.match(/^(Father|Mother|Guardian|Step\s*Father|Step\s*Mother)\s*-\s*(.+)$/i);
    if (!m)
        return null;
    return {
        relationship: m[1].trim(),
        parentName: m[2].trim(),
    };
}
function looksLikeLearnerName(value) {
    const v = String(value || "").trim();
    if (v.length < 2)
        return false;
    if (/^(cell|work|home)\s*no$/i.test(v))
        return false;
    if (/^(father|mother|guardian)\b/i.test(v))
        return false;
    if (/^\d+(\.\d+)?$/.test(v))
        return false;
    return /[a-z]/i.test(v);
}
function findLabelColumn(row, label) {
    for (let i = 0; i < row.length; i++) {
        if (rowText(row, i) === label)
            return i;
    }
    return null;
}
function parentHeaderColumns(row) {
    const cols = [];
    for (let i = 0; i < row.length; i++) {
        if (parseParentHeaderCell(rowText(row, i)))
            cols.push(i);
    }
    return cols;
}
function phoneValueColumns(row, labelCol) {
    const cols = [];
    for (let i = labelCol + 1; i < row.length; i++) {
        const v = rowText(row, i);
        if (v)
            cols.push(i);
    }
    return cols;
}
function detailValueColumns(row, labelCol, phoneCols) {
    const fromLabel = phoneValueColumns(row, labelCol);
    if (fromLabel.length >= phoneCols.length)
        return fromLabel.slice(0, phoneCols.length);
    const fromSparse = [];
    for (const col of phoneCols) {
        const v = rowText(row, col);
        if (v)
            fromSparse.push(col);
    }
    if (fromSparse.length > 0)
        return fromSparse;
    return fromLabel;
}
function countContactListBlocks(matrix) {
    let count = 0;
    for (const row of matrix) {
        const labelCol = findLabelColumn(row, "Cell No");
        if (labelCol === null)
            continue;
        const learnerCol = labelCol > 0 ? labelCol - 1 : 0;
        const learnerName = rowText(row, learnerCol);
        if (!looksLikeLearnerName(learnerName))
            continue;
        count += 1;
    }
    return count;
}
/** Kid-e-Sys contact_list.xls uses class title rows and parent blocks, not a flat header row. */
function isKidESysContactListLayout(matrix) {
    if (!matrix.length)
        return false;
    return countContactListBlocks(matrix) >= 1;
}
function resolveClassroomByRow(matrix) {
    let className = "";
    return matrix.map((row) => {
        const c0 = rowText(row, 0);
        if ((0, kideesysLearnerClassListNormalization_1.isKidESysClassListTitleCell)(c0)) {
            className = (0, kideesysSpreadsheet_1.parseClassTitle)(c0).className || c0;
        }
        return className;
    });
}
/**
 * Flatten Kid-e-Sys contact_list report blocks into tabular preview rows (one row per parent).
 */
function normalizeKidESysContactListSheet(matrix, fileName) {
    if (!matrix.length)
        return null;
    if (isKidESysEmployeeContactExport(fileName))
        return null;
    if (!isKidESysContactListLayout(matrix))
        return null;
    const classByRow = resolveClassroomByRow(matrix);
    const rows = [];
    const phoneCorrectionState = { first: null, count: 0 };
    let dataRowNumber = 0;
    for (let i = 0; i < matrix.length; i++) {
        const row = matrix[i];
        const cellLabelCol = findLabelColumn(row, "Cell No");
        if (cellLabelCol === null)
            continue;
        const learnerCol = cellLabelCol > 0 ? cellLabelCol - 1 : 0;
        const learnerName = rowText(row, learnerCol);
        if (!looksLikeLearnerName(learnerName))
            continue;
        const classroom = classByRow[i];
        if (!classroom)
            continue;
        const phoneCols = phoneValueColumns(row, cellLabelCol);
        const parents = [];
        for (let j = i - 1; j >= Math.max(0, i - 8); j--) {
            const headerCols = parentHeaderColumns(matrix[j] || []);
            if (headerCols.length === 0)
                continue;
            for (const col of headerCols) {
                const parsed = parseParentHeaderCell(rowText(matrix[j], col));
                if (parsed) {
                    parents.push({ ...parsed, cellNo: "", workNo: "", homeNo: "", email: "" });
                }
            }
            break;
        }
        for (let p = 0; p < parents.length && p < phoneCols.length; p++) {
            parents[p].cellNo = applyContactListPhoneCorrection(rowText(row, phoneCols[p]), "Cell No", dataRowNumber + 1, phoneCorrectionState);
        }
        for (let j = i + 1; j < Math.min(matrix.length, i + 6); j++) {
            const next = matrix[j];
            for (const label of ["Work No", "Home No", "Email"]) {
                const labelCol = findLabelColumn(next, label);
                if (labelCol === null)
                    continue;
                const valueCols = detailValueColumns(next, labelCol, phoneCols);
                for (let p = 0; p < parents.length && p < valueCols.length; p++) {
                    const value = rowText(next, valueCols[p]);
                    if (label === "Work No") {
                        parents[p].workNo = applyContactListPhoneCorrection(value, "Work No", dataRowNumber + 1, phoneCorrectionState);
                    }
                    if (label === "Home No") {
                        parents[p].homeNo = applyContactListPhoneCorrection(value, "Home No", dataRowNumber + 1, phoneCorrectionState);
                    }
                    if (label === "Email")
                        parents[p].email = value;
                }
            }
        }
        for (const parent of parents) {
            if (!parent.parentName && !parent.cellNo && !parent.email)
                continue;
            dataRowNumber += 1;
            rows.push({
                "Learner Name": learnerName,
                Classroom: classroom,
                Relationship: parent.relationship,
                "Parent Name": parent.parentName,
                "Cell No": parent.cellNo,
                "Work No": parent.workNo,
                "Home No": parent.homeNo,
                Email: parent.email,
            });
        }
    }
    if (rows.length === 0)
        return null;
    const parseIssues = [];
    if (phoneCorrectionState.first) {
        const { from, to, field, rowNumber } = phoneCorrectionState.first;
        const extra = phoneCorrectionState.count > 1
            ? ` (${phoneCorrectionState.count - 1} other contact-list phone(s) also corrected).`
            : "";
        parseIssues.push({
            severity: "info",
            field: "parentPhone",
            rowNumber,
            message: `Phone was auto-corrected from ${from} to ${to} (${field} on Kid-e-Sys contact list).${extra}`,
        });
    }
    return {
        headers: [...CONTACT_LIST_HEADERS],
        rows,
        fileName,
        parseIssues: parseIssues.length > 0 ? parseIssues : undefined,
    };
}
