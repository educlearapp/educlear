import type { MigrationSummary } from "../../types/migration";

type Card = {
  key: keyof MigrationSummary;
  label: string;
};

const CARDS: Card[] = [
  { key: "projects", label: "Migration Projects" },
  { key: "inProgress", label: "In Progress" },
  { key: "completed", label: "Completed" },
  { key: "needsReview", label: "Needs Review" },
];

type Props = {
  summary: MigrationSummary;
};

export default function MigrationSummaryCards({ summary }: Props) {
  return (
    <div className="sa-migration-summary-grid" role="group" aria-label="Migration statistics">
      {CARDS.map((card) => (
        <article key={card.key} className="sa-migration-summary-card">
          <div className="sa-migration-summary-accent" aria-hidden="true" />
          <p className="sa-migration-summary-label">{card.label}</p>
          <p className="sa-migration-summary-value">{summary[card.key]}</p>
        </article>
      ))}
    </div>
  );
}
