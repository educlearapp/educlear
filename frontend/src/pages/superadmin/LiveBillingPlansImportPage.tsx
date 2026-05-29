import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import MigrationSchoolSelect from "../../superAdmin/components/migration/MigrationSchoolSelect";
import MigrationStubModal, { type StubNotice } from "../../superAdmin/components/migration/MigrationStubModal";
import type { SchoolOption } from "../../superAdmin/types/migration";
import type { LiveBillingPlansPreview } from "../../superAdmin/types/liveBillingPlansImport";
import {
  applyLiveBillingPlansImport,
  formatMoney,
  previewLiveBillingPlansUpload,
} from "../../superAdmin/utils/liveBillingPlansImport";
import {
  fetchMigrationTargetSchools,
  type MigrationTargetSchoolsDebug,
} from "../../superAdmin/utils/migrationTargetSchools";
import "../SuperAdminMigrationPage.css";

const ACCEPT = ".xls,.xlsx";

export default function LiveBillingPlansImportPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [schoolOptionsDebug, setSchoolOptionsDebug] = useState<MigrationTargetSchoolsDebug | null>(
    null
  );
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<LiveBillingPlansPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [notice, setNotice] = useState<StubNotice | null>(null);
  const [applied, setApplied] = useState(false);

  useEffect(() => {
    void (async () => {
      const { schools, debug } = await fetchMigrationTargetSchools();
      setSchoolOptions(schools);
      setSchoolOptionsDebug(debug);
    })();
  }, []);

  const selectedSchoolName =
    schoolOptions.find((s) => s.id === selectedSchoolId)?.name || preview?.schoolName || "";

  const runPreview = useCallback(async () => {
    if (!selectedSchoolId || !file) return;
    setBusy(true);
    setUploadProgress(0);
    setApplied(false);
    try {
      const result = await previewLiveBillingPlansUpload({
        schoolId: selectedSchoolId,
        file,
        onProgress: (p) => setUploadProgress(p),
      });
      setPreview(result);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Preview failed";
      setNotice({ title: "Preview failed", message: msg });
      setPreview(null);
    } finally {
      setBusy(false);
      setUploadProgress(null);
    }
  }, [selectedSchoolId, file]);

  const runApply = useCallback(async () => {
    if (!preview?.sessionId || !selectedSchoolId) return;
    setBusy(true);
    try {
      const result = await applyLiveBillingPlansImport({
        schoolId: selectedSchoolId,
        sessionId: preview.sessionId,
      });
      setApplied(true);
      setNotice({
        title: "Billing plans saved",
        message: `Wrote ${result.learnersUpdated} learner billing plan(s) for ${selectedSchoolName}.`,
        details:
          "Statements, payments, invoices, and balances were not modified — only learner billing plans in the billing plan store.",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Apply failed";
      setNotice({ title: "Apply failed", message: msg });
    } finally {
      setBusy(false);
    }
  }, [preview, selectedSchoolId, selectedSchoolName]);

  const summaryCards = preview
    ? [
        { label: "Matched", value: preview.counts.matched },
        { label: "Unmatched", value: preview.counts.unmatched },
        { label: "Learners without plan", value: preview.counts.learnersWithoutPlan },
        { label: "Plans to write", value: preview.counts.plansToWrite },
      ]
    : [];

  return (
    <div className="sa-migration-page">
      <header className="sa-migration-header">
        <h1 className="page-title">Live Billing Plans Import</h1>
        <p className="sa-migration-subtitle">
          Upload Kid-e-Sys <strong>billing_plan_summary_by_child.xls</strong> and match rows to current
          live learners (ID number, admission number, name, surname, classroom). Preview only until you
          apply — saves to the normal billing plan store. Does not touch statements, payments, invoices,
          or balances.
        </p>
        <nav className="uc-migration-center-nav" aria-label="Migration navigation" style={{ marginTop: 16 }}>
          <Link to="/super-admin/migration" className="uc-migration-center-nav-link">
            Migration Center
          </Link>
          <Link
            to="/super-admin/migration/billing-plans"
            className="uc-migration-center-nav-link uc-migration-center-nav-link--active"
          >
            Billing plans import
          </Link>
          <Link to="/super-admin/migration/legacy" className="uc-migration-center-nav-link">
            Legacy migration
          </Link>
        </nav>
      </header>

      <div className="sa-migration-layout">
        <div className="sa-migration-column sa-migration-column--primary">
          <MigrationSchoolSelect
            schools={schoolOptions}
            selectedSchoolId={selectedSchoolId}
            onSchoolChange={(id) => {
              setSelectedSchoolId(id);
              setPreview(null);
              setApplied(false);
            }}
            debug={schoolOptionsDebug}
          />

          <section className="sa-migration-section">
            <h2 className="sa-migration-section-title">2. Upload billing plan</h2>
            <p className="sa-migration-section-hint">
              Kid-e-Sys export: billing_plan_summary_by_child.xls
            </p>
            <div
              className="sa-migration-dropzone"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPT}
                className="sa-migration-file-input"
                onChange={(e) => {
                  const picked = e.target.files?.[0] || null;
                  setFile(picked);
                  setPreview(null);
                  setApplied(false);
                }}
              />
              <p className="sa-migration-dropzone-title">
                {file ? file.name : "Click to choose billing_plan_summary_by_child.xls"}
              </p>
              {file ? (
                <p className="sa-migration-dropzone-text">{(file.size / 1024).toFixed(1)} KB</p>
              ) : null}
            </div>

            <div className="sa-migration-actions-row" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="sa-migration-btn sa-migration-btn--gold"
                disabled={!selectedSchoolId || !file || busy}
                onClick={() => void runPreview()}
              >
                {busy && uploadProgress != null
                  ? `Previewing… ${uploadProgress}%`
                  : "Preview import"}
              </button>
            </div>
          </section>
        </div>

        <div className="sa-migration-column sa-migration-column--secondary">
          {preview ? (
            <>
              <div className="sa-migration-summary-grid">
                {summaryCards.map((card) => (
                  <div key={card.label} className="sa-migration-summary-card">
                    <div className="sa-migration-summary-accent" aria-hidden="true" />
                    <p className="sa-migration-summary-label">{card.label}</p>
                    <p className="sa-migration-summary-value">{card.value}</p>
                  </div>
                ))}
              </div>

              <section className="sa-migration-section">
                <h2 className="sa-migration-section-title">Amount examples</h2>
                <p className="sa-migration-section-hint">
                  Sample matched learners by plan total ({preview.amountExamples.length} shown)
                </p>
                <div className="sa-migration-table-wrap">
                  <div className="sa-migration-table-scroll">
                    <table className="sa-migration-table">
                      <thead>
                        <tr>
                          <th>Learner</th>
                          <th>Class</th>
                          <th>Fees</th>
                          <th>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.amountExamples.map((row) => (
                          <tr key={`${row.fullName}-${row.className}`}>
                            <td>{row.fullName}</td>
                            <td>{row.className}</td>
                            <td>
                              {row.fees.map((f) => (
                                <div key={f.feeDescription}>
                                  {f.feeDescription}: {formatMoney(f.amount)}
                                </div>
                              ))}
                            </td>
                            <td>{formatMoney(row.totalAmount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </>
          ) : (
            <section className="sa-migration-section">
              <p className="sa-migration-section-hint">
                Select a school, upload the billing plan file, and run preview to see matched and
                unmatched rows.
              </p>
            </section>
          )}
        </div>
      </div>

      {preview ? (
        <>
          <section className="sa-migration-section" style={{ marginTop: 24 }}>
            <h2 className="sa-migration-section-title">
              Matched ({preview.counts.matched})
              {preview.matched.length < preview.counts.matched
                ? ` — showing ${preview.matched.length}`
                : ""}
            </h2>
            <div className="sa-migration-table-wrap">
              <div className="sa-migration-table-scroll">
                <table className="sa-migration-table">
                  <thead>
                    <tr>
                      <th>Billing name</th>
                      <th>Class</th>
                      <th>Live learner</th>
                      <th>Match</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.matched.map((row) => (
                      <tr key={row.billingMatchKey}>
                        <td>{row.fullName}</td>
                        <td>{row.className}</td>
                        <td>{row.learnerName}</td>
                        <td>{row.strategy || "—"}</td>
                        <td>{formatMoney(row.totalAmount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="sa-migration-section">
            <h2 className="sa-migration-section-title">
              Unmatched ({preview.counts.unmatched})
              {preview.unmatched.length < preview.counts.unmatched
                ? ` — showing ${preview.unmatched.length}`
                : ""}
            </h2>
            <div className="sa-migration-table-wrap">
              <div className="sa-migration-table-scroll">
                <table className="sa-migration-table">
                  <thead>
                    <tr>
                      <th>Billing name</th>
                      <th>Class</th>
                      <th>Fees</th>
                      <th>Total</th>
                      <th>Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.unmatched.map((row) => (
                      <tr key={row.billingMatchKey}>
                        <td>{row.fullName}</td>
                        <td>{row.className}</td>
                        <td>{row.feeLineCount}</td>
                        <td>{formatMoney(row.totalAmount)}</td>
                        <td>{row.ambiguous ? "Ambiguous" : "No match"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="sa-migration-section">
            <h2 className="sa-migration-section-title">
              Learners without plan ({preview.counts.learnersWithoutPlan})
              {preview.learnersWithoutPlan.length < preview.counts.learnersWithoutPlan
                ? ` — showing ${preview.learnersWithoutPlan.length}`
                : ""}
            </h2>
            <p className="sa-migration-section-hint">
              Active learners in EduClear with no row in the uploaded billing plan file.
            </p>
            <div className="sa-migration-table-wrap">
              <div className="sa-migration-table-scroll">
                <table className="sa-migration-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Class</th>
                      <th>Admission</th>
                      <th>ID number</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.learnersWithoutPlan.map((row) => (
                      <tr key={row.learnerId}>
                        <td>
                          {row.firstName} {row.lastName}
                        </td>
                        <td>{row.className || "—"}</td>
                        <td>{row.admissionNo || "—"}</td>
                        <td>{row.idNumber || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="sa-migration-section">
            <h2 className="sa-migration-section-title">3. Apply</h2>
            <p className="sa-migration-section-hint">
              Writes {preview.counts.plansToWrite} billing plan(s) using current learner IDs. Existing
              plans for other learners are left unchanged.
            </p>
            <button
              type="button"
              className="sa-migration-btn sa-migration-btn--gold"
              disabled={!preview.canApply || busy || applied}
              onClick={() => void runApply()}
            >
              {applied ? "Applied" : busy ? "Applying…" : "Apply billing plans"}
            </button>
          </section>
        </>
      ) : null}

      {notice ? <MigrationStubModal notice={notice} onClose={() => setNotice(null)} /> : null}
    </div>
  );
}
