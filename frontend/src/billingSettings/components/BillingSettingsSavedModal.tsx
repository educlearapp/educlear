type Props = {
  onClose: () => void;
};

export default function BillingSettingsSavedModal({ onClose }: Props) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="billing-settings-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="billing-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-settings-saved-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-settings-modal-accent" aria-hidden="true" />
        <h2 id="billing-settings-saved-title" className="billing-settings-modal-title">
          Billing settings saved successfully.
        </h2>
        <p className="billing-settings-modal-message">
          Your billing settings have been saved for this school. Backend sync will be available in a future release.
        </p>
        <div className="billing-settings-modal-actions">
          <button type="button" className="billing-settings-btn billing-settings-btn--gold" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
