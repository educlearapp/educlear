export type StubNotice = {
  title: string;
  message: string;
};

type Props = {
  notice: StubNotice;
  onClose: () => void;
};

export default function MigrationStubModal({ notice, onClose }: Props) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="sa-migration-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="sa-migration-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sa-migration-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sa-migration-modal-accent" aria-hidden="true" />
        <h2 id="sa-migration-modal-title" className="sa-migration-modal-title">
          {notice.title}
        </h2>
        <p className="sa-migration-modal-message">{notice.message}</p>
        <div className="sa-migration-modal-actions">
          <button type="button" className="sa-migration-btn sa-migration-btn--gold" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
