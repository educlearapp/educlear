import {
  type MigrationAgingCheck,
  type MigrationFeeCheckAuthorityCheck,
  type MigrationFinanceReconciliation,
  type MigrationStatementAuthorityCheck,
} from "../../superAdmin/utils/universalMigrationFinance";

type StageStatus = "PASS" | "REVIEW" | "BLOCKED" | "STALE" | "PENDING";

type Props = {
  reconciliation: MigrationFinanceReconciliation | null;
  statementCheck: MigrationStatementAuthorityCheck | null;
  feeCheck: MigrationFeeCheckAuthorityCheck | null;
  agingCheck: MigrationAgingCheck | null;
  onRunFinancialChecks?: () => void;
  busy?: boolean;
};

function statusForFinance(recon: MigrationFinanceReconciliation | null): StageStatus {
  if (!recon) return "PENDING";
  if (recon.stale) return "STALE";
  if (recon.canAccept && recon.differenceCents === 0) return "PASS";
  if (recon.blockedReasons.length) return "BLOCKED";
  return "REVIEW";
}

function statusForStatement(check: MigrationStatementAuthorityCheck | null): StageStatus {
  if (!check) return "PENDING";
  if (check.stale) return "STALE";
  if (check.statementAuthorityMatch) return "PASS";
  if (check.blockedReasons.length) return "BLOCKED";
  return "REVIEW";
}

function statusForFee(check: MigrationFeeCheckAuthorityCheck | null): StageStatus {
  if (!check) return "PENDING";
  if (check.stale) return "STALE";
  if (check.feeCheckAuthorityMatch) return "PASS";
  if (check.blockedReasons.length) return "BLOCKED";
  return "REVIEW";
}

function statusForAging(check: MigrationAgingCheck | null): StageStatus {
  if (!check) return "PENDING";
  if (check.stale) return "STALE";
  if (check.agingCheckPass) return "PASS";
  if (check.blockedReasons.length) return "BLOCKED";
  return "REVIEW";
}

export default function UniversalMigrationFinancialSequence({
  reconciliation,
  statementCheck,
  feeCheck,
  agingCheck,
  onRunFinancialChecks,
  busy,
}: Props) {
  const stages: Array<{ title: string; status: StageStatus; note: string }> = [
    {
      title: "Financial Position",
      status: reconciliation ? "PASS" : "PENDING",
      note: "Source opening + eligible post-cutover movements",
    },
    {
      title: "Opening Balances",
      status: reconciliation ? "PASS" : "PENDING",
      note: "Posted as non-posting migration openings into the billing ledger",
    },
    {
      title: "Finance Check",
      status: statusForFinance(reconciliation),
      note: "SOURCE = EduClear ledger totals",
    },
    {
      title: "Statement Balance Check",
      status: statusForStatement(statementCheck),
      note: "SOURCE = FINANCE = STATEMENT authority",
    },
    {
      title: "Fee Check Balance Check",
      status: statusForFee(feeCheck),
      note: "SOURCE = FINANCE = STATEMENT = FEE CHECK",
    },
    {
      title: "Aging Check",
      status: statusForAging(agingCheck),
      note: "SOURCE_BUCKETS when reliable; otherwise BALANCE_ONLY",
    },
    {
      title: "Accept Migration",
      status:
        statusForFinance(reconciliation) === "PASS" &&
        statusForStatement(statementCheck) === "PASS" &&
        statusForFee(feeCheck) === "PASS"
          ? "PASS"
          : statusForFinance(reconciliation) === "STALE" ||
              statusForStatement(statementCheck) === "STALE" ||
              statusForFee(feeCheck) === "STALE"
            ? "STALE"
            : "BLOCKED",
      note: "Requires FEE_CHECK_AUTHORITY_MATCH (backend-enforced)",
    },
  ];

  return (
    <div className="uc-migration-financial-sequence">
      <p className="uc-migration-dry-run-hint" role="note">
        Guided finance sequence. Changing an upstream financial artifact makes downstream checks
        stale and blocks acceptance. Ambiguous snapshot supersession is never auto-approved.
      </p>
      <ol className="uc-migration-finance-totals">
        {stages.map((s) => (
          <li key={s.title}>
            <strong>{s.title}</strong> — {s.status}
            <div>{s.note}</div>
          </li>
        ))}
      </ol>
      {onRunFinancialChecks ? (
        <div className="uc-migration-apply-stage-row">
          <button
            type="button"
            className="uc-migration-upload-primary"
            disabled={busy || !reconciliation}
            onClick={onRunFinancialChecks}
          >
            {busy ? "Running…" : "Run Financial Checks"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
