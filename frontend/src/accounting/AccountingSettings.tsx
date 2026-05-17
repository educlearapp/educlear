import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACCOUNTING_GOLD,
  ACCOUNTING_INK,
  accountingCard,
  accountingPageWrap,
  accountingSubtitle,
  accountingTitle,
} from "./accountingTheme";
import {
  DEFAULT_ACCOUNT_LABELS,
  DEFAULT_REPORT_BASIS_OPTIONS,
  type AccountingSettings as AccountingSettingsModel,
  type DefaultAccountKey,
  loadAccountingSettings,
  loadActiveChartAccounts,
  saveAccountingSettings,
  seedDefaultAccountIds,
} from "./accountingSettingsStorage";

type Props = {
  schoolId: string;
};

type SettingsTab =
  | "financial-years"
  | "default-accounts"
  | "posting-rules"
  | "approvals"
  | "reports";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "financial-years", label: "Financial Years" },
  { id: "default-accounts", label: "Default Accounts" },
  { id: "posting-rules", label: "Posting Rules" },
  { id: "approvals", label: "Approvals" },
  { id: "reports", label: "Reports" },
];

const fieldStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${ACCOUNTING_GOLD}`,
  fontWeight: 700,
  color: ACCOUNTING_INK,
  background: "#fff",
};

const goldBtn: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 10,
  border: "1px solid #b89329",
  background: "linear-gradient(135deg, #f7d56a, #d4af37)",
  color: ACCOUNTING_INK,
  fontWeight: 900,
  cursor: "pointer",
};

const lockedField: React.CSSProperties = {
  ...fieldStyle,
  background: "#f8fafc",
  color: "#64748b",
  cursor: "not-allowed",
};

const tabBtn = (active: boolean): React.CSSProperties => ({
  padding: "10px 16px",
  borderRadius: 10,
  border: active ? `2px solid ${ACCOUNTING_GOLD}` : "1px solid #e2e8f0",
  background: active ? ACCOUNTING_INK : "#fff",
  color: active ? ACCOUNTING_GOLD : ACCOUNTING_INK,
  fontWeight: 900,
  cursor: "pointer",
  fontSize: 13,
});

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "14px 0",
        borderBottom: "1px solid #f1f5f9",
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, marginTop: 2, accentColor: ACCOUNTING_GOLD }}
      />
      <span>
        <span style={{ display: "block", fontWeight: 800, color: ACCOUNTING_INK }}>{label}</span>
        {description ? (
          <span style={{ display: "block", fontSize: 13, color: "#64748b", marginTop: 4, fontWeight: 600 }}>
            {description}
          </span>
        ) : null}
      </span>
    </label>
  );
}

export default function AccountingSettings({ schoolId }: Props) {
  const [tab, setTab] = useState<SettingsTab>("financial-years");
  const [settings, setSettings] = useState<AccountingSettingsModel>(() => loadAccountingSettings(schoolId));
  const [savedBanner, setSavedBanner] = useState("");

  const chartAccounts = useMemo(() => loadActiveChartAccounts(schoolId), [schoolId, settings.updatedAt]);

  const reload = useCallback(() => {
    let next = loadAccountingSettings(schoolId);
    next = seedDefaultAccountIds(schoolId, next);
    setSettings(next);
  }, [schoolId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const persist = (next: AccountingSettingsModel) => {
    setSettings(next);
    saveAccountingSettings(schoolId, next);
    setSavedBanner("Settings saved for this school.");
    window.setTimeout(() => setSavedBanner(""), 3500);
  };

  const update = (patch: Partial<AccountingSettingsModel>) => {
    persist({ ...settings, ...patch });
  };

  if (!schoolId) {
    return (
      <div style={accountingPageWrap}>
        <h1 style={accountingTitle}>Accounting Settings</h1>
        <p style={accountingSubtitle}>Select a school to configure accounting settings.</p>
      </div>
    );
  }

  return (
    <div style={accountingPageWrap}>
      <div style={{ borderBottom: `2px solid ${ACCOUNTING_GOLD}`, paddingBottom: 18, marginBottom: 24 }}>
        <h1 style={accountingTitle}>Accounting Settings</h1>
        <p style={accountingSubtitle}>
          Financial years, default accounts, posting rules, approvals, and report preferences.
        </p>
      </div>

      {savedBanner ? (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 10,
            background: "#ecfdf5",
            border: `1px solid ${ACCOUNTING_GOLD}`,
            color: "#166534",
            fontWeight: 700,
          }}
        >
          {savedBanner}
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
        {TABS.map((t) => (
          <button key={t.id} type="button" style={tabBtn(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "financial-years" ? (
        <div style={{ display: "grid", gap: 20 }}>
          <div style={accountingCard}>
            <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 900, color: ACCOUNTING_INK }}>
              A. Department of Education Reporting Year
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
              <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
                Label
                <input style={lockedField} readOnly value="Department of Education" />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
                Start Month
                <input style={lockedField} readOnly value="January" />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
                End Month
                <input style={lockedField} readOnly value="December" />
              </label>
            </div>
            <p style={{ margin: "14px 0 0", fontSize: 13, color: "#64748b", fontWeight: 600 }}>
              Used for school and Department of Education management reports.
            </p>
          </div>

          <div style={accountingCard}>
            <h2 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 900, color: ACCOUNTING_INK }}>
              B. SARS / Tax Reporting Year
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
              <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
                Label
                <input style={lockedField} readOnly value="SARS / Tax" />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
                Start Month
                <input style={lockedField} readOnly value="March" />
              </label>
              <label style={{ display: "grid", gap: 6, fontWeight: 800, fontSize: 12, color: "#64748b" }}>
                End Month
                <input style={lockedField} readOnly value="February" />
              </label>
            </div>
            <p style={{ margin: "14px 0 0", fontSize: 13, color: "#64748b", fontWeight: 600 }}>
              Used for tax, audit, and accountant reports. Example: SARS 2026 = 1 March 2025 – 28 February 2026.
            </p>
          </div>

          <div style={accountingCard}>
            <label style={{ display: "grid", gap: 8, fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK }}>
              Default report basis
              <select
                style={fieldStyle}
                value={settings.financialYears.defaultReportBasis}
                onChange={(e) =>
                  update({
                    financialYears: {
                      defaultReportBasis: e.target.value as AccountingSettingsModel["financialYears"]["defaultReportBasis"],
                    },
                    reports: {
                      ...settings.reports,
                      defaultReportBasis: e.target.value as AccountingSettingsModel["reports"]["defaultReportBasis"],
                    },
                  })
                }
              >
                {DEFAULT_REPORT_BASIS_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 12,
              border: `1px solid ${ACCOUNTING_GOLD}`,
              background: "rgba(17,24,39,0.04)",
              fontSize: 14,
              fontWeight: 600,
              color: "#475569",
              lineHeight: 1.6,
            }}
          >
            Schools may need Department of Education reports on a January–December basis while SARS/tax reporting runs
            March–February. EduClear keeps both calendars available.
          </div>
        </div>
      ) : null}

      {tab === "default-accounts" ? (
        <div style={accountingCard}>
          <p style={{ margin: "0 0 20px", color: "#64748b", fontWeight: 600, fontSize: 14 }}>
            Map default posting accounts from your active Chart of Accounts. Selections are stored per school.
          </p>
          {(Object.keys(DEFAULT_ACCOUNT_LABELS) as DefaultAccountKey[]).map((key) => (
            <label
              key={key}
              style={{
                display: "grid",
                gap: 8,
                marginBottom: 16,
                fontWeight: 800,
                fontSize: 13,
                color: ACCOUNTING_INK,
              }}
            >
              {DEFAULT_ACCOUNT_LABELS[key]}
              <select
                style={fieldStyle}
                value={settings.defaultAccounts[key]}
                onChange={(e) =>
                  update({
                    defaultAccounts: { ...settings.defaultAccounts, [key]: e.target.value },
                  })
                }
              >
                <option value="">— Select account —</option>
                {chartAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {!chartAccounts.length ? (
            <p style={{ fontSize: 13, color: "#b45309", fontWeight: 700 }}>
              No active Chart of Accounts found. Open Chart of Accounts to seed accounts first.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === "posting-rules" ? (
        <div style={accountingCard}>
          <ToggleRow
            label="Auto-post billing payments"
            description="Post matched billing receipts to the ledger when banking rules allow."
            checked={settings.postingRules.autoPostBillingPayments}
            onChange={(v) => update({ postingRules: { ...settings.postingRules, autoPostBillingPayments: v } })}
          />
          <ToggleRow
            label="Auto-post approved expenses"
            description="Create journal entries when expenses are approved."
            checked={settings.postingRules.autoPostApprovedExpenses}
            onChange={(v) => update({ postingRules: { ...settings.postingRules, autoPostApprovedExpenses: v } })}
          />
          <ToggleRow
            label="Auto-post bank charges"
            description="Post bank fee lines from imports automatically."
            checked={settings.postingRules.autoPostBankCharges}
            onChange={(v) => update({ postingRules: { ...settings.postingRules, autoPostBankCharges: v } })}
          />
          <ToggleRow
            label="Auto-post depreciation"
            description="Post monthly depreciation from the asset register."
            checked={settings.postingRules.autoPostDepreciation}
            onChange={(v) => update({ postingRules: { ...settings.postingRules, autoPostDepreciation: v } })}
          />
          <ToggleRow
            label="Require journal review before posting"
            description="Journals must be reviewed before they can be posted."
            checked={settings.postingRules.requireJournalReviewBeforePosting}
            onChange={(v) =>
              update({ postingRules: { ...settings.postingRules, requireJournalReviewBeforePosting: v } })
            }
          />
        </div>
      ) : null}

      {tab === "approvals" ? (
        <div style={accountingCard}>
          <ToggleRow
            label="Require approval for expenses above amount"
            checked={settings.approvals.requireApprovalExpensesAbove}
            onChange={(v) => update({ approvals: { ...settings.approvals, requireApprovalExpensesAbove: v } })}
          />
          <label style={{ display: "grid", gap: 8, marginBottom: 20, fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK }}>
            Approval limit amount (R)
            <input
              type="number"
              min={0}
              style={fieldStyle}
              value={settings.approvals.expenseApprovalLimit}
              onChange={(e) =>
                update({
                  approvals: {
                    ...settings.approvals,
                    expenseApprovalLimit: Number(e.target.value) || 0,
                  },
                })
              }
            />
          </label>
          <ToggleRow
            label="Require owner approval for supplier payments"
            checked={settings.approvals.requireOwnerApprovalSupplierPayments}
            onChange={(v) =>
              update({ approvals: { ...settings.approvals, requireOwnerApprovalSupplierPayments: v } })
            }
          />
          <ToggleRow
            label="Require owner approval for journal reversals"
            checked={settings.approvals.requireOwnerApprovalJournalReversals}
            onChange={(v) =>
              update({ approvals: { ...settings.approvals, requireOwnerApprovalJournalReversals: v } })
            }
          />
        </div>
      ) : null}

      {tab === "reports" ? (
        <div style={accountingCard}>
          <label style={{ display: "grid", gap: 8, marginBottom: 16, fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK }}>
            Default report basis
            <select
              style={fieldStyle}
              value={settings.reports.defaultReportBasis}
              onChange={(e) =>
                update({
                  reports: {
                    ...settings.reports,
                    defaultReportBasis: e.target.value as AccountingSettingsModel["reports"]["defaultReportBasis"],
                  },
                  financialYears: {
                    defaultReportBasis: e.target.value as AccountingSettingsModel["financialYears"]["defaultReportBasis"],
                  },
                })
              }
            >
              {DEFAULT_REPORT_BASIS_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: "grid", gap: 8, marginBottom: 16, fontWeight: 800, fontSize: 13, color: ACCOUNTING_INK }}>
            Default export format
            <select
              style={fieldStyle}
              value={settings.reports.defaultExportFormat}
              onChange={(e) =>
                update({
                  reports: {
                    ...settings.reports,
                    defaultExportFormat: e.target.value === "Excel" ? "Excel" : "PDF",
                  },
                })
              }
            >
              <option value="PDF">PDF</option>
              <option value="Excel">Excel</option>
            </select>
          </label>
          <ToggleRow
            label="Show EduClear footer on exports"
            checked={settings.reports.showEduClearFooter}
            onChange={(v) => update({ reports: { ...settings.reports, showEduClearFooter: v } })}
          />
          <ToggleRow
            label="Include audit notes on reports"
            checked={settings.reports.includeAuditNotes}
            onChange={(v) => update({ reports: { ...settings.reports, includeAuditNotes: v } })}
          />
        </div>
      ) : null}

      <div style={{ marginTop: 24 }}>
        <button type="button" style={goldBtn} onClick={() => persist(settings)}>
          Save settings
        </button>
      </div>
    </div>
  );
}
