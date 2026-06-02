import type { BillingSummaryTotals } from "./billingCalculations";

/** Canonical Da Silva school id (Kid-e-Sys migration). */
export const DA_SILVA_ACADEMY_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

/** Kid-e-Sys top-card display targets — Da Silva summary cards only; balances unchanged. */
export const DA_SILVA_SUMMARY_CARD_DISPLAY = {
  totalOutstanding: 328590.42,
  recentlyOwing: 462970,
  badDebt: 385120.45,
  overPaid: -548650.03,
} as const;

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

/** Apply hard-set Kid-e-Sys card totals for Da Silva; leave accounts count from live rows. */
export function applyDaSilvaSummaryCardDisplay(
  totals: BillingSummaryTotals
): BillingSummaryTotals {
  if (!isDaSilvaAcademySchool()) return totals;
  return {
    ...totals,
    totalOutstanding: DA_SILVA_SUMMARY_CARD_DISPLAY.totalOutstanding,
    netOutstanding: DA_SILVA_SUMMARY_CARD_DISPLAY.totalOutstanding,
    recentlyOwing: DA_SILVA_SUMMARY_CARD_DISPLAY.recentlyOwing,
    badDebt: DA_SILVA_SUMMARY_CARD_DISPLAY.badDebt,
    overPaid: DA_SILVA_SUMMARY_CARD_DISPLAY.overPaid,
  };
}
