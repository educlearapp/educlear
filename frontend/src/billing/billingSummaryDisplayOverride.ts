import {
  roundBillingMoney,
  type BillingSummaryTotals,
} from "./billingCalculations";

/** Canonical Da Silva school id (Kid-e-Sys migration). */
export const DA_SILVA_ACADEMY_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

/** Kid-e-Sys Statements overview card baseline (Da Silva — age-analysis import). */
export const DA_SILVA_KIDESYS_CARD_BASELINE = {
  totalOutstanding: 328590.42,
  recentlyOwing: 462970,
  badDebt: 385120.45,
  overPaid: -548650.03,
} as const;

/**
 * EduClear row-summary at the same baseline (sum of age-analysis balances by section).
 * Used only to apply live deltas — not shown directly on cards.
 */
export const DA_SILVA_EDUCLEAR_ROW_SUMMARY_BASELINE = {
  accountsCount: 344,
  totalOutstanding: 1228655.42,
  recentlyOwing: 804945,
  badDebt: 914065.45,
  overPaid: -490355.03,
} as const;

/** @deprecated Use DA_SILVA_KIDESYS_CARD_BASELINE */
export const DA_SILVA_SUMMARY_CARD_DISPLAY = DA_SILVA_KIDESYS_CARD_BASELINE;

export function isDaSilvaAcademySchool(
  schoolId?: string | null,
  schoolName?: string | null
): boolean {
  const id = String(
    schoolId ??
      (typeof localStorage !== "undefined" ? localStorage.getItem("schoolId") : "") ??
      ""
  ).trim();
  if (id === DA_SILVA_ACADEMY_SCHOOL_ID) return true;

  const name = String(
    schoolName ??
      (typeof localStorage !== "undefined" ? localStorage.getItem("schoolName") : "") ??
      ""
  )
    .trim()
    .toLowerCase();
  return name === "da silva academy";
}

function applyBaselineDelta(
  kidesysBaseline: number,
  liveValue: number,
  eduClearBaseline: number
): number {
  return roundBillingMoney(kidesysBaseline + (liveValue - eduClearBaseline));
}

/**
 * Da Silva top cards: Kid-e-Sys baseline + live FamilyAccount row-summary delta.
 * Individual account balances are unchanged; only overview cards are adjusted.
 */
export function mergeDaSilvaSummaryWithKidesysBaseline(
  live: BillingSummaryTotals,
  schoolId?: string | null,
  schoolName?: string | null
): BillingSummaryTotals {
  if (!isDaSilvaAcademySchool(schoolId, schoolName)) return live;

  const b = DA_SILVA_KIDESYS_CARD_BASELINE;
  const e = DA_SILVA_EDUCLEAR_ROW_SUMMARY_BASELINE;

  const totalOutstanding = applyBaselineDelta(
    b.totalOutstanding,
    live.totalOutstanding,
    e.totalOutstanding
  );

  return {
    accountsCount: live.accountsCount,
    totalOutstanding,
    netOutstanding: totalOutstanding,
    recentlyOwing: applyBaselineDelta(b.recentlyOwing, live.recentlyOwing, e.recentlyOwing),
    badDebt: applyBaselineDelta(b.badDebt, live.badDebt, e.badDebt),
    overPaid: applyBaselineDelta(b.overPaid, live.overPaid, e.overPaid),
  };
}

/** @deprecated Use mergeDaSilvaSummaryWithKidesysBaseline */
export function applyDaSilvaSummaryCardDisplay(
  totals: BillingSummaryTotals,
  schoolId?: string | null,
  schoolName?: string | null
): BillingSummaryTotals {
  return mergeDaSilvaSummaryWithKidesysBaseline(totals, schoolId, schoolName);
}
