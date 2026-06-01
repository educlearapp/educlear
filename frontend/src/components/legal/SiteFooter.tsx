import { Link } from "react-router-dom";

import { EDUCLEAR_LEGAL_CONTACT } from "./legalContact";
import "./SiteFooter.css";

type SiteFooterProps = {
  variant?: "dark" | "light";
};

export default function SiteFooter({ variant = "dark" }: SiteFooterProps) {
  const { email, phoneDisplay, phoneTel } = EDUCLEAR_LEGAL_CONTACT;

  return (
    <footer className={`site-footer site-footer--${variant}`}>
      <nav className="site-footer-links" aria-label="Legal and support">
        <Link to="/terms-and-conditions">Terms &amp; Conditions</Link>
        <Link to="/privacy-policy">Privacy Policy</Link>
        <a href={`mailto:${email}`}>Contact</a>
        <a href={`mailto:${email}?subject=EduClear%20Support`}>Support</a>
      </nav>
      <div className="site-footer-legal-contact" aria-label="Legal contact">
        <a className="site-footer-legal-contact-phone" href={`tel:${phoneTel}`}>
          {phoneDisplay}
        </a>
        <span className="site-footer-legal-contact-sep" aria-hidden="true">
          ·
        </span>
        <a className="site-footer-legal-contact-email" href={`mailto:${email}`}>
          {email}
        </a>
      </div>
      <p className="site-footer-copy">&copy; {new Date().getFullYear()} EduClear. All rights reserved.</p>
    </footer>
  );
}
