export const ACCOUNTING_SETTINGS_STORAGE_PREFIX = "educlearAccountingSettings:";
export const ACCOUNTING_SETTINGS_UPDATED_EVENT = "educlear-accounting-settings-updated";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type ReportingBasis = "month" | "doe" | "sars";

export type DefaultReportBasisSetting = ReportingBasis;

export type DefaultAccountKey =
  | "bankAccount"
  | "accountsReceivable"
  | "schoolFeesIncome"
  | "registrationFeesIncome"
  | "salariesExpense"
  | "bankChargesExpense"
  | "depreciationExpense";

export type AccountingSettings = {
  financialYears: {
    defaultReportBasis: DefaultReportBasisSetting;
  };
  defaultAccounts: Record<DefaultAccountKey, string>;
  postingRules: {
    autoPostBillingPayments: boolean;
    autoPostApprovedExpenses: boolean;
    autoPostBankCharges: boolean;
    autoPostDepreciation: boolean;
    requireJournalReviewBeforePosting: boolean;
  };
  approvals: {
    requireApprovalExpensesAbove: boolean;
    expenseApprovalLimit: number;
    requireOwnerApprovalSupplierPayments: boolean;
    requireOwnerApprovalJournalReversals: boolean;
  };
  reports: {
    defaultReportBasis: DefaultReportBasisSetting;
    defaultExportFormat: "PDF" | "Excel";
    showEduClearFooter: boolean;
    includeAuditNotes: boolean;
  };
  updatedAt: string;
};

export type ResolvedReportingPeriod = {
  basis: ReportingBasis;
  year: number;
  monthIndex: number;
  startDate: string;
  endDate: string;
  label: string;
  depreciationYear: number;
};

export type ChartAccountOption = {
  id: string;
  code: string;
  name: string;
};

const COA_STORAGE_PREFIX = "educlearAccountingCOA:";

export const DEFAULT_ACCOUNT_LABELS: Record<DefaultAccountKey, string> = {
  bankAccount: "Bank Account",
  accountsReceivable: "Accounts Receivable",
  schoolFeesIncome: "School Fees Income",
  registrationFeesIncome: "Registration Fees Income",
  salariesExpense: "Salaries Expense",
  bankChargesExpense: "Bank Charges Expense",
  depreciationExpense: "Depreciation Expense",
};

export const REPORTING_BASIS_OPTIONS: { id: ReportingBasis; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "doe", label: "Department of Education Year" },
  { id: "sars", label: "SARS / Tax Year" },
];

export const DEFAULT_REPORT_BASIS_OPTIONS: { id: DefaultReportBasisSetting; label: string }[] = [
  { id: "doe", label: "Department of Education Year" },
  { id: "sars", label: "SARS / Tax Year" },
  { id: "month", label: "Calendar Month" },
];

function settingsKey(schoolId: string) {
  return `${ACCOUNTING_SETTINGS_STORAGE_PREFIX}${schoolId}`;
}

function defaultSettings(): AccountingSettings {
  const now = new Date().toISOString();
  return {
    financialYears: { defaultReportBasis: "doe" },
    defaultAccounts: {
      bankAccount: "",
      accountsReceivable: "",
      schoolFeesIncome: "",
      registrationFeesIncome: "",
      salariesExpense: "",
      bankChargesExpense: "",
      depreciationExpense: "",
    },
    postingRules: {
      autoPostBillingPayments: true,
      autoPostApprovedExpenses: false,
      autoPostBankCharges: true,
      autoPostDepreciation: true,
      requireJournalReviewBeforePosting: true,
    },
    approvals: {
      requireApprovalExpensesAbove: true,
      expenseApprovalLimit: 5000,
      requireOwnerApprovalSupplierPayments: true,
      requireOwnerApprovalJournalReversals: true,
    },
    reports: {
      defaultReportBasis: "doe",
      defaultExportFormat: "PDF",
      showEduClearFooter: true,
      includeAuditNotes: true,
    },
    updatedAt: now,
  };
}

function mergeSettings(parsed: Partial<AccountingSettings> | null): AccountingSettings {
  const base = defaultSettings();
  if (!parsed || typeof parsed !== "object") return base;
  return {
    financialYears: {
      defaultReportBasis:
        parsed.financialYears?.defaultReportBasis === "sars" ||
        parsed.financialYears?.defaultReportBasis === "month"
          ? parsed.financialYears.defaultReportBasis
          : "doe",
    },
    defaultAccounts: { ...base.defaultAccounts, ...(parsed.defaultAccounts || {}) },
    postingRules: { ...base.postingRules, ...(parsed.postingRules || {}) },
    approvals: { ...base.approvals, ...(parsed.approvals || {}) },
    reports: {
      ...base.reports,
      ...(parsed.reports || {}),
      defaultExportFormat:
        parsed.reports?.defaultExportFormat === "Excel" ? "Excel" : "PDF",
    },
    updatedAt: String(parsed.updatedAt || new Date().toISOString()),
  };
}

export function loadAccountingSettings(schoolId: string): AccountingSettings {
  if (!schoolId) return defaultSettings();
  try {
    const raw = localStorage.getItem(settingsKey(schoolId));
    if (!raw) return defaultSettings();
    return mergeSettings(JSON.parse(raw) as Partial<AccountingSettings>);
  } catch {
    return defaultSettings();
  }
}

export function saveAccountingSettings(schoolId: string, settings: AccountingSettings) {
  if (!schoolId) return;
  const payload: AccountingSettings = {
    ...settings,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(settingsKey(schoolId), JSON.stringify(payload));
  window.dispatchEvent(
    new CustomEvent(ACCOUNTING_SETTINGS_UPDATED_EVENT, { detail: { schoolId } })
  );
}

export function getDefaultReportingBasis(schoolId: string): DefaultReportBasisSetting {
  return loadAccountingSettings(schoolId).financialYears.defaultReportBasis;
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function lastDayOfFebruary(year: number) {
  return new Date(year, 2, 0).getDate();
}

export function parseAccountingDate(dateRaw: string): { year: number; monthIndex: number; iso: string } | null {
  const raw = String(dateRaw || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (iso) {
    const year = Number(iso[1]);
    const monthIndex = Number(iso[2]) - 1;
    const day = iso[3] ? Number(iso[3]) : 1;
    if (year >= 1970 && monthIndex >= 0 && monthIndex <= 11) {
      return { year, monthIndex, iso: `${year}-${pad2(monthIndex + 1)}-${pad2(day)}` };
    }
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return {
    year: d.getFullYear(),
    monthIndex: d.getMonth(),
    iso: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
  };
}

export function dateInReportingRange(dateRaw: string, startDate: string, endDate: string) {
  const parsed = parseAccountingDate(dateRaw);
  if (!parsed) return false;
  return parsed.iso >= startDate && parsed.iso <= endDate;
}

/** Tax year ending February of `taxYearEnding` (e.g. SARS 2026 → Mar 2025 – Feb 2026). */
export function resolveSarsTaxPeriod(taxYearEnding: number) {
  const startYear = taxYearEnding - 1;
  const endYear = taxYearEnding;
  const endDay = lastDayOfFebruary(endYear);
  return {
    startDate: `${startYear}-03-01`,
    endDate: `${endYear}-02-${pad2(endDay)}`,
    label: `March ${startYear} – February ${endYear}`,
    depreciationYear: endYear,
  };
}

export function resolveDoePeriod(calendarYear: number) {
  return {
    startDate: `${calendarYear}-01-01`,
    endDate: `${calendarYear}-12-31`,
    label: `January ${calendarYear} – December ${calendarYear}`,
    depreciationYear: calendarYear,
  };
}

export function resolveCalendarMonthPeriod(year: number, monthIndex: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    startDate: `${year}-${pad2(monthIndex + 1)}-01`,
    endDate: `${year}-${pad2(monthIndex + 1)}-${pad2(lastDay)}`,
    label: `${MONTH_NAMES[monthIndex] || ""} ${year}`,
    depreciationYear: year,
  };
}

export function resolveReportingPeriod(
  basis: ReportingBasis,
  year: number,
  monthIndex: number
): ResolvedReportingPeriod {
  if (basis === "sars") {
    const sars = resolveSarsTaxPeriod(year);
    return { basis, year, monthIndex, ...sars };
  }
  if (basis === "doe") {
    const doe = resolveDoePeriod(year);
    return { basis, year, monthIndex, ...doe };
  }
  const month = resolveCalendarMonthPeriod(year, monthIndex);
  return { basis, year, monthIndex, ...month };
}

export function reportingBasisYearLabel(basis: ReportingBasis) {
  if (basis === "sars") return "Tax year ending";
  if (basis === "doe") return "Calendar year";
  return "Year";
}

export function loadActiveChartAccounts(schoolId: string): ChartAccountOption[] {
  if (!schoolId) return [];
  try {
    const raw = localStorage.getItem(`${COA_STORAGE_PREFIX}${schoolId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const accounts = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.accounts)
        ? parsed.accounts
        : [];
    return accounts
      .filter((a: { active?: boolean }) => a.active !== false)
      .map((a: { id?: string; code?: string; name?: string }) => ({
        id: String(a.id || a.code || ""),
        code: String(a.code || ""),
        name: String(a.name || ""),
      }))
      .filter((a: ChartAccountOption) => a.id && a.name);
  } catch {
    return [];
  }
}

export function seedDefaultAccountIds(
  schoolId: string,
  settings: AccountingSettings
): AccountingSettings {
  const accounts = loadActiveChartAccounts(schoolId);
  if (!accounts.length) return settings;
  const findByName = (needle: string) =>
    accounts.find((a) => a.name.toLowerCase().includes(needle.toLowerCase()))?.id || "";

  const next = { ...settings, defaultAccounts: { ...settings.defaultAccounts } };
  if (!next.defaultAccounts.bankAccount) next.defaultAccounts.bankAccount = findByName("Bank Account");
  if (!next.defaultAccounts.accountsReceivable) {
    next.defaultAccounts.accountsReceivable = findByName("Accounts Receivable");
  }
  if (!next.defaultAccounts.schoolFeesIncome) {
    next.defaultAccounts.schoolFeesIncome = findByName("School Fees");
  }
  if (!next.defaultAccounts.registrationFeesIncome) {
    next.defaultAccounts.registrationFeesIncome = findByName("Registration");
  }
  if (!next.defaultAccounts.salariesExpense) next.defaultAccounts.salariesExpense = findByName("Salaries");
  if (!next.defaultAccounts.bankChargesExpense) {
    next.defaultAccounts.bankChargesExpense = findByName("Bank Charges");
  }
  if (!next.defaultAccounts.depreciationExpense) {
    next.defaultAccounts.depreciationExpense = findByName("Depreciation");
  }
  return next;
}
