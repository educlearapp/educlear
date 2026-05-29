"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKidesysOpeningBalanceEntry = void 0;
exports.normaliseAmount = normaliseAmount;
exports.readSchoolLedger = readSchoolLedger;
exports.writeSchoolLedger = writeSchoolLedger;
exports.upsertSchoolEntries = upsertSchoolEntries;
exports.appendSchoolEntry = appendSchoolEntry;
exports.listInvoices = listInvoices;
exports.listPayments = listPayments;
exports.lookupLearnerIdForAccountKey = lookupLearnerIdForAccountKey;
exports.relinkLedgerLearnerIds = relinkLedgerLearnerIds;
exports.backfillLedgerLearnerIds = backfillLedgerLearnerIds;
exports.listPenalties = listPenalties;
exports.buildPenaltyEntryId = buildPenaltyEntryId;
exports.normaliseIsoDate = normaliseIsoDate;
exports.resolveEntryDueDate = resolveEntryDueDate;
exports.isInvoicePastDue = isInvoicePastDue;
exports.prepareLedgerEntries = prepareLedgerEntries;
exports.accountEntries = accountEntries;
exports.entryMatchesFamilyAccountScope = entryMatchesFamilyAccountScope;
exports.collectFamilyAccountEntries = collectFamilyAccountEntries;
exports.getFamilyAccountLedger = getFamilyAccountLedger;
exports.calculateBalanceFromEntries = calculateBalanceFromEntries;
exports.computeOpenInvoiceLines = computeOpenInvoiceLines;
exports.listOverdueInvoicesForAccount = listOverdueInvoicesForAccount;
exports.computeAccountOverdue = computeAccountOverdue;
exports.computeLegalOverdueSnapshot = computeLegalOverdueSnapshot;
exports.computeFifoCreditAllocationsByLearner = computeFifoCreditAllocationsByLearner;
exports.unmergeLearnerLedger = unmergeLearnerLedger;
exports.reassignLedgerAccountRefs = reassignLedgerAccountRefs;
exports.calculateBalanceForAccount = calculateBalanceForAccount;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const daSilvaSchoolResolve_1 = require("../services/daSilvaSchoolResolve");
var billingDisplayRules_1 = require("./billingDisplayRules");
Object.defineProperty(exports, "isKidesysOpeningBalanceEntry", { enumerable: true, get: function () { return billingDisplayRules_1.isKidesysOpeningBalanceEntry; } });
const DATA_DIR = path_1.default.join(process.cwd(), "data");
const LEDGER_FILE = path_1.default.join(DATA_DIR, "billing-ledger.json");
function ensureStore() {
    if (!fs_1.default.existsSync(DATA_DIR))
        fs_1.default.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs_1.default.existsSync(LEDGER_FILE))
        fs_1.default.writeFileSync(LEDGER_FILE, JSON.stringify({}, null, 2), "utf8");
}
function readAll() {
    ensureStore();
    try {
        const raw = fs_1.default.readFileSync(LEDGER_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
function writeAll(data) {
    ensureStore();
    fs_1.default.writeFileSync(LEDGER_FILE, JSON.stringify(data, null, 2), "utf8");
}
function normaliseAmount(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}
function resolveBillingLedgerStoreKey(schoolId) {
    const key = String(schoolId || "").trim();
    if (!key)
        return key;
    const all = readAll();
    return (0, daSilvaSchoolResolve_1.resolveSchoolJsonStoreKey)(key, all, (value) => Array.isArray(value) ? value.length > 0 : false);
}
function readSchoolLedger(schoolId) {
    const storeKey = resolveBillingLedgerStoreKey(schoolId);
    if (!storeKey)
        return [];
    const all = readAll();
    return Array.isArray(all[storeKey]) ? all[storeKey] : [];
}
function writeSchoolLedger(schoolId, entries) {
    const storeKey = resolveBillingLedgerStoreKey(schoolId);
    if (!storeKey)
        return;
    const all = readAll();
    all[storeKey] = entries;
    writeAll(all);
}
function upsertSchoolEntries(schoolId, entries) {
    const key = String(schoolId || "").trim();
    if (!key || !entries.length)
        return;
    const current = readSchoolLedger(key);
    const byId = new Map(current.map((e) => [e.id, e]));
    for (const entry of entries)
        byId.set(entry.id, entry);
    writeSchoolLedger(key, Array.from(byId.values()));
}
function appendSchoolEntry(schoolId, entry) {
    upsertSchoolEntries(schoolId, [entry]);
}
function listInvoices(schoolId) {
    return readSchoolLedger(schoolId).filter((e) => e.type === "invoice");
}
function listPayments(schoolId) {
    return readSchoolLedger(schoolId).filter((e) => e.type === "payment");
}
function admissionBaseFromAccountKey(accountKey) {
    const adm = String(accountKey || "").trim();
    if (!adm)
        return "";
    const dash = adm.indexOf("-");
    return dash === -1 ? adm : adm.slice(0, dash);
}
function lookupLearnerIdForAccountKey(accountToLearnerId, accountNo) {
    const ref = String(accountNo || "").trim();
    if (!ref)
        return "";
    if (accountToLearnerId[ref])
        return accountToLearnerId[ref];
    const base = admissionBaseFromAccountKey(ref);
    if (base && accountToLearnerId[base])
        return accountToLearnerId[base];
    return "";
}
/**
 * Align ledger learnerId with current learners using accountNo / admission mapping.
 * Updates missing and stale learner ids (post re-import).
 */
function relinkLedgerLearnerIds(schoolId, accountToLearnerId) {
    const entries = readSchoolLedger(schoolId);
    if (!entries.length)
        return 0;
    let updated = 0;
    const next = entries.map((entry) => {
        const accountNo = String(entry.accountNo || "").trim();
        const targetId = lookupLearnerIdForAccountKey(accountToLearnerId, accountNo);
        const currentId = String(entry.learnerId || "").trim();
        if (!targetId || currentId === targetId)
            return entry;
        updated += 1;
        return { ...entry, learnerId: targetId };
    });
    if (updated > 0)
        writeSchoolLedger(schoolId, next);
    return updated;
}
/** @deprecated Use relinkLedgerLearnerIds — kept for existing scripts. */
function backfillLedgerLearnerIds(schoolId, accountToLearnerId) {
    return relinkLedgerLearnerIds(schoolId, accountToLearnerId);
}
function listPenalties(schoolId) {
    return readSchoolLedger(schoolId).filter((e) => e.type === "penalty");
}
function buildPenaltyEntryId(schoolId, accountNo, date, description) {
    const slug = String(description || "penalty")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 40);
    return `penalty-${schoolId}-${accountNo}-${date}-${slug}`;
}
function isValidCalendarYmd(y, m, d) {
    if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31)
        return false;
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function toIsoYmd(y, m, d) {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
/** Disambiguate DD/MM/YYYY vs MM/DD/YYYY (SA default when both parts <= 12). */
function slashDateToIso(first, second, year) {
    const asIso = (month, day) => isValidCalendarYmd(year, month, day) ? toIsoYmd(year, month, day) : "";
    if (first > 12 && second >= 1 && second <= 12)
        return asIso(second, first);
    if (second > 12 && first >= 1 && first <= 12)
        return asIso(first, second);
    if (first > 12 && second > 12)
        return "";
    const dmy = asIso(second, first);
    if (dmy)
        return dmy;
    return asIso(first, second);
}
/** Normalise to YYYY-MM-DD (handles ISO, DD/MM/YYYY, MM/DD/YYYY, YYYY/MM/DD). */
function normaliseIsoDate(value) {
    if (value === null || value === undefined)
        return "";
    const raw = String(value).trim();
    if (!raw)
        return "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const [y, m, d] = raw.split("-").map((p) => Number(p));
        return isValidCalendarYmd(y, m, d) ? raw : "";
    }
    const slashYmd = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (slashYmd) {
        const iso = slashDateToIso(Number(slashYmd[1]), Number(slashYmd[2]), Number(slashYmd[3]));
        if (iso)
            return iso;
    }
    const ymd = raw.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymd) {
        const y = Number(ymd[1]);
        const m = Number(ymd[2]);
        const d = Number(ymd[3]);
        return isValidCalendarYmd(y, m, d) ? toIsoYmd(y, m, d) : "";
    }
    if (!raw.includes("/")) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime()))
            return parsed.toISOString().slice(0, 10);
    }
    return "";
}
function resolveEntryDueDate(entry, runDueDates = {}) {
    const explicit = normaliseIsoDate(entry.dueDate);
    if (explicit)
        return explicit;
    const runId = String(entry.runId || "").trim();
    if (runId && runDueDates[runId]) {
        const fromRun = normaliseIsoDate(runDueDates[runId]);
        if (fromRun)
            return fromRun;
    }
    return normaliseIsoDate(entry.date);
}
/** Invoice due dates strictly before asOfDate count as overdue (due today is not overdue). */
function isInvoicePastDue(due, asOfDate) {
    const dueIso = normaliseIsoDate(due);
    const asOfIso = normaliseIsoDate(asOfDate);
    if (!dueIso || !asOfIso)
        return false;
    return dueIso < asOfIso;
}
function prepareLedgerEntries(entries, runDueDates = {}) {
    return entries.map((entry) => {
        if (entry.type !== "invoice")
            return entry;
        const dueDate = resolveEntryDueDate(entry, runDueDates);
        if (!dueDate || dueDate === entry.dueDate)
            return entry;
        return { ...entry, dueDate };
    });
}
function entryDueDate(entry, runDueDates = {}) {
    return resolveEntryDueDate(entry, runDueDates);
}
function accountEntries(entries, learnerId, accountNo) {
    const keys = new Set([learnerId, accountNo].filter((v) => v && v !== "-").map((v) => String(v).trim()));
    return entries.filter((e) => keys.has(String(e.learnerId || "").trim()) || keys.has(String(e.accountNo || "").trim()));
}
/**
 * Family statement scope: learner-tagged rows only for current members;
 * account-level rows (no learnerId) only when accountNo matches accountRef.
 */
function entryMatchesFamilyAccountScope(entry, scope) {
    const ref = String(scope.accountRef || "").trim();
    const learnerSet = new Set((scope.learnerIds || []).map((id) => String(id).trim()).filter(Boolean));
    const entryLearnerId = String(entry.learnerId || "").trim();
    const entryAccountNo = String(entry.accountNo || "").trim();
    if (entryLearnerId) {
        return learnerSet.has(entryLearnerId);
    }
    return Boolean(ref && entryAccountNo === ref);
}
/** Entries for a family billing account (statements, balances, parent portal). */
function collectFamilyAccountEntries(entries, scope) {
    const seen = new Set();
    const result = [];
    for (const entry of entries) {
        if (!entryMatchesFamilyAccountScope(entry, scope))
            continue;
        if (seen.has(entry.id))
            continue;
        seen.add(entry.id);
        result.push(entry);
    }
    return result;
}
function getFamilyAccountLedger(schoolId, scope) {
    return collectFamilyAccountEntries(readSchoolLedger(schoolId), scope).sort((a, b) => new Date(b.date || b.createdAt).getTime() - new Date(a.date || a.createdAt).getTime());
}
function calculateBalanceFromEntries(entries) {
    const invoiceTotal = entries
        .filter((e) => e.type === "invoice")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    const penaltyTotal = entries
        .filter((e) => e.type === "penalty")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    const paymentTotal = entries
        .filter((e) => e.type === "payment")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    const creditTotal = entries
        .filter((e) => e.type === "credit")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    return invoiceTotal + penaltyTotal - paymentTotal - creditTotal;
}
/** FIFO unpaid balance per invoice/penalty line for payment allocation. */
function computeOpenInvoiceLines(entries, learnerId, accountNo) {
    const matched = accountEntries(entries, learnerId, accountNo);
    const debits = matched
        .filter((e) => e.type === "invoice" || e.type === "penalty")
        .sort((a, b) => {
        const da = new Date(a.date || a.createdAt).getTime();
        const db = new Date(b.date || b.createdAt).getTime();
        if (da !== db)
            return da - db;
        return String(a.createdAt).localeCompare(String(b.createdAt));
    });
    let creditPool = matched
        .filter((e) => e.type === "payment" || e.type === "credit")
        .reduce((sum, e) => sum + normaliseAmount(e.amount), 0);
    const lines = [];
    for (const entry of debits) {
        const gross = normaliseAmount(entry.amount);
        if (gross <= 0)
            continue;
        const applied = Math.min(gross, creditPool);
        creditPool -= applied;
        const unpaid = gross - applied;
        if (unpaid <= 0.001)
            continue;
        const typeLabel = entry.type === "penalty" ? "Penalty" : "Invoice";
        lines.push({
            id: entry.id,
            audit: entry.id,
            type: typeLabel,
            date: entry.date || "",
            reference: entry.reference || typeLabel,
            description: entry.description || typeLabel,
            unpaid,
            amount: gross,
        });
    }
    return lines;
}
function listOverdueInvoicesForAccount(entries, learnerId, accountNo, asOfDate, runDueDates = {}) {
    const matched = accountEntries(entries, learnerId, accountNo);
    const asOfIso = normaliseIsoDate(asOfDate);
    return matched
        .filter((e) => e.type === "invoice")
        .map((entry) => {
        const due = entryDueDate(entry, runDueDates);
        const amount = normaliseAmount(entry.amount);
        if (!amount || !due || !isInvoicePastDue(due, asOfIso))
            return null;
        return {
            id: entry.id,
            dueDate: due,
            invoiceDate: normaliseIsoDate(entry.date),
            amount,
            reference: String(entry.reference || ""),
            description: String(entry.description || "School fees"),
        };
    })
        .filter((row) => Boolean(row))
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
function computeAccountOverdue(entries, learnerId, accountNo, options) {
    const matched = accountEntries(entries, learnerId, accountNo);
    const asOf = normaliseIsoDate(options.penaltyDate || options.dueDateCutoff);
    let overdueAmount = 0;
    let excludedNotYetDue = 0;
    for (const entry of matched.filter((e) => e.type === "invoice")) {
        const amount = normaliseAmount(entry.amount);
        if (!amount)
            continue;
        const due = entryDueDate(entry, options.runDueDates);
        if (!due)
            continue;
        if (options.excludeNotYetDue && !isInvoicePastDue(due, asOf)) {
            excludedNotYetDue += amount;
            continue;
        }
        if (isInvoicePastDue(due, asOf))
            overdueAmount += amount;
    }
    const balance = calculateBalanceForAccount(entries, learnerId, accountNo);
    return { balance, overdueAmount, excludedNotYetDue };
}
/** Shared legal-recovery overdue resolver (Section 41, Letter of Demand, Final Demand). */
function computeLegalOverdueSnapshot(entries, learnerId, accountNo, asOfDate, runDueDates) {
    const date = normaliseIsoDate(asOfDate) || new Date().toISOString().slice(0, 10);
    const { balance, overdueAmount, excludedNotYetDue } = computeAccountOverdue(entries, learnerId, accountNo, { penaltyDate: date, dueDateCutoff: date, excludeNotYetDue: true, runDueDates });
    let overdueInvoices = listOverdueInvoicesForAccount(entries, learnerId, accountNo, date, runDueDates);
    let overdueBalance = balance > 0 && overdueAmount > 0 ? Math.min(balance, overdueAmount) : 0;
    // Align with Statements legal eligibility: owing account + latest invoice due in the past
    if (overdueBalance <= 0 && balance > 0) {
        const matched = accountEntries(entries, learnerId, accountNo);
        let latestDue = "";
        for (const entry of matched.filter((e) => e.type === "invoice")) {
            const due = entryDueDate(entry, runDueDates);
            if (due && (!latestDue || due > latestDue))
                latestDue = due;
        }
        if (latestDue && isInvoicePastDue(latestDue, date)) {
            overdueBalance = balance;
            if (!overdueInvoices.length) {
                overdueInvoices = [
                    {
                        id: `fallback-${learnerId}`,
                        dueDate: latestDue,
                        invoiceDate: latestDue,
                        amount: balance,
                        reference: "",
                        description: "Outstanding school fees",
                    },
                ];
            }
        }
    }
    return { balance, overdueAmount, overdueBalance, excludedNotYetDue, overdueInvoices };
}
const MONEY_EPS = 0.001;
function roundMoney(value) {
    return Math.round(value * 100) / 100;
}
/**
 * FIFO credit pool applied to family debits; returns per-credit allocation by learner id.
 */
function computeFifoCreditAllocationsByLearner(familyEntries, familyLearnerIds) {
    const learnerSet = new Set(familyLearnerIds.map((id) => String(id).trim()).filter(Boolean));
    const debits = familyEntries
        .filter((e) => e.type === "invoice" || e.type === "penalty")
        .map((entry) => {
        const gross = normaliseAmount(entry.amount);
        return {
            entryId: entry.id,
            learnerId: String(entry.learnerId || "").trim(),
            remaining: gross,
            sortTime: new Date(entry.date || entry.createdAt).getTime(),
            createdAt: String(entry.createdAt || ""),
        };
    })
        .filter((d) => d.remaining > MONEY_EPS)
        .sort((a, b) => {
        if (a.sortTime !== b.sortTime)
            return a.sortTime - b.sortTime;
        return a.createdAt.localeCompare(b.createdAt);
    });
    const credits = familyEntries
        .filter((e) => e.type === "payment" || e.type === "credit")
        .map((entry) => ({
        id: entry.id,
        amount: normaliseAmount(entry.amount),
        sortTime: new Date(entry.date || entry.createdAt).getTime(),
        createdAt: String(entry.createdAt || ""),
    }))
        .filter((c) => c.amount > MONEY_EPS)
        .sort((a, b) => {
        if (a.sortTime !== b.sortTime)
            return a.sortTime - b.sortTime;
        return a.createdAt.localeCompare(b.createdAt);
    });
    const result = new Map();
    for (const credit of credits) {
        let pool = credit.amount;
        const byLearner = new Map();
        for (const debit of debits) {
            if (pool <= MONEY_EPS)
                break;
            if (debit.remaining <= MONEY_EPS)
                continue;
            const apply = Math.min(pool, debit.remaining);
            debit.remaining -= apply;
            pool -= apply;
            if (!debit.learnerId || !learnerSet.has(debit.learnerId))
                continue;
            byLearner.set(debit.learnerId, roundMoney((byLearner.get(debit.learnerId) || 0) + apply));
        }
        if (byLearner.size > 0)
            result.set(credit.id, byLearner);
    }
    return result;
}
/**
 * Move a learner's billing rows off a merged family account (never deletes entries).
 * - Learner-tagged invoices, penalties, credits, and payments move to toAccountNo.
 * - Shared payments/credits (account ref only, no learnerId) stay on fromAccountNo unless
 *   FIFO allocation attributes a portion to this learner (then split, do not delete).
 */
function unmergeLearnerLedger(schoolId, opts) {
    const key = String(schoolId || "").trim();
    const from = String(opts.fromAccountNo || "").trim();
    const to = String(opts.toAccountNo || "").trim();
    const learnerId = String(opts.learnerId || "").trim();
    const familyLearnerIds = opts.familyLearnerIds.map((id) => String(id).trim()).filter(Boolean);
    const emptyBalances = {
        schoolTotal: 0,
        sourceFamily: 0,
        learnerOnSource: 0,
    };
    const emptyAfter = {
        schoolTotal: 0,
        sourceFamily: 0,
        learnerOnTarget: 0,
    };
    if (!key || !from || !to || !learnerId || from === to) {
        const entries = readSchoolLedger(key);
        return {
            updated: 0,
            movedEntryIds: [],
            splitEntryIds: [],
            entries,
            balanceBefore: { ...emptyBalances, schoolTotal: calculateBalanceFromEntries(entries) },
            balanceAfter: { ...emptyAfter, schoolTotal: calculateBalanceFromEntries(entries) },
        };
    }
    const current = readSchoolLedger(key);
    const familyScope = { accountRef: from, learnerIds: familyLearnerIds };
    const familyEntries = collectFamilyAccountEntries(current, familyScope);
    const fifoAllocations = computeFifoCreditAllocationsByLearner(familyEntries, familyLearnerIds);
    const balanceBefore = {
        schoolTotal: calculateBalanceFromEntries(current),
        sourceFamily: calculateBalanceFromEntries(familyEntries),
        learnerOnSource: calculateBalanceForAccount(current, learnerId, from),
    };
    const movedEntryIds = [];
    const splitEntryIds = [];
    const extraRows = [];
    let updated = 0;
    const next = current.map((entry) => {
        const entryLearnerId = String(entry.learnerId || "").trim();
        const entryAccountNo = String(entry.accountNo || "").trim();
        const inFamily = entryAccountNo === from ||
            familyLearnerIds.includes(entryLearnerId) ||
            entryLearnerId === learnerId;
        if (!inFamily)
            return entry;
        const isDebit = entry.type === "invoice" || entry.type === "penalty";
        const isCredit = entry.type === "payment" || entry.type === "credit";
        if (isDebit && entryLearnerId === learnerId) {
            updated += 1;
            movedEntryIds.push(entry.id);
            return { ...entry, accountNo: to };
        }
        if (entry.type === "credit" && entryLearnerId === learnerId) {
            updated += 1;
            movedEntryIds.push(entry.id);
            return { ...entry, accountNo: to };
        }
        if (isCredit) {
            if (entryLearnerId && entryLearnerId !== learnerId) {
                return entry;
            }
            if (entryLearnerId === learnerId) {
                updated += 1;
                movedEntryIds.push(entry.id);
                return { ...entry, accountNo: to };
            }
            if (!entryLearnerId && entryAccountNo === from) {
                const portion = roundMoney(fifoAllocations.get(entry.id)?.get(learnerId) || 0);
                const fullAmount = roundMoney(normaliseAmount(entry.amount));
                if (portion <= MONEY_EPS)
                    return entry;
                if (portion >= fullAmount - MONEY_EPS) {
                    updated += 1;
                    movedEntryIds.push(entry.id);
                    return { ...entry, accountNo: to, learnerId };
                }
                const remainder = roundMoney(fullAmount - portion);
                const splitId = `${entry.id}-unmerge-${learnerId.slice(0, 8)}`;
                splitEntryIds.push(splitId);
                extraRows.push({
                    ...entry,
                    id: splitId,
                    amount: portion,
                    accountNo: to,
                    learnerId,
                    description: `${entry.description || entry.type} (unmerged to ${to})`.trim(),
                    createdAt: new Date().toISOString(),
                });
                updated += 1;
                return { ...entry, amount: remainder };
            }
            return entry;
        }
        return entry;
    });
    const merged = [...next, ...extraRows];
    const afterFamilyScope = {
        accountRef: from,
        learnerIds: familyLearnerIds.filter((id) => id !== learnerId),
    };
    const afterFamilyEntries = collectFamilyAccountEntries(merged, afterFamilyScope);
    const balanceAfter = {
        schoolTotal: calculateBalanceFromEntries(merged),
        sourceFamily: calculateBalanceFromEntries(afterFamilyEntries),
        learnerOnTarget: calculateBalanceForAccount(merged, learnerId, to),
    };
    if (Math.abs(balanceBefore.schoolTotal - balanceAfter.schoolTotal) > 0.02) {
        throw new Error(`Unmerge ledger reconciliation failed: school balance ${balanceBefore.schoolTotal} → ${balanceAfter.schoolTotal}`);
    }
    if (updated > 0 || extraRows.length > 0)
        writeSchoolLedger(key, merged);
    return {
        updated: updated + extraRows.length,
        movedEntryIds,
        splitEntryIds,
        entries: merged,
        balanceBefore,
        balanceAfter,
    };
}
/**
 * Reassign accountNo on ledger rows (never deletes entries).
 * includeAccountNoOnly: also move rows that match fromAccountNo but lack a learner id (family merge).
 */
function reassignLedgerAccountRefs(schoolId, opts) {
    const key = String(schoolId || "").trim();
    const from = String(opts.fromAccountNo || "").trim();
    const to = String(opts.toAccountNo || "").trim();
    if (!key || !from || !to || from === to) {
        return { updated: 0, entries: readSchoolLedger(key) };
    }
    const learnerSet = new Set(opts.learnerIds.map((id) => String(id).trim()).filter(Boolean));
    const includeAccountNoOnly = Boolean(opts.includeAccountNoOnly);
    const current = readSchoolLedger(key);
    let updated = 0;
    const next = current.map((entry) => {
        const entryLearnerId = String(entry.learnerId || "").trim();
        const entryAccountNo = String(entry.accountNo || "").trim();
        const matchesLearner = learnerSet.has(entryLearnerId);
        const matchesAccount = includeAccountNoOnly && entryAccountNo === from;
        if (!matchesLearner && !matchesAccount)
            return entry;
        updated += 1;
        return { ...entry, accountNo: to };
    });
    if (updated > 0)
        writeSchoolLedger(key, next);
    return { updated, entries: next };
}
function calculateBalanceForAccount(entries, learnerId, accountNo) {
    const keys = new Set([learnerId, accountNo].filter((v) => v && v !== "-").map((v) => String(v).trim()));
    const matched = entries.filter((e) => keys.has(String(e.learnerId || "").trim()) || keys.has(String(e.accountNo || "").trim()));
    const invoiceTotal = matched
        .filter((e) => e.type === "invoice")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    const penaltyTotal = matched
        .filter((e) => e.type === "penalty")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    const paymentTotal = matched
        .filter((e) => e.type === "payment")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    const creditTotal = matched
        .filter((e) => e.type === "credit")
        .reduce((s, e) => s + normaliseAmount(e.amount), 0);
    return invoiceTotal + penaltyTotal - paymentTotal - creditTotal;
}
