import type { BillingInvoiceSettings } from "../../types/billingSettings";
import {
  DEFAULT_INVOICE_PAGE_OPTIONS,
  DUE_DATE_OPTIONS,
  INVOICE_LAYOUT_OPTIONS,
} from "../billingSettingsConstants";
import BillingSettingsCheckbox from "../BillingSettingsCheckbox";
import BillingSettingsMessages from "../BillingSettingsMessages";
import BillingSettingsSelect from "../BillingSettingsSelect";

type Props = {
  schoolId: string;
  invoice: BillingInvoiceSettings;
  onFieldChange: (patch: Partial<BillingInvoiceSettings>) => void;
  onDisplayChange: (field: keyof BillingInvoiceSettings["displayOnInvoice"], checked: boolean) => void;
};

const DISPLAY_OPTIONS: { id: keyof BillingInvoiceSettings["displayOnInvoice"]; label: string }[] = [
  { id: "schoolName", label: "School Name" },
  { id: "schoolLogo", label: "School Logo" },
  { id: "dueDate", label: "Due Date" },
  { id: "payingAddress", label: "Paying Address" },
  { id: "childClassroom", label: "Child Classroom" },
];

export default function BillingInvoiceTab({ schoolId, invoice, onFieldChange, onDisplayChange }: Props) {
  return (
    <section
      className="billing-settings-card billing-settings-card--compact"
      aria-labelledby="billing-settings-invoice-heading"
    >
      <h2 id="billing-settings-invoice-heading" className="billing-settings-card-title">
        Invoice
      </h2>
      <p className="billing-settings-card-hint">Configure invoice pages, layout, and standard messages.</p>

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

      <section className="billing-settings-group">
        <h3 className="billing-settings-group-title">Display On Invoice</h3>
        <div className="billing-settings-checklist">
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

      <BillingSettingsSelect
        id={`${schoolId}-invoice-due-date`}
        label="Due Date"
        value={invoice.dueDate}
        options={DUE_DATE_OPTIONS}
        onChange={(value) => onFieldChange({ dueDate: value })}
      />

      <BillingSettingsMessages schoolId={schoolId} prefix="invoice" values={invoice} onChange={onFieldChange} />
    </section>
  );
}
