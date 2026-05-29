"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KIDEESYS_CSV_REQUIRED_COLUMNS = exports.KIDEESYS_CSV_FILE_SUFFIX = exports.KIDEESYS_CSV_TYPES = void 0;
exports.pickCsvField = pickCsvField;
exports.readCsvHeaders = readCsvHeaders;
exports.parseCsvFile = parseCsvFile;
exports.findKidESysCsvFiles = findKidESysCsvFiles;
exports.assertKidESysCsvBundleComplete = assertKidESysCsvBundleComplete;
exports.validateRequiredColumns = validateRequiredColumns;
exports.extractKidESysCsvZip = extractKidESysCsvZip;
exports.resolveKidESysCsvDirectory = resolveKidESysCsvDirectory;
exports.loadKidESysCsvBundle = loadKidESysCsvBundle;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const os_1 = __importDefault(require("os"));
const migrationLearnerFileParser_1 = require("../../../utils/migrationLearnerFileParser");
const learnerGender_1 = require("../../../utils/learnerGender");
const kideesysChildClassifier_1 = require("./kideesysChildClassifier");
/** Canonical Kid-e-Sys export file suffixes (also matched with school prefix). */
exports.KIDEESYS_CSV_TYPES = [
    "accounts",
    "child",
    "child_parent",
    "invoices",
    "journals",
    "monthly_accounts",
    "payments",
];
exports.KIDEESYS_CSV_FILE_SUFFIX = {
    accounts: "accounts.csv",
    child: "child.csv",
    child_parent: "child_parent.csv",
    invoices: "invoices.csv",
    journals: "journals.csv",
    monthly_accounts: "monthly_accounts.csv",
    payments: "payments.csv",
};
exports.KIDEESYS_CSV_REQUIRED_COLUMNS = {
    accounts: [["account_no"], ["balance"]],
    child: [["child_id"], ["child_name", "first_name", "name"]],
    child_parent: [["child_id"], ["parent_id"]],
    invoices: [["invoice_no", "id"], ["account_no"], ["amount"], ["date"]],
    journals: [["journal_no", "id"], ["account_no"], ["amount"], ["date"]],
    monthly_accounts: [["child_id"], ["description"], ["amount"]],
    payments: [["payment_no", "id"], ["account_no"], ["amount"], ["date"]],
};
function normalizeHeaderKey(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_]/g, "");
}
function rowLookup(row) {
    const map = new Map();
    for (const [key, value] of Object.entries(row)) {
        map.set(normalizeHeaderKey(key), String(value ?? "").trim());
    }
    return map;
}
function pickCsvField(row, aliases) {
    const map = rowLookup(row);
    for (const alias of aliases) {
        const value = map.get(normalizeHeaderKey(alias));
        if (value)
            return value;
    }
    return "";
}
function readCsvHeaders(filePath) {
    const text = fs_1.default.readFileSync(filePath, "utf8");
    const parsed = (0, migrationLearnerFileParser_1.parseCsvText)(text);
    return parsed.headers.map((h) => normalizeHeaderKey(h));
}
function parseCsvFile(filePath) {
    const text = fs_1.default.readFileSync(filePath, "utf8");
    return (0, migrationLearnerFileParser_1.parseCsvText)(text).rows;
}
function csvBasenameMatchesType(filename, csvType) {
    const lower = path_1.default.basename(filename).toLowerCase();
    const suffix = exports.KIDEESYS_CSV_FILE_SUFFIX[csvType];
    if (lower === suffix)
        return true;
    if (lower.endsWith(`_${suffix}`))
        return true;
    return lower.endsWith(suffix);
}
function findKidESysCsvFiles(rootDir) {
    const found = {};
    const walk = (dir) => {
        if (!fs_1.default.existsSync(dir))
            return;
        for (const entry of fs_1.default.readdirSync(dir, { withFileTypes: true })) {
            const full = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(full);
                continue;
            }
            if (!entry.name.toLowerCase().endsWith(".csv"))
                continue;
            for (const csvType of exports.KIDEESYS_CSV_TYPES) {
                if (!found[csvType] && csvBasenameMatchesType(entry.name, csvType)) {
                    found[csvType] = full;
                }
            }
        }
    };
    walk(rootDir);
    return found;
}
function assertKidESysCsvBundleComplete(files) {
    const missing = exports.KIDEESYS_CSV_TYPES.filter((name) => !files[name]);
    if (missing.length) {
        const friendly = missing.map((t) => exports.KIDEESYS_CSV_FILE_SUFFIX[t]).join(", ");
        throw new Error(`Kid-e-Sys CSV export is missing required file(s): ${friendly}. ` +
            `Expected files like Da_Silva_Academy_child.csv or child.csv in the source folder.`);
    }
}
function validateRequiredColumns(csvType, headers) {
    const headerSet = new Set(headers.map(normalizeHeaderKey));
    const missing = [];
    for (const group of exports.KIDEESYS_CSV_REQUIRED_COLUMNS[csvType]) {
        const ok = group.some((alias) => headerSet.has(normalizeHeaderKey(alias)));
        if (!ok)
            missing.push(group.join("|"));
    }
    return missing;
}
function extractKidESysCsvZip(zipPath) {
    const resolved = path_1.default.resolve(zipPath);
    if (!fs_1.default.existsSync(resolved))
        throw new Error(`ZIP not found: ${resolved}`);
    const dest = fs_1.default.mkdtempSync(path_1.default.join(os_1.default.tmpdir(), "kideesys-csv-"));
    (0, child_process_1.execSync)(`unzip -q -o ${JSON.stringify(resolved)} -d ${JSON.stringify(dest)}`, {
        stdio: "pipe",
    });
    return dest;
}
function resolveKidESysCsvDirectory(sourcePath) {
    const resolved = path_1.default.resolve(sourcePath);
    if (!fs_1.default.existsSync(resolved))
        throw new Error(`Source not found: ${resolved}`);
    if (resolved.toLowerCase().endsWith(".zip")) {
        const csvDir = extractKidESysCsvZip(resolved);
        return {
            csvDir,
            cleanup: () => {
                try {
                    fs_1.default.rmSync(csvDir, { recursive: true, force: true });
                }
                catch {
                    /* ignore */
                }
            },
        };
    }
    const stat = fs_1.default.statSync(resolved);
    if (!stat.isDirectory()) {
        throw new Error(`Expected ZIP or directory: ${resolved}`);
    }
    return { csvDir: resolved, cleanup: () => undefined };
}
function buildChildMatchKey(fullName, className) {
    const name = fullName.trim().toLowerCase().replace(/\s+/g, " ");
    const cls = className.trim().toLowerCase().replace(/\s+/g, " ");
    return `${name}|${cls}`;
}
function splitPersonName(fullName) {
    const parts = String(fullName || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    if (!parts.length)
        return { firstName: "", lastName: "" };
    if (parts.length === 1)
        return { firstName: parts[0], lastName: "" };
    return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}
function parseChildRows(rows) {
    const out = [];
    for (const row of rows) {
        const childId = pickCsvField(row, ["child_id", "id", "childid", "learner_id"]);
        const accountNo = pickCsvField(row, [
            "account_no",
            "account_number",
            "account_ref",
            "account_id",
            "billing_account",
            "account",
        ]);
        const firstName = pickCsvField(row, [
            "child_name",
            "first_name",
            "firstname",
            "name",
            "child_name",
        ]);
        const lastName = pickCsvField(row, [
            "child_surname",
            "last_name",
            "lastname",
            "surname",
            "family_name",
        ]);
        const fullNameField = pickCsvField(row, ["full_name", "learner_name", "child_full_name"]);
        const fullName = fullNameField ||
            [firstName, lastName].filter(Boolean).join(" ").trim() ||
            pickCsvField(row, ["display_name"]);
        const nameParts = splitPersonName(fullName);
        const resolvedFirst = firstName || nameParts.firstName;
        const resolvedLast = lastName || nameParts.lastName;
        const className = pickCsvField(row, [
            "classroom",
            "class_name",
            "class",
            "grade_class",
            "grade",
        ]);
        if (!childId && !fullName && !resolvedFirst)
            continue;
        const birthRaw = pickCsvField(row, [
            "date_of_birth",
            "dob",
            "birth_date",
            "birthdate",
            "birthday",
        ]);
        const idNumber = pickCsvField(row, ["child_id_no", "id_number", "identity_number", "id_no", "sa_id"]) ||
            null;
        const gender = (0, learnerGender_1.resolveLearnerGender)({
            gender: pickCsvField(row, ["gender", "sex", "learner_gender"]),
            idNumber,
        });
        const classification = (0, kideesysChildClassifier_1.classifyKidESysChildRow)(row);
        out.push({
            childId: childId || `${resolvedFirst}|${resolvedLast}|${className}`.toLowerCase(),
            accountNo,
            firstName: resolvedFirst,
            lastName: resolvedLast,
            fullName: fullName || `${resolvedFirst} ${resolvedLast}`.trim(),
            className: classification.hasValidClassroom
                ? className || classification.classroomRaw
                : classification.classroomRaw || className,
            birthDate: birthRaw || null,
            gender,
            idNumber,
            homeLanguage: pickCsvField(row, ["home_language", "language", "mother_tongue"]) || null,
            citizenship: pickCsvField(row, ["citizenship", "nationality"]) || null,
            enrollmentStatus: classification.enrollmentStatus,
            matchKey: buildChildMatchKey(fullName || `${resolvedFirst} ${resolvedLast}`, className || "Unknown"),
        });
    }
    return out;
}
function parseAccountRows(rows) {
    const out = [];
    for (const row of rows) {
        const accountId = pickCsvField(row, ["id", "account_id", "accountid"]);
        const accountNo = pickCsvField(row, [
            "account_no",
            "account_number",
            "account_ref",
            "account",
            "code",
        ]);
        if (!accountNo && !accountId)
            continue;
        const familyName = pickCsvField(row, [
            "family_name",
            "surname",
            "account_name",
            "name",
            "child_surname",
            "child_name",
        ]) || accountNo;
        const contactName = pickCsvField(row, [
            "contact_name",
            "account_holder",
            "parent_name",
            "payer_name",
        ]);
        const contactParts = splitPersonName(contactName);
        const balanceRaw = pickCsvField(row, [
            "balance",
            "balance_current",
            "outstanding",
            "amount_owing",
            "total",
        ]);
        out.push({
            accountId: accountId || accountNo,
            accountNo: accountNo || accountId,
            familyName,
            balance: Number(String(balanceRaw || "0").replace(/,/g, "")) || 0,
            contactFirstName: pickCsvField(row, ["first_name", "contact_first_name", "child_name"]) ||
                contactParts.firstName,
            contactSurname: pickCsvField(row, ["last_name", "contact_surname", "child_surname"]) ||
                contactParts.lastName,
            cellNo: pickCsvField(row, ["cell_no", "cell", "mobile", "cellphone", "phone"]),
            workNo: pickCsvField(row, ["work_no", "work", "work_phone"]),
            homeNo: pickCsvField(row, ["home_no", "home", "home_phone"]),
            email: pickCsvField(row, ["email", "email_address"]),
        });
    }
    return out;
}
function parseChildParentRows(rows) {
    const out = [];
    for (const row of rows) {
        const childId = pickCsvField(row, ["child_id", "learner_id", "id_child", "childid"]);
        const parentId = pickCsvField(row, ["parent_id", "guardian_id", "id_parent"]);
        if (!childId || !parentId)
            continue;
        const parentName = pickCsvField(row, ["parent_name", "guardian_name", "name", "full_name"]);
        const nameParts = splitPersonName(parentName);
        const primaryFlag = pickCsvField(row, ["is_primary", "primary", "main_contact"]).toLowerCase();
        const relationship = pickCsvField(row, ["relationship", "relation", "parent_type", "type"]) || "Guardian";
        out.push({
            childId,
            parentId,
            relationship,
            parentFirstName: pickCsvField(row, ["name", "first_name", "parent_first_name"]) || nameParts.firstName,
            parentSurname: pickCsvField(row, ["surname", "last_name", "parent_surname"]) || nameParts.lastName,
            cellNo: pickCsvField(row, ["cell_no", "cell", "mobile", "phone"]),
            workNo: pickCsvField(row, ["work_no", "work"]),
            homeNo: pickCsvField(row, ["home_no", "home"]),
            email: pickCsvField(row, ["email"]),
            isPrimary: !primaryFlag || primaryFlag === "1" || primaryFlag === "true" || primaryFlag === "yes",
        });
    }
    return out;
}
function parseMonthlyAccountRows(rows) {
    const out = [];
    for (const row of rows) {
        const feeDescription = pickCsvField(row, [
            "description",
            "fee_description",
            "fee",
            "item",
            "charge",
            "fee_type",
        ]);
        const amountRaw = pickCsvField(row, ["amount", "fee_amount", "value", "monthly_fee"]);
        const amount = Number(String(amountRaw || "0").replace(/,/g, "")) || 0;
        if (!feeDescription || !amount)
            continue;
        out.push({
            childId: pickCsvField(row, ["child_id", "learner_id", "id"]),
            accountNo: pickCsvField(row, ["account_no", "account_number", "account_ref", "account_id"]),
            feeDescription,
            amount,
            periodLabel: pickCsvField(row, ["period", "month", "billing_period", "term", "line_no"]),
        });
    }
    return out;
}
function dedupeInvoiceRows(rows) {
    const byKey = new Map();
    for (const inv of rows) {
        const key = `${inv.accountNo}|${inv.invoiceId}`;
        if (!byKey.has(key))
            byKey.set(key, inv);
    }
    return Array.from(byKey.values());
}
function parseInvoiceRows(rows) {
    const out = [];
    for (const row of rows) {
        const invoiceId = pickCsvField(row, [
            "transaction_id",
            "invoice_no",
            "id",
            "invoice_id",
            "invoice_number",
            "number",
        ]) || "";
        const accountNo = pickCsvField(row, ["account_no", "account_number", "account_ref", "account_id"]);
        const amountRaw = pickCsvField(row, ["amount", "invoice_amount", "total", "value", "detail_amount"]);
        const amount = Math.abs(Number(String(amountRaw || "0").replace(/,/g, "")) || 0);
        if (!invoiceId && !accountNo)
            continue;
        if (!amount)
            continue;
        out.push({
            invoiceId: invoiceId || `${accountNo}|${pickCsvField(row, ["date", "invoice_date"])}|${amount}`,
            accountNo,
            childId: pickCsvField(row, ["child_id", "learner_id", "reference_child_id"]),
            fullName: pickCsvField(row, ["full_name", "learner_name", "child_name", "name"]),
            amount,
            date: pickCsvField(row, ["date", "invoice_date", "created", "posted_date"]),
            dueDate: pickCsvField(row, ["due_date", "due", "payment_due"]),
            reference: pickCsvField(row, ["reference", "invoice_reference", "ref"]),
            description: pickCsvField(row, ["description", "notes", "memo", "detail_description"]),
        });
    }
    return dedupeInvoiceRows(out);
}
function dedupePaymentRows(rows) {
    const byKey = new Map();
    for (const pay of rows) {
        const key = `${pay.accountNo}|${pay.paymentId}`;
        if (!byKey.has(key))
            byKey.set(key, pay);
    }
    return Array.from(byKey.values());
}
function parsePaymentRows(rows) {
    const out = [];
    for (const row of rows) {
        const paymentId = pickCsvField(row, ["transaction_id", "payment_no", "id", "payment_id", "receipt_no", "receipt_number", "number"]) ||
            "";
        const accountNo = pickCsvField(row, ["account_no", "account_number", "account_ref", "account_id"]);
        const amountRaw = pickCsvField(row, ["amount", "payment_amount", "total", "value", "detail_amount"]);
        const amount = Math.abs(Number(String(amountRaw || "0").replace(/,/g, "")) || 0);
        if (!paymentId && !accountNo)
            continue;
        if (!amount)
            continue;
        out.push({
            paymentId: paymentId || `${accountNo}|${pickCsvField(row, ["date", "payment_date"])}|${amount}`,
            accountNo,
            childId: pickCsvField(row, ["child_id", "learner_id"]),
            fullName: pickCsvField(row, ["full_name", "learner_name", "name"]),
            amount,
            date: pickCsvField(row, ["date", "payment_date", "received_date", "posted_date"]),
            reference: pickCsvField(row, ["reference", "payment_reference", "ref"]),
            description: pickCsvField(row, ["description", "notes", "memo"]),
            method: pickCsvField(row, ["method", "payment_method", "type"]),
        });
    }
    return dedupePaymentRows(out);
}
function dedupeJournalRows(rows) {
    const byKey = new Map();
    for (const journal of rows) {
        const key = `${journal.accountNo}|${journal.journalId}`;
        if (!byKey.has(key))
            byKey.set(key, journal);
    }
    return Array.from(byKey.values());
}
function classifyJournal(debitRaw, creditRaw, amountRaw) {
    const debit = Math.abs(Number(String(debitRaw || "0").replace(/,/g, "")) || 0);
    const credit = Math.abs(Number(String(creditRaw || "0").replace(/,/g, "")) || 0);
    const amount = Math.abs(Number(String(amountRaw || "0").replace(/,/g, "")) || 0);
    if (debit > 0 && credit <= 0) {
        return { kind: "invoice", signedAmount: debit, amount: debit };
    }
    if (credit > 0 && debit <= 0) {
        return { kind: "payment", signedAmount: -credit, amount: credit };
    }
    if (amount > 0) {
        const signed = Number(String(amountRaw || "0").replace(/,/g, "")) || amount;
        if (signed < 0)
            return { kind: "payment", signedAmount: signed, amount: Math.abs(signed) };
        return { kind: "invoice", signedAmount: signed, amount: Math.abs(signed) };
    }
    return { kind: "credit", signedAmount: 0, amount: 0 };
}
function parseJournalRows(rows) {
    const out = [];
    for (const row of rows) {
        const journalId = pickCsvField(row, ["transaction_id", "journal_no", "id", "journal_id", "entry_id"]) || "";
        const accountNo = pickCsvField(row, ["account_no", "account_number", "account_ref", "account_id"]);
        const debitRaw = pickCsvField(row, ["debit", "debit_amount"]);
        const creditRaw = pickCsvField(row, ["credit", "credit_amount"]);
        const amountRaw = pickCsvField(row, ["amount", "value", "total", "detail_amount"]);
        const classified = classifyJournal(debitRaw, creditRaw, amountRaw);
        if (!journalId && !accountNo)
            continue;
        if (!classified.amount)
            continue;
        out.push({
            journalId: journalId || `${accountNo}|${pickCsvField(row, ["date"])}|${classified.amount}`,
            accountNo,
            childId: pickCsvField(row, ["child_id", "learner_id"]),
            fullName: pickCsvField(row, ["full_name", "name", "learner_name"]),
            amount: classified.amount,
            signedAmount: classified.signedAmount,
            date: pickCsvField(row, ["date", "journal_date", "posted_date", "transaction_date"]),
            reference: pickCsvField(row, ["reference", "ref", "journal_reference"]),
            description: pickCsvField(row, ["description", "notes", "memo", "narrative"]),
            kind: classified.kind,
        });
    }
    return dedupeJournalRows(out);
}
function loadKidESysCsvBundle(sourcePath) {
    const { csvDir, cleanup } = resolveKidESysCsvDirectory(sourcePath);
    try {
        const partialFiles = findKidESysCsvFiles(csvDir);
        assertKidESysCsvBundleComplete(partialFiles);
        const filesFound = partialFiles;
        const headersByFile = {};
        for (const csvType of exports.KIDEESYS_CSV_TYPES) {
            headersByFile[csvType] = readCsvHeaders(filesFound[csvType]);
        }
        return {
            sourcePath: path_1.default.resolve(sourcePath),
            csvDir,
            filesFound,
            headersByFile,
            children: parseChildRows(parseCsvFile(filesFound.child)),
            childParents: parseChildParentRows(parseCsvFile(filesFound.child_parent)),
            accounts: parseAccountRows(parseCsvFile(filesFound.accounts)),
            monthlyAccounts: parseMonthlyAccountRows(parseCsvFile(filesFound.monthly_accounts)),
            invoices: parseInvoiceRows(parseCsvFile(filesFound.invoices)),
            payments: parsePaymentRows(parseCsvFile(filesFound.payments)),
            journals: parseJournalRows(parseCsvFile(filesFound.journals)),
        };
    }
    finally {
        cleanup();
    }
}
