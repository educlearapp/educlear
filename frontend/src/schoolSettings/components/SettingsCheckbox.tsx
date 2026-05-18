type Props = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

export default function SettingsCheckbox({ id, label, checked, onChange }: Props) {
  return (
    <label className="school-settings-check-row" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        className="school-settings-check-input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="school-settings-check-box" aria-hidden="true" />
      <span className="school-settings-check-label">{label}</span>
    </label>
  );
}
