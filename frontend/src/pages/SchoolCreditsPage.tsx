import { useCallback, useState } from "react";
import "./SchoolCreditsPage.css";

const BUNDLES = [
  { id: "foundation", name: "Foundation", credits: "250 SMS Credits", price: "R75 once-off" },
  { id: "growth", name: "Growth", credits: "500 SMS Credits", price: "R150 once-off" },
  { id: "professional", name: "Professional", credits: "1000 SMS Credits", price: "R300 once-off" },
  { id: "elite", name: "Elite", credits: "2500 SMS Credits", price: "R750 once-off", featured: true },
] as const;

type Bundle = (typeof BUNDLES)[number];

function PurchaseModal({ bundle, onClose }: { bundle: Bundle; onClose: () => void }) {
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="sms-credits-modal-overlay" role="presentation" onClick={handleBackdropClick}>
      <div
        className="sms-credits-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sms-credits-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sms-credits-modal-accent" aria-hidden="true" />
        <h2 id="sms-credits-modal-title" className="sms-credits-modal-title">
          Confirm Purchase
        </h2>
        <dl className="sms-credits-modal-details">
          <div className="sms-credits-modal-row">
            <dt>Bundle</dt>
            <dd>{bundle.name}</dd>
          </div>
          <div className="sms-credits-modal-row">
            <dt>SMS Credits</dt>
            <dd>{bundle.credits}</dd>
          </div>
          <div className="sms-credits-modal-row">
            <dt>Price</dt>
            <dd>{bundle.price}</dd>
          </div>
        </dl>
        <p className="sms-credits-modal-notice">Payment integration coming soon.</p>
        <div className="sms-credits-modal-actions">
          <button type="button" className="sms-credits-modal-btn sms-credits-modal-btn--outline" onClick={onClose}>
            Close
          </button>
          <button type="button" className="sms-credits-modal-btn sms-credits-modal-btn--gold" onClick={onClose}>
            Continue Later
          </button>
        </div>
      </div>
    </div>
  );
}

function BundleCard({ bundle, onPurchase }: { bundle: Bundle; onPurchase: (bundle: Bundle) => void }) {
  const featured = "featured" in bundle && bundle.featured;

  return (
    <article className={`sms-credits-card${featured ? " sms-credits-card--elite" : ""}`}>
      <div className="sms-credits-card-accent" aria-hidden="true" />
      {featured ? <span className="sms-credits-card-badge">BEST VALUE</span> : null}
      <h3 className="sms-credits-card-title">{bundle.name}</h3>
      <p className="sms-credits-card-credits">{bundle.credits}</p>
      <p className="sms-credits-card-price">{bundle.price}</p>
      <button type="button" className="sms-credits-purchase-btn" onClick={() => onPurchase(bundle)}>
        Purchase
      </button>
    </article>
  );
}

export default function SchoolCreditsPage() {
  const [selectedBundle, setSelectedBundle] = useState<Bundle | null>(null);

  const closeModal = useCallback(() => setSelectedBundle(null), []);

  return (
    <div className="sms-credits-page">
      <h1 className="page-title">SMS Credit Bundles</h1>
      <div className="sms-credits-grid">
        {BUNDLES.map((bundle) => (
          <BundleCard key={bundle.id} bundle={bundle} onPurchase={setSelectedBundle} />
        ))}
      </div>
      {selectedBundle ? <PurchaseModal bundle={selectedBundle} onClose={closeModal} /> : null}
    </div>
  );
}
