type Props = {
  id: string;
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
};

export default function BillingSettingsSelect({ id, label, value, options, onChange }: Props) {
  return (
    <div className="billing-settings-field">
      <label className="billing-settings-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="billing-settings-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
