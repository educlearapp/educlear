"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normSasamsLearnerNameKey = normSasamsLearnerNameKey;
exports.normSasamsLearnerNameDobKey = normSasamsLearnerNameDobKey;
exports.buildSasamsRegisterLookupIndexes = buildSasamsRegisterLookupIndexes;
exports.lookupSasamsRegisterForClassLearner = lookupSasamsRegisterForClassLearner;
exports.sasamsParsedToProfileFields = sasamsParsedToProfileFields;
exports.buildSasamsLearnerProfileWriteData = buildSasamsLearnerProfileWriteData;
exports.countProfileFieldsWritten = countProfileFieldsWritten;
exports.mergeProfileWriteCounts = mergeProfileWriteCounts;
const kideesysSpreadsheet_1 = require("../../utils/kideesysSpreadsheet");
const learnerGender_1 = require("../../utils/learnerGender");
function digitsOnly(value) {
    return String(value || "").replace(/\D/g, "");
}
function hasText(value) {
    return Boolean(String(value ?? "").trim());
}
function normSasamsLearnerNameKey(firstName, lastName) {
    return (0, kideesysSpreadsheet_1.normalizeMatchText)(`${firstName} ${lastName}`.trim());
}
function normSasamsLearnerNameDobKey(firstName, lastName, birthDate) {
    if (!birthDate || Number.isNaN(birthDate.getTime()))
        return null;
    return `${normSasamsLearnerNameKey(firstName, lastName)}|${birthDate.toISOString().slice(0, 10)}`;
}
function pickBestRegisterCandidate(rows) {
    return [...rows].sort((a, b) => registerProfileScore(b) - registerProfileScore(a))[0];
}
function registerProfileScore(row) {
    let score = 0;
    if (row.birthDate)
        score += 4;
    if (hasText(row.gender))
        score += 4;
    if (hasText(row.idNumber))
        score += 2;
    if (hasText(row.language))
        score += 1;
    if (hasText(row.citizenship))
        score += 1;
    if (hasText(row.admissionNo))
        score += 1;
    return score;
}
function buildSasamsRegisterLookupIndexes(registerLearners) {
    const byAdmission = new Map();
    const byId = new Map();
    const byNormName = new Map();
    const byNormNameDob = new Map();
    const byMatchKey = new Map();
    for (const row of registerLearners) {
        if (row.admissionNo) {
            byAdmission.set((0, kideesysSpreadsheet_1.normalizeMatchText)(row.admissionNo), row);
            const admDigits = digitsOnly(row.admissionNo);
            if (admDigits.length >= 6)
                byId.set((0, kideesysSpreadsheet_1.normalizeMatchText)(admDigits), row);
        }
        if (row.sasamsLearnerNo && row.sasamsLearnerNo !== row.admissionNo) {
            byAdmission.set((0, kideesysSpreadsheet_1.normalizeMatchText)(row.sasamsLearnerNo), row);
        }
        if (row.idNumber) {
            const idDigits = digitsOnly(row.idNumber);
            if (idDigits.length >= 6)
                byId.set((0, kideesysSpreadsheet_1.normalizeMatchText)(idDigits), row);
        }
        const nameKey = normSasamsLearnerNameKey(row.firstName, row.lastName);
        const nameList = byNormName.get(nameKey) || [];
        nameList.push(row);
        byNormName.set(nameKey, nameList);
        const dobKey = normSasamsLearnerNameDobKey(row.firstName, row.lastName, row.birthDate);
        if (dobKey && !byNormNameDob.has(dobKey)) {
            byNormNameDob.set(dobKey, row);
        }
        byMatchKey.set(row.matchKey, row);
    }
    return { byAdmission, byId, byNormName, byNormNameDob, byMatchKey };
}
/**
 * Match a class-list learner to learner_register by:
 * ID number → admission/accession number → name+surname → name+surname+DOB.
 */
function lookupSasamsRegisterForClassLearner(fromClass, indexes) {
    const classIdDigits = digitsOnly(fromClass.idNumber);
    if (classIdDigits.length >= 6) {
        const byClassId = indexes.byId.get((0, kideesysSpreadsheet_1.normalizeMatchText)(classIdDigits));
        if (byClassId)
            return byClassId;
    }
    const classAdmDigits = digitsOnly(fromClass.admissionNo);
    if (classAdmDigits.length >= 6) {
        const byAdmAsId = indexes.byId.get((0, kideesysSpreadsheet_1.normalizeMatchText)(classAdmDigits));
        if (byAdmAsId)
            return byAdmAsId;
    }
    if (fromClass.admissionNo) {
        const byAdmission = indexes.byAdmission.get((0, kideesysSpreadsheet_1.normalizeMatchText)(fromClass.admissionNo));
        if (byAdmission)
            return byAdmission;
    }
    if (fromClass.sasamsLearnerNo) {
        const byAccession = indexes.byAdmission.get((0, kideesysSpreadsheet_1.normalizeMatchText)(fromClass.sasamsLearnerNo));
        if (byAccession)
            return byAccession;
    }
    const nameKey = normSasamsLearnerNameKey(fromClass.firstName, fromClass.lastName);
    const dobKeyFromClass = normSasamsLearnerNameDobKey(fromClass.firstName, fromClass.lastName, fromClass.birthDate);
    if (dobKeyFromClass) {
        const byNameDob = indexes.byNormNameDob.get(dobKeyFromClass);
        if (byNameDob)
            return byNameDob;
    }
    const nameHits = indexes.byNormName.get(nameKey);
    if (nameHits?.length === 1)
        return nameHits[0];
    if (nameHits && nameHits.length > 1) {
        if (classIdDigits.length >= 6) {
            const narrowed = nameHits.find((r) => digitsOnly(r.idNumber) === classIdDigits);
            if (narrowed)
                return narrowed;
        }
        if (fromClass.admissionNo) {
            const admKey = (0, kideesysSpreadsheet_1.normalizeMatchText)(fromClass.admissionNo);
            const narrowed = nameHits.find((r) => (r.admissionNo && (0, kideesysSpreadsheet_1.normalizeMatchText)(r.admissionNo) === admKey) ||
                (r.sasamsLearnerNo && (0, kideesysSpreadsheet_1.normalizeMatchText)(r.sasamsLearnerNo) === admKey));
            if (narrowed)
                return narrowed;
        }
        return pickBestRegisterCandidate(nameHits);
    }
    if (fromClass.idNumber) {
        const byId = indexes.byId.get((0, kideesysSpreadsheet_1.normalizeMatchText)(fromClass.idNumber));
        if (byId)
            return byId;
    }
    return indexes.byMatchKey.get(fromClass.matchKey) ?? null;
}
function sasamsParsedToProfileFields(row) {
    return {
        admissionNo: row.admissionNo,
        idNumber: row.idNumber,
        birthDate: row.birthDate,
        gender: (0, learnerGender_1.resolveLearnerGender)({ gender: row.gender, idNumber: row.idNumber }),
        homeLanguage: row.language,
        citizenship: row.citizenship,
    };
}
function pickString(incoming, existing) {
    const inc = String(incoming ?? "").trim();
    if (!inc)
        return undefined;
    const cur = String(existing ?? "").trim();
    if (cur === inc)
        return undefined;
    return inc;
}
function pickDate(incoming, existing) {
    if (!incoming || Number.isNaN(incoming.getTime()))
        return undefined;
    if (existing && incoming.getTime() === existing.getTime())
        return undefined;
    return incoming;
}
/** Build Prisma learner update payload — never overwrite a real value with blank. */
function buildSasamsLearnerProfileWriteData(incoming, existing) {
    const genderIncoming = (0, learnerGender_1.normalizeLearnerGender)(incoming.gender) ||
        (0, learnerGender_1.resolveLearnerGender)({ gender: incoming.gender, idNumber: incoming.idNumber });
    const data = {};
    const admissionNo = pickString(incoming.admissionNo, existing?.admissionNo);
    if (admissionNo)
        data.admissionNo = admissionNo;
    const idNumber = pickString(incoming.idNumber, existing?.idNumber);
    if (idNumber)
        data.idNumber = idNumber;
    const homeLanguage = pickString(incoming.homeLanguage, existing?.homeLanguage);
    if (homeLanguage)
        data.homeLanguage = homeLanguage;
    const citizenship = pickString(incoming.citizenship, existing?.citizenship);
    if (citizenship)
        data.citizenship = citizenship;
    const gender = pickString(genderIncoming, existing?.gender);
    if (gender)
        data.gender = gender;
    const birthDate = pickDate(incoming.birthDate, existing?.birthDate ?? null);
    if (birthDate)
        data.birthDate = birthDate;
    return data;
}
function countProfileFieldsWritten(data) {
    return {
        dobWritten: data.birthDate ? 1 : 0,
        genderWritten: data.gender ? 1 : 0,
        idNumbersWritten: data.idNumber ? 1 : 0,
        homeLanguageWritten: data.homeLanguage ? 1 : 0,
        citizenshipWritten: data.citizenship ? 1 : 0,
    };
}
function mergeProfileWriteCounts(a, b) {
    return {
        dobWritten: a.dobWritten + b.dobWritten,
        genderWritten: a.genderWritten + b.genderWritten,
        idNumbersWritten: a.idNumbersWritten + b.idNumbersWritten,
        homeLanguageWritten: a.homeLanguageWritten + b.homeLanguageWritten,
        citizenshipWritten: a.citizenshipWritten + b.citizenshipWritten,
    };
}
