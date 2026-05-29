"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sasamsLearnersToParsedLearners = sasamsLearnersToParsedLearners;
exports.parseSasamsDateValue = parseSasamsDateValue;
exports.detectSasamsClassListHeaders = detectSasamsClassListHeaders;
exports.parseSasamsClassListDirectory = parseSasamsClassListDirectory;
exports.diagnoseSasamsClassListFile = diagnoseSasamsClassListFile;
exports.diagnoseSasamsClassListDirectory = diagnoseSasamsClassListDirectory;
exports.buildSasamsClassPlacementIndex = buildSasamsClassPlacementIndex;
exports.parseSasamsLearnerRegister = parseSasamsLearnerRegister;
exports.parseSasamsParentLearnerLinks = parseSasamsParentLearnerLinks;
exports.parseSasamsParentRegister = parseSasamsParentRegister;
exports.isSasamsHrStaffRegister = isSasamsHrStaffRegister;
exports.parseSasamsParentSources = parseSasamsParentSources;
exports.mergeSasamsLearnerSources = mergeSasamsLearnerSources;
exports.parseKidESysClassListDirectoryForParity = parseKidESysClassListDirectoryForParity;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const classroomNormalization_1 = require("../../utils/classroomNormalization");
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const sasamsNormalization_1 = require("../migration/adapters/sasamsNormalization");
const parsers_1 = require("./parsers");
const sasamsLearnerProfileWrite_1 = require("./sasamsLearnerProfileWrite");
const EXTRA_COLUMN_MAP = {
    dateofbirth: "dateOfBirth",
    dob: "dateOfBirth",
    birthdate: "dateOfBirth",
    language: "language",
    homelanguage: "language",
    citizenship: "citizenship",
    nationality: "citizenship",
    firstname: "firstName",
    surname: "lastName",
    lastname: "lastName",
    class: "sasamsClass",
    classplacement: "sasamsClass",
    classname: "sasamsClass",
    learnerfirstname: "firstName",
    learnersurname: "lastName",
    studentfirstname: "firstName",
    studentsurname: "lastName",
};
function compactKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}
function normalizeHeaderText(value) {
    return String(value || "")
        .replace(/[\r\n]+/g, " ")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}
function fuzzyIncludesAll(value, tokens) {
    const v = normalizeHeaderText(value);
    if (!v)
        return false;
    return tokens.every((t) => v.includes(t));
}
function mapHeaderColumn(header) {
    const key = compactKey(normalizeHeaderText(header));
    if (!key)
        return null;
    const extra = EXTRA_COLUMN_MAP[key];
    if (extra)
        return extra;
    return (0, sasamsNormalization_1.normalizeSASAMSColumn)(header);
}
function findHeaderRowIndex(sheet) {
    let best = -1;
    let bestScore = 0;
    for (let i = 0; i < Math.min(sheet.rows.length, 40); i++) {
        const row = sheet.rows[i] || [];
        let score = 0;
        for (const cell of row) {
            const mapped = mapSasamsSheetColumn(String(cell || ""));
            if (mapped)
                score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            best = i;
        }
    }
    return bestScore >= 2 ? best : -1;
}
/** SA-SAMS exports with Number | Accession | Surname | First Name | Birth Date on one row. */
function findSasamsCanonicalHeaderRow(sheet) {
    for (let i = 0; i < Math.min(sheet.rows.length, 25); i++) {
        const row = sheet.rows[i] || [];
        const keys = row.map((cell) => compactKey(normalizeHeaderText(String(cell ?? ""))));
        const hasAccession = keys.some((k) => k.includes("accession") || k === "accno" || (k.includes("acc") && k.includes("no")));
        const hasSurname = keys.some((k) => k.includes("surname"));
        const hasFirst = keys.some((k) => k.includes("firstname") || (k.includes("first") && k.includes("name")) || k === "names");
        const hasBirth = keys.some((k) => k.includes("birth") && k.includes("date"));
        if (hasAccession && hasSurname && hasFirst && hasBirth)
            return i;
    }
    return -1;
}
function firstSasamsDataRowIndex(sheet, headerRow) {
    for (let i = headerRow + 1; i < Math.min(sheet.rows.length, headerRow + 8); i++) {
        const row = sheet.rows[i] || [];
        const c0 = String(row[0] ?? "").trim();
        const c1 = String(row[1] ?? "").trim();
        const c2 = String(row[2] ?? "").trim();
        const c3 = String(row[3] ?? "").trim();
        if ((0, kideesysSpreadsheet_1.isNumericIndexCell)(c0) && (c2 || c3 || c1))
            return i;
        if (c2 && c3 && !/^learner/i.test(c2))
            return i;
    }
    return headerRow + 1;
}
function mapSasamsLearnerRegisterHeader(header) {
    const raw = String(header || "");
    const normalized = normalizeHeaderText(raw);
    if (!normalized)
        return null;
    // Prefer exact/known mappings first.
    const exact = mapHeaderColumn(raw);
    if (exact)
        return exact;
    // Fuzzy / partial matches for SA-SAMS learner register (rotated/merged/multiline headings).
    if (fuzzyIncludesAll(normalized, ["admission", "number"]) || fuzzyIncludesAll(normalized, ["admission", "no"])) {
        return "learnerNumber";
    }
    if (fuzzyIncludesAll(normalized, ["accession", "number"]) || fuzzyIncludesAll(normalized, ["accession", "no"])) {
        return "learnerNumber";
    }
    if (fuzzyIncludesAll(normalized, ["learner", "surname"]) || normalized === "surname" || fuzzyIncludesAll(normalized, ["surname"])) {
        return "lastName";
    }
    if (fuzzyIncludesAll(normalized, ["learner", "first", "name"]) || fuzzyIncludesAll(normalized, ["first", "name"])) {
        return "firstName";
    }
    if (normalized.includes("gender") || normalized === "sex")
        return "gender";
    if (normalized.includes("birth") && normalized.includes("date"))
        return "dateOfBirth";
    if (normalized === "dob" || normalized.includes(" d o b ") || normalized.endsWith(" dob") || normalized.startsWith("dob ")) {
        return "dateOfBirth";
    }
    if (fuzzyIncludesAll(normalized, ["id", "number"]) || normalized === "id no" || normalized === "id")
        return "idNumber";
    if (fuzzyIncludesAll(normalized, ["home", "language"]) || normalized.includes("language"))
        return "language";
    if (normalized.includes("citizenship") || normalized.includes("nationality"))
        return "citizenship";
    if (normalized === "grade" || normalized.includes("grade"))
        return "grade";
    if (fuzzyIncludesAll(normalized, ["date", "promoted"]) || normalized.includes("promoted"))
        return "datePromoted";
    return null;
}
function joinHeaderBandForColumn(rows, colIndex, startRow, endRow) {
    const parts = [];
    for (let r = startRow; r <= endRow; r++) {
        const row = rows[r] || [];
        const v = normalizeHeaderText(String(row[colIndex] ?? ""));
        if (v)
            parts.push(v);
    }
    // De-dup consecutive identical fragments after normalization.
    const deduped = [];
    for (const p of parts) {
        if (!deduped.length || deduped[deduped.length - 1] !== p)
            deduped.push(p);
    }
    return deduped.join(" ").trim();
}
function detectSasamsLearnerRegisterHeaders(sheet) {
    const maxScanRows = Math.min(sheet.rows.length, 15);
    const maxStart = Math.max(0, Math.min(10, maxScanRows - 1));
    let best = null;
    let bestScore = -1;
    // Determine a conservative column count for scanning.
    const maxCols = sheet.rows.slice(0, maxScanRows).reduce((m, r) => Math.max(m, (r || []).length), 0);
    const colsToScan = Math.min(Math.max(maxCols, 1), 200);
    for (let start = 0; start <= maxStart; start++) {
        const end = Math.min(maxScanRows - 1, start + 14);
        const headersByColumn = [];
        const mapped = [];
        let score = 0;
        for (let c = 0; c < colsToScan; c++) {
            const header = joinHeaderBandForColumn(sheet.rows, c, start, end);
            headersByColumn[c] = header;
            const mappedField = mapSasamsLearnerRegisterHeader(header);
            if (mappedField) {
                score += 1;
                mapped.push({ columnIndex: c, detectedHeader: header, detectedAs: mappedField });
            }
        }
        if (score > bestScore) {
            // Find the last row in the band that contributes any non-empty header text.
            let lastNonEmptyHeaderRow = start;
            for (let r = end; r >= start; r--) {
                const row = sheet.rows[r] || [];
                const anyNonEmpty = row.some((cell) => normalizeHeaderText(String(cell ?? "")));
                if (anyNonEmpty) {
                    lastNonEmptyHeaderRow = r;
                    break;
                }
            }
            bestScore = score;
            best = {
                headerStartRow: start,
                headerEndRow: end,
                dataStartRow: lastNonEmptyHeaderRow + 1,
                headersByColumn,
                mapped,
            };
        }
    }
    return (best ?? {
        headerStartRow: 0,
        headerEndRow: Math.min(0, sheet.rows.length - 1),
        dataStartRow: 1,
        headersByColumn: [],
        mapped: [],
    });
}
function buildColumnIndex(headers) {
    const index = {};
    headers.forEach((header, col) => {
        const field = mapHeaderColumn(header);
        if (field && index[field] === undefined)
            index[field] = col;
    });
    return index;
}
/** Map header using register fuzzy logic first, then legacy single-row headers. */
function mapSasamsSheetColumn(header) {
    const reg = mapSasamsLearnerRegisterHeader(header);
    if (reg && reg !== "datePromoted")
        return reg;
    return mapHeaderColumn(header);
}
function buildSasamsColumnIndex(headers) {
    const index = {};
    headers.forEach((header, col) => {
        const field = mapSasamsSheetColumn(header);
        if (field && index[field] === undefined)
            index[field] = col;
    });
    return index;
}
function singleRowHeaderLayout(sheet, headerIdx) {
    const headers = sheet.rows[headerIdx] || [];
    return {
        dataStartRow: headerIdx + 1,
        headers,
        mappedCount: headers.filter((h) => mapSasamsSheetColumn(String(h || ""))).length,
        headerStartRow: headerIdx,
        headerEndRow: headerIdx,
    };
}
function headerBandLooksMerged(detected) {
    const bandRowSpan = Math.max(0, detected.headerEndRow - detected.headerStartRow);
    if (bandRowSpan < 2)
        return false;
    return detected.headersByColumn.some((h) => {
        const text = String(h || "");
        return text.split(/\s+/).filter(Boolean).length > 12 || (text.match(/\n/g) || []).length > 1;
    });
}
function hasLearnerNameHeaderColumns(headers) {
    let hasFirst = false;
    let hasLast = false;
    for (const h of headers) {
        const mapped = mapSasamsSheetColumn(String(h || ""));
        if (mapped === "firstName")
            hasFirst = true;
        if (mapped === "lastName")
            hasLast = true;
    }
    return hasFirst && hasLast;
}
/** Rotated/multiline SA-SAMS header band detection shared by class lists and learner register. */
function resolveSasamsDataSheetLayout(sheet) {
    const canonicalHeaderIdx = findSasamsCanonicalHeaderRow(sheet);
    if (canonicalHeaderIdx >= 0) {
        const layout = singleRowHeaderLayout(sheet, canonicalHeaderIdx);
        return {
            ...layout,
            dataStartRow: firstSasamsDataRowIndex(sheet, canonicalHeaderIdx),
        };
    }
    const detected = detectSasamsLearnerRegisterHeaders(sheet);
    const legacyHeaderIdx = findHeaderRowIndex(sheet);
    if (legacyHeaderIdx >= 0) {
        const legacyLayout = singleRowHeaderLayout(sheet, legacyHeaderIdx);
        const bandMerged = headerBandLooksMerged(detected);
        const legacyHasNames = hasLearnerNameHeaderColumns(legacyLayout.headers);
        if (legacyHasNames &&
            legacyLayout.mappedCount >= 3 &&
            (bandMerged || legacyLayout.mappedCount >= detected.mapped.length)) {
            return legacyLayout;
        }
    }
    let dataStartRow = detected.dataStartRow;
    let headers = detected.headersByColumn;
    let mappedCount = detected.mapped.length;
    let headerStartRow = detected.headerStartRow;
    let headerEndRow = detected.headerEndRow;
    if (!headers.length || mappedCount < 2) {
        if (legacyHeaderIdx >= 0) {
            return singleRowHeaderLayout(sheet, legacyHeaderIdx);
        }
        if (detected.headersByColumn.length) {
            headers = detected.headersByColumn;
            dataStartRow = Math.max(1, dataStartRow);
            mappedCount = detected.mapped.length;
        }
        else {
            headers = sheet.rows[0] || [];
            dataStartRow = 1;
            headerStartRow = 0;
            headerEndRow = 0;
            mappedCount = 0;
        }
    }
    return { dataStartRow, headers, mappedCount, headerStartRow, headerEndRow };
}
function listSasamsClassListFilesInDir(classListDir) {
    if (!fs_1.default.existsSync(classListDir))
        return [];
    return fs_1.default
        .readdirSync(classListDir)
        .filter((f) => /\.xlsx?$/i.test(f))
        .sort((a, b) => a.localeCompare(b));
}
function mappedColumnsFromHeaders(headers) {
    const mappedColumns = [];
    headers.forEach((header, columnIndex) => {
        const mapped = mapSasamsSheetColumn(String(header || ""));
        if (mapped) {
            mappedColumns.push({
                columnIndex,
                header: String(header || "").trim(),
                mappedAs: mapped,
            });
        }
    });
    return mappedColumns;
}
function countLearnerRowsInSasamsTable(sheet, layout) {
    const col = buildSasamsColumnIndex(layout.headers);
    let learnerCount = 0;
    for (let i = layout.dataStartRow; i < sheet.rows.length; i++) {
        const row = sheet.rows[i] || [];
        const fullName = rowValue(row, col, "fullName");
        const firstName = rowValue(row, col, "firstName");
        const lastName = rowValue(row, col, "lastName");
        if (fullName || firstName || lastName)
            learnerCount += 1;
    }
    return learnerCount;
}
/** Convert SA-SAMS parsed learners to Kid-e-Sys-shaped rows for billing parity checks. */
function sasamsLearnersToParsedLearners(learners) {
    return learners.map((l) => ({
        matchKey: l.matchKey,
        fullName: l.fullName,
        firstName: l.firstName,
        lastName: l.lastName,
        className: l.canonicalClassName || l.className,
        sourceFile: l.sourceFile,
        idNumber: l.idNumber,
        admissionNo: l.admissionNo,
    }));
}
function rowValue(row, index, field) {
    const col = index[field];
    if (col === undefined)
        return "";
    return String(row[col] ?? "").trim();
}
/** Parse SA-SAMS birth dates like `2020/04/25 (06'01)` — date part only. */
function parseSasamsDateValue(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return null;
    const datePart = raw.split(/[\s(\[]/)[0]?.trim() || "";
    return (0, kideesysSpreadsheet_1.parseKidEsysDate)(datePart);
}
function parseKidEsysDateAsDate(value) {
    const iso = parseSasamsDateValue(value);
    if (!iso)
        return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}
function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
}
function classifyAccessionOrId(raw) {
    const digits = digitsOnly(raw);
    if (!digits)
        return { admissionNo: null, idNumber: null };
    if (digits.length >= 13)
        return { admissionNo: null, idNumber: digits };
    return { admissionNo: digits, idNumber: null };
}
function parseSasamsGradeClassLabel(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return "";
    const slash = raw.match(/grade\s*0*(\d{1,2})\s*\/\s*([0-9]{1,2}[A-Za-z])/i);
    if (slash) {
        const grade = String(Number.parseInt(slash[1], 10));
        const section = slash[2].replace(/^0+/, "").toUpperCase();
        const letter = section.replace(/^\d+/, "");
        const num = section.replace(/[A-Za-z]/g, "");
        if (letter)
            return `Grade ${grade}${letter}`;
        if (num)
            return `Grade ${grade}${num}`;
    }
    return normalizeSasamsClassroomNameFromClassValue(raw);
}
function normalizeSasamsClassroomNameFromClassValue(value) {
    const raw = String(value || "").trim();
    if (!raw)
        return "";
    // Normalize common prefixes and whitespace first.
    let v = raw.replace(/[\r\n]+/g, " ").trim();
    v = v.replace(/^grade\s+/i, "");
    v = v.replace(/\s+/g, "");
    // Accept "01A" -> "Grade 1A" (drop leading zeros)
    const numericSection = v.match(/^0*(\d{1,2})([A-Za-z])$/);
    if (numericSection) {
        const grade = String(Number.parseInt(numericSection[1], 10));
        const section = numericSection[2].toUpperCase();
        return `Grade ${grade}${section}`;
    }
    // Accept "1A" -> "Grade 1A"
    const numericPlain = v.match(/^(\d{1,2})([A-Za-z])$/);
    if (numericPlain) {
        const grade = String(Number.parseInt(numericPlain[1], 10));
        const section = numericPlain[2].toUpperCase();
        return `Grade ${grade}${section}`;
    }
    // Accept "RA" / "R A" / "Grade RA" -> "Grade Ra" (A/B lowercased only).
    const rSection = v.match(/^R([A-Za-z])$/i);
    if (rSection) {
        const section = rSection[1].toLowerCase();
        return `Grade R${section}`;
    }
    // Fallback to existing classroom normalization if value is already "Grade 1A" etc.
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(raw);
    return norm.classroomName || raw;
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
    if (/^grade\s+\d{1,2}$/i.test(withoutYear))
        return false;
    return /^grade\b/i.test(withoutYear);
}
function learnerFromParts(opts) {
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(opts.className);
    const canonicalClassName = norm.classroomName || opts.className;
    const fullName = `${opts.firstName} ${opts.lastName}`.trim();
    return {
        fullName,
        firstName: opts.firstName,
        lastName: opts.lastName,
        className: opts.className,
        canonicalClassName,
        grade: opts.grade || norm.gradeLabel || "",
        matchKey: (0, parsers_1.buildLearnerMatchKey)(fullName, canonicalClassName),
        admissionNo: opts.admissionNo,
        sasamsLearnerNo: opts.sasamsLearnerNo,
        idNumber: opts.idNumber,
        birthDate: opts.birthDate,
        gender: opts.gender,
        language: opts.language,
        citizenship: opts.citizenship,
        admissionDate: opts.admissionDate,
        sourceFile: opts.sourceFile,
    };
}
/** Scan class list exports for SA-SAMS / Kid-e-Sys learner column headers before import. */
function detectSasamsClassListHeaders(classListDir) {
    const files = [];
    const xlsFiles = listSasamsClassListFilesInDir(classListDir);
    if (!xlsFiles.length) {
        return { files, totalLearners: 0, expectedClassFiles: 0 };
    }
    for (const file of xlsFiles) {
        const filePath = path_1.default.join(classListDir, file);
        const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
        const layout = resolveSasamsDataSheetLayout(sheet);
        if (layout.mappedCount < 2) {
            files.push({ file, headerRow: -1, mappedColumns: [], learnerCount: 0 });
            continue;
        }
        const mappedColumns = mappedColumnsFromHeaders(layout.headers);
        const learnerCount = countLearnerRowsInSasamsTable(sheet, layout);
        files.push({
            file,
            headerRow: layout.dataStartRow,
            mappedColumns,
            learnerCount,
        });
    }
    return {
        files,
        totalLearners: files.reduce((s, f) => s + f.learnerCount, 0),
        expectedClassFiles: files.length,
    };
}
/** Parse SA-SAMS class list directory (header table or Kid-e-Sys-style section layout). */
function parseSasamsClassListDirectory(classListDir) {
    if (!fs_1.default.existsSync(classListDir)) {
        throw new Error(`SA-SAMS class list directory not found: ${classListDir}`);
    }
    const files = listSasamsClassListFilesInDir(classListDir);
    const learners = [];
    const classrooms = [];
    for (const file of files) {
        const filePath = path_1.default.join(classListDir, file);
        const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
        const layout = resolveSasamsDataSheetLayout(sheet);
        if (layout.mappedCount >= 2) {
            const col = buildSasamsColumnIndex(layout.headers);
            let className = "";
            for (let i = layout.dataStartRow; i < sheet.rows.length; i++) {
                const row = sheet.rows[i] || [];
                const fullName = rowValue(row, col, "fullName");
                const firstName = rowValue(row, col, "firstName") || (fullName ? (0, kideesysSpreadsheet_1.splitFullName)(fullName).firstName : "");
                const lastName = rowValue(row, col, "lastName") || (fullName ? (0, kideesysSpreadsheet_1.splitFullName)(fullName).lastName : "");
                if (!firstName && !lastName && !fullName)
                    continue;
                const rowClass = rowValue(row, col, "sasamsClass") ||
                    rowValue(row, col, "classroom") ||
                    rowValue(row, col, "grade");
                if (rowClass && isClassSectionTitle(rowClass)) {
                    className = normalizeSasamsClassroomNameFromClassValue(rowClass);
                    continue;
                }
                const normalizedFromRowClass = rowValue(row, col, "sasamsClass") ? normalizeSasamsClassroomNameFromClassValue(rowClass) : "";
                if (!className && normalizedFromRowClass)
                    className = normalizedFromRowClass;
                const effectiveClass = normalizedFromRowClass ||
                    normalizeSasamsClassroomNameFromClassValue(rowValue(row, col, "classroom")) ||
                    normalizeSasamsClassroomNameFromClassValue(className) ||
                    normalizeSasamsClassroomNameFromClassValue(path_1.default.basename(file).replace(/\.xls$/i, "").replace(/_/g, " "));
                const fn = firstName || (0, kideesysSpreadsheet_1.splitFullName)(fullName).firstName;
                const ln = lastName || (0, kideesysSpreadsheet_1.splitFullName)(fullName).lastName;
                if (!fn && !ln)
                    continue;
                learners.push(learnerFromParts({
                    firstName: fn,
                    lastName: ln,
                    className: effectiveClass,
                    grade: rowValue(row, col, "grade"),
                    admissionNo: rowValue(row, col, "learnerNumber") || null,
                    sasamsLearnerNo: rowValue(row, col, "learnerNumber") || null,
                    idNumber: rowValue(row, col, "idNumber") || null,
                    birthDate: parseKidEsysDateAsDate(rowValue(row, col, "dateOfBirth")),
                    gender: rowValue(row, col, "gender") || null,
                    language: rowValue(row, col, "language") || null,
                    citizenship: rowValue(row, col, "citizenship") || null,
                    admissionDate: parseKidEsysDateAsDate(rowValue(row, col, "admissionDate")),
                    sourceFile: file,
                }));
            }
            if (className)
                classrooms.push({ className, sourceFile: file });
            continue;
        }
        const legacy = (0, parsers_1.parseClassListFile)(filePath);
        classrooms.push({ className: legacy.classroom.className, sourceFile: file });
        for (const l of legacy.learners) {
            learners.push(learnerFromParts({
                firstName: l.firstName,
                lastName: l.lastName,
                className: l.className,
                grade: (0, classroomNormalization_1.normalizeClassroomInput)(l.className).gradeLabel || "",
                admissionNo: null,
                sasamsLearnerNo: null,
                idNumber: null,
                birthDate: null,
                gender: null,
                language: null,
                citizenship: null,
                admissionDate: null,
                sourceFile: file,
            }));
        }
    }
    return { classrooms, learners };
}
function diagnoseSasamsTableRows(sheet, layout, file) {
    const col = buildSasamsColumnIndex(layout.headers);
    const learners = [];
    const rejections = [];
    let className = "";
    for (let i = layout.dataStartRow; i < sheet.rows.length; i++) {
        const row = sheet.rows[i] || [];
        const snapshot = row.map((c) => String(c ?? ""));
        const sheetRow = i + 1;
        const fullName = rowValue(row, col, "fullName");
        const firstName = rowValue(row, col, "firstName") || (fullName ? (0, kideesysSpreadsheet_1.splitFullName)(fullName).firstName : "");
        const lastName = rowValue(row, col, "lastName") || (fullName ? (0, kideesysSpreadsheet_1.splitFullName)(fullName).lastName : "");
        if (!firstName && !lastName && !fullName) {
            rejections.push({ sheetRow, reason: "empty row (no fullName/firstName/lastName)", snapshot });
            continue;
        }
        const rowClass = rowValue(row, col, "sasamsClass") ||
            rowValue(row, col, "classroom") ||
            rowValue(row, col, "grade");
        if (rowClass && isClassSectionTitle(rowClass)) {
            className = normalizeSasamsClassroomNameFromClassValue(rowClass);
            rejections.push({
                sheetRow,
                reason: `class section title row: ${rowClass}`,
                snapshot,
            });
            continue;
        }
        const normalizedFromRowClass = rowValue(row, col, "sasamsClass") ? normalizeSasamsClassroomNameFromClassValue(rowClass) : "";
        if (!className && normalizedFromRowClass)
            className = normalizedFromRowClass;
        const fn = firstName || (0, kideesysSpreadsheet_1.splitFullName)(fullName).firstName;
        const ln = lastName || (0, kideesysSpreadsheet_1.splitFullName)(fullName).lastName;
        if (!fn && !ln) {
            rejections.push({
                sheetRow,
                reason: "name columns present but first/last name empty after split",
                snapshot,
            });
            continue;
        }
        const effectiveClass = normalizedFromRowClass ||
            normalizeSasamsClassroomNameFromClassValue(rowValue(row, col, "classroom")) ||
            normalizeSasamsClassroomNameFromClassValue(className) ||
            normalizeSasamsClassroomNameFromClassValue(path_1.default.basename(file).replace(/\.xls$/i, "").replace(/_/g, " "));
        learners.push(learnerFromParts({
            firstName: fn,
            lastName: ln,
            className: effectiveClass,
            grade: rowValue(row, col, "grade"),
            admissionNo: rowValue(row, col, "learnerNumber") || null,
            sasamsLearnerNo: rowValue(row, col, "learnerNumber") || null,
            idNumber: rowValue(row, col, "idNumber") || null,
            birthDate: parseKidEsysDateAsDate(rowValue(row, col, "dateOfBirth")),
            gender: rowValue(row, col, "gender") || null,
            language: rowValue(row, col, "language") || null,
            citizenship: rowValue(row, col, "citizenship") || null,
            admissionDate: parseKidEsysDateAsDate(rowValue(row, col, "admissionDate")),
            sourceFile: file,
        }));
    }
    return { learners, rejections };
}
function isLegacyClassSectionTitle(value) {
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
    if (/^grade\s+\d{1,2}$/i.test(withoutYear))
        return false;
    return /^grade\b/i.test(withoutYear);
}
function diagnoseLegacyClassListRows(filePath) {
    const legacy = (0, parsers_1.parseClassListFile)(filePath);
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const rejections = [];
    let className = "";
    for (let i = 0; i < sheet.rows.length; i++) {
        const row = sheet.rows[i] || [];
        const snapshot = row.map((c) => String(c ?? ""));
        const sheetRow = i + 1;
        const c0 = String(row[0] ?? "").trim();
        const c1 = String(row[1] ?? "").trim();
        if (!className && isLegacyClassSectionTitle(c0)) {
            className = (0, kideesysSpreadsheet_1.parseClassTitle)(c0).className;
            rejections.push({ sheetRow, reason: `legacy class section (col0): ${c0}`, snapshot });
            continue;
        }
        if (!className && isLegacyClassSectionTitle(c1)) {
            className = (0, kideesysSpreadsheet_1.parseClassTitle)(c1).className;
            rejections.push({ sheetRow, reason: `legacy class section (col1): ${c1}`, snapshot });
            continue;
        }
        if (!className) {
            rejections.push({ sheetRow, reason: "legacy: no classroom context yet", snapshot });
            continue;
        }
        if (!c1) {
            rejections.push({ sheetRow, reason: "legacy: missing name column (col1)", snapshot });
            continue;
        }
        if (!(0, kideesysSpreadsheet_1.isNumericIndexCell)(c0)) {
            rejections.push({ sheetRow, reason: `legacy: col0 is not numeric index (${c0 || "(empty)"})`, snapshot });
            continue;
        }
    }
    const learners = legacy.learners.map((l) => learnerFromParts({
        firstName: l.firstName,
        lastName: l.lastName,
        className: l.className,
        grade: (0, classroomNormalization_1.normalizeClassroomInput)(l.className).gradeLabel || "",
        admissionNo: null,
        sasamsLearnerNo: null,
        idNumber: null,
        birthDate: null,
        gender: null,
        language: null,
        citizenship: null,
        admissionDate: null,
        sourceFile: path_1.default.basename(filePath),
    }));
    return { learners, rejections };
}
/** Row-level diagnostic for one SA-SAMS class list file (same rules as parseSasamsClassListDirectory). */
function diagnoseSasamsClassListFile(filePath) {
    const filename = path_1.default.basename(filePath);
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const rawFirst20 = sheet.rows.slice(0, 20).map((row) => row.map((c) => String(c ?? "")));
    const layout = resolveSasamsDataSheetLayout(sheet);
    const mappedColumns = mappedColumnsFromHeaders(layout.headers);
    const detectedHeaderRow = layout.dataStartRow + 1;
    if (layout.mappedCount >= 2) {
        const { learners, rejections } = diagnoseSasamsTableRows(sheet, layout, filename);
        return {
            filename,
            filePath,
            rawFirst20,
            layout: {
                headerStartRow: layout.headerStartRow,
                headerEndRow: layout.headerEndRow,
                dataStartRow: layout.dataStartRow,
                mappedCount: layout.mappedCount,
                headers: layout.headers,
            },
            detectedHeaderRow,
            mappedColumns,
            parseMode: "sasams-table",
            parsedLearnerCount: learners.length,
            firstParsedLearners: learners.slice(0, 3),
            rejections,
        };
    }
    const { learners, rejections } = diagnoseLegacyClassListRows(filePath);
    return {
        filename,
        filePath,
        rawFirst20,
        layout: {
            headerStartRow: layout.headerStartRow,
            headerEndRow: layout.headerEndRow,
            dataStartRow: layout.dataStartRow,
            mappedCount: layout.mappedCount,
            headers: layout.headers,
        },
        detectedHeaderRow,
        mappedColumns,
        parseMode: "legacy-kideesys",
        parsedLearnerCount: learners.length,
        firstParsedLearners: learners.slice(0, 3),
        rejections,
    };
}
/** Directory diagnostic — same file set as parseSasamsClassListDirectory. */
function diagnoseSasamsClassListDirectory(classListDir) {
    if (!fs_1.default.existsSync(classListDir))
        return [];
    return listSasamsClassListFilesInDir(classListDir).map((file) => diagnoseSasamsClassListFile(path_1.default.join(classListDir, file)));
}
function placementNameKey(lastName, firstName) {
    return `${(0, kideesysSpreadsheet_1.normalizeMatchText)(lastName)}|${(0, kideesysSpreadsheet_1.normalizeMatchText)(firstName)}`;
}
/**
 * Build a placement index from SA-SAMS class list exports.
 * Matching priority is handled by callers: ID number → admission number → surname+first name.
 */
function buildSasamsClassPlacementIndex(classListDir) {
    const { learners } = parseSasamsClassListDirectory(classListDir);
    const byIdNumber = new Map();
    const byAdmissionNo = new Map();
    const bySurnameFirstName = new Map();
    const countsByClassroom = new Map();
    for (const learner of learners) {
        const classroomName = learner.canonicalClassName || (0, classroomNormalization_1.normalizeClassroomInput)(learner.className).classroomName || learner.className;
        if (!classroomName)
            continue;
        countsByClassroom.set(classroomName, (countsByClassroom.get(classroomName) || 0) + 1);
        const idKey = learner.idNumber ? (0, kideesysSpreadsheet_1.normalizeMatchText)(learner.idNumber) : "";
        const admKey = learner.admissionNo ? (0, kideesysSpreadsheet_1.normalizeMatchText)(learner.admissionNo) : "";
        const nameKey = placementNameKey(learner.lastName, learner.firstName);
        if (idKey && !byIdNumber.has(idKey))
            byIdNumber.set(idKey, classroomName);
        if (admKey && !byAdmissionNo.has(admKey))
            byAdmissionNo.set(admKey, classroomName);
        if (nameKey && !bySurnameFirstName.has(nameKey))
            bySurnameFirstName.set(nameKey, classroomName);
    }
    return {
        byIdNumber,
        byAdmissionNo,
        bySurnameFirstName,
        countsByClassroom,
        totalLearners: learners.length,
    };
}
/** Parse SA-SAMS master learner register (authoritative profile fields). */
function parseSasamsLearnerRegister(filePath) {
    if (!fs_1.default.existsSync(filePath)) {
        throw new Error(`SA-SAMS learner register not found: ${filePath}`);
    }
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const detected = detectSasamsLearnerRegisterHeaders(sheet);
    const layout = resolveSasamsDataSheetLayout(sheet);
    const dataStartRow = layout.dataStartRow;
    const headers = layout.headers;
    const col = buildSasamsColumnIndex(headers);
    const sourceFile = path_1.default.basename(filePath);
    const out = [];
    // Report detected learner register headers before import starts (used in scripts + validations).
    const mappedForLog = headers
        .map((h, idx) => {
        const mappedAs = mapSasamsLearnerRegisterHeader(h);
        if (!mappedAs)
            return null;
        return { idx, header: String(h || "").trim(), mappedAs };
    })
        .filter(Boolean);
    console.log(`\nSA-SAMS learner register header detection (${sourceFile}):`);
    console.log(`Header scan rows: ${detected.headerStartRow + 1}–${detected.headerEndRow + 1}; data starts at row ${dataStartRow + 1}`);
    if (!mappedForLog.length) {
        console.log("Detected headers: (none confidently mapped)");
    }
    else {
        for (const m of mappedForLog) {
            console.log(`  [col ${m.idx + 1}] ${m.mappedAs}: ${m.header || "(empty)"}`);
        }
    }
    for (let i = dataStartRow; i < sheet.rows.length; i++) {
        const row = sheet.rows[i] || [];
        const fullName = rowValue(row, col, "fullName");
        const firstName = rowValue(row, col, "firstName") || (fullName ? (0, kideesysSpreadsheet_1.splitFullName)(fullName).firstName : "");
        const lastName = rowValue(row, col, "lastName") || (fullName ? (0, kideesysSpreadsheet_1.splitFullName)(fullName).lastName : "");
        if (!firstName && !lastName)
            continue;
        const className = rowValue(row, col, "classroom") ||
            rowValue(row, col, "grade") ||
            "";
        out.push(learnerFromParts({
            firstName,
            lastName,
            className,
            grade: rowValue(row, col, "grade"),
            admissionNo: rowValue(row, col, "learnerNumber") || null,
            sasamsLearnerNo: rowValue(row, col, "learnerNumber") || null,
            idNumber: rowValue(row, col, "idNumber") || null,
            birthDate: parseKidEsysDateAsDate(rowValue(row, col, "dateOfBirth")),
            gender: rowValue(row, col, "gender") || null,
            language: rowValue(row, col, "language") || null,
            citizenship: rowValue(row, col, "citizenship") || null,
            admissionDate: parseKidEsysDateAsDate(rowValue(row, col, "admissionDate")),
            sourceFile,
        }));
    }
    return out;
}
function isArchivedFlag(value) {
    const v = String(value || "").trim().toLowerCase();
    return v === "yes" || v === "y" || v === "true" || v === "1" || v === "archived";
}
function findSasamsParentLearnerLinksHeaderRow(sheet) {
    for (let i = 0; i < Math.min(sheet.rows.length, 25); i++) {
        const row = sheet.rows[i] || [];
        const c0 = normalizeHeaderText(String(row[0] ?? ""));
        const c1 = normalizeHeaderText(String(row[1] ?? ""));
        const c4 = normalizeHeaderText(String(row[4] ?? ""));
        if (c0 === "surname" && (c1 === "names" || c1.includes("name")) && c4 === "surname") {
            return i;
        }
    }
    return -1;
}
/** parent_learner_links.xls — learner block cols 0–3, parent cols 4–9; continuation rows reuse learner context. */
function parseSasamsParentLearnerLinks(filePath) {
    if (!fs_1.default.existsSync(filePath)) {
        throw new Error(`SA-SAMS parent learner links not found: ${filePath}`);
    }
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const headerIdx = findSasamsParentLearnerLinksHeaderRow(sheet);
    if (headerIdx < 0) {
        throw new Error(`Could not detect parent_learner_links headers in ${filePath}`);
    }
    const sourceFile = path_1.default.basename(filePath);
    const headerRow = (sheet.rows[headerIdx] || []).map((c) => normalizeHeaderText(String(c ?? "")));
    const parentIdCol = headerRow.findIndex((h) => (h.includes("id") && h.includes("number")) ||
        h === "id no" ||
        h === "id number" ||
        h === "identity number" ||
        h === "parent id" ||
        h === "id");
    const parentHomeCol = headerRow.findIndex((h) => h.includes("home") && h.includes("tel"));
    const parentWorkCol = headerRow.findIndex((h) => h.includes("work") && (h.includes("tel") || h.includes("phone")));
    const parentCellCol = headerRow.findIndex((h) => h.includes("cell") || h.includes("mobile"));
    const parentEmailCol = headerRow.findIndex((h) => h.includes("email") || h.includes("e-mail"));
    const out = [];
    let ctx = null;
    for (let i = headerIdx + 1; i < sheet.rows.length; i++) {
        const row = sheet.rows[i] || [];
        const learnerSurname = String(row[0] ?? "").trim();
        const learnerNames = String(row[1] ?? "").trim();
        const accRaw = String(row[2] ?? "").trim();
        const gradeClass = String(row[3] ?? "").trim();
        const parentSurname = String(row[4] ?? "").trim();
        const parentName = String(row[5] ?? "").trim();
        if (learnerSurname && learnerNames) {
            const nameParts = learnerNames.split(/\s+/).filter(Boolean);
            const learnerFirstName = nameParts[0] || learnerNames;
            const { admissionNo, idNumber } = classifyAccessionOrId(accRaw);
            ctx = {
                learnerLastName: learnerSurname,
                learnerFirstName,
                learnerAdmissionNo: admissionNo,
                learnerIdNumber: idNumber,
                learnerClassName: parseSasamsGradeClassLabel(gradeClass) || gradeClass || null,
            };
        }
        if (!parentSurname && !parentName)
            continue;
        if (!ctx && !learnerSurname)
            continue;
        const active = ctx || {
            learnerLastName: learnerSurname,
            learnerFirstName: learnerNames.split(/\s+/)[0] || learnerNames,
            learnerAdmissionNo: classifyAccessionOrId(accRaw).admissionNo,
            learnerIdNumber: classifyAccessionOrId(accRaw).idNumber,
            learnerClassName: parseSasamsGradeClassLabel(gradeClass) || gradeClass || null,
        };
        const parentFirst = parentName.split(/\s+/)[0] || parentName || "Parent";
        const parentLast = parentSurname || parentName || "Unknown";
        const detectedIdValue = parentIdCol >= 0 ? String(row[parentIdCol] ?? "").trim() : "";
        const detectedIdDigits = digitsOnly(detectedIdValue);
        const resolvedParentIdNumber = detectedIdDigits.length >= 6 ? detectedIdDigits : null;
        out.push({
            firstName: parentFirst,
            surname: parentLast,
            relation: "Guardian",
            cellNo: parentCellCol >= 0 ? String(row[parentCellCol] ?? "").trim() : String(row[8] ?? "").trim(),
            workNo: parentWorkCol >= 0 ? String(row[parentWorkCol] ?? "").trim() : String(row[7] ?? "").trim(),
            homeNo: parentHomeCol >= 0 ? String(row[parentHomeCol] ?? "").trim() : String(row[6] ?? "").trim(),
            email: parentEmailCol >= 0 ? String(row[parentEmailCol] ?? "").trim() : String(row[9] ?? "").trim(),
            idNumber: resolvedParentIdNumber,
            learnerAdmissionNo: active.learnerAdmissionNo,
            learnerIdNumber: active.learnerIdNumber,
            learnerFirstName: active.learnerFirstName,
            learnerLastName: active.learnerLastName,
            learnerClassName: active.learnerClassName,
            archived: false,
            sourceFile,
            sourceRow: i + 1,
        });
    }
    return out;
}
/** Parse SA-SAMS parent/guardian register (rotated headers supported). */
function parseSasamsParentRegister(filePath) {
    if (!fs_1.default.existsSync(filePath)) {
        throw new Error(`SA-SAMS parent register not found: ${filePath}`);
    }
    if (/parent_learner_links/i.test(path_1.default.basename(filePath))) {
        return parseSasamsParentLearnerLinks(filePath);
    }
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const layout = resolveSasamsDataSheetLayout(sheet);
    if (layout.mappedCount < 2) {
        throw new Error(`Could not detect SA-SAMS parent register headers in ${filePath}`);
    }
    const col = buildSasamsColumnIndex(layout.headers);
    const sourceFile = path_1.default.basename(filePath);
    const out = [];
    for (let i = layout.dataStartRow; i < sheet.rows.length; i++) {
        const row = sheet.rows[i] || [];
        const parentName = rowValue(row, col, "parentName");
        const learnerFirst = rowValue(row, col, "firstName");
        const learnerLast = rowValue(row, col, "lastName");
        const parentFirst = rowValue(row, col, "parentName")
            ? (0, kideesysSpreadsheet_1.splitFullName)(parentName).firstName
            : "";
        const parentLast = rowValue(row, col, "parentName")
            ? (0, kideesysSpreadsheet_1.splitFullName)(parentName).lastName
            : "";
        const firstName = parentFirst || learnerFirst;
        const lastName = parentLast || learnerLast;
        if (!firstName && !lastName && !parentName)
            continue;
        const accRaw = rowValue(row, col, "learnerNumber");
        const { admissionNo, idNumber } = classifyAccessionOrId(accRaw);
        const archivedCol = layout.headers.findIndex((h) => /archiv/i.test(String(h || "")));
        const archived = archivedCol >= 0 ? isArchivedFlag(String(row[archivedCol] ?? "")) : false;
        out.push({
            firstName: parentFirst || firstName || "Parent",
            surname: parentLast || lastName || parentName || "Unknown",
            relation: "Guardian",
            cellNo: rowValue(row, col, "parentPhone"),
            workNo: "",
            homeNo: "",
            email: rowValue(row, col, "parentEmail"),
            idNumber: rowValue(row, col, "idNumber") || null,
            learnerAdmissionNo: admissionNo,
            learnerIdNumber: idNumber,
            learnerFirstName: learnerFirst || null,
            learnerLastName: learnerLast || null,
            learnerClassName: rowValue(row, col, "classroom") ||
                parseSasamsGradeClassLabel(rowValue(row, col, "grade")) ||
                rowValue(row, col, "grade") ||
                null,
            archived,
            sourceFile,
            sourceRow: i + 1,
        });
    }
    return out;
}
/** HR staff export (Initials, Title, Marital status) — not parent-learner links. */
function isSasamsHrStaffRegister(filePath) {
    if (!fs_1.default.existsSync(filePath))
        return false;
    const base = path_1.default.basename(filePath).toLowerCase();
    if (base.includes("parent_register"))
        return false;
    const sheet = (0, kideesysSpreadsheet_1.parseKideesysSpreadsheetFile)(filePath);
    const looksLikeParentRegister = (() => {
        for (let i = 0; i < Math.min(20, sheet.rows.length); i++) {
            const row = sheet.rows[i] || [];
            const joined = row
                .map((c) => normalizeHeaderText(String(c ?? "")))
                .join(" ");
            if (/guardian|parent|learner|pupil/i.test(joined))
                return true;
        }
        return false;
    })();
    for (let i = 0; i < Math.min(12, sheet.rows.length); i++) {
        const row = sheet.rows[i] || [];
        const joined = row
            .map((c) => normalizeHeaderText(String(c ?? "")))
            .join(" ");
        if (/hr\s*list/i.test(joined))
            return true;
        const keys = row.map((c) => compactKey(normalizeHeaderText(String(c ?? ""))));
        if (keys.includes("initials") && keys.includes("maritalstatus"))
            return !looksLikeParentRegister;
        if (keys.includes("title") && keys.includes("maritalstatus") && keys.includes("surname")) {
            return !looksLikeParentRegister;
        }
    }
    return false;
}
/** Merge parent register + parent_learner_links (deduped). Skips HR staff register mistaken for parents. */
function parseSasamsParentSources(parentRegisterPath, parentLearnerLinksPath) {
    const register = fs_1.default.existsSync(parentRegisterPath) && !isSasamsHrStaffRegister(parentRegisterPath)
        ? parseSasamsParentRegister(parentRegisterPath)
        : [];
    const links = fs_1.default.existsSync(parentLearnerLinksPath)
        ? parseSasamsParentLearnerLinks(parentLearnerLinksPath)
        : [];
    // Parent register often has ID numbers but no learner/link context.
    // Build conservative enrichment map: parent name -> single unique ID number.
    const nameToIdCandidates = new Map();
    for (const row of register) {
        const id = String(row.idNumber || "").trim();
        if (!id)
            continue;
        const nameKey = `${(0, kideesysSpreadsheet_1.normalizeMatchText)(row.firstName)}|${(0, kideesysSpreadsheet_1.normalizeMatchText)(row.surname)}`;
        const set = nameToIdCandidates.get(nameKey) || new Set();
        set.add(id);
        nameToIdCandidates.set(nameKey, set);
    }
    const nameToUniqueId = new Map();
    for (const [k, set] of nameToIdCandidates.entries()) {
        if (set.size === 1)
            nameToUniqueId.set(k, Array.from(set)[0]);
    }
    // Only include rows that can be matched to learners (typically parent_learner_links).
    // The parent register is used to enrich ID numbers, but register-only rows are not emitted.
    const registerWithLearnerContext = register.filter((r) => Boolean(String(r.learnerAdmissionNo || "").trim()) ||
        Boolean(String(r.learnerIdNumber || "").trim()) ||
        Boolean(String(r.learnerClassName || "").trim()));
    const byKey = new Map();
    const keyFor = (row) => {
        const learnerKey = (0, kideesysSpreadsheet_1.normalizeMatchText)(row.learnerAdmissionNo || "") ||
            (0, kideesysSpreadsheet_1.normalizeMatchText)(row.learnerIdNumber || "") ||
            (0, kideesysSpreadsheet_1.normalizeMatchText)(`${row.learnerFirstName || ""} ${row.learnerLastName || ""}`.trim()) ||
            (0, kideesysSpreadsheet_1.normalizeMatchText)(row.learnerClassName || "");
        return [
            (0, kideesysSpreadsheet_1.normalizeMatchText)(row.firstName),
            (0, kideesysSpreadsheet_1.normalizeMatchText)(row.surname),
            learnerKey,
        ].join("|");
    };
    const pick = (a, b) => {
        const av = String(a || "").trim();
        if (av)
            return av;
        const bv = String(b || "").trim();
        return bv ? bv : null;
    };
    const merge = (a, b) => {
        return {
            ...a,
            relation: pick(a.relation, b.relation) || "Guardian",
            cellNo: pick(a.cellNo, b.cellNo) || "",
            workNo: pick(a.workNo, b.workNo) || "",
            homeNo: pick(a.homeNo, b.homeNo) || "",
            email: pick(a.email, b.email) || "",
            idNumber: pick(a.idNumber, b.idNumber),
            learnerAdmissionNo: pick(a.learnerAdmissionNo, b.learnerAdmissionNo),
            learnerIdNumber: pick(a.learnerIdNumber, b.learnerIdNumber),
            learnerFirstName: pick(a.learnerFirstName, b.learnerFirstName),
            learnerLastName: pick(a.learnerLastName, b.learnerLastName),
            learnerClassName: pick(a.learnerClassName, b.learnerClassName),
            archived: a.archived && b.archived,
            sourceFile: a.sourceFile || b.sourceFile,
            sourceRow: Math.min(a.sourceRow, b.sourceRow),
        };
    };
    for (const row of [...registerWithLearnerContext, ...links]) {
        if (!row.idNumber) {
            const nameKey = `${(0, kideesysSpreadsheet_1.normalizeMatchText)(row.firstName)}|${(0, kideesysSpreadsheet_1.normalizeMatchText)(row.surname)}`;
            const uniqueId = nameToUniqueId.get(nameKey);
            if (uniqueId)
                row.idNumber = uniqueId;
        }
        const key = keyFor(row);
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, row);
        }
        else {
            byKey.set(key, merge(existing, row));
        }
    }
    return Array.from(byKey.values());
}
function pickEnrichment(primary, fallback) {
    const p = primary == null || (typeof primary === "string" && !String(primary).trim()) ? null : primary;
    if (p != null)
        return p;
    const f = fallback == null || (typeof fallback === "string" && !String(fallback).trim()) ? null : fallback;
    return f ?? null;
}
/**
 * Merge class-list learners (primary) with learner register (fallback for missing profile fields only).
 * Register-only rows are never imported — class lists are the authoritative learner set.
 */
function mergeSasamsLearnerSources(classListLearners, registerLearners, audit) {
    const registerIndexes = (0, sasamsLearnerProfileWrite_1.buildSasamsRegisterLookupIndexes)(registerLearners);
    const merged = new Map();
    let enrichedFromRegister = 0;
    const matchedRegisterKeys = new Set();
    for (const fromClass of classListLearners) {
        const reg = (0, sasamsLearnerProfileWrite_1.lookupSasamsRegisterForClassLearner)(fromClass, registerIndexes);
        if (reg)
            matchedRegisterKeys.add(reg.matchKey);
        const className = fromClass.canonicalClassName || fromClass.className;
        const firstName = fromClass.firstName;
        const lastName = fromClass.lastName;
        const key = (0, parsers_1.buildLearnerMatchKey)(`${firstName} ${lastName}`, className);
        if (reg) {
            const enrichedFields = [];
            const trackEnriched = (field, primary, fallback) => {
                const pEmpty = primary == null || (typeof primary === "string" && !String(primary).trim());
                const fPresent = fallback != null && (typeof fallback !== "string" || String(fallback).trim());
                if (pEmpty && fPresent)
                    enrichedFields.push(field);
            };
            trackEnriched("admissionNo", fromClass.admissionNo, reg.admissionNo);
            trackEnriched("idNumber", fromClass.idNumber, reg.idNumber);
            trackEnriched("birthDate", fromClass.birthDate, reg.birthDate);
            trackEnriched("gender", fromClass.gender, reg.gender);
            trackEnriched("language", fromClass.language, reg.language);
            trackEnriched("citizenship", fromClass.citizenship, reg.citizenship);
            const admissionNo = pickEnrichment(fromClass.admissionNo, reg.admissionNo);
            const idNumber = pickEnrichment(fromClass.idNumber, reg.idNumber);
            const birthDate = pickEnrichment(fromClass.birthDate, reg.birthDate);
            const gender = pickEnrichment(fromClass.gender, reg.gender);
            const language = pickEnrichment(fromClass.language, reg.language);
            const citizenship = pickEnrichment(fromClass.citizenship, reg.citizenship);
            const grade = pickEnrichment(fromClass.grade, reg.grade) || fromClass.grade || reg.grade || "";
            if (enrichedFields.length)
                enrichedFromRegister += 1;
            merged.set(key, {
                ...fromClass,
                firstName,
                lastName,
                fullName: `${firstName} ${lastName}`.trim(),
                className: fromClass.className,
                canonicalClassName: className,
                matchKey: key,
                grade,
                admissionNo,
                sasamsLearnerNo: pickEnrichment(fromClass.sasamsLearnerNo, reg.sasamsLearnerNo),
                idNumber,
                birthDate,
                gender,
                language,
                citizenship,
                admissionDate: pickEnrichment(fromClass.admissionDate, reg.admissionDate),
                sourceFile: fromClass.sourceFile,
                enrichedFromRegister: enrichedFields.length > 0,
            });
        }
        else {
            merged.set(key, {
                ...fromClass,
                canonicalClassName: className,
                matchKey: key,
            });
        }
    }
    const registerOnlySkipped = registerLearners.filter((reg) => !matchedRegisterKeys.has(reg.matchKey)).length;
    if (audit) {
        audit.classListParsed = classListLearners.length;
        audit.registerParsed = registerLearners.length;
        audit.mergedTotal = merged.size;
        audit.enrichedFromRegister = enrichedFromRegister;
        audit.registerOnlySkipped = registerOnlySkipped;
    }
    return Array.from(merged.values());
}
/** Kid-e-Sys class lists kept only for parity checks — not used as learner master. */
function parseKidESysClassListDirectoryForParity(classListDir) {
    return (0, parsers_1.parseClassListDirectory)(classListDir);
}
