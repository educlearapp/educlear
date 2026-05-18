type Props = {
  onClose: () => void;
};

export default function SettingsSavedModal({ onClose }: Props) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="school-settings-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="school-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="school-settings-saved-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="school-settings-modal-accent" aria-hidden="true" />
        <h2 id="school-settings-saved-title" className="school-settings-modal-title">
          Settings saved successfully
        </h2>
        <p className="school-settings-modal-message">
          Your school settings have been saved for this institution. Backend sync will be available in a future
          release.
        </p>
        <div className="school-settings-modal-actions">
          <button type="button" className="school-settings-btn school-settings-btn--gold" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
