export type MatchConfidence = "high" | "medium" | "low" | "none";

export function confidenceFromScore(score: number): MatchConfidence {
  if (score >= 90) return "high";
  if (score >= 70) return "medium";
  if (score >= 50) return "low";
  return "none";
}

export type LearnerMatchProfile = {
  learnerId: string;
  learnerName: string;
  learnerSurname: string;
  accountNo: string;
  familyAccountId: string;
  parentNames: string[];
  parentSurnames: string[];
  parentCellNumbers: string[];
  lastPaymentAmount?: number;
};

export type PreviousBankMatch = {
  blobKey: string;
  learnerId: string;
  learnerName: string;
  accountNo: string;
  familyAccountId: string;
};

export type MatchSuggestion = {
  suggestedAccountId: string;
  suggestedAccountNo: string;
  suggestedLearnerId: string;
  suggestedLearnerName: string;
  confidenceScore: number;
  matchConfidence: MatchConfidence;
  matchReason: string;
};

const EMPTY_SUGGESTION: MatchSuggestion = {
  suggestedAccountId: "",
  suggestedAccountNo: "",
  suggestedLearnerId: "",
  suggestedLearnerName: "",
  confidenceScore: 0,
  matchConfidence: "none",
  matchReason: "",
};

function normaliseText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

/** Collapse spaces — bank refs like "SCHOOL FEES SIL002 MAY" stay matchable. */
export function normaliseBankBlob(description: string, reference: string) {
  return normaliseText(`${description || ""} ${reference || ""}`).replace(/\s+/g, " ").trim();
}

function isRealAccountNo(account: string) {
  const value = String(account || "").trim();
  if (!value || value === "-") return false;
  return true;
}

/**
 * Case-insensitive account match inside description/reference (substring).
 * Longer account refs are matched first by the caller to reduce partial collisions.
 */
export function accountNumberInBankLine(blob: string, accountNo: string) {
  const account = String(accountNo || "").trim();
  if (!isRealAccountNo(account)) return false;
  const token = account.toLowerCase();
  if (token.length < 3) return false;
  return blob.includes(token);
}

function buildSuggestion(
  profile: LearnerMatchProfile,
  confidenceScore: number,
  matchReason: string
): MatchSuggestion {
  return {
    suggestedAccountId: profile.familyAccountId,
    suggestedAccountNo: profile.accountNo,
    suggestedLearnerId: profile.learnerId,
    suggestedLearnerName: profile.learnerName,
    confidenceScore,
    matchConfidence: confidenceFromScore(confidenceScore),
    matchReason,
  };
}

function matchByAccountNumber(
  blob: string,
  profiles: LearnerMatchProfile[]
): MatchSuggestion | null {
  const eligible = profiles
    .filter((p) => isRealAccountNo(p.accountNo))
    .sort((a, b) => b.accountNo.length - a.accountNo.length);

  for (const profile of eligible) {
    const account = String(profile.accountNo).trim();
    if (accountNumberInBankLine(blob, account)) {
      return buildSuggestion(
        profile,
        95,
        `Exact account reference ${account} found in bank line`
      );
    }
  }
  return null;
}

function includesToken(haystack: string, token: string) {
  if (!token || token.length < 3) return false;
  const pattern = new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
  return pattern.test(haystack) || haystack.includes(token);
}

function surnameInBlob(blob: string, surname: string) {
  const token = normaliseText(surname).trim();
  if (token.length < 3) return false;
  return includesToken(blob, token);
}

function fullNameInBlob(blob: string, fullName: string) {
  const parts = normaliseText(fullName).split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length < 2) return false;
  return parts.every((p) => includesToken(blob, p));
}

function normaliseCellDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function cellInBlob(blob: string, cellNo: string) {
  const digits = normaliseCellDigits(cellNo);
  if (digits.length < 9) return false;
  const blobDigits = normaliseText(blob).replace(/\s+/g, "");
  const needle = digits.slice(-9);
  const hay = blobDigits.replace(/\s+/g, "");
  return hay.includes(needle) || normaliseCellDigits(blob).includes(needle);
}

function matchByLearnerSurname(blob: string, profiles: LearnerMatchProfile[]): MatchSuggestion | null {
  for (const profile of profiles) {
    if (surnameInBlob(blob, profile.learnerSurname)) {
      return buildSuggestion(profile, 80, "Learner surname matched in bank line");
    }
  }
  return null;
}

function matchByParentSurname(blob: string, profiles: LearnerMatchProfile[]): MatchSuggestion | null {
  for (const profile of profiles) {
    for (const surname of profile.parentSurnames) {
      if (surnameInBlob(blob, surname)) {
        return buildSuggestion(profile, 75, "Parent surname matched in bank line");
      }
    }
  }
  return null;
}

function matchByLearnerFullName(blob: string, profiles: LearnerMatchProfile[]): MatchSuggestion | null {
  for (const profile of profiles) {
    if (fullNameInBlob(blob, profile.learnerName)) {
      return buildSuggestion(profile, 70, "Learner full name matched in bank line");
    }
  }
  return null;
}

function matchByParentCell(blob: string, profiles: LearnerMatchProfile[]): MatchSuggestion | null {
  for (const profile of profiles) {
    for (const cell of profile.parentCellNumbers) {
      if (cellInBlob(blob, cell)) {
        return buildSuggestion(profile, 65, "Parent cell number matched in bank line");
      }
    }
  }
  return null;
}

function matchByPreviousMatches(
  blob: string,
  previousMatches: PreviousBankMatch[]
): MatchSuggestion | null {
  for (const prev of previousMatches) {
    if (!prev.blobKey || !prev.learnerId) continue;
    if (blob === prev.blobKey || blob.includes(prev.blobKey) || prev.blobKey.includes(blob)) {
      return {
        suggestedAccountId: prev.familyAccountId,
        suggestedAccountNo: prev.accountNo,
        suggestedLearnerId: prev.learnerId,
        suggestedLearnerName: prev.learnerName,
        confidenceScore: 60,
        matchConfidence: confidenceFromScore(60),
        matchReason: "Matches a previous accepted bank reconciliation",
      };
    }
  }
  return null;
}

export function transactionFingerprint(input: {
  date: string;
  description: string;
  reference: string;
  moneyIn: number;
  moneyOut: number;
}) {
  const amount = input.moneyIn || input.moneyOut;
  return [
    input.date,
    amount.toFixed(2),
    normaliseText(input.description).replace(/\s+/g, " ").trim(),
    normaliseText(input.reference).replace(/\s+/g, " ").trim(),
  ].join("|");
}

/**
 * Deterministic parent/learner match for incoming bank lines.
 * Rules apply in strict priority order; first hit wins.
 */
export function matchBankTransaction(
  txn: { description: string; reference: string; moneyIn: number; moneyOut: number },
  profiles: LearnerMatchProfile[],
  previousMatches: PreviousBankMatch[] = []
): MatchSuggestion {
  const blob = normaliseBankBlob(txn.description, txn.reference);

  const accountHit = matchByAccountNumber(blob, profiles);
  if (accountHit) return accountHit;

  const learnerSurnameHit = matchByLearnerSurname(blob, profiles);
  if (learnerSurnameHit) return learnerSurnameHit;

  const parentSurnameHit = matchByParentSurname(blob, profiles);
  if (parentSurnameHit) return parentSurnameHit;

  const fullNameHit = matchByLearnerFullName(blob, profiles);
  if (fullNameHit) return fullNameHit;

  const cellHit = matchByParentCell(blob, profiles);
  if (cellHit) return cellHit;

  const previousHit = matchByPreviousMatches(blob, previousMatches);
  if (previousHit) return previousHit;

  return { ...EMPTY_SUGGESTION };
}

export const EXPENSE_CATEGORIES = [
  "Electricity",
  "Water",
  "Rent / Bond",
  "Salaries",
  "Fuel",
  "Repairs & Maintenance",
  "Stationery",
  "Food / Tuckshop",
  "Insurance",
  "Bank Charges",
  "SARS / UIF",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export type ExpenseMatchSuggestion = {
  expenseCategory: ExpenseCategory;
  suggestedSupplierName: string;
  matchReason: string;
};

/** Keyword rules for money-out bank lines (Accounting expense candidates). */
export function inferExpenseCategory(description: string, reference = ""): ExpenseMatchSuggestion {
  const blob = normaliseText(`${description} ${reference}`);
  const pick = (category: ExpenseCategory, reason: string, supplier = ""): ExpenseMatchSuggestion => ({
    expenseCategory: category,
    suggestedSupplierName: supplier,
    matchReason: reason,
  });

  if (/\belectric|\beskom\b/.test(blob)) return pick("Electricity", "Matched electricity / Eskom");
  if (/\bwater\b|\bmunicipal/.test(blob)) return pick("Water", "Matched water / municipality");
  if (/\bfuel\b|\bshell\b|\bbp\b|\bengen\b|\bsasol\b/.test(blob)) return pick("Fuel", "Matched fuel supplier");
  if (/\bbank fee|\bcharges\b|\bservice fee/.test(blob)) return pick("Bank Charges", "Matched bank fee / charges");
  if (/\bsalary|\bpayroll\b/.test(blob)) return pick("Salaries", "Matched salary / payroll");
  if (/\binsurance\b/.test(blob)) return pick("Insurance", "Matched insurance");
  if (/\brepair|\bmaintenance\b/.test(blob)) return pick("Repairs & Maintenance", "Matched repairs / maintenance");
  if (/\brent\b|\bbond\b/.test(blob)) return pick("Rent / Bond", "Matched rent / bond");
  if (/\bstationery\b|\bmakro\b|\boffice\b/.test(blob)) return pick("Stationery", "Matched stationery / office");
  if (/\bfood\b|\btuckshop\b|\bcatering\b/.test(blob)) return pick("Food / Tuckshop", "Matched food / tuckshop / catering");
  if (/\bsars\b|\buif\b|\bpaye\b/.test(blob)) return pick("SARS / UIF", "Matched SARS / UIF / PAYE");

  return pick("Other", "No rule match — default category");
}

export type SupplierMatchInput = {
  id: string;
  name: string;
  category: string;
  autoMatchRule?: string;
};

export function matchSupplierFromDescription(
  description: string,
  reference: string,
  suppliers: SupplierMatchInput[]
): { supplierId: string; supplierName: string; category: string; reason: string } | null {
  const blob = normaliseText(`${description} ${reference}`);
  for (const supplier of suppliers) {
    const name = String(supplier.name || "").trim();
    if (!name) continue;
    const nameKey = normaliseText(name);
    if (nameKey.length >= 3 && blob.includes(nameKey.replace(/\s+/g, " "))) {
      return {
        supplierId: supplier.id,
        supplierName: name,
        category: String(supplier.category || "Other").trim() || "Other",
        reason: `Supplier name "${name}" found in description`,
      };
    }
    const rule = String(supplier.autoMatchRule || "").trim();
    if (rule) {
      const ruleKey = normaliseText(rule);
      if (ruleKey.length >= 3 && blob.includes(ruleKey.replace(/\s+/g, " "))) {
        return {
          supplierId: supplier.id,
          supplierName: name,
          category: String(supplier.category || "Other").trim() || "Other",
          reason: `Supplier rule "${rule}" matched`,
        };
      }
    }
  }
  return null;
}

/** Infer a display supplier name from bank description when no supplier record matches. */
export function inferSupplierNameFromDescription(description: string): string {
  const raw = String(description || "").trim();
  if (!raw) return "Unknown supplier";
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length <= 4) return raw.slice(0, 80);
  return parts.slice(0, 4).join(" ");
}
