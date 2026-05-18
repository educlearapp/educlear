import type { DataCategoryId } from "../../types/migration";
import { DATA_CATEGORIES } from "./migrationConstants";

type Props = {
  selected: Set<DataCategoryId>;
  onToggle: (id: DataCategoryId) => void;
};

export default function MigrationDataCategories({ selected, onToggle }: Props) {
  return (
    <section className="sa-migration-section">
      <h2 className="sa-migration-section-title">4. Data Categories</h2>
      <ul className="sa-migration-checklist">
        {DATA_CATEGORIES.map((category) => {
          const checked = selected.has(category.id);
          return (
            <li key={category.id}>
              <label className="sa-migration-check-item">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(category.id)}
                />
                <span>{category.label}</span>
              </label>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
