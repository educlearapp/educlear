type Props = {
  title: string;
  message: string;
  onClose: () => void;
};

export default function SasamsStubModal({ title, message, onClose }: Props) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="sasams-report-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="sasams-report-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sasams-report-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sasams-report-modal-accent" aria-hidden="true" />
        <h2 id="sasams-report-modal-title" className="sasams-report-modal-title">
          {title}
        </h2>
        <p className="sasams-report-modal-message">{message}</p>
        <div className="sasams-report-modal-actions">
          <button type="button" className="sasams-report-btn sasams-report-btn--gold" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}