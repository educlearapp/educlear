import type { BillingInvoiceSettings } from "../../types/billingSettings";
import {
  DEFAULT_INVOICE_PAGE_OPTIONS,
  DUE_DATE_OPTIONS,
  INVOICE_FEATURE_OPTIONS,
  INVOICE_LAYOUT_OPTIONS,
} from "../billingSettingsConstants";
import BillingSettingsCheckbox from "../BillingSettingsCheckbox";
import BillingSettingsCheckboxGroup from "../BillingSettingsCheckboxGroup";
import BillingSettingsMessages from "../BillingSettingsMessages";
import BillingSettingsSelect from "../BillingSettingsSelect";

type Props = {
  schoolId: string;
  invoice: BillingInvoiceSettings;
  onFieldChange: (patch: Partial<BillingInvoiceSettings>) => void;
  onInvoiceFeatureChange: (id: string, checked: boolean) => void;
  onDisplayChange: (field: keyof BillingInvoiceSettings["displayOnInvoice"], checked: boolean) => void;
};

const DISPLAY_OPTIONS: { id: keyof BillingInvoiceSettings["displayOnInvoice"]; label: string }[] = [
  { id: "schoolName", label: "School Name" },
  { id: "schoolLogo", label: "School Logo" },
  { id: "dueDate", label: "Due Date" },
  { id: "payingAddress", label: "Paying Address" },
  { id: "childClassroom", label: "Child Classroom" },
];

export default function BillingInvoiceTab({
  schoolId,
  invoice,
  onFieldChange,
  onInvoiceFeatureChange,
  onDisplayChange,
}: Props) {
  return (
    <section
      className="billing-settings-card billing-settings-card--compact"
      aria-labelledby="billing-settings-invoice-heading"
    >
      <h2 id="billing-settings-invoice-heading" className="billing-settings-card-title">
        Invoice
      </h2>
      <p className="billing-settings-card-hint">Configure invoice pages, numbering, and terms.</p>

      <div className="billing-settings-grid billing-settings-grid--2">
        <BillingSettingsSelect
          id={`${schoolId}-default-invoice-page`}
          label="Default Invoice Page"
          value={invoice.defaultInvoicePage}
          options={DEFAULT_INVOICE_PAGE_OPTIONS}
          onChange={(value) => onFieldChange({ defaultInvoicePage: value })}
        />
        <BillingSettingsSelect
          id={`${schoolId}-invoice-layout`}
          label="Invoice Layout"
          value={invoice.invoiceLayout}
          options={INVOICE_LAYOUT_OPTIONS}
          onChange={(value) => onFieldChange({ invoiceLayout: value })}
        />
      </div>

      <BillingSettingsCheckboxGroup
        schoolId={schoolId}
        prefix="invoice-features"
        title="Invoice Features"
        options={INVOICE_FEATURE_OPTIONS}
        values={invoice.invoiceFeatures}
        onChange={onInvoiceFeatureChange}
        columns={2}
      />

      <div className="billing-settings-grid billing-settings-grid--2">
        <div className="billing-settings-field">
          <label className="billing-settings-label" htmlFor={`${schoolId}-invoice-prefix`}>
            Invoice Prefix
          </label>
          <input
            id={`${schoolId}-invoice-prefix`}
            type="text"
            className="billing-settings-input"
            value={invoice.invoicePrefix}
            onChange={(e) => onFieldChange({ invoicePrefix: e.target.value })}
          />
        </div>
        <BillingSettingsSelect
          id={`${schoolId}-invoice-due-date`}
          label="Due Date"
          value={invoice.dueDate}
          options={DUE_DATE_OPTIONS}
          onChange={(value) => onFieldChange({ dueDate: value })}
        />
      </div>

      <div className="billing-settings-field billing-settings-field--full">
        <label className="billing-settings-label" htmlFor={`${schoolId}-invoice-terms`}>
          Terms and Conditions
        </label>
        <textarea
          id={`${schoolId}-invoice-terms`}
          className="billing-settings-textarea"
          rows={3}
          value={invoice.termsAndConditions}
          onChange={(e) => onFieldChange({ termsAndConditions: e.target.value })}
        />
      </div>

      <section className="billing-settings-group">
        <h3 className="billing-settings-group-title">Display On Invoice</h3>
        <div className="billing-settings-checklist billing-settings-checklist--2col">
          {DISPLAY_OPTIONS.map((option) => (
            <BillingSettingsCheckbox
              key={option.id}
              id={`${schoolId}-invoice-display-${option.id}`}
              label={option.label}
              checked={invoice.displayOnInvoice[option.id]}
              onChange={(checked) => onDisplayChange(option.id, checked)}
            />
          ))}
        </div>
      </section>

      <BillingSettingsMessages schoolId={schoolId} prefix="invoice" values={invoice} onChange={onFieldChange} />
    </section>
  );
}
