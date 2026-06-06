import "./SchoolCreditsPage.css";

const WINSMS_URLS = {
  registration: "https://www.winsms.co.za/registration",
  buyCredits: "https://www.winsms.co.za/bulksmspricing",
  apiIntegration: "https://www.winsms.co.za/development-tools",
} as const;

const BUNDLES = [
  { id: "foundation", name: "Foundation", credits: "250 SMS Credits", price: "R72.50 (Excl. VAT)" },
  { id: "growth", name: "Growth", credits: "500 SMS Credits", price: "R145.00 (Excl. VAT)" },
  { id: "professional", name: "Professional", credits: "1,000 SMS Credits", price: "R280.00 (Excl. VAT)" },
  { id: "elite", name: "Elite", credits: "2,500 SMS Credits", price: "R650.00 (Excl. VAT)", featured: true },
] as const;

type Bundle = (typeof BUNDLES)[number];

function openWinSms(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function WinSmsLinkButton({ href, label }: { href: string; label: string }) {
  return (
    <a
      className="sms-credits-action-btn sms-credits-action-btn--gold"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {label}
    </a>
  );
}

function BundleCard({ bundle }: { bundle: Bundle }) {
  const featured = "featured" in bundle && bundle.featured;

  return (
    <article className={`sms-credits-card${featured ? " sms-credits-card--elite" : ""}`}>
      <div className="sms-credits-card-accent" aria-hidden="true" />
      {featured ? <span className="sms-credits-card-badge">BEST VALUE</span> : null}
      <h3 className="sms-credits-card-title">{bundle.name}</h3>
      <p className="sms-credits-card-credits">{bundle.credits}</p>
      <p className="sms-credits-card-price">{bundle.price}</p>
      <button
        type="button"
        className="sms-credits-purchase-btn"
        onClick={() => openWinSms(WINSMS_URLS.buyCredits)}
      >
        Buy Credits on WinSMS
      </button>
    </article>
  );
}

export default function SchoolCreditsPage() {
  return (
    <div className="sms-credits-page">
      <header className="sms-credits-header">
        <h1 className="page-title">SMS Credit Bundles</h1>
        <p className="sms-credits-intro">
          Each school must create and register its own WinSMS account, purchase SMS credits directly from
          WinSMS, then connect that WinSMS account to EduClear under Communication Settings to start sending
          SMS messages to parents and staff.
        </p>
      </header>

      <div className="sms-credits-actions">
        <WinSmsLinkButton href={WINSMS_URLS.registration} label="Register WinSMS Account" />
        <WinSmsLinkButton href={WINSMS_URLS.buyCredits} label="Buy SMS Credits" />
        <WinSmsLinkButton
          href={WINSMS_URLS.apiIntegration}
          label="WinSMS API / Integration Details"
        />
      </div>

      <p className="sms-credits-notice" role="note">
        SMS credits are supplied by WinSMS. Prices shown are excluding VAT and may change without notice.
        Final pricing and payment are handled directly by WinSMS.
      </p>

      <div className="sms-credits-grid">
        {BUNDLES.map((bundle) => (
          <BundleCard key={bundle.id} bundle={bundle} />
        ))}
      </div>
    </div>
  );
}
