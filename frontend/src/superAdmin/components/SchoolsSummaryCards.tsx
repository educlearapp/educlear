import type { SchoolsSummary } from "../types/schools";

type Card = {
  key: keyof SchoolsSummary;
  label: string;
};

const CARDS: Card[] = [
  { key: "total", label: "Total Schools" },
  { key: "active", label: "Active Schools" },
  { key: "suspended", label: "Suspended Schools" },
  { key: "trial", label: "Trial Schools" },
];

type Props = {
  summary: SchoolsSummary;
};

export default function SchoolsSummaryCards({ summary }: Props) {
  return (
    <div className="sa-schools-summary-grid" role="group" aria-label="School statistics">
      {CARDS.map((card) => (
        <article key={card.key} className="sa-schools-summary-card">
          <div className="sa-schools-summary-accent" aria-hidden="true" />
          <p className="sa-schools-summary-label">{card.label}</p>
          <p className="sa-schools-summary-value">{summary[card.key]}</p>
        </article>
      ))}
    </div>
  );
}
