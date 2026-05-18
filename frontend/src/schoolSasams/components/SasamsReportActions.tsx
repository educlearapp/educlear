import type { SasamsReportActionId } from "../types/sasamsReport";

type Action = {
  id: SasamsReportActionId;
  label: string;
  variant: "gold" | "outline";
};

const ACTIONS: Action[] = [
  { id: "validateFile", label: "Validate File", variant: "gold" },
  { id: "prepareReports", label: "Prepare Reports", variant: "outline" },
  { id: "emailReports", label: "Email Reports", variant: "outline" },
  { id: "downloadTemplate", label: "Download Template", variant: "outline" },
];

type Props = {
  onAction: (actionId: SasamsReportActionId) => void;
};

export default function SasamsReportActions({ onAction }: Props) {
  return (
    <section className="sasams-report-section sasams-report-section--actions">
      <h2 className="sasams-report-section-title">4. Report Actions</h2>
      <div className="sasams-report-actions-bar">
        {ACTIONS.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`sasams-report-btn sasams-report-btn--${action.variant}`}
            onClick={() => onAction(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </section>
  );
}
