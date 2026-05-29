"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchKideesysBillingAccounts = matchKideesysBillingAccounts;
exports.matchKideesysBillingAccountsWithSecondPass = matchKideesysBillingAccountsWithSecondPass;
exports.groupSiblingAccounts = groupSiblingAccounts;
const classroomNormalization_1 = require("../../utils/classroomNormalization");
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const daSilvaMergedFamily_1 = require("./daSilvaMergedFamily");
const parsers_1 = require("./parsers");
const daSilvaKideesysBillingMatchSecondPass_1 = require("./daSilvaKideesysBillingMatchSecondPass");
function normName(value) {
    return (0, kideesysSpreadsheet_1.normalizeMatchText)(value);
}
function normClass(value) {
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(String(value || ""));
    return norm.matchKey || normName(String(value || ""));
}
function normId(value) {
    return String(value || "")
        .replace(/\D/g, "")
        .trim();
}
/** Kid-e-Sys billing names are often `First Middle Surname` (last token = surname). */
function parseBillingDisplayName(fullName) {
    const cleaned = String(fullName || "")
        .replace(/\n/g, " ")
        .replace(/ref:\s*\([^)]*\)/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
        return { firstName: parts[0] || "", lastName: "" };
    }
    return {
        firstName: parts[0],
        lastName: parts[parts.length - 1],
    };
}
function buildBillingLearnerIndexes(learners) {
    const byMatchKey = new Map();
    const byIdNumber = new Map();
    const byAdmission = new Map();
    const byNameClass = new Map();
    const byNameOnly = new Map();
    const bySurname = new Map();
    for (const l of learners) {
        const keys = new Set();
        keys.add(l.matchKey);
        keys.add((0, parsers_1.buildLearnerMatchKey)(`${l.firstName} ${l.lastName}`, l.className || ""));
        for (const key of keys) {
            const list = byMatchKey.get(key) || [];
            list.push(l.id);
            byMatchKey.set(key, list);
        }
        const idn = normId(l.idNumber);
        if (idn.length >= 6) {
            const list = byIdNumber.get(idn) || [];
            list.push(l.id);
            byIdNumber.set(idn, list);
        }
        const adm = normId(l.admissionNo);
        if (adm) {
            const list = byAdmission.get(adm) || [];
            list.push(l.id);
            byAdmission.set(adm, list);
        }
        const nameClassKey = `${normName(l.firstName)}|${normName(l.lastName)}|${normClass(l.className)}`;
        const ncList = byNameClass.get(nameClassKey) || [];
        ncList.push(l.id);
        byNameClass.set(nameClassKey, ncList);
        const nameOnlyKey = `${normName(l.lastName)}|${normName(l.firstName)}`;
        const noList = byNameOnly.get(nameOnlyKey) || [];
        noList.push(l.id);
        byNameOnly.set(nameOnlyKey, noList);
        const surKey = normName(l.lastName);
        const sList = bySurname.get(surKey) || [];
        sList.push(l.id);
        bySurname.set(surKey, sList);
    }
    return { byMatchKey, byIdNumber, byAdmission, byNameClass, byNameOnly, bySurname };
}
function pickUnique(candidates) {
    const unique = [...new Set(candidates)];
    if (unique.length === 1)
        return { id: unique[0], ambiguous: false };
    if (unique.length === 0)
        return { id: null, ambiguous: false };
    return { id: null, ambiguous: true };
}
function matchNameToLearner(displayName, classHint, indexes, classByKey) {
    const { firstName, lastName } = parseBillingDisplayName(displayName);
    if (!firstName || !lastName) {
        return { learnerId: null, matchKey: null, strategy: null, ambiguous: false };
    }
    const className = classHint || classByKey.get((0, parsers_1.buildLearnerMatchKey)(displayName, ""))?.className || "";
    const matchKey = (0, parsers_1.buildLearnerMatchKey)(`${firstName} ${lastName}`, className);
    const strategies = [
        { name: "match_key", ids: indexes.byMatchKey.get(matchKey) || [] },
    ];
    if (className) {
        const nameClassKey = `${normName(firstName)}|${normName(lastName)}|${normClass(className)}`;
        strategies.push({ name: "surname_first_name_class", ids: indexes.byNameClass.get(nameClassKey) || [] });
    }
    const nameOnlyKey = `${normName(lastName)}|${normName(firstName)}`;
    strategies.push({ name: "surname_first_name", ids: indexes.byNameOnly.get(nameOnlyKey) || [] });
    const fromClass = classByKey.get(matchKey);
    if (fromClass?.idNumber) {
        const idn = normId(fromClass.idNumber);
        if (idn.length >= 6) {
            strategies.push({ name: "class_list_id_number", ids: indexes.byIdNumber.get(idn) || [] });
        }
    }
    if (fromClass?.admissionNo) {
        const adm = normId(fromClass.admissionNo);
        if (adm) {
            strategies.push({ name: "class_list_admission_no", ids: indexes.byAdmission.get(adm) || [] });
        }
    }
    for (const s of strategies) {
        const { id, ambiguous } = pickUnique(s.ids);
        if (id) {
            return { learnerId: id, matchKey, strategy: s.name, ambiguous: false };
        }
        if (ambiguous) {
            return { learnerId: null, matchKey, strategy: s.name, ambiguous: true };
        }
    }
    return { learnerId: null, matchKey, strategy: null, ambiguous: false };
}
function matchByFamilySurname(names, indexes) {
    if (names.length < 2)
        return null;
    const surnames = names.map((n) => normName(parseBillingDisplayName(n).lastName)).filter(Boolean);
    if (new Set(surnames).size !== 1)
        return null;
    const sur = surnames[0];
    const candidates = indexes.bySurname.get(sur) || [];
    if (!candidates.length)
        return null;
    const hits = [];
    for (const name of names) {
        const { firstName, lastName } = parseBillingDisplayName(name);
        const key = `${normName(lastName)}|${normName(firstName)}`;
        const ids = indexes.byNameOnly.get(key) || [];
        if (ids.length === 1)
            hits.push(ids[0]);
    }
    if (hits.length === names.length) {
        return { learnerIds: hits, strategy: "sibling_family_surname" };
    }
    return null;
}
function matchKideesysBillingAccounts(opts) {
    const learnerIndex = buildBillingLearnerIndexes(opts.dbLearners);
    const classByKey = new Map(opts.classListLearners.map((l) => [l.matchKey, l]));
    for (const row of opts.classListLearners) {
        const dbHit = opts.dbLearners.find((d) => normName(d.firstName) === normName(row.firstName) &&
            normName(d.lastName) === normName(row.lastName));
        if (!dbHit)
            continue;
        const idn = normId(row.idNumber);
        const adm = normId(row.admissionNo);
        if (idn.length >= 6) {
            const list = learnerIndex.byIdNumber.get(idn) || [];
            if (!list.includes(dbHit.id))
                list.push(dbHit.id);
            learnerIndex.byIdNumber.set(idn, list);
        }
        if (adm) {
            const list = learnerIndex.byAdmission.get(adm) || [];
            if (!list.includes(dbHit.id))
                list.push(dbHit.id);
            learnerIndex.byAdmission.set(adm, list);
        }
    }
    const familyIndex = {
        learnerNameToAccount: new Map(),
        accountToLearnerNames: new Map(),
    };
    for (const account of opts.accounts) {
        const names = account.learnerNames?.length
            ? account.learnerNames
            : (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName);
        for (const name of names.length ? names : [account.fullName]) {
            (0, daSilvaMergedFamily_1.addLearnerToFamilyIndex)(familyIndex, account.accountNo, name);
        }
    }
    const matched = [];
    const unmatchedAccounts = [];
    const duplicateMatches = [];
    const matchedLearnerIds = new Set();
    for (const account of opts.accounts) {
        const names = account.learnerNames?.length
            ? account.learnerNames
            : (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName);
        const displayNames = names.length ? names : [account.fullName];
        const siblingGroupKey = displayNames.length > 1 ? `siblings:${normName(account.accountNo)}` : null;
        const classHint = account.section && !/^general$/i.test(account.section) ? account.section : null;
        let learnerId = null;
        let matchKey = null;
        let strategy = null;
        let ambiguous = false;
        const familyMatch = matchByFamilySurname(displayNames, learnerIndex);
        if (familyMatch && familyMatch.learnerIds.length === 1) {
            learnerId = familyMatch.learnerIds[0];
            strategy = familyMatch.strategy;
        }
        else if (familyMatch && familyMatch.learnerIds.length > 1) {
            learnerId = familyMatch.learnerIds[0];
            strategy = familyMatch.strategy;
        }
        if (!learnerId) {
            for (const name of displayNames) {
                const hit = matchNameToLearner(name, classHint, learnerIndex, classByKey);
                if (hit.learnerId) {
                    learnerId = hit.learnerId;
                    matchKey = hit.matchKey;
                    strategy = hit.strategy;
                    ambiguous = hit.ambiguous;
                    break;
                }
                if (hit.ambiguous) {
                    ambiguous = true;
                    strategy = hit.strategy;
                    break;
                }
            }
        }
        if (!learnerId && displayNames.length === 1) {
            const sur = normName(parseBillingDisplayName(displayNames[0]).lastName);
            const surHits = learnerIndex.bySurname.get(sur) || [];
            if (surHits.length === 1) {
                learnerId = surHits[0];
                strategy = "unique_surname_fallback";
            }
        }
        const row = {
            accountNo: account.accountNo,
            fullName: account.fullName,
            learnerId,
            matchKey,
            strategy,
            ambiguous,
            siblingGroupKey,
        };
        if (learnerId) {
            matched.push(row);
            matchedLearnerIds.add(learnerId);
            if (ambiguous)
                duplicateMatches.push(row);
        }
        else {
            unmatchedAccounts.push(row);
            if (ambiguous)
                duplicateMatches.push(row);
        }
    }
    const unmatchedLearners = opts.dbLearners
        .filter((l) => !matchedLearnerIds.has(l.id))
        .map((l) => ({
        learnerId: l.id,
        fullName: `${l.firstName} ${l.lastName}`,
        className: l.className,
    }));
    return { matched, unmatchedAccounts, duplicateMatches, unmatchedLearners };
}
function matchKideesysBillingAccountsWithSecondPass(opts) {
    const firstPass = matchKideesysBillingAccounts({
        accounts: opts.accounts,
        dbLearners: opts.dbLearners,
        classListLearners: opts.classListLearners,
        mergedFamilyAccountNos: opts.mergedFamilyAccountNos,
    });
    const accountBalances = new Map(opts.accounts.map((a) => [a.accountNo, a.balance]));
    return (0, daSilvaKideesysBillingMatchSecondPass_1.applySecondPassBillingMatch)(firstPass, opts, accountBalances);
}
/** Apply sibling family grouping: learners sharing an account keep one FamilyAccount ref. */
function groupSiblingAccounts(matched) {
    const byAccount = new Map();
    for (const row of matched) {
        if (!row.learnerId)
            continue;
        const list = byAccount.get(row.accountNo) || [];
        list.push(row.learnerId);
        byAccount.set(row.accountNo, list);
    }
    return byAccount;
}
