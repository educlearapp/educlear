import BillingSettingsCheckbox from "./BillingSettingsCheckbox";

type Option = { id: string; label: string };

type Props = {
  schoolId: string;
  prefix: string;
  title: string;
  options: readonly Option[];
  values: Record<string, boolean>;
  onChange: (id: string, checked: boolean) => void;
  columns?: 1 | 2;
};

export default function BillingSettingsCheckboxGroup({
  schoolId,
  prefix,
  title,
  options,
  values,
  onChange,
  columns = 1,
}: Props) {
  const checklistClass =
    columns === 2 ? "billing-settings-checklist billing-settings-checklist--2col" : "billing-settings-checklist";

  return (
    <section className="billing-settings-group">
      <h3 className="billing-settings-group-title">{title}</h3>
      <div className={checklistClass}>
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
