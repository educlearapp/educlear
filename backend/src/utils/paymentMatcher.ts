export type MatchConfidence = "high" | "medium" | "low" | "none";

const CONFIDENCE_RANK: Record<MatchConfidence, number> = {
  high: 4,
  medium: 3,
  low: 2,
  none: 0,
};

function betterConfidence(a: MatchConfidence, b: MatchConfidence) {
  return CONFIDENCE_RANK[a] > CONFIDENCE_RANK[b];
}

export type LearnerMatchProfile = {
  learnerId: string;
  learnerName: string;
  accountNo: string;
  parentNames: string[];
  lastPaymentAmount?: number;
};

export type MatchSuggestion = {
  suggestedAccountNo: string;
  suggestedLearnerId: string;
  suggestedLearnerName: string;
  matchConfidence: MatchConfidence;
  matchReason: string;
};

function normaliseText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
}

/** Collapse spaces — bank refs like "SCHOOL FEES SIL002 MAY" stay matchable. */
function normaliseBankBlob(description: string, reference: string) {
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
      return {
        suggestedAccountNo: account,
        suggestedLearnerId: profile.learnerId,
        suggestedLearnerName: profile.learnerName,
        matchConfidence: "high",
        matchReason: `Account reference ${account} found in bank line`,
      };
    }
  }
  return null;
}

function includesToken(haystack: string, token: string) {
  if (!token || token.length < 3) return false;
  return haystack.includes(token);
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

export function matchBankTransaction(
  txn: { description: string; reference: string; moneyIn: number; moneyOut: number },
  profiles: LearnerMatchProfile[]
): MatchSuggestion {
  const blob = normaliseBankBlob(txn.description, txn.reference);

  const accountHit = matchByAccountNumber(blob, profiles);
  if (accountHit) return accountHit;

  let best: MatchSuggestion = {
    suggestedAccountNo: "",
    suggestedLearnerId: "",
    suggestedLearnerName: "",
    matchConfidence: "none",
    matchReason: "",
  };

  for (const profile of profiles) {
    const account = String(profile.accountNo || "").trim();
    if (!isRealAccountNo(account)) continue;

    const nameParts = profile.learnerName.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
    const nameHits = nameParts.filter((p) => includesToken(blob, p)).length;
    if (nameHits >= 2) {
      const candidate: MatchSuggestion = {
        suggestedAccountNo: account,
        suggestedLearnerId: profile.learnerId,
        suggestedLearnerName: profile.learnerName,
        matchConfidence: "medium",
        matchReason: "Learner name matched in description/reference",
      };
      if (betterConfidence(candidate.matchConfidence, best.matchConfidence)) best = candidate;
    } else if (nameHits === 1) {
      const candidate: MatchSuggestion = {
        suggestedAccountNo: account,
        suggestedLearnerId: profile.learnerId,
        suggestedLearnerName: profile.learnerName,
        matchConfidence: "low",
        matchReason: "Partial learner name match",
      };
      if (
        best.matchConfidence === "none" ||
        (best.matchConfidence === "low" && !best.suggestedLearnerId)
      ) {
        best = candidate;
      }
    }

    for (const parentName of profile.parentNames) {
      const parts = parentName.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
      const parentHits = parts.filter((p) => includesToken(blob, p)).length;
      if (parentHits >= 2) {
        const candidate: MatchSuggestion = {
          suggestedAccountNo: account,
          suggestedLearnerId: profile.learnerId,
          suggestedLearnerName: profile.learnerName,
          matchConfidence: "medium",
          matchReason: "Parent name matched in description/reference",
        };
        if (betterConfidence(candidate.matchConfidence, best.matchConfidence)) best = candidate;
      }
    }

    if (txn.moneyIn > 0 && profile.lastPaymentAmount && profile.lastPaymentAmount > 0) {
      const diff = Math.abs(txn.moneyIn - profile.lastPaymentAmount);
      if (diff <= 0.05) {
        const candidate: MatchSuggestion = {
          suggestedAccountNo: account,
          suggestedLearnerId: profile.learnerId,
          suggestedLearnerName: profile.learnerName,
          matchConfidence: "medium",
          matchReason: "Amount matches previous payment",
        };
        if (best.matchConfidence === "none" || best.matchConfidence === "low") best = candidate;
      }
    }
  }

  return best;
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
