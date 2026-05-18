import type { SasamsUploadTypeId } from "../types/sasamsReport";
import { SASAMS_UPLOAD_TYPES } from "./sasamsConstants";

type Props = {
  value: SasamsUploadTypeId | "";
  onChange: (id: SasamsUploadTypeId) => void;
};

export default function SasamsUploadTypeSelect({ value, onChange }: Props) {
  return (
    <section className="sasams-report-section">
      <h2 className="sasams-report-section-title">2. Upload Type</h2>
      <p className="sasams-report-section-hint">Select the type of SASAMS data in your upload.</p>
      <div className="sasams-report-type-grid" role="radiogroup" aria-label="Upload type">
        {SASAMS_UPLOAD_TYPES.map((option) => {
          const selected = value === option.id;
          return (
            <label
              key={option.id}
              className={`sasams-report-type-card${selected ? " sasams-report-type-card--selected" : ""}`}
            >
              <input
                type="radio"
                name="sasams-upload-type"
                className="sasams-report-type-input"
                value={option.id}
                checked={selected}
                onChange={() => onChange(option.id)}
              />
              <span className="sasams-report-type-label">{option.label}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
