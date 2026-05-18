import BillingSettingsCheckbox from "./BillingSettingsCheckbox";

type Option = { id: string; label: string };

type Props = {
  schoolId: string;
  prefix: string;
  title: string;
  options: readonly Option[];
  values: Record<string, boolean>;
  onChange: (id: string, checked: boolean) => void;
};

export default function BillingSettingsCheckboxGroup({
  schoolId,
  prefix,
  title,
  options,
  values,
  onChange,
}: Props) {
  return (
    <section className="billing-settings-group">
      <h3 className="billing-settings-group-title">{title}</h3>
      <div className="billing-settings-checklist">
        {options.map((option) => (
          <BillingSettingsCheckbox
            key={option.id}
            id={`${schoolId}-${prefix}-${option.id}`}
            label={option.label}
            checked={Boolean(values[option.id])}
            onChange={(checked) => onChange(option.id, checked)}
          />
        ))}
      </div>
    </section>
  );
}
