import { Link } from "react-router-dom";

import logoIcon from "../assets/logo.icon.png";
import SiteFooter from "../components/legal/SiteFooter";
import "./PrivacyPolicy.css";

export default function PrivacyPolicy() {
  return (
    <div className="privacy-legal-page">
      <header className="privacy-legal-sticky-header">
        <div className="privacy-legal-sticky-inner">
          <Link to="/" className="privacy-legal-brand" aria-label="EduClear home">
            <img src={logoIcon} alt="" />
            <span>EduClear</span>
          </Link>
          <h1 className="privacy-legal-sticky-title">Privacy Policy</h1>
        </div>
      </header>

      <main className="privacy-legal-main">
        <div className="privacy-legal-card">
          <p className="privacy-legal-badge">Placeholder — full policy coming soon</p>
          <p>
            EduClear is preparing a complete Privacy Policy aligned with South African
            POPIA requirements. This page will describe how we collect, use, store, and
            protect personal information processed through the platform.
          </p>
          <p>
            For privacy-related enquiries in the meantime, contact{" "}
            <a href="mailto:info@educlear.co.za">info@educlear.co.za</a>.
          </p>
          <p>
            Please review our{" "}
            <Link to="/terms-and-conditions">Terms &amp; Conditions</Link> for platform
            use, billing, and service rules.
          </p>
        </div>
      </main>

      <SiteFooter variant="dark" />
    </div>
  );
}
