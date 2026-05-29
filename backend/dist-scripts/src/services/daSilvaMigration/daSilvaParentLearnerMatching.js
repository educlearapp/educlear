"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLearnerMatchIndexes = buildLearnerMatchIndexes;
exports.matchParentToLearner = matchParentToLearner;
exports.auditParentMatches = auditParentMatches;
const classroomNormalization_1 = require("../../utils/classroomNormalization");
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
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
function nameOnlyKey(firstName, lastName) {
    return `${normName(lastName)}|${normName(firstName)}`;
}
function buildLearnerMatchIndexes(learners) {
    const byAdmission = new Map();
    const byIdNumber = new Map();
    const byNameClass = new Map();
    const byNameOnly = new Map();
    for (const l of learners) {
        const adm = normId(l.admissionNo);
        if (adm) {
            const list = byAdmission.get(adm) || [];
            list.push(l.id);
            byAdmission.set(adm, list);
        }
        const idn = normId(l.idNumber);
        if (idn.length >= 6) {
            const list = byIdNumber.get(idn) || [];
            list.push(l.id);
            byIdNumber.set(idn, list);
        }
        const key = `${normName(l.firstName)}|${normName(l.lastName)}|${normClass(l.className)}`;
        const list = byNameClass.get(key) || [];
        list.push(l.id);
        byNameClass.set(key, list);
        const nameKey = nameOnlyKey(l.firstName, l.lastName);
        const nameList = byNameOnly.get(nameKey) || [];
        nameList.push(l.id);
        byNameOnly.set(nameKey, nameList);
    }
    return { byAdmission, byIdNumber, byNameClass, byNameOnly };
}
function pickUnique(candidates) {
    const unique = [...new Set(candidates)];
    if (unique.length === 1)
        return { id: unique[0], ambiguous: false };
    if (unique.length === 0)
        return { id: null, ambiguous: false };
    return { id: null, ambiguous: true };
}
function matchParentToLearner(parent, indexes, learnersById) {
    const strategies = [];
    const lid = normId(parent.learnerIdNumber);
    if (lid.length >= 6) {
        strategies.push({ name: "learner_id_number", ids: indexes.byIdNumber.get(lid) || [] });
    }
    const adm = normId(parent.learnerAdmissionNo);
    if (adm) {
        strategies.push({ name: "learner_admission_no", ids: indexes.byAdmission.get(adm) || [] });
    }
    if (parent.learnerFirstName && parent.learnerLastName && parent.learnerClassName) {
        const key = `${normName(parent.learnerFirstName)}|${normName(parent.learnerLastName)}|${normClass(parent.learnerClassName)}`;
        strategies.push({ name: "learner_name_class", ids: indexes.byNameClass.get(key) || [] });
    }
    if (parent.learnerFirstName && parent.learnerLastName) {
        const nameKey = nameOnlyKey(parent.learnerFirstName, parent.learnerLastName);
        strategies.push({ name: "learner_surname_first_name", ids: indexes.byNameOnly.get(nameKey) || [] });
    }
    const parentPhone = normId(parent.cellNo || parent.homeNo);
    if (parentPhone.length >= 9 && parent.learnerFirstName && parent.learnerLastName) {
        const phoneHits = [];
        for (const learner of learnersById.values()) {
            if (normName(learner.firstName) === normName(parent.learnerFirstName) &&
                normName(learner.lastName) === normName(parent.learnerLastName)) {
                phoneHits.push(learner.id);
            }
        }
        if (phoneHits.length) {
            strategies.push({ name: "parent_phone_with_learner_name", ids: phoneHits });
        }
    }
    for (const s of strategies) {
        const { id, ambiguous } = pickUnique(s.ids);
        if (id) {
            return { learnerId: id, strategy: s.name, ambiguous: false, candidateIds: s.ids };
        }
        if (ambiguous) {
            return { learnerId: null, strategy: s.name, ambiguous: true, candidateIds: s.ids };
        }
    }
    return { learnerId: null, strategy: null, ambiguous: false, candidateIds: [] };
}
function auditParentMatches(parents, learners) {
    const indexes = buildLearnerMatchIndexes(learners);
    const learnersById = new Map(learners.map((l) => [l.id, l]));
    const rows = [];
    const unmatchedParents = [];
    const duplicateMatches = [];
    for (const parent of parents) {
        const match = matchParentToLearner(parent, indexes, learnersById);
        const row = {
            parentFirstName: parent.firstName,
            parentSurname: parent.surname,
            learnerAdmissionNo: parent.learnerAdmissionNo,
            learnerIdNumber: parent.learnerIdNumber,
            learnerName: parent.learnerFirstName && parent.learnerLastName
                ? `${parent.learnerFirstName} ${parent.learnerLastName}`
                : null,
            learnerClassName: parent.learnerClassName,
            matched: Boolean(match.learnerId),
            strategy: match.strategy,
            ambiguous: match.ambiguous,
            archived: parent.archived,
        };
        rows.push(row);
        if (!match.learnerId)
            unmatchedParents.push(row);
        if (match.ambiguous)
            duplicateMatches.push(row);
    }
    return { rows, unmatchedParents, duplicateMatches };
}
