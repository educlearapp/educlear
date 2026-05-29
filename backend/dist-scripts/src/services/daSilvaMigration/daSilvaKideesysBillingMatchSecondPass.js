"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildFamilyIndexFromAccounts = buildFamilyIndexFromAccounts;
exports.applySecondPassBillingMatch = applySecondPassBillingMatch;
const classroomNormalization_1 = require("../../utils/classroomNormalization");
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const daSilvaMergedFamily_1 = require("./daSilvaMergedFamily");
const parsers_1 = require("./parsers");
const FIRST_NAME_ALIASES = {
    lethabo: ["lebo", "thabo"],
    kgotso: ["kgots", "kgotso"],
    onthatile: ["ontha", "thati"],
    phemelo: ["pheme"],
    gosego: ["gose"],
    omogolo: ["omo"],
    oatlegile: ["oat"],
    tokelo: ["toke"],
    elleliyon: ["elle"],
};
function normName(value) {
    return (0, kideesysSpreadsheet_1.normalizeMatchText)(value);
}
function normClass(value) {
    const norm = (0, classroomNormalization_1.normalizeClassroomInput)(String(value || ""));
    return norm.matchKey || normName(String(value || ""));
}
function normSurname(value) {
    return normName(value)
        .replace(/\b(van|der|de|du|le|den)\b/g, " ")
        .replace(/[-']/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
function cleanBillingDisplayName(fullName) {
    return String(fullName || "")
        .replace(/\n/g, " ")
        .replace(/ref:\s*\([^)]*\)/gi, "")
        .replace(/\bdsa\d+\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
}
function parseBillingDisplayName(fullName) {
    const parts = cleanBillingDisplayName(fullName).split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
        return { firstName: parts[0] || "", lastName: "" };
    }
    const lower = parts.map((p) => p.toLowerCase());
    const penultimate = lower[lower.length - 2];
    if (parts.length >= 3 &&
        /^(van|de|du|der|le|da|den|di)$/.test(penultimate)) {
        return {
            firstName: parts.slice(0, -2).join(" "),
            lastName: parts.slice(-2).join(" "),
        };
    }
    return {
        firstName: parts[0],
        lastName: parts[parts.length - 1],
    };
}
function firstNameVariants(first) {
    const base = normName(first);
    const variants = new Set([base, base.replace(/\s+/g, "")]);
    const aliases = FIRST_NAME_ALIASES[base] || [];
    for (const alias of aliases)
        variants.add(normName(alias));
    if (base.length >= 3)
        variants.add(base.slice(0, 3));
    return [...variants];
}
function firstNamesCompatible(billingFirst, dbFirst) {
    const a = normName(billingFirst).replace(/\s+/g, "");
    const b = normName(dbFirst).replace(/\s+/g, "");
    if (!a || !b)
        return false;
    if (a === b)
        return true;
    if (a.startsWith(b) || b.startsWith(a))
        return Math.min(a.length, b.length) >= 3;
    for (const variant of firstNameVariants(billingFirst)) {
        if (variant && (b === variant || b.startsWith(variant) || variant.startsWith(b)))
            return true;
    }
    return false;
}
function pushIndex(map, key, id) {
    if (!key)
        return;
    const list = map.get(key) || [];
    if (!list.includes(id))
        list.push(id);
    map.set(key, list);
}
function buildLearnerIndexes(learners, contacts, billingPlanItems, transactions) {
    const byId = new Map();
    const byMatchKey = new Map();
    const byNameOnly = new Map();
    const byNormSurname = new Map();
    const bySurnameClass = new Map();
    const byContactKey = new Map();
    const byBillingPlanKey = new Map();
    const byTxnName = new Map();
    for (const l of learners) {
        byId.set(l.id, l);
        pushIndex(byMatchKey, l.matchKey, l.id);
        pushIndex(byNameOnly, `${normName(l.lastName)}|${normName(l.firstName)}`, l.id);
        pushIndex(byNormSurname, normSurname(l.lastName), l.id);
        pushIndex(bySurnameClass, `${normSurname(l.lastName)}|${normClass(l.className)}`, l.id);
    }
    for (const contact of contacts) {
        const key = normName(contact.fullName);
        const ids = learners
            .filter((l) => normName(`${l.firstName} ${l.lastName}`) === key ||
            (normName(l.firstName) === normName(contact.firstName) &&
                normName(l.lastName) === normName(contact.lastName)))
            .map((l) => l.id) || [];
        if (ids.length)
            pushIndex(byContactKey, key, ids[0]);
        for (const id of ids)
            pushIndex(byContactKey, key, id);
    }
    for (const item of billingPlanItems) {
        const ids = learners
            .filter((l) => l.matchKey === item.matchKey)
            .map((l) => l.id);
        if (ids.length)
            pushIndex(byBillingPlanKey, item.matchKey, ids[0]);
        for (const id of ids)
            pushIndex(byBillingPlanKey, item.matchKey, id);
    }
    for (const txn of transactions) {
        const key = normName(txn.fullName);
        const { firstName, lastName } = parseBillingDisplayName(txn.fullName);
        const ids = learners
            .filter((l) => normName(`${l.firstName} ${l.lastName}`) === key ||
            (normSurname(l.lastName) === normSurname(lastName) &&
                firstNamesCompatible(firstName, l.firstName)))
            .map((l) => l.id);
        for (const id of ids)
            pushIndex(byTxnName, key, id);
    }
    return {
        byId,
        byMatchKey,
        byNameOnly,
        byNormSurname,
        bySurnameClass,
        byContactKey,
        byBillingPlanKey,
        byTxnName,
    };
}
function uniqueIds(ids) {
    return [...new Set(ids)];
}
function toCandidate(id, strategy, confidence, indexes) {
    const l = indexes.byId.get(id);
    return {
        learnerId: id,
        fullName: l ? `${l.firstName} ${l.lastName}` : id,
        className: l?.className ?? null,
        strategy,
        confidence,
    };
}
function collectCandidatesForName(displayName, classHint, account, indexes, familyIndex, billingPlanItems, transactions, alreadyMatchedIds) {
    const { firstName, lastName } = parseBillingDisplayName(displayName);
    const candidates = [];
    const seen = new Set();
    const add = (ids, strategy, confidence) => {
        for (const id of uniqueIds(ids)) {
            if (alreadyMatchedIds.has(id) || seen.has(id))
                continue;
            seen.add(id);
            candidates.push(toCandidate(id, strategy, confidence, indexes));
        }
    };
    const className = classHint || "";
    const matchKey = (0, parsers_1.buildLearnerMatchKey)(`${firstName} ${lastName}`, className);
    add(indexes.byMatchKey.get(matchKey) || [], "match_key", "high");
    const nameOnlyKey = `${normName(lastName)}|${normName(firstName)}`;
    add(indexes.byNameOnly.get(nameOnlyKey) || [], "surname_first_name", "high");
    if (className) {
        const scKey = `${normSurname(lastName)}|${normClass(className)}`;
        const scHits = (indexes.bySurnameClass.get(scKey) || []).filter((id) => {
            const l = indexes.byId.get(id);
            return l ? firstNamesCompatible(firstName, l.firstName) : false;
        });
        add(scHits, "class_surname", scHits.length === 1 ? "high" : "medium");
    }
    const surHits = (indexes.byNormSurname.get(normSurname(lastName)) || []).filter((id) => {
        const l = indexes.byId.get(id);
        return l ? firstNamesCompatible(firstName, l.firstName) : false;
    });
    add(surHits, "surname_normalization", surHits.length === 1 ? "high" : "medium");
    const contactKey = normName(displayName);
    add(indexes.byContactKey.get(contactKey) || [], "contact_list", "high");
    const planKey = (0, parsers_1.buildLearnerMatchKey)(`${firstName} ${lastName}`, className);
    add(indexes.byBillingPlanKey.get(planKey) || [], "billing_plan", "high");
    const txnNameHits = indexes.byTxnName.get(contactKey) || [];
    add(txnNameHits, "transaction_name", uniqueIds(txnNameHits).length === 1 ? "high" : "medium");
    const accountFromFamily = (0, daSilvaMergedFamily_1.findAccountForLearnerName)(displayName, [account], familyIndex);
    if (accountFromFamily === account.accountNo) {
        const txnHits = transactions
            .filter((t) => t.accountNo === account.accountNo)
            .flatMap((t) => indexes.byTxnName.get(normName(t.fullName)) || []);
        add(txnHits, "age_analysis_txn_crossref", "medium");
    }
    const nicknameHits = surHits.filter((id) => {
        const l = indexes.byId.get(id);
        return l ? firstNamesCompatible(firstName, l.firstName) : false;
    });
    add(nicknameHits, "first_name_nickname", nicknameHits.length === 1 ? "high" : "low");
    for (const item of billingPlanItems) {
        if (item.matchKey !== planKey)
            continue;
        add(indexes.byBillingPlanKey.get(item.matchKey) || [], "billing_plan_crossref", "high");
    }
    const billingTokens = new Set(cleanBillingDisplayName(displayName)
        .split(/\s+/)
        .map((t) => normName(t))
        .filter(Boolean));
    if (billingTokens.size >= 2) {
        const tokenHits = [...indexes.byId.values()].filter((l) => {
            const learnerTokens = normName(`${l.firstName} ${l.lastName}`)
                .split(/\s+/)
                .filter(Boolean);
            return [...billingTokens].every((t) => learnerTokens.includes(t));
        });
        add(tokenHits.map((l) => l.id), "full_name_token_overlap", tokenHits.length === 1 ? "high" : "low");
    }
    const deduped = [];
    const seenKeys = new Set();
    for (const c of candidates) {
        const key = `${c.learnerId}|${c.strategy}`;
        if (seenKeys.has(key))
            continue;
        seenKeys.add(key);
        deduped.push(c);
    }
    return deduped;
}
function pickHighConfidenceCandidate(candidates) {
    const high = candidates.filter((c) => c.confidence === "high");
    const uniqueHigh = uniqueIds(high.map((c) => c.learnerId));
    if (uniqueHigh.length !== 1)
        return null;
    return high.find((c) => c.learnerId === uniqueHigh[0]) || null;
}
function trySiblingFamilyGroupMatch(displayNames, classHint, account, indexes, familyIndex, billingPlanItems, transactions, alreadyMatchedIds) {
    if (displayNames.length < 2) {
        return { learnerId: null, strategy: null, candidates: [] };
    }
    const perName = [];
    for (const name of displayNames) {
        const candidates = collectCandidatesForName(name, classHint, account, indexes, familyIndex, billingPlanItems, transactions, alreadyMatchedIds);
        perName.push({ name, pick: pickHighConfidenceCandidate(candidates), candidates });
    }
    const allHigh = perName.every((row) => row.pick);
    if (!allHigh) {
        return {
            learnerId: null,
            strategy: null,
            candidates: perName.flatMap((row) => row.candidates),
        };
    }
    const ids = perName.map((row) => row.pick.learnerId);
    if (uniqueIds(ids).length === displayNames.length) {
        return {
            learnerId: ids[0],
            strategy: "sibling_family_grouping",
            candidates: perName.flatMap((row) => row.candidates),
        };
    }
    return {
        learnerId: null,
        strategy: null,
        candidates: perName.flatMap((row) => row.candidates),
    };
}
function reasonFromCandidates(candidates, firstPassReason) {
    if (!candidates.length) {
        return firstPassReason || "No learner candidate matched name, class, or cross-reference keys";
    }
    const high = uniqueIds(candidates.filter((c) => c.confidence === "high").map((c) => c.learnerId));
    if (high.length > 1) {
        return `Ambiguous: ${high.length} high-confidence learners (${high.map((id) => id).join(", ")})`;
    }
    const any = uniqueIds(candidates.map((c) => c.learnerId));
    if (any.length > 1) {
        return `Ambiguous: ${any.length} candidates across strategies — manual review required`;
    }
    if (any.length === 1 && !candidates.some((c) => c.confidence === "high")) {
        return "Single medium/low-confidence candidate only — not auto-linked";
    }
    return firstPassReason || "No unique high-confidence match";
}
function buildFamilyIndexFromAccounts(accounts) {
    const index = {
        learnerNameToAccount: new Map(),
        accountToLearnerNames: new Map(),
    };
    for (const account of accounts) {
        const names = account.learnerNames?.length
            ? account.learnerNames
            : (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName);
        for (const name of names.length ? names : [account.fullName]) {
            (0, daSilvaMergedFamily_1.addLearnerToFamilyIndex)(index, account.accountNo, name);
        }
    }
    return index;
}
function applySecondPassBillingMatch(firstPass, input, accountBalances) {
    const billingPlanItems = input.billingPlanItems || [];
    const transactions = input.transactions || [];
    const contacts = input.contacts || [];
    const familyIndex = buildFamilyIndexFromAccounts(input.accounts);
    const indexes = buildLearnerIndexes(input.dbLearners, contacts, billingPlanItems, transactions);
    const accountByNo = new Map(input.accounts.map((a) => [a.accountNo, a]));
    const matchedLearnerIds = new Set(firstPass.matched.filter((r) => r.learnerId).map((r) => r.learnerId));
    const matched = [...firstPass.matched];
    const duplicateMatches = [...firstPass.duplicateMatches];
    const reconciliationRows = [];
    const autoMatched = [];
    const manualReviewRequired = [];
    const stillUnmatchedRows = [];
    let secondPassAutoMatched = 0;
    for (const row of firstPass.unmatchedAccounts) {
        const account = accountByNo.get(row.accountNo);
        const displayNames = account
            ? account.learnerNames?.length
                ? account.learnerNames
                : (0, daSilvaMergedFamily_1.splitMergedAccountNames)(account.fullName)
            : (0, daSilvaMergedFamily_1.splitMergedAccountNames)(row.fullName);
        const names = displayNames.length ? displayNames : [row.fullName];
        const classHint = account?.section && !/^general$/i.test(account.section) ? account.section : null;
        let candidates = names.flatMap((name) => collectCandidatesForName(name, classHint, account || {
            accountNo: row.accountNo,
            fullName: row.fullName,
            balance: accountBalances.get(row.accountNo) ?? 0,
            section: "",
        }, indexes, familyIndex, billingPlanItems, transactions, matchedLearnerIds));
        let secondPassLearnerId = null;
        let secondPassStrategy = null;
        let secondPassConfidence = null;
        const siblingTry = trySiblingFamilyGroupMatch(names, classHint, account || {
            accountNo: row.accountNo,
            fullName: row.fullName,
            balance: 0,
            section: "",
        }, indexes, familyIndex, billingPlanItems, transactions, matchedLearnerIds);
        if (siblingTry.learnerId) {
            secondPassLearnerId = siblingTry.learnerId;
            secondPassStrategy = siblingTry.strategy;
            secondPassConfidence = "high";
            candidates = [...candidates, ...siblingTry.candidates];
        }
        if (!secondPassLearnerId) {
            for (const name of names) {
                const nameCandidates = collectCandidatesForName(name, classHint, account || {
                    accountNo: row.accountNo,
                    fullName: row.fullName,
                    balance: accountBalances.get(row.accountNo) ?? 0,
                    section: "",
                }, indexes, familyIndex, billingPlanItems, transactions, matchedLearnerIds);
                const pick = pickHighConfidenceCandidate(nameCandidates);
                if (pick) {
                    secondPassLearnerId = pick.learnerId;
                    secondPassStrategy = pick.strategy;
                    secondPassConfidence = pick.confidence;
                    candidates = [...candidates, ...nameCandidates];
                    break;
                }
            }
        }
        if (!secondPassLearnerId && names.length > 1) {
            const resolved = [];
            for (const name of names) {
                const nameCandidates = collectCandidatesForName(name, classHint, account || {
                    accountNo: row.accountNo,
                    fullName: row.fullName,
                    balance: 0,
                    section: "",
                }, indexes, familyIndex, billingPlanItems, transactions, matchedLearnerIds);
                const pick = pickHighConfidenceCandidate(nameCandidates);
                if (pick)
                    resolved.push(pick);
                candidates = [...candidates, ...nameCandidates];
            }
            const uniqueResolved = uniqueIds(resolved.map((r) => r.learnerId));
            if (uniqueResolved.length === 1) {
                const pick = resolved.find((r) => r.learnerId === uniqueResolved[0]);
                secondPassLearnerId = pick.learnerId;
                secondPassStrategy = "sibling_single_active_match";
                secondPassConfidence = "high";
            }
        }
        if (!secondPassLearnerId && names.length === 1 && classHint) {
            const { lastName } = parseBillingDisplayName(names[0]);
            const scKey = `${normSurname(lastName)}|${normClass(classHint)}`;
            const scHits = (indexes.bySurnameClass.get(scKey) || []).filter((id) => {
                const l = indexes.byId.get(id);
                return l
                    ? firstNamesCompatible(parseBillingDisplayName(names[0]).firstName, l.firstName)
                    : false;
            });
            if (scHits.length === 1) {
                secondPassLearnerId = scHits[0];
                secondPassStrategy = "class_surname_fallback";
                secondPassConfidence = "high";
            }
        }
        const firstPassReason = row.ambiguous
            ? `First pass ambiguous (${row.strategy || "multiple strategies"})`
            : row.strategy
                ? `First pass strategy "${row.strategy}" found no unique learner`
                : null;
        let reasonNotMatched = reasonFromCandidates(candidates, firstPassReason);
        if (secondPassLearnerId && secondPassConfidence === "high") {
            reasonNotMatched = `Second pass auto-linked via ${secondPassStrategy} (${secondPassConfidence})`;
        }
        let disposition = "still_unmatched";
        if (secondPassLearnerId && secondPassConfidence === "high") {
            disposition = "auto_matched";
        }
        else if (candidates.length > 0) {
            disposition = "manual_review";
        }
        const reconRow = {
            accountNo: row.accountNo,
            learnerName: names[0] || row.fullName,
            siblingFamilyNames: names.length > 1 ? names : [],
            balance: accountBalances.get(row.accountNo) ?? account?.balance ?? 0,
            matchedCandidates: candidates,
            reasonNotMatched,
            secondPassLearnerId,
            secondPassStrategy,
            secondPassConfidence,
            disposition,
        };
        reconciliationRows.push(reconRow);
        if (disposition === "auto_matched" && secondPassLearnerId) {
            const mergedRow = {
                ...row,
                learnerId: secondPassLearnerId,
                strategy: secondPassStrategy,
                ambiguous: false,
            };
            matched.push(mergedRow);
            matchedLearnerIds.add(secondPassLearnerId);
            secondPassAutoMatched += 1;
            autoMatched.push(reconRow);
        }
        else if (disposition === "manual_review") {
            manualReviewRequired.push(reconRow);
        }
        else {
            stillUnmatchedRows.push(reconRow);
        }
    }
    const unmatchedAccounts = firstPass.unmatchedAccounts
        .filter((row) => !autoMatched.some((a) => a.accountNo === row.accountNo))
        .filter((row) => !matched.some((m) => m.accountNo === row.accountNo && m.learnerId));
    const firstPassMatched = firstPass.matched.filter((r) => r.learnerId).length;
    const totalMatched = matched.filter((r) => r.learnerId).length;
    const report = {
        generatedAt: new Date().toISOString(),
        totalAccounts: input.accounts.length,
        firstPassMatched,
        secondPassAutoMatched,
        totalMatched,
        stillUnmatched: unmatchedAccounts.length,
        autoMatched,
        manualReviewRequired,
        stillUnmatchedRows,
        reconciliationRows,
    };
    const unmatchedLearners = input.dbLearners
        .filter((l) => !matchedLearnerIds.has(l.id))
        .map((l) => ({
        learnerId: l.id,
        fullName: `${l.firstName} ${l.lastName}`,
        className: l.className,
    }));
    return {
        audit: {
            matched,
            unmatchedAccounts,
            duplicateMatches,
            unmatchedLearners,
        },
        report,
    };
}
