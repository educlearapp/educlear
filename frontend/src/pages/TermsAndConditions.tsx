import { Link } from "react-router-dom";

import logoIcon from "../assets/logo.icon.png";
import { EDUCLEAR_LEGAL_CONTACT } from "../components/legal/legalContact";
import SiteFooter from "../components/legal/SiteFooter";
import "./TermsAndConditions.css";

const SECTIONS = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: [
      "By accessing or using the EduClear platform, registering a school account, or completing a subscription or payment through EduClear, you agree to be bound by these Terms and Conditions.",
      "If you do not agree to these terms, you must not use EduClear services. Where you act on behalf of a school or organisation, you confirm that you have authority to bind that entity to these terms.",
    ],
  },
  {
    id: "services",
    title: "2. EduClear Services",
    body: [
      "EduClear provides cloud-based school management software, including learner registrations, billing, statements, payments, payroll-related tools, parent communication features, reporting, and related administrative functions.",
      "Service features, limits, and availability may vary according to your selected package, account configuration, and applicable product updates published by EduClear.",
    ],
  },
  {
    id: "school-responsibilities",
    title: "3. School Responsibilities",
    body: [
      "Schools are responsible for the accuracy of data entered into EduClear, including learner, parent, guardian, and staff information.",
      "Schools must ensure that authorised users comply with applicable laws, school policies, and internal access controls. Schools remain responsible for decisions made using data exported or processed through the platform.",
    ],
  },
  {
    id: "subscription",
    title: "4. Subscription & Package Terms",
    body: [
      "EduClear subscription packages define usage limits such as learner counts, payroll staff limits, and enabled modules. Package details displayed at signup or checkout apply to your account unless otherwise agreed in writing.",
      "Upgrades, downgrades, or package changes may take effect according to EduClear billing rules and may require payment of applicable fees before activation.",
    ],
  },
  {
    id: "billing",
    title: "5. Billing & Payments",
    body: [
      "Subscription fees are billed according to the package and billing cycle selected during registration or renewal. Fees are quoted in South African Rand unless stated otherwise.",
      "Failure to pay applicable subscription fees may result in restricted access, suspension, or termination of services in accordance with these terms.",
    ],
  },
  {
    id: "sms-payfast",
    title: "6. SMS / Credits / PayFast Payments",
    body: [
      "Where SMS messaging or communication credits are purchased through EduClear, schools agree to use messaging features lawfully and only for legitimate school-related communication.",
      "Payments processed via PayFast or other supported payment gateways are subject to the payment provider's terms and processing timelines. EduClear is not responsible for delays, declines, or disputes arising solely from third-party payment networks.",
    ],
  },
  {
    id: "privacy",
    title: "7. Data & Privacy",
    body: [
      "EduClear processes personal information in accordance with applicable South African privacy legislation, including the Protection of Personal Information Act (POPIA), where applicable.",
      "Schools remain responsible for obtaining lawful grounds to collect and process learner, parent, and staff information uploaded to EduClear. Our Privacy Policy describes how EduClear handles platform data.",
    ],
  },
  {
    id: "accounts",
    title: "8. User Accounts & Security",
    body: [
      "Account credentials must be kept confidential. Schools must promptly notify EduClear of suspected unauthorised access or security incidents affecting their account.",
      "EduClear may implement reasonable security measures but does not guarantee that unauthorised access will never occur.",
    ],
  },
  {
    id: "availability",
    title: "9. Service Availability",
    body: [
      "EduClear aims to provide reliable platform availability but does not guarantee uninterrupted or error-free operation. Maintenance, upgrades, connectivity issues, or events beyond reasonable control may affect access.",
      "Scheduled maintenance will, where practicable, be communicated in advance through appropriate channels.",
    ],
  },
  {
    id: "liability",
    title: "10. Limitation of Liability",
    body: [
      "To the fullest extent permitted by law, EduClear and its affiliates shall not be liable for indirect, incidental, special, or consequential damages arising from use of the platform.",
      "EduClear's total liability for claims relating to the services shall not exceed the subscription fees paid by the school for the applicable billing period in which the claim arose, except where liability cannot be limited by law.",
    ],
  },
  {
    id: "termination",
    title: "11. Suspension / Termination",
    body: [
      "EduClear may suspend or terminate access where accounts breach these terms, pose security risks, or remain unpaid after reasonable notice.",
      "Schools may request account closure subject to settlement of outstanding fees and applicable data export or retention policies.",
    ],
  },
  {
    id: "ip",
    title: "12. Intellectual Property",
    body: [
      "EduClear software, branding, documentation, workflows, and related materials remain the intellectual property of EduClear and its licensors.",
      "Schools receive a limited, non-exclusive licence to use the platform for internal school operations for the duration of an active subscription.",
    ],
  },
  {
    id: "updates",
    title: "13. Updates to Terms",
    body: [
      "EduClear may update these Terms and Conditions from time to time. Material changes will be published on this page with an updated effective date.",
      "Continued use of EduClear after changes take effect constitutes acceptance of the revised terms.",
    ],
  },
  {
    id: "contact",
    title: "14. Contact Information",
    body: [
      "For questions regarding these Terms and Conditions, billing, platform support, or formal legal notices, contact EduClear Group using the details below.",
    ],
  },
] as const;

export default function TermsAndConditions() {
  return (
    <div className="terms-legal-page">
      <header className="terms-legal-sticky-header">
        <div className="terms-legal-sticky-inner">
          <Link to="/" className="terms-legal-brand" aria-label="EduClear home">
            <img src={logoIcon} alt="" />
            <span>EduClear</span>
          </Link>
          <h1 className="terms-legal-sticky-title">EduClear Terms &amp; Conditions</h1>
        </div>
      </header>

      <main className="terms-legal-main">
        <div className="terms-legal-intro">
          <p className="terms-legal-effective">Effective date: 1 June 2026</p>
          <p>
            These Terms and Conditions govern access to and use of the EduClear school
            management platform. Please read them carefully before registering, subscribing,
            or making payments through EduClear.
          </p>
          <nav className="terms-legal-toc" aria-label="Terms sections">
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
                <p key={paragraph.slice(0, 48)}>{paragraph}</p>
              ))}
              {section.id === "contact" ? (
                <div className="terms-contact-card" role="group" aria-label="EduClear contact details">
                  <p className="terms-contact-card-entity">{EDUCLEAR_LEGAL_CONTACT.entityName}</p>
                  <p className="terms-contact-card-line">
                    <span className="terms-contact-card-label">Phone:</span>{" "}
                    <a href={`tel:${EDUCLEAR_LEGAL_CONTACT.phoneTel}`}>
                      {EDUCLEAR_LEGAL_CONTACT.phoneDisplay}
                    </a>
                  </p>
                  <p className="terms-contact-card-line">
                    <span className="terms-contact-card-label">Email:</span>{" "}
                    <a href={`mailto:${EDUCLEAR_LEGAL_CONTACT.email}`}>
                      {EDUCLEAR_LEGAL_CONTACT.email}
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
