import type { GeneralSettings } from "../types/schoolSettings";
import SettingsCheckbox from "./SettingsCheckbox";

type Props = {
  schoolId: string;
  general: GeneralSettings;
  onFieldChange: (field: keyof GeneralSettings, value: boolean) => void;
};

export default function GeneralSettingsTab({ schoolId, general, onFieldChange }: Props) {
  return (
    <section className="school-settings-card" aria-labelledby="school-settings-general-heading">
      <h2 id="school-settings-general-heading" className="school-settings-card-title">
        General Options
      </h2>
      <p className="school-settings-card-hint">Enable optional modes for your school workspace.</p>
      <div className="school-settings-checklist">
        <SettingsCheckbox
          id={`${schoolId}-student-mode`}
          label="Student Mode"
          checked={general.studentMode}
          onChange={(value) => onFieldChange("studentMode", value)}
        />
        <SettingsCheckbox
          id={`${schoolId}-extra-mural-mode`}
          label="Extra Mural Mode"
          checked={general.extraMuralMode}
          onChange={(value) => onFieldChange("extraMuralMode", value)}
        />
      </div>
    </section>
  );
}
