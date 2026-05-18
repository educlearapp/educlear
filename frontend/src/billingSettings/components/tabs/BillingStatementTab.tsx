import type { BillingStatementSettings } from "../../types/billingSettings";
import {
  STATEMENT_SHOW_AMOUNTS_OPTIONS,
  STATEMENT_HISTORY_OPTIONS,
  STATEMENT_INFO_OPTIONS,
  STATEMENT_LAYOUT_OPTIONS,
} from "../billingSettingsConstants";
import BillingSettingsCheckbox from "../BillingSettingsCheckbox";
import BillingSettingsCheckboxGroup from "../BillingSettingsCheckboxGroup";
import BillingSettingsMessages from "../BillingSettingsMessages";
import BillingSettingsSelect from "../BillingSettingsSelect";

type Props = {
  schoolId: string;
  statement: BillingStatementSettings;
  onFieldChange: (patch: Partial<BillingStatementSettings>) => void;
  onStatementInfoChange: (id: string, checked: boolean) => void;
  onDisplayChange: (field: keyof BillingStatementSettings["displayOnStatement"], checked: boolean) => void;
};

const DISPLAY_OPTIONS: { id: keyof BillingStatementSettings["displayOnStatement"]; label: string }[] = [
  { id: "schoolName", label: "School Name" },
  { id: "schoolLogo", label: "School Logo" },
  { id: "payingAddress", label: "Paying Address" },
  { id: "childClassroom", label: "Child Classroom" },
];

export default function BillingStatementTab({
  schoolId,
  statement,
  onFieldChange,
  onStatementInfoChange,
  onDisplayChange,
}: Props) {
  return (
    <section
      className="billing-settings-card billing-settings-card--compact"
      aria-labelledby="billing-settings-statement-heading"
    >
      <h2 id="billing-settings-statement-heading" className="billing-settings-card-title">
        Statement
      </h2>
      <p className="billing-settings-card-hint">Configure statement layout, history, and delivery messages.</p>

      <div className="billing-settings-grid billing-settings-grid--2">
        <BillingSettingsSelect
          id={`${schoolId}-statement-layout`}
          label="Statement Layout"
          value={statement.statementLayout}
          options={STATEMENT_LAYOUT_OPTIONS}
          onChange={(value) => onFieldChange({ statementLayout: value })}
        />
        <BillingSettingsSelect
          id={`${schoolId}-statement-history`}
          label="Statement History"
          value={statement.statementHistory}
          options={STATEMENT_HISTORY_OPTIONS}
          onChange={(value) => onFieldChange({ statementHistory: value })}
        />
      </div>

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="statement-info"
        title="Statement Info"
        options={STATEMENT_INFO_OPTIONS}
        values={statement.statementInfo}
        onChange={onStatementInfoChange}
      />

      <BillingSettingsSelect
        id={`${schoolId}-statement-show-amounts`}
        label="Show Amounts"
        value={statement.showAmounts}
        options={STATEMENT_SHOW_AMOUNTS_OPTIONS}
        onChange={(value) => onFieldChange({ showAmounts: value })}
      />

      <section className="billing-settings-group">
        <h3 className="billing-settings-group-title">Display On Statement</h3>
        <div className="billing-settings-checklist">
          {DISPLAY_OPTIONS.map((option) => (
            <BillingSettingsCheckbox
              key={option.id}
              id={`${schoolId}-statement-display-${option.id}`}
              label={option.label}
              checked={statement.displayOnStatement[option.id]}
              onChange={(checked) => onDisplayChange(option.id, checked)}
            />
          ))}
        </div>
      </section>

      <BillingSettingsMessages
        schoolId={schoolId}
        prefix="statement"
        values={statement}
        onChange={onFieldChange}
      />
    </section>
  );
}
