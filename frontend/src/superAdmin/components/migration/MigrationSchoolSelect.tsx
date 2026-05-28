import type { SchoolOption } from "../../types/migration";
import type { MigrationTargetSchoolsDebug } from "../../utils/migrationTargetSchools";

type Props = {
  schools: SchoolOption[];
  selectedSchoolId: string;
  onSchoolChange: (schoolId: string) => void;
  /** Temporary — remove after migration school selector is verified in production. */
  debug?: MigrationTargetSchoolsDebug | null;
};

export default function MigrationSchoolSelect({
  schools,
  selectedSchoolId,
  onSchoolChange,
  debug,
}: Props) {
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
      {debug ? (
        <details className="sa-migration-school-debug" data-testid="migration-school-debug">
          <summary>School selector debug (temporary)</summary>
          <dl>
            <dt>Total schools</dt>
            <dd>{debug.total}</dd>
            <dt>School IDs</dt>
            <dd>
              <code>{debug.schoolIds.join(", ") || "—"}</code>
            </dd>
            <dt>School names</dt>
            <dd>
              <code>{debug.schoolNames.join(", ") || "—"}</code>
            </dd>
            {debug.ensuredDaSilva != null ? (
              <>
                <dt>Da Silva ensured</dt>
                <dd>{debug.ensuredDaSilva ? "yes" : "no"}</dd>
              </>
            ) : null}
            {debug.daSilvaSchoolId ? (
              <>
                <dt>Da Silva school id</dt>
                <dd>
                  <code>{debug.daSilvaSchoolId}</code>
                </dd>
              </>
            ) : null}
          </dl>
        </details>
      ) : null}
    </section>
  );
}
