"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKidESysLearnerClassListPreview = isKidESysLearnerClassListPreview;
exports.learnerMatchKeysInPriorityOrder = learnerMatchKeysInPriorityOrder;
exports.buildMigrationLearnerMatchIndex = buildMigrationLearnerMatchIndex;
exports.resolveLearnerForRow = resolveLearnerForRow;
exports.investigateTransactionReadiness = investigateTransactionReadiness;
exports.computeTransactionReadiness = computeTransactionReadiness;
const MigrationTargetField_1 = require("../types/MigrationTargetField");
const MigrationLearnerStatus_1 = require("../types/MigrationLearnerStatus");
const transactionEligibility_1 = require("./transactionEligibility");
const EMPTY_COUNTS = {
    historicalOnlyTransactions: 0,
    eligibleActiveTransactions: 0,
    blockedTransactions: 0,
    unmatchedTransactions: 0,
};
const TRANSACTION_FIELDS = new Set(MigrationTargetField_1.TRANSACTION_TARGET_FIELDS);
const AMOUNT_FIELDS = new Set(["amount", "debit", "credit"]);
function cellString(value) {
    if (value == null)
        return "";
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    return String(value).trim();
}
function isNumericValue(value) {
    const s = cellString(value);
    if (!s)
        return false;
    const normalized = s.replace(/[\s,]/g, "").replace(/^\((.+)\)$/, "-$1");
    if (normalized === "-" || normalized === "+")
        return false;
    return Number.isFinite(Number(normalized));
}
function buildTargetToSource(mappings) {
    const map = new Map();
    for (const m of mappings) {
        const target = String(m.targetField || "").trim();
        const source = String(m.sourceColumn || "").trim();
        if (target && source)
            map.set(target, source);
    }
    return map;
}
function getMappedValue(row, targetToSource, field) {
    const source = targetToSource.get(field);
    if (!source)
        return undefined;
    return row[source];
}
/** Kid-e-Sys grade/class register previews (tagged during report-table parse). */
function isKidESysLearnerClassListPreview(preview) {
    if (String(preview.category || "").trim() !== "learners")
        return false;
    const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
    return warnings.some((w) => /Kid-e-Sys class list/i.test(String(w)));
}
function hasLearnerIdentityMappings(targetToSource) {
    return (targetToSource.has("fullName") ||
        targetToSource.has("firstName") ||
        targetToSource.has("lastName") ||
        targetToSource.has("idNumber"));
}
/**
 * Only true learner roster files may populate the readiness index.
 * Transaction/parent/account-only sources must never self-index learners.
 */
function isLearnerIndexSource(preview, category, targetToSource) {
    if (category === "transactions" || category === "parents" || category === "staff") {
        return false;
    }
    if (category === "learners" || category === "historical") {
        return true;
    }
    if (category === "billing") {
        const hasIdentity = hasLearnerIdentityMappings(targetToSource);
        const accountOnly = targetToSource.has("accountNumber") && !hasIdentity;
        return hasIdentity && !accountOnly;
    }
    const accountOnly = targetToSource.has("accountNumber") && !hasLearnerIdentityMappings(targetToSource);
    if (accountOnly)
        return false;
    return false;
}
function resolveLearnerIndexStatus(preview, category, statusRaw, statusMapped) {
    if (category === "learners" &&
        isKidESysLearnerClassListPreview(preview) &&
        (!statusMapped || !statusRaw.trim())) {
        return "ACTIVE";
    }
    return (0, MigrationLearnerStatus_1.parseMigrationLearnerStatus)(statusRaw, { fileCategory: category });
}
function learnerIdentityMatchKeys(row, targetToSource) {
    const keys = [];
    const id = cellString(getMappedValue(row, targetToSource, "idNumber")).toLowerCase();
    const full = cellString(getMappedValue(row, targetToSource, "fullName")).toLowerCase();
    const first = cellString(getMappedValue(row, targetToSource, "firstName")).toLowerCase();
    const last = cellString(getMappedValue(row, targetToSource, "lastName")).toLowerCase();
    if (id)
        keys.push(`id:${id}`);
    if (full)
        keys.push(`name:${full}`);
    if (first || last)
        keys.push(`name:${first} ${last}`.trim());
    return keys;
}
function learnerAccountMatchKeys(row, targetToSource) {
    const account = cellString(getMappedValue(row, targetToSource, "accountNumber")).toLowerCase();
    return account ? [`acct:${account}`] : [];
}
/** Identity keys (name/id) before account fallback — class-list match wins over acct:*. */
function learnerMatchKeysInPriorityOrder(row, targetToSource) {
    return [...learnerIdentityMatchKeys(row, targetToSource), ...learnerAccountMatchKeys(row, targetToSource)];
}
function learnerIndexEntryQuality(entry) {
    let score = 0;
    if (entry.status === "ACTIVE")
        score += 4;
    else if (entry.status !== "UNKNOWN")
        score += 2;
    if (entry.grade || entry.classroom)
        score += 2;
    return score;
}
function shouldReplaceLearnerIndexEntry(existing, incoming) {
    if (!existing)
        return true;
    return learnerIndexEntryQuality(incoming) > learnerIndexEntryQuality(existing);
}
function bumpBucket(counts, bucket) {
    switch (bucket) {
        case "historicalOnly":
            counts.historicalOnlyTransactions += 1;
            break;
        case "eligibleActive":
            counts.eligibleActiveTransactions += 1;
            break;
        case "blocked":
            counts.blockedTransactions += 1;
            break;
        case "unmatched":
            counts.unmatchedTransactions += 1;
            break;
        default:
            break;
    }
}
function hasTransactionMappings(targetToSource) {
    for (const field of TRANSACTION_FIELDS) {
        if (targetToSource.has(field))
            return true;
    }
    return false;
}
function buildMigrationLearnerMatchIndex(previews, mappingsByFile, rowsByFileId) {
    const index = new Map();
    for (const preview of previews) {
        const fileMappings = mappingsByFile.get(preview.fileId);
        const targetToSource = buildTargetToSource(fileMappings?.mappings ?? []);
        const rows = rowsByFileId.get(preview.fileId) ?? preview.sampleRows;
        const category = String(preview.category || "").trim();
        if (!isLearnerIndexSource(preview, category, targetToSource))
            continue;
        const statusMapped = targetToSource.has("status");
        for (const row of rows) {
            const statusRaw = cellString(getMappedValue(row, targetToSource, "status"));
            const status = resolveLearnerIndexStatus(preview, category, statusRaw, statusMapped);
            const grade = cellString(getMappedValue(row, targetToSource, "grade"));
            const classroom = cellString(getMappedValue(row, targetToSource, "classroom"));
            const accountStatus = statusRaw;
            const entry = {
                status,
                grade: grade || undefined,
                classroom: classroom || undefined,
                accountStatus: accountStatus || undefined,
            };
            const identityKeys = learnerIdentityMatchKeys(row, targetToSource);
            const accountKeys = learnerAccountMatchKeys(row, targetToSource);
            for (const key of identityKeys) {
                const existing = index.get(key);
                if (shouldReplaceLearnerIndexEntry(existing, entry)) {
                    index.set(key, entry);
                }
            }
            for (const key of accountKeys) {
                const existing = index.get(key);
                if (shouldReplaceLearnerIndexEntry(existing, entry)) {
                    index.set(key, entry);
                }
            }
        }
    }
    return index;
}
function resolveLearnerForRow(row, targetToSource, index) {
    const keys = learnerMatchKeysInPriorityOrder(row, targetToSource);
    for (const key of keys) {
        const entry = index.get(key);
        if (entry)
            return { entry, matched: true };
    }
    return { entry: null, matched: keys.length > 0 };
}
function rowAmountValid(row, targetToSource) {
    let hasMappedAmount = false;
    for (const field of AMOUNT_FIELDS) {
        if (!targetToSource.has(field))
            continue;
        hasMappedAmount = true;
        const raw = getMappedValue(row, targetToSource, field);
        const s = cellString(raw);
        if (s && isNumericValue(raw))
            return true;
    }
    return !hasMappedAmount;
}
function investigateTransactionReadiness(input) {
    const mappingsByFile = new Map(input.mappings.map((m) => [m.fileId, m]));
    const index = buildMigrationLearnerMatchIndex(input.previews, mappingsByFile, input.rowsByFileId);
    let learnerIndexActive = 0;
    let learnerIndexUnknown = 0;
    for (const entry of index.values()) {
        if (entry.status === "ACTIVE")
            learnerIndexActive += 1;
        if (entry.status === "UNKNOWN")
            learnerIndexUnknown += 1;
    }
    const counts = { ...EMPTY_COUNTS };
    const cutoverDate = input.cutoverDate ?? null;
    const sampleLimit = Math.max(1, input.sampleLimit ?? 5);
    const sampleEligibleRows = [];
    let hasTransactionFiles = false;
    for (const preview of input.previews) {
        const category = String(preview.category || "").trim();
        const fileMappings = mappingsByFile.get(preview.fileId);
        const targetToSource = buildTargetToSource(fileMappings?.mappings ?? []);
        const isTransactionFile = category === "transactions" || hasTransactionMappings(targetToSource);
        if (!isTransactionFile)
            continue;
        hasTransactionFiles = true;
        const rows = input.rowsByFileId.get(preview.fileId) ?? preview.sampleRows;
        rows.forEach((row, rowIndex) => {
            const { entry, matched } = resolveLearnerForRow(row, targetToSource, index);
            const txDate = getMappedValue(row, targetToSource, "transactionDate");
            const datePresent = cellString(txDate).length > 0;
            const accountStatus = cellString(getMappedValue(row, targetToSource, "status")) ||
                entry?.accountStatus ||
                "";
            const accountClosed = (0, MigrationLearnerStatus_1.isClosedOrInactiveAccountStatus)(accountStatus);
            const bucket = (0, transactionEligibility_1.classifyTransactionReadiness)({
                learnerStatus: entry?.status ?? null,
                grade: entry?.grade,
                classroom: entry?.classroom,
                accountStatus,
                accountClosed,
                transactionDate: txDate,
                cutoverDate,
                hasLearnerOrAccountMatch: matched,
                amountValid: rowAmountValid(row, targetToSource),
                datePresent,
            });
            bumpBucket(counts, bucket);
            if (bucket === "eligibleActive" && sampleEligibleRows.length < sampleLimit) {
                const matchKey = learnerMatchKeysInPriorityOrder(row, targetToSource).find((k) => index.has(k)) ?? "";
                sampleEligibleRows.push({
                    fileId: preview.fileId,
                    filename: preview.filename,
                    rowIndex,
                    matchKey,
                    learnerStatus: entry?.status ?? "UNKNOWN",
                    grade: entry?.grade,
                    classroom: entry?.classroom,
                });
            }
        });
    }
    return {
        learnerIndexTotal: index.size,
        learnerIndexActive,
        learnerIndexUnknown,
        counts: hasTransactionFiles ? counts : { ...EMPTY_COUNTS },
        sampleEligibleRows,
    };
}
function computeTransactionReadiness(input) {
    return investigateTransactionReadiness(input).counts;
}
