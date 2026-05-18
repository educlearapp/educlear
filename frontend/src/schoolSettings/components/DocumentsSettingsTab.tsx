import { DOCUMENT_DISPLAY_FIELDS } from "./schoolSettingsConstants";
import type { DocumentDisplaySettings } from "../types/schoolSettings";
import SettingsCheckbox from "./SettingsCheckbox";

type Props = {
  schoolId: string;
  documents: DocumentDisplaySettings;
  onFieldChange: (field: keyof DocumentDisplaySettings, value: boolean) => void;
};

export default function DocumentsSettingsTab({ schoolId, documents, onFieldChange }: Props) {
  return (
    <section className="school-settings-card" aria-labelledby="school-settings-documents-heading">
      <h2 id="school-settings-documents-heading" className="school-settings-card-title">
        Display On Documents
      </h2>
      <p className="school-settings-card-hint">
        Select which school details appear on generated documents and reports.
      </p>
      <div className="school-settings-checklist school-settings-checklist--documents">
        {DOCUMENT_DISPLAY_FIELDS.map((field) => (
          <SettingsCheckbox
            key={field.id}
            id={`${schoolId}-doc-${field.id}`}
            label={field.label}
            checked={documents[field.id]}
            onChange={(value) => onFieldChange(field.id, value)}
          />
        ))}
      </div>
    </section>
  );
}
