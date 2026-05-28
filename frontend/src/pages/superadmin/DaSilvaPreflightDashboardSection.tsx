import { useCallback, useEffect, useMemo, useState } from "react";
import { superAdminApiFetch } from "../../superAdmin/superAdminApi";
import type { SchoolOption } from "../../superAdmin/types/migration";
import {
  fetchUniversalMigrationPreflight,
  preflightStatusLabel,
  type MigrationPreflightBlocker,
  type MigrationPreflightStatus,
  type MigrationPreflightSummary,
} from "../../superAdmin/utils/universalMigrationPreflight";

const DA_SILVA_DEFAULT_SCHOOL_ID = "cmpideqeq0000108xb6ouv9zi";

const SECTION_LINKS: Array<{ label: string; hash: string; key: keyof MigrationPreflightSummary }> = [
  { label: "Runbook", hash: "#uc-migration-section-9", key: "runbookStatus" },
  { label: "Pilot validation", hash: "#uc-migration-section-8", key: "pilotStatus" },
  { label: "Validation", hash: "#uc-migration-section-4", key: "validationStatus" },
  { label: "Dry run", hash: "#uc-migration-section-5", key: "dryRunStatus" },
  { label: "Apply / batch", hash: "#uc-migration-section-6", key: "batchStatus" },
  { label: "Import audit", hash: "#uc-migration-section-7", key: "reconciliationStatus" },
  { label: "Sign-off", hash: "#uc-migration-section-7", key: "signoffStatus" },
];

function formatDate(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function formatStatusValue(value: string): string {
  if (!value || value === "missing") return "Missing";
  return value.replace(/_/g, " ");
}

function bannerClass(status: MigrationPreflightStatus): string {
  return `uc-migration-preflight-banner uc-migration-preflight-banner--${status}`;
}

function cardClass(statusValue: string): string {
  const normalized = statusValue.toLowerCase();
  if (normalized === "completed" || normalized === "passed" || normalized === "approved" || normalized === "pass" || normalized === "ready") {
    return "uc-migration-preflight-card uc-migration-preflight-card--ready";
  }
  if (
    normalized === "warning" ||
    normalized === "in_progress" ||
    normalized === "pending" ||
    normalized === "draft" ||
    normalized === "preview_only"
  ) {
    return "uc-migration-preflight-card uc-migration-preflight-card--warning";
  }
  if (
    normalized === "blocked" ||
    normalized === "failed" ||
    normalized === "fail" ||
    normalized === "missing" ||
    normalized === "not_eligible"
  ) {
    return "uc-migration-preflight-card uc-migration-preflight-card--blocked";
  }
  return "uc-migration-preflight-card uc-migration-preflight-card--unknown";
}

function blockerClass(severity: MigrationPreflightBlocker["severity"]): string {
  return `uc-migration-preflight-blocker uc-migration-preflight-blocker--${severity}`;
}

export default function DaSilvaPreflightDashboardSection() {
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [schoolId, setSchoolId] = useState(DA_SILVA_DEFAULT_SCHOOL_ID);
  const [dashboard, setDashboard] = useState<MigrationPreflightSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSchool = useMemo(
    () => schoolOptions.find((s) => s.id === schoolId) ?? null,
    [schoolOptions, schoolId]
  );

  const loadDashboard = useCallback(async () => {
    if (!schoolId) return;
    setBusy(true);
    setError(null);
    try {
      const data = await fetchUniversalMigrationPreflight(schoolId);
      setDashboard(data);
    } catch (e: unknown) {
      setDashboard(null);
      setError(e instanceof Error ? e.message : "Failed to load preflight dashboard");
    } finally {
      setBusy(false);
    }
  }, [schoolId]);

  useEffect(() => {
    void (async () => {
      try {
        const schools = (await superAdminApiFetch("/api/schools")) as Array<{
          id: string;
          name: string;
        }>;
        setSchoolOptions(schools.map((s) => ({ id: s.id, name: s.name })));
        if (schools.some((s) => s.id === DA_SILVA_DEFAULT_SCHOOL_ID)) {
          setSchoolId(DA_SILVA_DEFAULT_SCHOOL_ID);
        } else if (schools[0]) {
          setSchoolId(schools[0].id);
        }
      } catch {
        /* optional */
      }
    })();
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const overall = dashboard?.overallStatus ?? "unknown";

  return (
    <div className="uc-migration-preflight-panel">
      <p className="uc-migration-preflight-intro">
        Executive preflight view for Da Silva pilot readiness — aggregates runbook, pilot, validation, dry
        run, batch, reconciliation, and sign-off from real framework state. Read-only; no apply or
        reconciliation triggers.
      </p>

      <div className="uc-migration-preflight-toolbar">
        <label className="uc-migration-preflight-field">
          <span>School</span>
          <select
            value={schoolId}
            onChange={(e) => setSchoolId(e.target.value)}
            disabled={busy}
          >
            {schoolOptions.length === 0 ? (
              <option value={schoolId}>{selectedSchool?.name ?? schoolId}</option>
            ) : (
              schoolOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          className="uc-migration-preflight-btn"
          onClick={() => void loadDashboard()}
          disabled={busy || !schoolId}
        >
          {busy ? "Refreshing…" : "Refresh dashboard"}
        </button>
      </div>

      {error ? (
        <p className="uc-migration-preflight-error" role="alert">
          {error}
        </p>
      ) : null}

      {dashboard ? (
        <>
          <div className={bannerClass(overall)} role="status">
            <span className="uc-migration-preflight-banner-label">Pilot preflight</span>
            <strong className="uc-migration-preflight-banner-status">
              {preflightStatusLabel(overall)}
            </strong>
            <span className="uc-migration-preflight-banner-meta">
              {dashboard.schoolName} · {dashboard.sourceSystem}
            </span>
          </div>

          <div className="uc-migration-preflight-cards">
            {SECTION_LINKS.map((item) => (
              <a
                key={item.label}
                href={item.hash}
                className={cardClass(String(dashboard[item.key]))}
              >
                <span className="uc-migration-preflight-card-title">{item.label}</span>
                <span className="uc-migration-preflight-card-value">
                  {formatStatusValue(String(dashboard[item.key]))}
                </span>
              </a>
            ))}
          </div>

          <div className="uc-migration-preflight-golive">
            <h4>Go-live</h4>
            <p className="uc-migration-preflight-golive-answer">
              <span className="uc-migration-preflight-golive-label">GO LIVE:</span>{" "}
              <strong
                className={
                  dashboard.goLiveReady
                    ? "uc-migration-preflight-golive-yes"
                    : "uc-migration-preflight-golive-no"
                }
              >
                {dashboard.goLiveReady ? "YES" : "NO"}
              </strong>
            </p>
            <p className="uc-migration-preflight-muted">
              Generated {formatDate(dashboard.generatedAt)}
            </p>
            {(dashboard.runbookId ||
              dashboard.pilotId ||
              dashboard.batchId ||
              dashboard.signoffId) && (
              <p className="uc-migration-preflight-refs">
                {dashboard.runbookId ? `Runbook ${dashboard.runbookId}` : null}
                {dashboard.pilotId ? ` · Pilot ${dashboard.pilotId}` : null}
                {dashboard.batchId ? ` · Batch ${dashboard.batchId}` : null}
                {dashboard.signoffId ? ` · Sign-off ${dashboard.signoffId}` : null}
              </p>
            )}
          </div>

          <div className="uc-migration-preflight-blockers-panel">
            <h4>Blockers &amp; advisories</h4>
            {dashboard.blockers.length === 0 ? (
              <p className="uc-migration-preflight-muted">No blockers recorded.</p>
            ) : (
              <ul className="uc-migration-preflight-blockers-list">
                {dashboard.blockers.map((b) => (
                  <li key={b.blockerId} className={blockerClass(b.severity)}>
                    <span className="uc-migration-preflight-blocker-severity">{b.severity}</span>
                    <strong>{b.title}</strong>
                    <span>{b.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <nav className="uc-migration-preflight-nav" aria-label="Jump to migration sections">
            <span>Jump to section:</span>
            <a href="#uc-migration-section-8">Pilot validation</a>
            <a href="#uc-migration-section-9">Runbook</a>
            <a href="#uc-migration-section-6">Apply</a>
            <a href="#uc-migration-section-7">Import audit</a>
          </nav>
        </>
      ) : busy ? (
        <p className="uc-migration-preflight-muted">Loading preflight dashboard…</p>
      ) : null}
    </div>
  );
}
