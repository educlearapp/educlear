import type { BillingReceiptSettings } from "../../types/billingSettings";
import { DEFAULT_PAYMENT_PAGE_OPTIONS, RECEIPT_LAYOUT_OPTIONS } from "../billingSettingsConstants";
import BillingSettingsCheckbox from "../BillingSettingsCheckbox";
import BillingSettingsMessages from "../BillingSettingsMessages";
import BillingSettingsSelect from "../BillingSettingsSelect";

type Props = {
  schoolId: string;
  receipt: BillingReceiptSettings;
  onFieldChange: (patch: Partial<BillingReceiptSettings>) => void;
  onDisplayChange: (field: keyof BillingReceiptSettings["displayOnReceipt"], checked: boolean) => void;
};

const DISPLAY_OPTIONS: { id: keyof BillingReceiptSettings["displayOnReceipt"]; label: string }[] = [
  { id: "schoolName", label: "School Name" },
  { id: "schoolLogo", label: "School Logo" },
];

export default function BillingReceiptTab({ schoolId, receipt, onFieldChange, onDisplayChange }: Props) {
  return (
    <section
      className="billing-settings-card billing-settings-card--compact"
      aria-labelledby="billing-settings-receipt-heading"
    >
      <h2 id="billing-settings-receipt-heading" className="billing-settings-card-title">
        Receipt
      </h2>
      <p className="billing-settings-card-hint">Configure receipt pages, layout, and standard messages.</p>

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

      <section className="billing-settings-group">
        <h3 className="billing-settings-group-title">Display On Receipt</h3>
        <div className="billing-settings-checklist">
          {DISPLAY_OPTIONS.map((option) => (
            <BillingSettingsCheckbox
              key={option.id}
              id={`${schoolId}-receipt-display-${option.id}`}
              label={option.label}
              checked={receipt.displayOnReceipt[option.id]}
              onChange={(checked) => onDisplayChange(option.id, checked)}
            />
          ))}
        </div>
      </section>

      <BillingSettingsMessages schoolId={schoolId} prefix="receipt" values={receipt} onChange={onFieldChange} />
    </section>
  );
}
