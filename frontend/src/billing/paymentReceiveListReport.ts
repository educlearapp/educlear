import { escapeExportHtml } from "../accounting/accountingExportEngine";
import { downloadCsv } from "../accounting/accountingExportEngine";
import type { GeneratedBillingReport, PaymentReceiveListGroup } from "./billingReportsEngine";

function blankCell() {
  return '<td class="prl-blank">&nbsp;</td>';
}

export function buildPaymentReceivePrintHtml(
  report: GeneratedBillingReport,
  schoolName: string
): string {
  const groups = report.groups || [];
  const generated = new Date(report.generatedAt).toLocaleString("en-ZA");

  const groupBlocks = groups
    .map((group) => {
      const rows = group.rows
        .map(
          (r) =>
            `<tr>
              <td class="prl-num">${r.rowNum}</td>
              <td>${escapeExportHtml(r.accountNo)}</td>
              <td>${escapeExportHtml(r.learnerName)}</td>
              <td class="prl-balance">${escapeExportHtml(r.balance)}</td>
              ${blankCell()}
              ${blankCell()}
              ${blankCell()}
              ${blankCell()}
            </tr>`
        )
        .join("");
      const heading = group.heading
        ? `<h2 class="prl-group-heading">${escapeExportHtml(group.heading)}</h2>`
        : "";
      return `${heading}
        <table class="prl-table">
          <thead>
            <tr>
              <th class="prl-num">#</th>
              <th>Account</th>
              <th>Learner name</th>
              <th>Balance</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Date</th>
              <th>Receipt No</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="8" class="prl-empty">No accounts in this group.</td></tr>'}</tbody>
        </table>`;
    })
    .join("");

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>Payment Receive List — ${escapeExportHtml(schoolName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, Helvetica, sans-serif; color: #000; margin: 24px 28px; line-height: 1.35; background: #fff; }
  .prl-top { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; border-bottom: 2px solid #000; padding-bottom: 12px; }
  .prl-title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: 0.02em; }
  .prl-school { text-align: right; font-size: 14px; font-weight: 700; max-width: 50%; }
  .prl-meta { font-size: 11px; color: #444; margin-top: 4px; font-weight: 400; }
  .prl-group-heading { margin: 22px 0 8px; font-size: 15px; font-weight: 700; text-decoration: underline; }
  .prl-table { width: 100%; border-collapse: collapse; margin-bottom: 18px; font-size: 12px; }
  .prl-table th, .prl-table td { border: 1px solid #000; padding: 6px 8px; vertical-align: middle; }
  .prl-table th { background: #fff; font-weight: 700; text-align: left; }
  .prl-num { width: 36px; text-align: center; }
  .prl-balance { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .prl-blank { min-width: 72px; height: 22px; }
  .prl-empty { text-align: center; font-style: italic; color: #555; }
  @media print {
    body { margin: 12mm 14mm; }
    .prl-group-heading { page-break-after: avoid; }
    .prl-table { page-break-inside: auto; }
    .prl-table tr { page-break-inside: avoid; }
  }
</style></head><body>
  <div class="prl-top">
    <div>
      <h1 class="prl-title">Payment Receive List</h1>
      <div class="prl-meta">Generated ${escapeExportHtml(generated)}</div>
    </div>
    <div class="prl-school">${escapeExportHtml(schoolName)}</div>
  </div>
  ${groupBlocks || '<p class="prl-empty">No accounts match your filters.</p>'}
</body></html>`;
}

export function exportPaymentReceiveListCsv(
  report: GeneratedBillingReport,
  schoolName: string
) {
  const groups = report.groups || [];
  const lines: string[] = ["Group", "Account", "Learner", "Balance"];
  for (const group of groups) {
    const groupLabel = group.heading || schoolName;
    for (const row of group.rows) {
      lines.push(
        [
          groupLabel,
          row.accountNo,
          row.learnerName,
          row.balance,
        ]
          .map((v) => {
            const s = String(v ?? "");
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      );
    }
  }
  const stamp = new Date(report.generatedAt).toISOString().slice(0, 10);
  downloadCsv(lines.join("\r\n"), `payment-receive-list-${stamp}.csv`);
}

export function downloadPaymentReceiveHtml(html: string, generatedAt: string) {
  const stamp = new Date(generatedAt).toISOString().slice(0, 10);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payment-receive-list-${stamp}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function groupCount(report: GeneratedBillingReport): number {
  return report.groups?.length ?? 0;
}

export function rowCount(report: GeneratedBillingReport): number {
  return (report.groups || []).reduce((n, g) => n + g.rows.length, 0);
}
