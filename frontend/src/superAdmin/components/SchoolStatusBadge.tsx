import type { SchoolStatus } from "../types/schools";

type Props = {
  status: SchoolStatus;
};

const STATUS_CLASS: Record<SchoolStatus, string> = {
  Active: "sa-schools-badge sa-schools-badge--active",
  Trial: "sa-schools-badge sa-schools-badge--trial",
  Suspended: "sa-schools-badge sa-schools-badge--suspended",
};

export default function SchoolStatusBadge({ status }: Props) {
  return (
    <span className={STATUS_CLASS[status]} role="status">
      {status}
    </span>
  );
}
