import {
  ACCOUNT_STYLE_OPTIONS,
  ACCOUNTS_INFO_BLOCK_OPTIONS,
  CORRECTIONS_OPTIONS,
  INVOICES_INFO_BLOCK_OPTIONS,
  PAYMENTS_INFO_BLOCK_OPTIONS,
  QUICK_POPUP_OPTIONS,
  GENERAL_SHOW_AMOUNTS_OPTIONS,
} from "../billingSettingsConstants";
import BillingSettingsCheckboxGroup from "../BillingSettingsCheckboxGroup";
import BillingSettingsSelect from "../BillingSettingsSelect";
import type { BillingGeneralSettings } from "../../types/billingSettings";

type Props = {
  schoolId: string;
  general: BillingGeneralSettings;
  onFieldChange: (patch: Partial<BillingGeneralSettings>) => void;
  onCheckboxChange: (
    group: "quickPopups" | "accountsInfoBlocks" | "invoicesInfoBlocks" | "paymentsInfoBlocks" | "corrections",
    id: string,
    checked: boolean
  ) => void;
};

export default function BillingGeneralTab({ schoolId, general, onFieldChange, onCheckboxChange }: Props) {
  return (
    <section className="billing-settings-card" aria-labelledby="billing-settings-general-heading">
      <h2 id="billing-settings-general-heading" className="billing-settings-card-title">
        General
      </h2>
      <p className="billing-settings-card-hint">Configure account display, popups, and billing workspace blocks.</p>

      <div className="billing-settings-grid billing-settings-grid--2">
        <BillingSettingsSelect
          id={`${schoolId}-account-style`}
          label="Account Style"
          value={general.accountStyle}
          options={ACCOUNT_STYLE_OPTIONS}
          onChange={(value) => onFieldChange({ accountStyle: value })}
        />
        <BillingSettingsSelect
          id={`${schoolId}-show-amounts`}
          label="Show Amounts"
          value={general.showAmounts}
          options={GENERAL_SHOW_AMOUNTS_OPTIONS}
          onChange={(value) => onFieldChange({ showAmounts: value })}
        />
      </div>

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="quick-popups"
        title="Quick Popups"
        options={QUICK_POPUP_OPTIONS}
        values={general.quickPopups}
        onChange={(id, checked) => onCheckboxChange("quickPopups", id, checked)}
      />

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="accounts-info"
        title="Accounts Info Blocks"
        options={ACCOUNTS_INFO_BLOCK_OPTIONS}
        values={general.accountsInfoBlocks}
        onChange={(id, checked) => onCheckboxChange("accountsInfoBlocks", id, checked)}
      />

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="invoices-info"
        title="Invoices Info Blocks"
        options={INVOICES_INFO_BLOCK_OPTIONS}
        values={general.invoicesInfoBlocks}
        onChange={(id, checked) => onCheckboxChange("invoicesInfoBlocks", id, checked)}
      />

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="payments-info"
        title="Payments Info Blocks"
        options={PAYMENTS_INFO_BLOCK_OPTIONS}
        values={general.paymentsInfoBlocks}
        onChange={(id, checked) => onCheckboxChange("paymentsInfoBlocks", id, checked)}
      />

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="corrections"
        title="Corrections"
        options={CORRECTIONS_OPTIONS}
        values={general.corrections}
        onChange={(id, checked) => onCheckboxChange("corrections", id, checked)}
      />
    </section>
  );
}
