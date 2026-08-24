/**
 * Content-first worksheet classification for Universal Migration.
 * Filename / sheet name are supporting signals only.
 */

import type { MigrationFileCategory } from "../types/MigrationFile";
import {
  classifyExpressInvoiceExport,
  expressInvoiceAuthorityForFilename,
} from "./expressInvoiceAuthority";

export type MigrationSheetRole = "DATA" | "SUPPORTING" | "SUMMARY" | "UNKNOWN";

export type MigrationSheetKind =
  | "learners"
  | "parents"
  | "learner_parent_links"
  | "classes"
  | "billing"
  | "invoices"
  | "payments"
  | "transactions"
  | "invoice_line_items"
  | "supporting"
  | "summary"
  | "unknown";

export type ClassifiedMigrationSheet = {
  category: MigrationFileCategory;
  sheetRole: MigrationSheetRole;
  sheetKind: MigrationSheetKind;
  reasons: string[];
};

function compact(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function compactList(headers: string[]): string[] {
  return headers.map(compact).filter(Boolean);
}

function has(keys: string[], token: string): boolean {
  const t = compact(token);
  return keys.some((k) => k === t || k.includes(t));
}

function hasAny(keys: string[], tokens: string[]): boolean {
  return tokens.some((t) => has(keys, t));
}

function hasAll(keys: string[], tokens: string[]): boolean {
  return tokens.every((t) => has(keys, t));
}

function sampleHaystack(sampleRows: Record<string, string>[], limit = 8): string {
  return sampleRows
    .slice(0, limit)
    .flatMap((row) => Object.values(row).map((v) => compact(String(v || ""))))
    .join(" ");
}

/**
 * Classify a worksheet from headers + sample values.
 * A summary sheet that mentions “Canonical learners” must not become a learner list.
 */
export function classifyMigrationSheet(input: {
  sheetName?: string;
  filename?: string;
  headers: string[];
  sampleRows?: Record<string, string>[];
}): ClassifiedMigrationSheet {
  const headers = compactList(input.headers || []);
  const sheet = compact(input.sheetName || "");
  const file = compact(input.filename || "");
  const samples = sampleHaystack(input.sampleRows || []);
  const reasons: string[] = [];

  const nameHintSummary =
    /summary|readme|cover|metrics|overview|contents/.test(sheet) ||
    /summary|readme|cover/.test(file);

  if (headers.length === 0) {
    return {
      category: "unknown",
      sheetRole: nameHintSummary ? "SUMMARY" : "UNKNOWN",
      sheetKind: nameHintSummary ? "summary" : "unknown",
      reasons: ["No defensible header row"],
    };
  }

  if (has(headers, "metric") && has(headers, "value")) {
    reasons.push("Metric/Value cover table");
    return {
      category: "unknown",
      sheetRole: "SUMMARY",
      sheetKind: "summary",
      reasons,
    };
  }

  if (has(headers, "severity") && hasAny(headers, ["issuecode", "issue", "detail"])) {
    reasons.push("Issue/review register");
    return {
      category: "unknown",
      sheetRole: "SUPPORTING",
      sheetKind: "supporting",
      reasons,
    };
  }

  if (
    has(headers, "class") &&
    hasAny(headers, ["sourcerows", "canonicalrows", "difference"]) &&
    !hasAny(headers, ["firstname", "surname", "accession", "admission"])
  ) {
    reasons.push("Class reconciliation counts");
    return {
      category: "unknown",
      sheetRole: "SUPPORTING",
      sheetKind: "classes",
      reasons,
    };
  }

  if (has(headers, "initials") && hasAny(headers, ["maritalstatus", "duplicaterowcount", "title"])) {
    reasons.push("HR/contact dump without learner linkage");
    return {
      category: "unknown",
      sheetRole: "SUPPORTING",
      sheetKind: "supporting",
      reasons,
    };
  }

  const learnerIdentity =
    hasAny(headers, ["accession", "admission", "admissionno", "learnernumber", "studentnumber"]) &&
    hasAny(headers, ["surname", "lastname", "firstname", "fullname", "learnername"]);
  const learnerNames =
    hasAny(headers, ["firstname", "fullname", "learnername"]) &&
    hasAny(headers, ["surname", "lastname"]);
  const looksLikeLearnerRegister =
    (learnerIdentity || (learnerNames && hasAny(headers, ["grade", "class", "dob", "dateofbirth", "gender"]))) &&
    !has(headers, "metric");

  const parentCandidate =
    hasAny(headers, ["candidateid", "parentid"]) ||
    (hasAny(headers, ["firstname", "surname", "lastname"]) &&
      hasAny(headers, ["linkedlearners", "learneraccessions", "roles"]));

  const parentContact =
    hasAny(headers, ["parentname", "guardian", "parentfirstname", "parentfirst"]) &&
    hasAny(headers, ["cell", "phone", "email", "mobile"]);

  const relationship =
    hasAny(headers, ["role", "relationship", "parentrole"]) &&
    hasAny(headers, ["parentfirst", "parentfirstname", "parentname", "parentsurname"]) &&
    hasAny(headers, ["learnersurname", "learnerfirst", "accession", "learnername"]);

  const billing =
    hasAny(headers, ["account", "accountno", "accountnumber", "customer", "openingbalance", "balance", "owing"]) &&
    !looksLikeLearnerRegister;

  const invoices =
    hasAny(headers, ["invoiceno", "invoicenumber", "docno"]) &&
    hasAny(headers, ["amount", "total", "balance"]);

  const payments =
    hasAny(headers, ["payment", "receipt", "receiptno"]) &&
    hasAny(headers, ["amount", "total"]);

  const transactions =
    hasAny(headers, ["transaction", "trntype", "type"]) &&
    hasAny(headers, ["amount", "debit", "credit"]);

  const invoiceLines =
    hasAny(headers, ["item", "description", "qty", "quantity"]) &&
    hasAny(headers, ["invoiceno", "invoicenumber", "docno"]);

  if (relationship && !parentCandidate) {
    reasons.push("Learner–parent relationship rows");
    return {
      category: "unknown",
      sheetRole: "SUPPORTING",
      sheetKind: "learner_parent_links",
      reasons,
    };
  }

  if (looksLikeLearnerRegister && !parentCandidate && !billing) {
    reasons.push("Learner identity columns");
    return {
      category: "learners",
      sheetRole: "DATA",
      sheetKind: "learners",
      reasons,
    };
  }

  if (parentCandidate || (parentContact && !looksLikeLearnerRegister)) {
    reasons.push(parentCandidate ? "Parent candidate columns" : "Parent contact columns");
    return {
      category: "parents",
      sheetRole: "DATA",
      sheetKind: "parents",
      reasons,
    };
  }

  if (invoiceLines && !payments) {
    reasons.push("Invoice line-item columns");
    return {
      category: "unknown",
      sheetRole: "SUPPORTING",
      sheetKind: "invoice_line_items",
      reasons,
    };
  }

  if (invoices && !payments) {
    reasons.push("Invoice header columns");
    return {
      category: "transactions",
      sheetRole: "DATA",
      sheetKind: "invoices",
      reasons,
    };
  }

  if (payments && !invoices) {
    reasons.push("Payment columns");
    return {
      category: "transactions",
      sheetRole: "DATA",
      sheetKind: "payments",
      reasons,
    };
  }

  if (transactions) {
    reasons.push("Transaction history columns");
    return {
      category: "transactions",
      sheetRole: "DATA",
      sheetKind: "transactions",
      reasons,
    };
  }

  if (billing) {
    reasons.push("Account/balance columns");
    return {
      category: "billing",
      sheetRole: "DATA",
      sheetKind: "billing",
      reasons,
    };
  }

  if (nameHintSummary && !looksLikeLearnerRegister && !parentCandidate) {
    reasons.push("Summary/cover sheet name with non-register columns");
    return {
      category: "unknown",
      sheetRole: "SUMMARY",
      sheetKind: "summary",
      reasons,
    };
  }

  if (samples.includes("canonicallearners") && !looksLikeLearnerRegister) {
    reasons.push("Canonical-learners wording in a non-register sheet");
    return {
      category: "unknown",
      sheetRole: "SUMMARY",
      sheetKind: "summary",
      reasons,
    };
  }

  const expressKind = classifyExpressInvoiceExport(input.filename || "", input.sheetName);
  if (expressKind !== "NOT_EXPRESS") {
    const auth = expressInvoiceAuthorityForFilename(input.filename || "", input.sheetName);
    if (auth) {
      reasons.push(`Express export kind ${expressKind}`);
      if (expressKind === "ITEM_SALES") {
        return {
          category: "unknown",
          sheetRole: "SUPPORTING",
          sheetKind: "invoice_line_items",
          reasons,
        };
      }
      const kindMap: Record<string, MigrationSheetKind> = {
        INVOICE_REPORT: "invoices",
        INVOICE_A: "parents",
        INVOICE_B: "billing",
        INVOICE_C: "payments",
        INVOICE_CC: "payments",
        UNPAID_ACCOUNTS: "billing",
      };
      return {
        category: auth.category,
        sheetRole: "DATA",
        sheetKind: kindMap[expressKind] || "unknown",
        reasons,
      };
    }
  }

  reasons.push("No defensible dataset category");
  return {
    category: "unknown",
    sheetRole: "UNKNOWN",
    sheetKind: "unknown",
    reasons,
  };
}

export function sheetSatisfiesRequiredCategory(sheet: {
  category?: string;
  sheetRole?: string | null;
}): boolean {
  const role = String(sheet.sheetRole || "DATA").toUpperCase();
  if (role === "SUMMARY" || role === "SUPPORTING") return false;
  const category = String(sheet.category || "");
  return ["learners", "parents", "billing", "transactions", "staff", "historical"].includes(category);
}

export function isNonAuthorityMigrationSheet(sheet: { sheetRole?: string | null }): boolean {
  const role = String(sheet.sheetRole || "DATA").toUpperCase();
  return role === "SUMMARY" || role === "SUPPORTING";
}
