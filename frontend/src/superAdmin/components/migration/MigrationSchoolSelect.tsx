import type { SchoolOption } from "../../types/migration";

type Props = {
  schools: SchoolOption[];
  selectedSchoolId: string;
  onSchoolChange: (schoolId: string) => void;
};

export default function MigrationSchoolSelect({ schools, selectedSchoolId, onSchoolChange }: Props) {
  return (
    <section className="sa-migration-section">
      <h2 className="sa-migration-section-title">1. Select School</h2>
      <p className="sa-migration-section-hint">Choose school to migrate into</p>
      <label className="sa-migration-field">
        <span className="sa-migration-field-label">Target school</span>
        <select
          className="sa-migration-select"
          value={selectedSchoolId}
          onChange={(e) => onSchoolChange(e.target.value)}
        >
          <option value="">Choose school to migrate into</option>
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
