import type { SasamsReportSummary } from "../types/sasamsReport";

type Card = {
  key: keyof SasamsReportSummary;
  label: string;
};

const CARDS: Card[] = [
  { key: "filesUploaded", label: "Files Uploaded" },
  { key: "learnersMatched", label: "Learners Matched" },
  { key: "reportsReady", label: "Reports Ready" },
  { key: "errorsNeedsReview", label: "Errors / Needs Review" },
];

type Props = {
  summary: SasamsReportSummary;
};

export default function SasamsSummaryCards({ summary }: Props) {
  return (
    <div className="sasams-report-summary-grid" role="group" aria-label="SASAMS upload statistics">
      {CARDS.map((card) => (
        <article key={card.key} className="sasams-report-summary-card">
          <div className="sasams-report-summary-accent" aria-hidden="true" />
          <p className="sasams-report-summary-label">{card.label}</p>
          <p className="sasams-report-summary-value">{summary[card.key]}</p>
        </article>
      ))}
    </div>
  );
}
