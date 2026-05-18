import type { MigrationSource } from "../../types/migration";
import { MIGRATION_SOURCES } from "./migrationConstants";

type Props = {
  value: MigrationSource | "";
  onChange: (source: MigrationSource) => void;
};

export default function MigrationSourceSelect({ value, onChange }: Props) {
  return (
    <section className="sa-migration-section">
      <h2 className="sa-migration-section-title">2. Migration Source</h2>
      <div className="sa-migration-source-grid" role="radiogroup" aria-label="Migration source">
        {MIGRATION_SOURCES.map((source) => {
          const selected = value === source.id;
          return (
            <label
              key={source.id}
              className={`sa-migration-source-card${selected ? " sa-migration-source-card--selected" : ""}`}
            >
              <input
                type="radio"
                name="migration-source"
                value={source.id}
                checked={selected}
                onChange={() => onChange(source.id)}
                className="sa-migration-source-input"
              />
              <span className="sa-migration-source-label">{source.label}</span>
            </label>
          );
        })}
      </div>
    </section>
  );
}
