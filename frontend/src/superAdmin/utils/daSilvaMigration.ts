import type { DaSilvaMigrationPreview } from "../types/daSilvaMigration";

export function formatDaSilvaReconciliationSummary(preview: DaSilvaMigrationPreview): string {
  const t = preview.summary;
  const lines = [
    `Learners: ${t.totalLearners}`,
    `Parents: ${t.totalParents}`,
    `Classes: ${t.totalClasses}`,
    `Invoices: ${t.totalInvoices} (R ${t.totalInvoiceAmount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })})`,
    `Payments: ${t.totalPayments} (R ${t.totalPaymentAmount.toLocaleString("en-ZA", { minimumFractionDigits: 2 })})`,
    `Outstanding (age analysis): R ${t.totalOutstandingBalance.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
    "",
    `Class list: ${preview.countValidation.learnersFromClassList}`,
    `Contact list: ${preview.countValidation.learnersFromContactList}`,
    `Billing plan: ${preview.countValidation.learnersFromBillingPlan}`,
    `Billing accounts (age analysis): ${preview.countValidation.billingAccountsFromAgeAnalysis}`,
    "",
    preview.canImport ? "✓ Count validation passed — ready for staging review." : "✗ Count mismatch — import blocked.",
  ];
  if (preview.countValidation.errors.length) {
    lines.push("", "Errors:", ...preview.countValidation.errors.map((e) => `  • ${e}`));
  }
  const varianceRows = preview.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01);
  if (varianceRows.length) {
    lines.push(
      "",
      `Reconciliation variances: ${varianceRows.length} account(s) differ between age analysis and imported ledger.`,
      "Sample:",
      ...varianceRows.slice(0, 8).map(
        (r) =>
          `  ${r.accountNo} ${r.fullName.replace(/\n/g, " ")}: age R${r.ageAnalysisBalance.toFixed(2)} vs ledger R${r.ledgerBalanceFromImport.toFixed(2)}`
      )
    );
  }
  return lines.join("\n");
}

export async function uploadDaSilvaPreview(opts: {
  schoolId: string;
  projectId: string;
  classListFiles: File[];
  contactList: File;
  employees: File;
  billingPlan: File;
  ageAnalysis: File;
  transactions: File;
}): Promise<DaSilvaMigrationPreview & { projectId: string }> {
  const form = new FormData();
  form.append("schoolId", opts.schoolId);
  form.append("projectId", opts.projectId);
  for (const file of opts.classListFiles) {
    form.append("classListFiles", file);
  }
  form.append("contactList", opts.contactList);
  form.append("employees", opts.employees);
  form.append("billingPlan", opts.billingPlan);
  form.append("ageAnalysis", opts.ageAnalysis);
  form.append("transactions", opts.transactions);

  const { API_URL } = await import("../../api");
  const { superAdminAuthHeaders } = await import("../superAdminApi");
  const res = await fetch(`${API_URL}/api/super-admin/migration/da-silva/preview`, {
    method: "POST",
    headers: superAdminAuthHeaders(),
    body: form,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || "Preview failed");
  return data;
}

export async function commitDaSilvaImport(opts: {
  schoolId: string;
  projectId: string;
  confirmToken: string;
}) {
  const { superAdminApiFetch } = await import("../superAdminApi");
  return superAdminApiFetch("/api/super-admin/migration/da-silva/import", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function rollbackDaSilvaImport(opts: { schoolId: string; projectId: string }) {
  const { superAdminApiFetch } = await import("../superAdminApi");
  return superAdminApiFetch("/api/super-admin/migration/da-silva/rollback", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}
