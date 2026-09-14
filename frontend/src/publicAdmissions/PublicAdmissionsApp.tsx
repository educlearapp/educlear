import { useEffect, useState } from "react";
import { Route, Routes, useParams } from "react-router-dom";
import {
  fetchPublicAdmissionsConfig,
  PublicAdmissionsApiError,
} from "./publicAdmissionsApi";
import { derivePublicAdmissionsShellState } from "./derivePublicAdmissionsShellState";
import PublicAdmissionsApplyPage from "./PublicAdmissionsApplyPage";
import PublicAdmissionsLandingPage from "./PublicAdmissionsLandingPage";
import PublicAdmissionsLayout from "./PublicAdmissionsLayout";
import type {
  PublicAdmissionsConfig,
  PublicAdmissionsShellState,
} from "./publicAdmissionsTypes";
import "./publicAdmissions.css";

function PublicAdmissionsLandingRoute() {
  const { publicSlug = "" } = useParams<{ publicSlug: string }>();
  const slug = String(publicSlug || "").trim().toLowerCase();

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<PublicAdmissionsConfig | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setConfig(null);
    setNotFound(false);
    setError(false);

    if (!slug) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    void (async () => {
      try {
        const next = await fetchPublicAdmissionsConfig(slug);
        if (cancelled) return;
        setConfig(next);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof PublicAdmissionsApiError && err.status === 404) {
          setNotFound(true);
        } else {
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const state: PublicAdmissionsShellState = derivePublicAdmissionsShellState({
    loading,
    notFound,
    error,
    config,
  });

  return (
    <PublicAdmissionsLayout config={config}>
      <PublicAdmissionsLandingPage publicSlug={slug} state={state} config={config} />
    </PublicAdmissionsLayout>
  );
}

/**
 * Public EduClear Online Admissions SPA entry (OA-06B / OA-06C).
 * Mounted at /admissions/* — no staff JWT, no SchoolDashboard shell.
 */
export default function PublicAdmissionsApp() {
  return (
    <Routes>
      <Route path=":publicSlug" element={<PublicAdmissionsLandingRoute />} />
      <Route path=":publicSlug/apply" element={<PublicAdmissionsApplyPage />} />
      <Route
        path="*"
        element={
          <PublicAdmissionsLayout config={null}>
            <PublicAdmissionsLandingPage
              publicSlug=""
              state="NOT_FOUND"
              config={null}
            />
          </PublicAdmissionsLayout>
        }
      />
    </Routes>
  );
}
