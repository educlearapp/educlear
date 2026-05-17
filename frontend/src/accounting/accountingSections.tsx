import AccountingPlaceholder from "./AccountingPlaceholder";

export function AccountingExpenses() {
  return (
    <AccountingPlaceholder
      title="Expenses"
      description="Record and approve school expenses. Money out from banking can be classified here as expense candidates."
    />
  );
}

export function AccountingSuppliers() {
  return (
    <AccountingPlaceholder
      title="Suppliers"
      description="Manage supplier profiles, payment terms, and purchase history for the school."
    />
  );
}

export function AccountingAssets() {
  return (
    <AccountingPlaceholder
      title="Assets"
      description="Track fixed assets, depreciation schedules, and asset register entries."
    />
  );
}

export function AccountingJournals() {
  return (
    <AccountingPlaceholder
      title="Journals"
      description="General journal entries, adjustments, and period-close postings."
    />
  );
}

export function AccountingChartOfAccounts() {
  return (
    <AccountingPlaceholder
      title="Chart of Accounts"
      description="Configure account codes, categories, and mapping for financial reporting."
    />
  );
}

export { default as AccountingBudget } from "./AccountingBudget";

export function AccountingFinancialStatements() {
  return (
    <AccountingPlaceholder
      title="Financial Statements"
      description="Income statement, balance sheet, and cash flow views for the school."
    />
  );
}

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
