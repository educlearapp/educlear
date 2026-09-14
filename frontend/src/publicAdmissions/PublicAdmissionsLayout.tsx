import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { absolutizeSchoolLogoUrl } from "../utils/schoolLogo";
import type { PublicAdmissionsConfig } from "./publicAdmissionsTypes";
import "./publicAdmissions.css";

type Props = {
  config: PublicAdmissionsConfig | null;
  children: ReactNode;
};

/**
 * Clean public admissions shell — no SchoolDashboard / staff chrome.
 */
export default function PublicAdmissionsLayout({ config, children }: Props) {
  const schoolName = config?.schoolDisplayName?.trim() || "Online Admissions";
  const logoUrl = config?.branding?.logoUrl
    ? absolutizeSchoolLogoUrl(config.branding.logoUrl)
    : "";
  const accent = String(config?.branding?.primaryColor || "").trim();
  const style = accent
    ? ({ ["--pa-accent" as string]: accent } as CSSProperties)
    : undefined;

  return (
    <div className="pa-shell" style={style} data-testid="public-admissions-shell">
      <header className="pa-header">
        <div className="pa-header-inner">
          {logoUrl ? (
            <img
              className="pa-logo"
              src={logoUrl}
              alt={`${schoolName} logo`}
              width={48}
              height={48}
            />
          ) : (
            <div className="pa-logo-fallback" aria-hidden="true">
              {schoolName.slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="pa-header-text">
            <p className="pa-eyebrow">Online Admissions</p>
            <h1 className="pa-school-name">{schoolName}</h1>
          </div>
        </div>
      </header>

      <main className="pa-main" id="public-admissions-main">
        {children}
      </main>

      <footer className="pa-footer">
        <p>
          Powered by{" "}
          <Link to="/" className="pa-footer-link">
            EduClear
          </Link>
        </p>
      </footer>
    </div>
  );
}
