import type { ReactNode } from "react";
import type { FinancePolicySettings } from "../types/billingSettings";

type Props = {
  schoolId: string;
  policy: FinancePolicySettings;
  onChange: (patch: Partial<FinancePolicySettings>) => void;
};

export default function FinancePolicySettingsCard({ schoolId, policy, onChange }: Props) {
  const updateNumber = (field: keyof FinancePolicySettings, value: string, max?: number) => {
    const parsed = Math.max(0, Number(value) || 0);
    onChange({ [field]: typeof max === "number" ? Math.min(parsed, max) : parsed } as Partial<FinancePolicySettings>);
  };

  const updateThreshold = (
    field: keyof FinancePolicySettings["accountHealthThresholds"],
    value: string
  ) => {
    onChange({
      accountHealthThresholds: {
        ...policy.accountHealthThresholds,
        [field]: Math.max(0, Number(value) || 0),
      },
    });
  };

  return (
    <section className="billing-settings-group billing-finance-policy">
      <h3 className="billing-settings-group-title">School Finance Policy</h3>
      <p className="billing-settings-card-hint">
        These settings guide Parent Portal finance actions and Collections Centre status groups.
      </p>

      <PolicySection
        title="Due Dates"
        hint="Set the key dates parents and finance staff will see."
      >
        <div className="billing-settings-grid billing-settings-grid--2">
          <NumberField
            id={`${schoolId}-finance-due-day`}
            label="Monthly fee due day"
            value={policy.monthlyFeeDueDay}
            min={1}
            max={31}
            onChange={(value) => updateNumber("monthlyFeeDueDay", value, 31)}
          />
          <NumberField
            id={`${schoolId}-finance-grace-period`}
            label="Grace period days"
            value={policy.gracePeriodDays}
            min={0}
            max={31}
            onChange={(value) => updateNumber("gracePeriodDays", value, 31)}
          />
          <TextField
            id={`${schoolId}-finance-settlement-deadline`}
            label="School settlement deadline (MM-DD)"
            value={policy.schoolSettlementDeadline}
            onChange={(value) => onChange({ schoolSettlementDeadline: value })}
          />
        </div>
      </PolicySection>

      <PolicySection
        title="Payment Plan Rules"
        hint="Decide when parents may ask for help and what the school needs before review."
      >
        <div className="billing-settings-grid billing-settings-grid--2">
          <NumberField
            id={`${schoolId}-finance-arrangement-days`}
            label="Payment plan opens after overdue days"
            value={policy.arrangementEligibilityDays}
            min={1}
            onChange={(value) => updateNumber("arrangementEligibilityDays", value)}
          />
          <NumberField
            id={`${schoolId}-finance-max-duration`}
            label="Maximum plan length (months)"
            value={policy.maximumArrangementDurationMonths}
            min={1}
            max={6}
            onChange={(value) => updateNumber("maximumArrangementDurationMonths", value, 6)}
          />
          <NumberField
            id={`${schoolId}-finance-min-monthly`}
            label="Minimum monthly payment"
            value={policy.minimumMonthlyPayment}
            min={0}
            onChange={(value) => updateNumber("minimumMonthlyPayment", value)}
          />
          <NumberField
            id={`${schoolId}-finance-min-upfront`}
            label="Minimum upfront payment"
            value={policy.minimumUpfrontPayment}
            min={0}
            onChange={(value) => updateNumber("minimumUpfrontPayment", value)}
          />
          <NumberField
            id={`${schoolId}-finance-auto-cancel`}
            label="Cancel plan after missed payments"
            value={policy.autoCancelAfterMissedInstalments}
            min={1}
            onChange={(value) => updateNumber("autoCancelAfterMissedInstalments", value)}
          />
        </div>
        <div className="billing-settings-checklist billing-settings-checklist--2col">
          <Checkbox
            id={`${schoolId}-finance-arrangements-allowed`}
            label="Parents may request payment plans"
            checked={policy.arrangementsAllowed}
            onChange={(checked) => onChange({ arrangementsAllowed: checked })}
          />
          <Checkbox
            id={`${schoolId}-finance-require-approval`}
            label="Finance office approval required"
            checked={policy.requireApproval}
            onChange={(checked) => onChange({ requireApproval: checked })}
          />
          <Checkbox
            id={`${schoolId}-finance-require-documents`}
            label="Supporting documents may be requested"
            checked={policy.requireSupportingDocuments}
            onChange={(checked) => onChange({ requireSupportingDocuments: checked })}
          />
        </div>
      </PolicySection>

      <PolicySection
        title="Account Health Rules"
        hint="Control when an account moves from healthy to urgent."
      >
        <div className="billing-settings-grid billing-settings-grid--2 billing-finance-thresholds">
          <NumberField
            id={`${schoolId}-finance-excellent-days`}
            label="Excellent max overdue days"
            value={policy.accountHealthThresholds.excellentMaxOverdueDays}
            min={0}
            onChange={(value) => updateThreshold("excellentMaxOverdueDays", value)}
          />
          <NumberField
            id={`${schoolId}-finance-needs-days`}
            label="Needs Attention max overdue days"
            value={policy.accountHealthThresholds.needsAttentionMaxOverdueDays}
            min={1}
            onChange={(value) => updateThreshold("needsAttentionMaxOverdueDays", value)}
          />
          <NumberField
            id={`${schoolId}-finance-action-days`}
            label="Action Required max overdue days"
            value={policy.accountHealthThresholds.actionRequiredMaxOverdueDays}
            min={1}
            onChange={(value) => updateThreshold("actionRequiredMaxOverdueDays", value)}
          />
        </div>
      </PolicySection>

      <PolicySection
        title="Reminder Settings"
        hint="Choose when parents should be reminded about payments."
      >
        <TextField
          id={`${schoolId}-finance-reminders`}
          label="Reminder schedule"
          value={policy.reminderSchedule}
          onChange={(value) => onChange({ reminderSchedule: value })}
        />
      </PolicySection>
    </section>
  );
}

function PolicySection({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <section className="billing-finance-policy-section">
      <div className="billing-finance-policy-section-head">
        <h4>{title}</h4>
        <p>{hint}</p>
      </div>
      {children}
    </section>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="billing-settings-field" htmlFor={id}>
      <span className="billing-settings-label">{label}</span>
      <input
        id={id}
        className="billing-settings-input"
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="billing-settings-field" htmlFor={id}>
      <span className="billing-settings-label">{label}</span>
      <input
        id={id}
        className="billing-settings-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function Checkbox({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="billing-settings-check-row" htmlFor={id}>
      <input
        id={id}
        className="billing-settings-check-input"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="billing-settings-check-box" aria-hidden />
      <span className="billing-settings-check-label">{label}</span>
    </label>
  );
}
