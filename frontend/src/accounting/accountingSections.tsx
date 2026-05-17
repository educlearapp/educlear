import AccountingPlaceholder from "./AccountingPlaceholder";

export { default as AccountingExpenses } from "./AccountingExpenses";

export { default as AccountingSuppliers } from "./AccountingSuppliers";

export function AccountingAssets() {
  return (
    <AccountingPlaceholder
      title="Assets"
      description="Track fixed assets, depreciation schedules, and asset register entries."
    />
  );
}

export { default as AccountingJournals } from "./AccountingJournals";

export { default as AccountingChartOfAccounts } from "./AccountingChartOfAccounts";

export { default as AccountingBudget } from "./AccountingBudget";

export { default as AccountingFinancialStatements } from "./AccountingFinancialStatements";

export function AccountingReports() {
  return (
    <AccountingPlaceholder
      title="Accounting Reports"
      description="Management reports, audit trails, and export packs for accountants."
    />
  );
}

export function AccountingSettings() {
  return (
    <AccountingPlaceholder
      title="Accounting Settings"
      description="Financial year, tax settings, default accounts, and integration preferences."
    />
  );
}
