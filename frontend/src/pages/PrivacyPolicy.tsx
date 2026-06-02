import { Link } from "react-router-dom";

import logoIcon from "../assets/logo.icon.png";
import SiteFooter from "../components/legal/SiteFooter";
import "./TermsAndConditions.css";

const SECTIONS = [
  {
    id: "introduction",
    title: "1. Introduction",
    body: [
      "EduClear respects and protects personal information and processes data in accordance with South African POPIA requirements.",
      "This Privacy Policy explains how EduClear collects, stores, uses and protects information processed through the EduClear platform.",
    ],
  },
  {
    id: "information-we-collect",
    title: "2. Information We Collect",
    body: [
      "EduClear may collect:",
      "School information",
      "Owner and staff information",
      "Parent and guardian information",
      "Learner information",
      "Contact information",
      "Billing and payment records",
      "SMS and communication records",
      "Login and usage activity",
      "Only information necessary to operate EduClear services is collected.",
    ],
  },
  {
    id: "school-parent-learner-data",
    title: "3. School, Parent & Learner Data",
    body: [
      "Schools remain responsible for ensuring data uploaded to EduClear is lawful and accurate.",
      "EduClear acts as a secure platform provider and processes information supplied by schools.",
      "Schools are responsible for obtaining appropriate parental or guardian consent where required.",
    ],
  },
  {
    id: "how-educlear-uses-information",
    title: "4. How EduClear Uses Information",
    body: [
      "EduClear uses information to:",
      "Manage school administration",
      "Process billing and payments",
      "Generate statements and invoices",
      "Support attendance and learner records",
      "Enable teacher and parent communication",
      "Deliver SMS and platform notifications",
      "Provide support and maintain platform functionality",
      "EduClear does not sell personal information.",
    ],
  },
  {
    id: "data-storage-security",
    title: "5. Data Storage & Security",
    body: [
      "EduClear uses secure cloud infrastructure and access controls to protect information.",
      "Security measures may include:",
      "Password protection",
      "User permissions",
      "Encrypted connections",
      "Backup systems",
      "Activity logging",
      "Role-based access",
      "While reasonable security measures are used, no online platform can guarantee absolute security.",
    ],
  },
  {
    id: "user-access-permissions",
    title: "6. User Access & Permissions",
    body: [
      "Access to information is controlled through school-created user accounts and role-based permissions.",
      "School administrators are responsible for:",
      "Managing user access",
      "Protecting passwords",
      "Removing former staff access",
      "Maintaining secure use of the platform",
    ],
  },
  {
    id: "popia-compliance",
    title: "7. POPIA Compliance",
    body: [
      "EduClear is committed to complying with South African POPIA principles including:",
      "Accountability",
      "Purpose limitation",
      "Information quality",
      "Openness",
      "Security safeguards",
      "Responsible processing",
      "Users may request information updates or corrections where applicable.",
    ],
  },
  {
    id: "third-party-services",
    title: "8. Third-Party Services",
    body: [
      "EduClear may integrate with approved third-party services including:",
      "Payfast payment services",
      "SMS providers",
      "Hosting and infrastructure providers",
      "Email delivery services",
      "These providers may process limited information required to perform their services.",
    ],
  },
  {
    id: "cookies-analytics",
    title: "9. Cookies & Platform Analytics",
    body: [
      "EduClear may use cookies or technical tools necessary to:",
      "Maintain sessions",
      "Improve platform performance",
      "Monitor system stability",
      "Enhance user experience",
      "No advertising tracking or resale of user data occurs.",
    ],
  },
  {
    id: "data-retention-deletion",
    title: "10. Data Retention & Deletion",
    body: [
      "EduClear retains information only as reasonably required for:",
      "School operations",
      "Billing history",
      "Legal compliance",
      "Security and audit purposes",
      "Schools may request deletion or export of data subject to legal and operational requirements.",
    ],
  },
  {
    id: "subscription-non-payment-rule",
    title: "11. Subscription & Non-Payment Rule",
    body: [
      "EduClear subscriptions include a 7-day grace period for unpaid subscription fees.",
      "If payment remains outstanding after the grace period, EduClear may suspend platform access until the account is brought up to date.",
      "Suspension may limit access to platform features and services.",
    ],
  },
  {
    id: "updates-to-policy",
    title: "12. Updates to Policy",
    body: [
      "EduClear may update this Privacy Policy from time to time.",
      "Updated versions become effective once published on the platform.",
      "Continued use of EduClear constitutes acceptance of revised policies.",
    ],
  },
  {
    id: "contact",
    title: "13. Contact Information",
    body: ["For privacy enquiries or requests regarding this Privacy Policy, contact EduClear using the details below."],
  },
] as const;

export default function PrivacyPolicy() {
  return (
    <div className="terms-legal-page">
      <header className="terms-legal-sticky-header">
        <div className="terms-legal-sticky-inner">
          <Link to="/" className="terms-legal-brand" aria-label="EduClear home">
            <img src={logoIcon} alt="" />
            <span>EduClear</span>
          </Link>
          <h1 className="terms-legal-sticky-title">EduClear Privacy Policy</h1>
        </div>
      </header>

      <main className="terms-legal-main">
        <div className="terms-legal-intro">
          <p className="terms-legal-effective">POPIA COMPLIANT – EFFECTIVE 1 JUNE 2026</p>
          <p>
            This Privacy Policy applies to information processed through the EduClear platform.
            Please also review our{" "}
            <Link to="/terms-and-conditions">Terms &amp; Conditions</Link> and{" "}
            <Link to="/refund-and-cancellation-policy">Refund &amp; Cancellation Policy</Link>.
          </p>
          <nav className="terms-legal-toc" aria-label="Privacy policy sections">
            <ul>
              {SECTIONS.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>{section.title}</a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="terms-legal-sections">
          {SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className="terms-legal-card"
              aria-labelledby={`${section.id}-heading`}
            >
              <h2 id={`${section.id}-heading`}>{section.title}</h2>
              {section.body.map((paragraph) => (
                <p key={`${section.id}-${paragraph.slice(0, 48)}`}>{paragraph}</p>
              ))}
              {section.id === "contact" ? (
                <div className="terms-contact-card" role="group" aria-label="EduClear contact details">
                  <p className="terms-contact-card-entity">EduClear</p>
                  <p className="terms-contact-card-line">
                    <span className="terms-contact-card-label">Email:</span>{" "}
                    <a href="mailto:info@educlear.co.za">info@educlear.co.za</a>
                  </p>
                  <p className="terms-contact-card-line">
                    <span className="terms-contact-card-label">Website:</span>{" "}
                    <a href="https://educlear.co.za" target="_blank" rel="noreferrer">
                      educlear.co.za
                    </a>
                  </p>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      </main>

      <SiteFooter variant="dark" />
    </div>
  );
}
