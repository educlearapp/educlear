import "./admissionsStaff.css";

type Props = {
  status: string;
  className?: string;
};

function statusClass(status: string): string {
  switch (status) {
    case "SUBMITTED":
      return "admissions-staff-status-badge--submitted";
    case "UNDER_REVIEW":
      return "admissions-staff-status-badge--review";
    case "INFO_REQUESTED":
      return "admissions-staff-status-badge--info";
    case "ACCEPTED":
      return "admissions-staff-status-badge--accepted";
    case "DECLINED":
    case "WITHDRAWN":
    case "CANCELLED":
      return "admissions-staff-status-badge--declined";
    default:
      return "admissions-staff-status-badge--neutral";
  }
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export default function AdmissionsStatusBadge({ status, className = "" }: Props) {
  return (
    <span
      className={`admissions-staff-status-badge ${statusClass(status)} ${className}`.trim()}
      aria-label={`Application status: ${statusLabel(status)}`}
    >
      {statusLabel(status)}
    </span>
  );
}
