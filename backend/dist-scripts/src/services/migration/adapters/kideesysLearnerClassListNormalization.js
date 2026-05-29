"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKidESysClassListTitleCell = isKidESysClassListTitleCell;
exports.isKidESysLearnerClassListLayout = isKidESysLearnerClassListLayout;
exports.normalizeKidESysLearnerClassListSheet = normalizeKidESysLearnerClassListSheet;
const kideesysSpreadsheet_1 = require("../../../utils/kideesysSpreadsheet");
function rowText(row, index) {
    return String(row[index] ?? "").trim();
}
/**
 * Kid-e-Sys per-class learner exports use a title row (e.g. "Grade 1A 2026") with no header row;
 * column A is a numeric index and column B holds learner full names.
 */
function isKidESysClassListTitleCell(value) {
    const v = String(value || "").trim().replace(/\s+/g, " ");
    if (!v)
        return false;
    if (/total$/i.test(v))
        return false;
    if (/^\d+(\.\d+)?$/.test(v))
        return false;
    const withoutYear = v.replace(/\s+20\d{2}\s*$/i, "").trim();
    if (/^creche(\s+20\d{2})?$/i.test(v))
        return true;
    if (/^reception(\s+20\d{2})?$/i.test(v))
        return true;
    if (/^rrr?(\s+20\d{2})?$/i.test(withoutYear))
        return true;
    if (/^pre[-\s]?school(\s+20\d{2})?$/i.test(withoutYear))
        return true;
    if (/^preschool(\s+20\d{2})?$/i.test(withoutYear))
        return true;
    // Exclude fee descriptions like "GRADE 8" (no class stream letter).
    if (/^grade\s+\d{1,2}$/i.test(withoutYear))
        return false;
    return /^grade\b/i.test(withoutYear);
}
function findClassListTitleRow(matrix) {
    const scanLimit = Math.min(matrix.length, 20);
    for (let i = 0; i < scanLimit; i++) {
        const row = matrix[i];
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        if (isKidESysClassListTitleCell(c0)) {
            return { rowIndex: i, classTitle: c0 };
        }
        if (isKidESysClassListTitleCell(c1)) {
            return { rowIndex: i, classTitle: c1 };
        }
        const nonEmpty = row.map((c) => String(c ?? "").trim()).filter(Boolean);
        if (nonEmpty.length === 1 && isKidESysClassListTitleCell(nonEmpty[0])) {
            return { rowIndex: i, classTitle: nonEmpty[0] };
        }
    }
    return null;
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
function countIndexedLearnerRows(matrix, afterRow) {
    let count = 0;
    for (let i = afterRow + 1; i < matrix.length; i++) {
        const row = matrix[i];
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        if (!c1 || !looksLikeLearnerName(c1))
            continue;
        if (!(0, kideesysSpreadsheet_1.isNumericIndexCell)(c0))
            continue;
        count++;
    }
    return count;
}
function isKidESysLearnerClassListLayout(matrix) {
    if (!matrix.length)
        return false;
    const title = findClassListTitleRow(matrix);
    if (!title)
        return false;
    return countIndexedLearnerRows(matrix, title.rowIndex) > 0;
}
/**
 * Normalize Kid-e-Sys class-list sheets to standard preview columns (fullName, classroom).
 * Returns null when the sheet does not match the class-list layout.
 */
function normalizeKidESysLearnerClassListSheet(matrix, fileName) {
    if (!matrix.length)
        return null;
    const titleInfo = findClassListTitleRow(matrix);
    if (!titleInfo)
        return null;
    const learnerRowCount = countIndexedLearnerRows(matrix, titleInfo.rowIndex);
    if (learnerRowCount === 0)
        return null;
    const { className } = (0, kideesysSpreadsheet_1.parseClassTitle)(titleInfo.classTitle);
    const classroom = className || titleInfo.classTitle;
    const rows = [];
    for (let i = titleInfo.rowIndex + 1; i < matrix.length; i++) {
        const row = matrix[i];
        const c0 = rowText(row, 0);
        const c1 = rowText(row, 1);
        if (!c1 || !looksLikeLearnerName(c1))
            continue;
        if (!(0, kideesysSpreadsheet_1.isNumericIndexCell)(c0))
            continue;
        rows.push({
            fullName: c1,
            classroom,
        });
    }
    if (rows.length === 0)
        return null;
    return {
        headers: ["fullName", "classroom"],
        rows,
        fileName,
    };
}
