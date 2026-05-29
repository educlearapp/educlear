"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAPPED_CONFIDENCE_THRESHOLD = void 0;
exports.suggestColumnMappings = suggestColumnMappings;
const genericExcelMetadata_1 = require("../adapters/genericExcelMetadata");
const genericExcelNormalization_1 = require("../adapters/genericExcelNormalization");
const kideesysNormalization_1 = require("../adapters/kideesysNormalization");
const sasamsMetadata_1 = require("../adapters/sasamsMetadata");
const sasamsNormalization_1 = require("../adapters/sasamsNormalization");
const MAPPED_CONFIDENCE_THRESHOLD = 80;
exports.MAPPED_CONFIDENCE_THRESHOLD = MAPPED_CONFIDENCE_THRESHOLD;
const MIN_SUGGESTION_CONFIDENCE = 45;
function compactColumnKey(value) {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function columnHaystack(column) {
    return compactColumnKey(column);
}
/** Short tokens must match exactly or as a clear prefix/suffix segment (avoids "paid" → "id"). */
function matchesKeyword(haystack, keyword) {
    const key = compactColumnKey(keyword);
    if (!key || !haystack)
        return false;
    if (haystack === key)
        return true;
    if (key.length <= 4) {
        return false;
    }
    return haystack.includes(key);
}
const KEYWORD_RULES = [
    {
        target: "fullName",
        keywords: [
            "learnername",
            "childname",
            "studentname",
            "pupilname",
            "fullname",
            "learner",
            "child",
            "student",
            "pupil",
        ],
        baseConfidence: 88,
        reason: "Column name matches learner / child / student name",
        categoryBoost: ["learners"],
    },
    {
        target: "firstName",
        keywords: ["firstname", "first", "givenname", "forename"],
        baseConfidence: 90,
        reason: "Column name matches first name",
        categoryBoost: ["learners"],
    },
    {
        target: "lastName",
        keywords: ["lastname", "surname", "familyname", "last"],
        baseConfidence: 90,
        reason: "Column name matches last name or surname",
        categoryBoost: ["learners"],
    },
    {
        target: "grade",
        keywords: ["grade", "year", "form"],
        baseConfidence: 86,
        reason: "Column name matches grade or year level",
        categoryBoost: ["learners"],
    },
    {
        target: "classroom",
        keywords: ["classroom", "class", "registerclass", "register", "homeroom", "section"],
        baseConfidence: 84,
        reason: "Column name matches class or register class",
        categoryBoost: ["learners"],
    },
    {
        target: "gender",
        keywords: ["gender", "sex"],
        baseConfidence: 92,
        reason: "Column name matches gender",
        categoryBoost: ["learners"],
    },
    {
        target: "dateOfBirth",
        keywords: ["dateofbirth", "dob", "birthdate", "birthday", "born"],
        baseConfidence: 90,
        reason: "Column name matches date of birth",
        categoryBoost: ["learners"],
    },
    {
        target: "idNumber",
        keywords: ["idnumber", "idno", "identitynumber", "nationalid", "passport", "emis"],
        baseConfidence: 82,
        reason: "Column name matches ID or identity number",
        categoryBoost: ["learners"],
    },
    {
        target: "learnerNumber",
        keywords: ["admissionnumber", "admissionno", "registernumber", "learnernumber"],
        baseConfidence: 86,
        reason: "Column name matches admission or register number",
        categoryBoost: ["learners"],
    },
    {
        target: "admissionDate",
        keywords: ["admissiondate", "dateofadmission"],
        baseConfidence: 88,
        reason: "Column name matches admission date",
        categoryBoost: ["learners"],
    },
    {
        target: "status",
        keywords: ["status", "enrolment", "enrollment", "active", "learnerstatus"],
        baseConfidence: 85,
        reason: "Column name matches learner status",
        categoryBoost: ["learners"],
    },
    {
        target: "homeLanguage",
        keywords: ["homelanguage", "language", "mediumofinstruction"],
        baseConfidence: 88,
        reason: "Column name matches home language",
        categoryBoost: ["learners"],
    },
    {
        target: "citizenship",
        keywords: ["citizenship", "nationality", "countryofbirth"],
        baseConfidence: 88,
        reason: "Column name matches citizenship or nationality",
        categoryBoost: ["learners"],
    },
    {
        target: "nickname",
        keywords: ["nickname", "knownas", "preferredname"],
        baseConfidence: 86,
        reason: "Column name matches nickname",
        categoryBoost: ["learners"],
    },
    {
        target: "parentIdNumber",
        keywords: ["parentid", "parentidnumber", "guardianid", "idnumber"],
        baseConfidence: 82,
        reason: "Column name matches parent ID number",
        categoryBoost: ["parents"],
    },
    {
        target: "parentFirstName",
        keywords: ["parentfirstname", "fatherfirstname", "motherfirstname"],
        baseConfidence: 88,
        reason: "Column name matches parent first name",
        categoryBoost: ["parents"],
    },
    {
        target: "parentSurname",
        keywords: ["parentsurname", "parentlastname", "fathersurname", "mothersurname"],
        baseConfidence: 88,
        reason: "Column name matches parent surname",
        categoryBoost: ["parents"],
    },
    {
        target: "parentWorkPhone",
        keywords: ["workno", "workphone", "officephone", "worktel"],
        baseConfidence: 84,
        reason: "Column name matches work phone",
        categoryBoost: ["parents"],
    },
    {
        target: "parentName",
        keywords: [
            "parentname",
            "guardian",
            "parent",
            "mother",
            "father",
            "mom",
            "dad",
            "contactname",
            "responsibleparty",
        ],
        baseConfidence: 88,
        reason: "Column name matches parent or guardian",
        categoryBoost: ["parents"],
    },
    {
        target: "parentEmail",
        keywords: ["email", "parentemail", "guardianemail", "mail"],
        baseConfidence: 90,
        reason: "Column name matches email",
        categoryBoost: ["parents"],
    },
    {
        target: "parentPhone",
        keywords: ["cell", "mobile", "phone", "tel", "telephone", "contactnumber", "parentphone"],
        baseConfidence: 88,
        reason: "Column name matches phone or mobile",
        categoryBoost: ["parents"],
    },
    {
        target: "relationship",
        keywords: ["relationship", "relation", "kinship", "contacttype"],
        baseConfidence: 90,
        reason: "Column name matches relationship",
        categoryBoost: ["parents"],
    },
    {
        target: "address",
        keywords: ["address", "street", "suburb", "city", "postal", "postcode", "physical"],
        baseConfidence: 86,
        reason: "Column name matches address",
        categoryBoost: ["parents"],
    },
    {
        target: "accountNumber",
        keywords: ["accountnumber", "accountno", "accno", "ledger", "accountcode"],
        baseConfidence: 88,
        reason: "Column name matches account number",
        categoryBoost: ["billing"],
    },
    {
        target: "accountName",
        keywords: ["accountname", "accountholder", "billingname"],
        baseConfidence: 86,
        reason: "Column name matches account name",
        categoryBoost: ["billing"],
    },
    {
        target: "openingBalance",
        keywords: ["openingbalance", "openbalance", "bf", "broughtforward", "opening"],
        baseConfidence: 88,
        reason: "Column name matches opening balance",
        categoryBoost: ["billing"],
    },
    {
        target: "currentBalance",
        keywords: [
            "balance",
            "outstanding",
            "amountdue",
            "arrears",
            "closingbalance",
            "currentbalance",
            "owed",
        ],
        baseConfidence: 86,
        reason: "Column name matches balance or amount due",
        categoryBoost: ["billing", "transactions"],
    },
    {
        target: "feeAmount",
        keywords: ["fee", "feeamount", "amount", "chargeamount", "tuition"],
        baseConfidence: 80,
        reason: "Column name matches fee amount",
        categoryBoost: ["billing"],
    },
    {
        target: "billingPlan",
        keywords: ["billingplan", "plan", "feeplan", "package"],
        baseConfidence: 84,
        reason: "Column name matches billing plan",
        categoryBoost: ["billing"],
    },
    {
        target: "transactionDate",
        keywords: ["transactiondate", "transdate", "txdate", "posteddate", "valuedate", "date"],
        baseConfidence: 86,
        reason: "Column name matches transaction date",
        categoryBoost: ["transactions"],
    },
    {
        target: "transactionType",
        keywords: ["transactiontype", "type", "transtype", "entrytype"],
        baseConfidence: 84,
        reason: "Column name matches transaction type",
        categoryBoost: ["transactions"],
    },
    {
        target: "reference",
        keywords: ["reference", "ref", "receiptno", "invoiceno", "docno", "document"],
        baseConfidence: 82,
        reason: "Column name matches reference number",
        categoryBoost: ["transactions"],
    },
    {
        target: "description",
        keywords: ["description", "narrative", "details", "memo", "comment"],
        baseConfidence: 86,
        reason: "Column name matches description",
        categoryBoost: ["transactions"],
    },
    {
        target: "debit",
        keywords: ["debit", "invoice", "charge", "dr", "debitamount"],
        baseConfidence: 88,
        reason: "Column name matches debit or charge",
        categoryBoost: ["transactions", "billing"],
    },
    {
        target: "credit",
        keywords: ["credit", "receipt", "payment", "cr", "creditamount", "paid"],
        baseConfidence: 88,
        reason: "Column name matches credit or payment",
        categoryBoost: ["transactions"],
    },
    {
        target: "amount",
        keywords: ["amount", "value", "total", "sum"],
        baseConfidence: 78,
        reason: "Column name matches monetary amount",
        categoryBoost: ["transactions", "billing"],
    },
    {
        target: "balance",
        keywords: ["runningbalance", "ledgerbalance", "balanceafter"],
        baseConfidence: 84,
        reason: "Column name matches running balance",
        categoryBoost: ["transactions"],
    },
];
function scoreRule(haystack, rule, category) {
    const matched = rule.keywords.filter((kw) => matchesKeyword(haystack, kw));
    if (matched.length === 0)
        return null;
    let score = rule.baseConfidence;
    const longest = matched.reduce((a, b) => (compactColumnKey(a).length >= compactColumnKey(b).length ? a : b));
    if (compactColumnKey(longest).length >= 8)
        score += 4;
    const cat = category.toLowerCase();
    if (rule.categoryBoost?.some((c) => cat === c || cat.includes(c))) {
        score += 6;
    }
    if (score > 98)
        score = 98;
    return { score, reason: rule.reason };
}
function isGenericExcelSystemId(systemId) {
    const id = String(systemId || "").trim();
    return id === "generic-excel-csv" || id === "generic-excel";
}
function kidESysMappingForColumn(column, category) {
    const target = (0, kideesysNormalization_1.normalizeKidESysColumn)(column, category);
    if (!target)
        return null;
    return {
        target,
        confidence: 92,
        reason: "Kid-e-Sys adapter v1 column normalization",
    };
}
function genericExcelMappingForColumn(column) {
    const target = (0, genericExcelNormalization_1.normalizeGenericExcelColumn)(column);
    if (!target)
        return null;
    const ambiguous = (0, genericExcelNormalization_1.isAmbiguousGenericExcelColumn)(column);
    const rules = genericExcelMetadata_1.GENERIC_EXCEL_CONFIDENCE_RULES;
    return {
        target,
        confidence: ambiguous
            ? rules.ambiguousMappingConfidence
            : rules.confidentMappingConfidence,
        reason: ambiguous
            ? "Generic Excel/CSV alias (ambiguous — review manually)"
            : "Generic Excel/CSV adapter v1 column normalization",
    };
}
function sasamsMappingForColumn(column) {
    const target = (0, sasamsNormalization_1.normalizeSASAMSColumn)(column);
    if (!target)
        return null;
    const ambiguous = (0, sasamsNormalization_1.isAmbiguousSASAMSColumn)(column);
    const rules = sasamsMetadata_1.SASAMS_CONFIDENCE_RULES;
    return {
        target,
        confidence: ambiguous
            ? rules.ambiguousMappingConfidence
            : rules.confidentMappingConfidence,
        reason: ambiguous
            ? "SA-SAMS adapter v1 alias (ambiguous — review manually)"
            : "SA-SAMS adapter v1 column normalization",
    };
}
function bestMappingForColumn(column, category, systemId) {
    if (String(systemId || "").trim() === "kideesys") {
        const kidMatch = kidESysMappingForColumn(column, category);
        if (kidMatch)
            return kidMatch;
    }
    if (String(systemId || "").trim() === "sasams") {
        const sasamsMatch = sasamsMappingForColumn(column);
        if (sasamsMatch)
            return sasamsMatch;
    }
    if (isGenericExcelSystemId(systemId)) {
        const genericMatch = genericExcelMappingForColumn(column);
        if (genericMatch)
            return genericMatch;
    }
    const haystack = columnHaystack(column);
    let best = null;
    for (const rule of KEYWORD_RULES) {
        const scored = scoreRule(haystack, rule, category);
        if (!scored)
            continue;
        if (!best || scored.score > best.confidence) {
            best = { target: rule.target, confidence: scored.score, reason: scored.reason };
        }
    }
    if (!best || best.confidence < MIN_SUGGESTION_CONFIDENCE)
        return null;
    return best;
}
/**
 * Keyword-based column → EduClear field mapping suggestions (no DB, no import).
 */
function suggestColumnMappings(input) {
    const columns = (input.columns || []).filter((c) => String(c).trim().length > 0);
    const mappings = [];
    const unmappedColumns = [];
    const systemId = String(input.systemId || "").trim() || undefined;
    for (const sourceColumn of columns) {
        const match = bestMappingForColumn(sourceColumn, input.category, systemId);
        if (!match) {
            unmappedColumns.push(sourceColumn);
            mappings.push({
                sourceColumn,
                suggestedTarget: null,
                confidence: 0,
                reason: "No confident keyword match for this column",
            });
            continue;
        }
        mappings.push({
            sourceColumn,
            suggestedTarget: match.target,
            confidence: match.confidence,
            reason: match.reason,
        });
        if (match.confidence < MAPPED_CONFIDENCE_THRESHOLD) {
            unmappedColumns.push(sourceColumn);
        }
    }
    return {
        fileId: input.fileId,
        filename: input.filename,
        category: input.category,
        mappings,
        unmappedColumns,
    };
}
