import type { BillingReceiptSettings } from "../../types/billingSettings";
import { DEFAULT_PAYMENT_PAGE_OPTIONS, RECEIPT_FEATURE_OPTIONS, RECEIPT_LAYOUT_OPTIONS } from "../billingSettingsConstants";
import BillingSettingsCheckboxGroup from "../BillingSettingsCheckboxGroup";
import BillingSettingsMessages from "../BillingSettingsMessages";
import BillingSettingsSelect from "../BillingSettingsSelect";

type Props = {
  schoolId: string;
  receipt: BillingReceiptSettings;
  onFieldChange: (patch: Partial<BillingReceiptSettings>) => void;
  onReceiptFeatureChange: (id: string, checked: boolean) => void;
};

export default function BillingReceiptTab({ schoolId, receipt, onFieldChange, onReceiptFeatureChange }: Props) {
  return (
    <section
      className="billing-settings-card billing-settings-card--compact"
      aria-labelledby="billing-settings-receipt-heading"
    >
      <h2 id="billing-settings-receipt-heading" className="billing-settings-card-title">
        Receipt
      </h2>
      <p className="billing-settings-card-hint">Configure receipt layout, display options, and footer message.</p>

      <div className="billing-settings-grid billing-settings-grid--2">
        <BillingSettingsSelect
          id={`${schoolId}-default-payment-page`}
          label="Default Payment Page"
          value={receipt.defaultPaymentPage}
          options={DEFAULT_PAYMENT_PAGE_OPTIONS}
          onChange={(value) => onFieldChange({ defaultPaymentPage: value })}
        />
        <BillingSettingsSelect
          id={`${schoolId}-receipt-layout`}
          label="Receipt Layout"
          value={receipt.receiptLayout}
          options={RECEIPT_LAYOUT_OPTIONS}
          onChange={(value) => onFieldChange({ receiptLayout: value })}
        />
      </div>

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="receipt-features"
        title="Receipt Display"
        options={RECEIPT_FEATURE_OPTIONS}
        values={receipt.receiptFeatures}
        onChange={onReceiptFeatureChange}
        columns={2}
      />

      <div className="billing-settings-field billing-settings-field--full">
        <label className="billing-settings-label" htmlFor={`${schoolId}-receipt-footer`}>
          Footer Message
        </label>
        <textarea
          id={`${schoolId}-receipt-footer`}
          className="billing-settings-textarea"
          rows={3}
          value={receipt.footerMessage}
          onChange={(e) => onFieldChange({ footerMessage: e.target.value })}
        />
      </div>

      <BillingSettingsMessages schoolId={schoolId} prefix="receipt" values={receipt} onChange={onFieldChange} />
    </section>
  );
}
