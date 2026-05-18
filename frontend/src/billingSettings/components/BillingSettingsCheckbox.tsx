type Props = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export default function BillingSettingsCheckbox({ id, label, checked, onChange }: Props) {
  return (
    <label className="billing-settings-check-row" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="billing-settings-check-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="billing-settings-check-box" aria-hidden="true" />
      <span className="billing-settings-check-label">{label}</span>
    </label>
  );
}
