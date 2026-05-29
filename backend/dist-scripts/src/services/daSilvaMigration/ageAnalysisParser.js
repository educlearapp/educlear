"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KIDEESYS_ACCOUNT_CODE_RE = void 0;
exports.isKidESysSourceAccountRef = isKidESysSourceAccountRef;
exports.indexAgeAnalysisAccountNames = indexAgeAnalysisAccountNames;
exports.parseAgeAnalysisSheet = parseAgeAnalysisSheet;
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const daSilvaMergedFamily_1 = require("./daSilvaMergedFamily");
function isKidESysSourceAccountRef(accountNo) {
    const ref = String(accountNo || "").trim();
    if (!ref || ref.startsWith("KID-MISSING-"))
        return false;
    return exports.KIDEESYS_ACCOUNT_CODE_RE.test(ref);
}
/** Map each learner name on an age-analysis row (including multi-line siblings) to accountNo. */
function indexAgeAnalysisAccountNames(accounts, target) {
    for (const account of accounts) {
        target.set((0, kideesysSpreadsheet_1.normalizeMatchText)(account.fullName), account.accountNo);
        const names = account.learnerNames?.length
            ? account.learnerNames
            : (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName);
        for (const name of names) {
            if (!name)
                continue;
            target.set((0, kideesysSpreadsheet_1.normalizeMatchText)(name), account.accountNo);
        }
    }
}
/** Kid-e-Sys debtor account codes (e.g. ALI002, RAM021). */
exports.KIDEESYS_ACCOUNT_CODE_RE = /^[A-Z]{2,5}\d{2,5}$/i;
function compactHeader(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
function rowText(row, index) {
    return String(row[index] ?? "").trim();
}
function isAccountCode(value) {
    return exports.KIDEESYS_ACCOUNT_CODE_RE.test(String(value || "").trim());
}
function normalizeAccountCode(value) {
    return String(value || "").trim().toUpperCase();
}
function looksLikeAmountCell(value) {
    const v = String(value ?? "").trim();
    if (!v)
        return false;
    return /^-?[\d,]+(\.\d+)?$/.test(v.replace(/,/g, ""));
}
function isSectionTitleRow(row) {
    const nonEmpty = row.map((c) => String(c ?? "").trim()).filter(Boolean);
    if (nonEmpty.length !== 1)
        return false;
    const cell = nonEmpty[0];
    if (cell === "Account")
        return false;
    if ((0, kideesysSpreadsheet_1.isNumericIndexCell)(cell))
        return false;
    if (isAccountCode(cell))
        return false;
    return true;
}
function isAgeAnalysisHeaderRow(row) {
    const compact = row.map((c) => compactHeader(c));
    const hasAccount = compact.some((c) => c === "account");
    const hasBalance = compact.some((c) => c === "balance");
    return hasAccount && hasBalance;
}
function findColumnIndex(row, matchers) {
    for (let i = 0; i < row.length; i++) {
        const key = compactHeader(row[i]);
        if (!key)
            continue;
        if (matchers.some((m) => key === m || key.startsWith(m)))
            return i;
    }
    return null;
}
function buildColumnMap(headerRow) {
    if (!isAgeAnalysisHeaderRow(headerRow))
        return null;
    const account = findColumnIndex(headerRow, ["account"]);
    const balance = findColumnIndex(headerRow, ["balance"]);
    if (account === null || balance === null)
        return null;
    let name = null;
    for (let i = account + 1; i < balance; i++) {
        const cell = rowText(headerRow, i);
        if (!cell) {
            name = i;
            break;
        }
        const key = compactHeader(cell);
        if (key.includes("name") || key.includes("child") || key.includes("learner")) {
            name = i;
            break;
        }
    }
    if (name === null) {
        for (let i = account + 1; i < balance; i++) {
            if (!rowText(headerRow, i)) {
                name = i;
                break;
            }
        }
    }
    if (name === null)
        name = account + 1;
    const current = findColumnIndex(headerRow, ["current"]);
    const d30 = findColumnIndex(headerRow, ["30days", "30"]);
    const d60 = findColumnIndex(headerRow, ["60days", "60"]);
    const d90 = findColumnIndex(headerRow, ["90days", "90"]);
    const d120 = findColumnIndex(headerRow, ["120days", "120"]);
    return {
        account,
        name,
        balance,
        current,
        d30,
        d60,
        d90,
        d120,
    };
}
function findAccountInRow(row, maxScan = 4) {
    for (let i = 0; i < Math.min(row.length, maxScan); i++) {
        const cell = rowText(row, i);
        if (!cell || (0, kideesysSpreadsheet_1.isNumericIndexCell)(cell))
            continue;
        if (isAccountCode(cell))
            return { index: i, value: normalizeAccountCode(cell) };
    }
    return null;
}
function inferColumnMapFromSampleRow(row) {
    const accountHit = findAccountInRow(row);
    if (!accountHit)
        return null;
    const account = accountHit.index;
    let name = account + 1;
    let balance = name + 1;
    while (balance < row.length && !looksLikeAmountCell(rowText(row, balance))) {
        if (balance === name && rowText(row, name) && !looksLikeAmountCell(rowText(row, name))) {
            balance += 1;
            continue;
        }
        if (!rowText(row, balance)) {
            balance += 1;
            continue;
        }
        if (!looksLikeAmountCell(rowText(row, balance))) {
            name = balance;
            balance += 1;
            continue;
        }
        break;
    }
    if (balance >= row.length || !looksLikeAmountCell(rowText(row, balance)))
        return null;
    const readAmountAt = (idx) => {
        if (idx === null || idx < 0 || idx >= row.length)
            return null;
        const v = rowText(row, idx);
        return looksLikeAmountCell(v) ? (0, kideesysSpreadsheet_1.parseAmount)(v) : null;
    };
    const amountCols = [];
    for (let i = balance; i < row.length; i++) {
        if (looksLikeAmountCell(rowText(row, i)))
            amountCols.push(i);
    }
    return {
        account,
        name,
        balance,
        current: amountCols[1] ?? null,
        d30: amountCols[2] ?? null,
        d60: amountCols[3] ?? null,
        d90: amountCols[4] ?? null,
        d120: amountCols[5] ?? null,
    };
}
function readAmount(row, idx) {
    if (idx === null || idx < 0)
        return 0;
    return (0, kideesysSpreadsheet_1.parseAmount)(rowText(row, idx));
}
function parseAccountDataRow(row, columnMap, section) {
    const accountHit = findAccountInRow(row);
    if (!accountHit)
        return null;
    const accountNo = accountHit.value;
    const fullName = rowText(row, columnMap.name);
    const balance = readAmount(row, columnMap.balance);
    return {
        accountNo,
        fullName,
        balance,
        section: section || "General",
        current: readAmount(row, columnMap.current),
        d30: readAmount(row, columnMap.d30),
        d60: readAmount(row, columnMap.d60),
        d90: readAmount(row, columnMap.d90),
        d120: readAmount(row, columnMap.d120),
        learnerNames: (0, daSilvaMergedFamily_1.splitMergedAccountNames)(fullName),
    };
}
function emptyAudit() {
    return {
        ageAnalysisRowsParsed: 0,
        accountNumbersParsed: 0,
        accountsWithMultipleLearners: 0,
        sectionLabels: [],
        headerRowIndex: null,
        accountColumnIndex: null,
        nameColumnIndex: null,
        balanceColumnIndex: null,
        agingColumnIndexes: {
            current: null,
            d30: null,
            d60: null,
            d90: null,
            d120: null,
        },
        sampleAccountNumbers: [],
    };
}
/**
 * Parse Kid-e-Sys Account List (Age Analysis) — authoritative billing identity source.
 * Handles index column or account-first layouts, section rows, and multi-line learner names.
 */
function parseAgeAnalysisSheet(sheet) {
    const audit = emptyAudit();
    const accounts = [];
    let section = "General";
    let columnMap = null;
    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
        const row = sheet.rows[rowIndex] || [];
        if (isSectionTitleRow(row)) {
            section = rowText(row, 0) || section;
            if (!audit.sectionLabels.includes(section))
                audit.sectionLabels.push(section);
            continue;
        }
        if (!audit.headerRowIndex && isAgeAnalysisHeaderRow(row)) {
            const headerMap = buildColumnMap(row);
            audit.headerRowIndex = rowIndex;
            if (headerMap) {
                audit.agingColumnIndexes = {
                    current: headerMap.current,
                    d30: headerMap.d30,
                    d60: headerMap.d60,
                    d90: headerMap.d90,
                    d120: headerMap.d120,
                };
            }
            continue;
        }
        const accountHit = findAccountInRow(row);
        if (!accountHit)
            continue;
        if (!columnMap) {
            columnMap = inferColumnMapFromSampleRow(row);
            if (columnMap) {
                audit.accountColumnIndex = columnMap.account;
                audit.nameColumnIndex = columnMap.name;
                audit.balanceColumnIndex = columnMap.balance;
                audit.agingColumnIndexes = {
                    current: columnMap.current,
                    d30: columnMap.d30,
                    d60: columnMap.d60,
                    d90: columnMap.d90,
                    d120: columnMap.d120,
                };
            }
        }
        if (!columnMap)
            continue;
        const parsed = parseAccountDataRow(row, columnMap, section);
        if (!parsed)
            continue;
        audit.ageAnalysisRowsParsed += 1;
        accounts.push(parsed);
    }
    const accountNos = new Set(accounts.map((a) => a.accountNo));
    audit.accountNumbersParsed = accountNos.size;
    audit.sampleAccountNumbers = [...accountNos].sort().slice(0, 25);
    audit.accountsWithMultipleLearners = accounts.filter((a) => (a.learnerNames?.length || (0, daSilvaMergedFamily_1.splitMergedAccountNames)(a.fullName).length) > 1).length;
    return { accounts, audit };
}
