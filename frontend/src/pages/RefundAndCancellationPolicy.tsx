import { Link } from "react-router-dom";

import logoIcon from "../assets/logo.icon.png";
import { EDUCLEAR_LEGAL_CONTACT } from "../components/legal/legalContact";
import SiteFooter from "../components/legal/SiteFooter";
import "./TermsAndConditions.css";

const SECTIONS = [
  {
    id: "introduction",
    title: "1. Introduction",
    body: [
      "This Refund and Cancellation Policy explains how cancellations, refunds, and billing disputes are handled for EduClear subscriptions, packages, SMS credits, and other digital services purchased through the EduClear platform.",
      "By subscribing to EduClear or completing a payment via PayFast or other supported gateways, you agree to this policy together with our Terms and Conditions.",
    ],
  },
  {
    id: "subscriptions",
    title: "2. EduClear Subscriptions",
    body: [
      "EduClear provides recurring and term-based subscriptions for access to the school management platform. Subscription fees grant access to platform features for the billing period selected at checkout or renewal.",
      "Subscription access continues for the paid period unless cancelled in accordance with this policy or suspended for non-payment, breach of terms, or security reasons as described in our Terms and Conditions.",
    ],
  },
  {
    id: "packages",
    title: "3. Starter & Unlimited Packages",
    body: [
      "Starter and Unlimited packages define usage limits such as learner counts, payroll staff limits, and enabled modules. Package fees are charged according to the plan and billing cycle displayed at registration, upgrade, or renewal.",
      "Moving between Starter and Unlimited, or changing billing cycles, may require payment of applicable fees before the new package takes effect. Downgrades may be subject to prorated credits or adjusted renewal dates at EduClear's discretion, as communicated at the time of change.",
    ],
  },
  {
    id: "sms-credits",
    title: "4. SMS, Credits & Digital Services",
    body: [
      "SMS messaging credits, communication bundles, and other prepaid digital add-ons are sold for lawful school-related use only. Credits are allocated to your school account once payment is confirmed.",
      "Digital services that have been delivered, consumed, or allocated to your account cannot be reversed except where required by law or where EduClear determines a processing error occurred.",
    ],
  },
  {
    id: "payfast",
    title: "5. PayFast Payments",
    body: [
      "Payments processed through PayFast are subject to PayFast's own terms, security checks, and settlement timelines. EduClear receives confirmation when a payment is successful; failed, pending, or reversed transactions are handled according to PayFast and your bank's rules.",
      "EduClear is not responsible for delays, declines, chargebacks, or disputes that arise solely from PayFast, card issuers, or banking networks. Refunds initiated by EduClear for eligible amounts are returned via the original payment method where practicable, or by alternative means agreed with the school.",
    ],
  },
  {
    id: "cancellation",
    title: "6. Cancellation Process",
    body: [
      "Schools may request cancellation of a subscription by contacting EduClear support before the next renewal date. Cancellation stops future billing for recurring subscriptions but does not automatically entitle you to a refund for the current paid period unless stated below.",
      "To cancel, email info@educlear.co.za from your registered school contact address with your school name, account email, and requested cancellation date. EduClear will confirm receipt and the effective end date of access.",
      "Where a subscription is cancelled mid-period, access may continue until the end of the already-paid billing period unless otherwise agreed in writing. Outstanding fees remain payable until settled.",
    ],
  },
  {
    id: "refunds",
    title: "7. Refund Conditions",
    body: [
      "Refunds may be considered where EduClear has charged in error, duplicated a payment, or failed to activate a paid service through no fault of the school. Refund requests must be submitted within 14 days of the transaction date with proof of payment and a clear description of the issue.",
      "Subscription refunds for change-of-mind or unused portions of a billing period are generally not provided once the billing period has commenced and platform access has been granted, except where required by applicable South African consumer law.",
      "Approved refunds are processed within a reasonable period, typically within 10 business days of approval, subject to PayFast and banking processing times.",
    ],
  },
  {
    id: "non-refundable",
    title: "8. Non-Refundable Used Credits & Services",
    body: [
      "SMS credits, messaging bundles, and other digital units that have been sent, consumed, or partially used are non-refundable.",
      "Services already rendered, including platform access for elapsed subscription days, data exports completed at your request, and one-off setup or onboarding work expressly agreed as non-refundable, are not eligible for refund.",
      "Promotional credits, trial extensions, and complimentary allocations provided by EduClear carry no cash value and cannot be exchanged for refunds.",
    ],
  },
  {
    id: "disputes",
    title: "9. Billing Disputes",
    body: [
      "If you believe a charge is incorrect, contact EduClear promptly with transaction references, dates, and amounts. We will investigate and respond within a reasonable timeframe.",
      "While a dispute is under review, EduClear may suspend further charges or adjust your account where appropriate. Unresolved disputes may be escalated in accordance with applicable law; schools should not initiate chargebacks without first contacting EduClear, as this may delay resolution.",
    ],
  },
  {
    id: "updates",
    title: "10. Updates to This Policy",
    body: [
      "EduClear may update this Refund and Cancellation Policy from time to time. Material changes will be published on this page with an updated effective date.",
      "Continued use of paid EduClear services after changes take effect constitutes acceptance of the revised policy for future transactions.",
    ],
  },
  {
    id: "contact",
    title: "11. Contact Information",
    body: [
      "For cancellation requests, refund enquiries, billing disputes, or questions about this policy, contact EduClear Group using the details below.",
    ],
  },
] as const;

export default function RefundAndCancellationPolicy() {
  return (
    <div className="terms-legal-page">
      <header className="terms-legal-sticky-header">
        <div className="terms-legal-sticky-inner">
          <Link to="/" className="terms-legal-brand" aria-label="EduClear home">
            <img src={logoIcon} alt="" />
            <span>EduClear</span>
          </Link>
          <h1 className="terms-legal-sticky-title">Refund &amp; Cancellation Policy</h1>
        </div>
      </header>

      <main className="terms-legal-main">
        <div className="terms-legal-intro">
          <p className="terms-legal-effective">Effective date: 1 June 2026</p>
          <p>
            This policy applies to EduClear subscriptions, Starter and Unlimited packages, SMS
            and communication credits, and payments made through PayFast or other supported
            gateways. Please read it together with our{" "}
            <Link to="/terms-and-conditions">Terms &amp; Conditions</Link>.
          </p>
          <nav className="terms-legal-toc" aria-label="Refund and cancellation sections">
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
