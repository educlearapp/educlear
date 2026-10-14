import { useEffect, useRef, useState } from "react";
import { PAYMENT_PENDING_ACCEPTANCE_WARNING } from "./admissionsDocumentActions";

type Props = {
  applicationNumber: string | null;
  feeLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export default function AcceptPaymentPendingModal({ applicationNumber, feeLabel, busy, onCancel, onConfirm }: Props) {
  const [understood, setUnderstood] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  const titleId = "accept-payment-pending-title";
  return (
    <div
      className="admissions-staff-modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        className="admissions-staff-modal admissions-staff-modal--compact"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby="accept-payment-pending-warning"
        data-testid="accept-payment-pending-modal"
      >
        <div className="admissions-staff-modal-accent" aria-hidden="true" />
        <h2 id={titleId} className="admissions-staff-modal-title">
          Accept application{applicationNumber ? ` ${applicationNumber}` : ""}?
        </h2>
        <div
          id="accept-payment-pending-warning"
          className="admissions-staff-alert admissions-staff-alert--warning admissions-staff-pending-warning"
        >
          {PAYMENT_PENDING_ACCEPTANCE_WARNING}
        </div>
        <dl className="admissions-staff-pending-facts">
          <div>
            <dt>Admission fee</dt>
            <dd>{feeLabel}</dd>
          </div>
          <div>
            <dt>Payment status after acceptance</dt>
            <dd>Proof uploaded — verification still pending</dd>
          </div>
        </dl>
        <label className="admissions-staff-pending-confirm">
          <input
            type="checkbox"
            checked={understood}
            disabled={busy}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          <span>I understand that accepting does not confirm payment, issue a receipt or enrol the learner.</span>
        </label>
        <div className="admissions-staff-modal-actions">
          <button
            ref={cancelRef}
            type="button"
            className="admissions-staff-btn admissions-staff-btn--outline"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admissions-staff-btn admissions-staff-btn--gold"
            disabled={busy || !understood}
            onClick={onConfirm}
          >
            {busy ? "Accepting…" : "Accept with payment pending"}
          </button>
        </div>
      </div>
    </div>
  );
}
