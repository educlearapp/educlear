type Props = {
  title: string;
  message: string;
  onClose: () => void;
};

export default function DepositsStubModal({ title, message, onClose }: Props) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="billing-deposits-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="billing-deposits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="billing-deposits-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="billing-deposits-modal-accent" aria-hidden="true" />
        <h2 id="billing-deposits-modal-title" className="billing-deposits-modal-title">
          {title}
        </h2>
        <p className="billing-deposits-modal-message">{message}</p>
        <div className="billing-deposits-modal-actions">
          <button type="button" className="billing-deposits-btn billing-deposits-btn--gold" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
