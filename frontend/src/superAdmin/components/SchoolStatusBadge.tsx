import { lifecycleBadgeLabel, type SchoolLifecycleStatus } from "../schoolLifecycle";

type Props = {
  status: SchoolLifecycleStatus;
};

const STATUS_CLASS: Record<SchoolLifecycleStatus, string> = {
  ACTIVE: "sa-schools-badge sa-schools-badge--active",
  TRIAL: "sa-schools-badge sa-schools-badge--trial",
  INACTIVE: "sa-schools-badge sa-schools-badge--inactive",
  ARCHIVED: "sa-schools-badge sa-schools-badge--archived",
};

export default function SchoolStatusBadge({ status }: Props) {
  return (
    <span className={STATUS_CLASS[status]} role="status">
      {lifecycleBadgeLabel(status)}
    </span>
  );
}
