"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyDaSilvaUploadFile = classifyDaSilvaUploadFile;
exports.canonicalRelativePathForSlot = canonicalRelativePathForSlot;
const path_1 = __importDefault(require("path"));
const CLASS_LIST_FIELDS = new Set([
    "classlistfiles",
    "classlists",
    "classlist",
    "sasamsclasslists",
]);
const FIELD_TO_SLOT = {
    learnerregister: "learnerRegister",
    learner_register: "learnerRegister",
    sasamslearnerregister: "learnerRegister",
    parentlearnerlinks: "parentLearnerLinks",
    parent_learner_links: "parentLearnerLinks",
    sasamsparentlearnerlinks: "parentLearnerLinks",
    parentregister: "parentRegister",
    parent_register: "parentRegister",
    sasamsparentregister: "parentRegister",
    billingplansummary: "billingPlanSummary",
    billing_plan_summary: "billingPlanSummary",
    billingplan: "billingPlanSummary",
    "03_billing_plan_summary_by_child": "billingPlanSummary",
    ageanalysis: "ageAnalysis",
    age_analysis: "ageAnalysis",
    accountlistageanalysis: "ageAnalysis",
    "02_account_list_age_analysis": "ageAnalysis",
    transactionlist: "transactionList",
    transaction_list: "transactionList",
    "01_transaction_list": "transactionList",
    transactions: "transactionList",
    contactlist: "contactList",
    contact_list: "contactList",
    "04_contact_list": "contactList",
    kidesycontactlist: "contactList",
    kideesyscontactlist: "contactList",
    contactlistfile: "contactList",
    employeecontactlist: "employeeContactList",
    employee_contact_list: "employeeContactList",
    "06_employees": "employeeContactList",
    employees: "employeeContactList",
    kideesysemployees: "employeeContactList",
};
function normalizeField(field) {
    return String(field || "")
        .trim()
        .toLowerCase()
        .replace(/\[\d*\]$/i, "");
}
function isClassListField(field) {
    const n = normalizeField(field);
    if (CLASS_LIST_FIELDS.has(n))
        return true;
    return /^classlistfiles/i.test(field.trim());
}
function lowerName(originalName) {
    return path_1.default.basename(String(originalName || "")).toLowerCase();
}
function isSpreadsheet(originalName) {
    return /\.xlsx?$/i.test(originalName);
}
function classifyByFilename(originalName) {
    const name = lowerName(originalName);
    if (!name || !isSpreadsheet(originalName))
        return "unknown";
    if (name.includes("employee") || name.includes("06_employee")) {
        return "employeeContactList";
    }
    if (name.includes("learner_register") || name.includes("learner register")) {
        return "learnerRegister";
    }
    if (name.includes("parent_learner") || name.includes("parent learner")) {
        return "parentLearnerLinks";
    }
    if (name.includes("parent_register") || name.includes("parent register")) {
        return "parentRegister";
    }
    if (name.includes("billing_plan") || name.includes("billing plan")) {
        return "billingPlanSummary";
    }
    if (name.includes("age_analysis") || name.includes("age analysis") || name.includes("account_list")) {
        return "ageAnalysis";
    }
    if (name.includes("transaction_list") || name.includes("transaction list") || name === "01_transaction_list.xls") {
        return "transactionList";
    }
    if (name.includes("contact_list") ||
        name.includes("04_contact") ||
        (name.includes("contact") && !name.includes("employee"))) {
        return "contactList";
    }
    if (name.includes("class") && !name.includes("register")) {
        return "classList";
    }
    return "unknown";
}
function classifyDaSilvaUploadFile(fieldname, originalname) {
    const field = String(fieldname || "").trim();
    if (isClassListField(field))
        return "classList";
    const normalized = normalizeField(field);
    if (FIELD_TO_SLOT[normalized])
        return FIELD_TO_SLOT[normalized];
    return classifyByFilename(originalname);
}
function canonicalRelativePathForSlot(kind, originalname) {
    switch (kind) {
        case "classList":
            return `sasams/class_lists/${path_1.default.basename(originalname)}`;
        case "learnerRegister":
            return "sasams/learner_register.xls";
        case "parentLearnerLinks":
            return "sasams/parent_learner_links.xls";
        case "parentRegister":
            return "sasams/parent_register.xls";
        case "billingPlanSummary":
            return "kideesys/billing_plan_summary.xls";
        case "ageAnalysis":
            return "kideesys/age_analysis.xls";
        case "transactionList":
            return "kideesys/transaction_list.xls";
        case "contactList":
            return "kideesys/contact_list.xls";
        case "employeeContactList":
            return "kideesys/employee_contact_list.xls";
        default:
            return null;
    }
}
