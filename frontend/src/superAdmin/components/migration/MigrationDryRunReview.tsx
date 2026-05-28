import { useEffect, useMemo, useState } from "react";
import "./MigrationDryRunReview.css";

export type MigrationDryRunCountRow = {
  label: string;
  value: number | string;
};

export type MigrationDryRunValidationStatus = {
  canApply: boolean;
  errors?: number;
  warnings?: number;
  info?: number;
  canProceed?: boolean;
};

export type MigrationDryRunTransactionReadiness = {
  historicalOnlyTransactions: number;
  eligibleActiveTransactions: number;
  blockedTransactions: number;
  unmatchedTransactions: number;
};

type Props = {
  schoolId: string;
  schoolName: string;
  canApply: boolean;
  counts: MigrationDryRunCountRow[];
  transactionReadiness?: MigrationDryRunTransactionReadiness | null;
  cutoverDate?: string | null;
  warnings: string[];
  validation: MigrationDryRunValidationStatus;
  /** Shown when apply must be blocked (e.g. missing approval). */
  applyBlockedReason?: string | null;
  confirmPhrase?: string;
  applyLabel?: string;
  onApply: (confirmationText: string) => void | Promise<void>;
  busy?: boolean;
  requireTypedConfirmation?: boolean;
  /**
   * When true, Migration Readiness Checklist is complete (including final confirmation).
   * Satisfies typed-phrase gate so Apply is not blocked separately from the checklist.
   */
  checklistReadyForApply?: boolean;
  /** Phase 14 — shown before apply when transaction posting is enabled. */
  transactionPostingWarning?: string | null;
};

function formatCount(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString() : value;
}

export default function MigrationDryRunReview({
  schoolId,
  schoolName,
  canApply,
  counts,
  transactionReadiness,
  cutoverDate,
  warnings,
  validation,
  applyBlockedReason,
  confirmPhrase,
  applyLabel = "Apply import",
  onApply,
  busy = false,
  requireTypedConfirmation = true,
  checklistReadyForApply = false,
  transactionPostingWarning,
}: Props) {
  const [typedConfirm, setTypedConfirm] = useState("");

  const phrase = (confirmPhrase || schoolName || "APPLY").trim();
  const phraseOk =
    !requireTypedConfirmation ||
    checklistReadyForApply ||
    typedConfirm.trim().toLowerCase() === phrase.toLowerCase();

  const resolveConfirmationText = (): string => {
    const typed = typedConfirm.trim();
    if (typed) return typed;
    if (checklistReadyForApply) return phrase;
    return "";
  };

  useEffect(() => {
    setTypedConfirm("");
  }, [schoolId, phrase]);

  const applyDisabled = useMemo(() => {
    if (busy) return true;
    if (!canApply) return true;
    if (applyBlockedReason) return true;
    if (!schoolId) return true;
    if (!phraseOk) return true;
    return false;
  }, [busy, canApply, applyBlockedReason, schoolId, phraseOk]);

  const validationRows = [
    {
      label: "Can apply",
      value: validation.canApply ? "Yes — ready" : "No — blocked",
      tone: validation.canApply ? "ok" : "blocked",
    },
    ...(validation.errors != null
      ? [{ label: "Errors", value: String(validation.errors), tone: validation.errors > 0 ? "warn" : "ok" }]
      : []),
    ...(validation.warnings != null
      ? [
          {
            label: "Warnings",
            value: String(validation.warnings),
            tone: validation.warnings > 0 ? "warn" : "ok",
          },
        ]
      : []),
    ...(validation.canProceed != null
      ? [
          {
            label: "Can proceed",
            value: validation.canProceed ? "Yes" : "No",
            tone: validation.canProceed ? "ok" : "blocked",
          },
        ]
      : []),
  ] as Array<{ label: string; value: string; tone: string }>;

  return (
    <div className="sa-migration-dry-run-review">
      <section className="sa-migration-dry-run-review-block" aria-labelledby="dry-run-school-heading">
        <h3 id="dry-run-school-heading" className="sa-migration-dry-run-review-heading">
          Target school
        </h3>
        {schoolId ? (
          <dl className="sa-migration-dry-run-review-school">
            <div>
              <dt>School</dt>
              <dd>{schoolName || "—"}</dd>
            </div>
            <div>
              <dt>School ID</dt>
              <dd className="sa-migration-dry-run-review-mono">{schoolId}</dd>
            </div>
          </dl>
        ) : (
          <p className="sa-migration-dry-run-review-alert" role="alert">
            Select a target school before applying a dry run.
          </p>
        )}
      </section>

      <section className="sa-migration-dry-run-review-block" aria-labelledby="dry-run-counts-heading">
        <h3 id="dry-run-counts-heading" className="sa-migration-dry-run-review-heading">
          Staged counts
        </h3>
        <ul className="sa-migration-dry-run-review-counts">
          {counts.map((row) => (
            <li key={row.label}>
              <span className="sa-migration-dry-run-review-count-label">{row.label}</span>
              <span className="sa-migration-dry-run-review-count-value">{formatCount(row.value)}</span>
            </li>
          ))}
        </ul>
      </section>

      {transactionReadiness ? (
        <section
          className="sa-migration-dry-run-review-block"
          aria-labelledby="dry-run-transaction-readiness-heading"
        >
          <h3
            id="dry-run-transaction-readiness-heading"
            className="sa-migration-dry-run-review-heading"
          >
            Transaction readiness
          </h3>
          {cutoverDate ? (
            <p className="sa-migration-dry-run-review-muted">
              Cutover date: <strong>{cutoverDate}</strong> (transactions before this date are
              historical-only)
            </p>
          ) : null}
          <ul className="sa-migration-dry-run-review-counts">
            <li>
              <span className="sa-migration-dry-run-review-count-label">Historical only</span>
              <span className="sa-migration-dry-run-review-count-value">
                {formatCount(transactionReadiness.historicalOnlyTransactions)}
              </span>
            </li>
            <li>
              <span className="sa-migration-dry-run-review-count-label">Eligible active</span>
              <span className="sa-migration-dry-run-review-count-value">
                {formatCount(transactionReadiness.eligibleActiveTransactions)}
              </span>
            </li>
            <li>
              <span className="sa-migration-dry-run-review-count-label">Blocked</span>
              <span className="sa-migration-dry-run-review-count-value">
                {formatCount(transactionReadiness.blockedTransactions)}
              </span>
            </li>
            <li>
              <span className="sa-migration-dry-run-review-count-label">Unmatched</span>
              <span className="sa-migration-dry-run-review-count-value">
                {formatCount(transactionReadiness.unmatchedTransactions)}
              </span>
            </li>
          </ul>
          <p className="sa-migration-dry-run-review-alert" role="note">
            Historical learner transactions are preserved for history only and will not affect active
            head count or new billing.
          </p>
        </section>
      ) : null}

      <section className="sa-migration-dry-run-review-block" aria-labelledby="dry-run-validation-heading">
        <h3 id="dry-run-validation-heading" className="sa-migration-dry-run-review-heading">
          Validation status
        </h3>
        <ul className="sa-migration-dry-run-review-validation">
          {validationRows.map((row) => (
            <li
              key={row.label}
              className={`sa-migration-dry-run-review-validation-item sa-migration-dry-run-review-validation-item--${row.tone}`}
            >
              <span>{row.label}</span>
              <strong>{row.value}</strong>
            </li>
          ))}
        </ul>
        {!canApply ? (
          <p className="sa-migration-dry-run-review-alert" role="alert">
            Apply is blocked until all blocking validation errors are resolved.
          </p>
        ) : null}
      </section>

      <section className="sa-migration-dry-run-review-block" aria-labelledby="dry-run-warnings-heading">
        <h3 id="dry-run-warnings-heading" className="sa-migration-dry-run-review-heading">
          Warnings ({warnings.length})
        </h3>
        {warnings.length === 0 ? (
          <p className="sa-migration-dry-run-review-muted">No warnings recorded for this dry run.</p>
        ) : (
          <ul className="sa-migration-dry-run-review-warnings">
            {warnings.slice(0, 30).map((w) => (
              <li key={w}>{w}</li>
            ))}
            {warnings.length > 30 ? (
              <li className="sa-migration-dry-run-review-muted">
                …and {warnings.length - 30} more
              </li>
            ) : null}
          </ul>
        )}
      </section>

      {requireTypedConfirmation && schoolId ? (
        <section className="sa-migration-dry-run-review-block" aria-labelledby="dry-run-confirm-heading">
          <h3 id="dry-run-confirm-heading" className="sa-migration-dry-run-review-heading">
            Typed confirmation
          </h3>
          <p className="sa-migration-dry-run-review-muted">
            Type <strong>{phrase}</strong> exactly to confirm you are applying to this school.
          </p>
          <label className="sa-migration-dry-run-review-confirm-field">
            <span className="sa-migration-field-label">Confirmation</span>
            <input
              type="text"
              className="sa-migration-dry-run-review-input"
              value={typedConfirm}
              onChange={(e) => setTypedConfirm(e.target.value)}
              placeholder={phrase}
              disabled={busy || !canApply}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </section>
      ) : null}

      {applyBlockedReason ? (
        <p className="sa-migration-dry-run-review-alert" role="status">
          {applyBlockedReason}
        </p>
      ) : null}

      {transactionPostingWarning ? (
        <p className="sa-migration-dry-run-review-alert" role="note">
          {transactionPostingWarning}
        </p>
      ) : null}

      <div className="sa-migration-dry-run-review-actions">
        <button
          type="button"
          className="sa-migration-btn sa-migration-btn--gold"
          disabled={applyDisabled}
          onClick={() => void onApply(resolveConfirmationText())}
        >
          {busy ? "Working…" : applyLabel}
        </button>
      </div>
    </div>
  );
}
