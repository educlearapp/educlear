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
  const blob = normaliseText(`${txn.description} ${txn.reference}`);
  let best: MatchSuggestion = {
    suggestedAccountNo: "",
    suggestedLearnerId: "",
    suggestedLearnerName: "",
    matchConfidence: "none",
    matchReason: "",
  };

  for (const profile of profiles) {
    const account = String(profile.accountNo || "").trim();
    if (!account || account === "-") continue;

    const accountToken = account.toLowerCase();
    if (includesToken(blob, accountToken)) {
      return {
        suggestedAccountNo: account,
        suggestedLearnerId: profile.learnerId,
        suggestedLearnerName: profile.learnerName,
        matchConfidence: "high",
        matchReason: `Account reference ${account} found in bank line`,
      };
    }

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
  "Rent",
  "Salaries",
  "Utilities",
  "Transport",
  "Supplies",
  "Maintenance",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
