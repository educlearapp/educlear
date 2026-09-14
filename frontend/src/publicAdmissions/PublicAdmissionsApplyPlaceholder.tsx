import { Link, useParams } from "react-router-dom";
import PublicAdmissionsLayout from "./PublicAdmissionsLayout";

/**
 * OA-06B placeholder for the draft application flow (OA-06C).
 * Does not create an application or persist tokens.
 */
export default function PublicAdmissionsApplyPlaceholder() {
  const { publicSlug = "" } = useParams<{ publicSlug: string }>();
  const slug = String(publicSlug || "").trim().toLowerCase();

  return (
    <PublicAdmissionsLayout config={null}>
      <section className="pa-card" aria-labelledby="pa-apply-heading" data-testid="pa-apply-placeholder">
        <h2 id="pa-apply-heading" className="pa-section-title">
          Start your application
        </h2>
        <p className="pa-body">
          The online application form will be available in the next step of this admissions
          experience. No application has been created yet.
        </p>
        {slug ? (
          <p className="pa-body">
            <Link to={`/admissions/${encodeURIComponent(slug)}`} className="pa-text-link">
              Back to admissions information
            </Link>
          </p>
        ) : null}
      </section>
    </PublicAdmissionsLayout>
  );
}
