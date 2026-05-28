import { useEffect, useState } from "react";
import type { MigrationAdapterStatus, MigrationSystemResearch } from "../../superAdmin/utils/universalMigrationSystems";
import type { MigrationAdapterReadinessTemplate } from "../../superAdmin/utils/universalMigrationReadiness";
import {
  deriveAdapterReadinessUiStatus,
  readinessUiStatusLabel,
  splitReadinessFiles,
} from "../../superAdmin/utils/universalMigrationReadiness";
import {
  adapterTestRecommendationLabel,
  adapterTestStatusLabel,
  type MigrationAdapterTestResult,
} from "../../superAdmin/utils/universalMigrationAdapterTest";
import {
  getMigrationAdapterTestResult,
  subscribeMigrationAdapterTestSession,
} from "../../superAdmin/utils/universalMigrationAdapterTestSession";
import "./AdapterReadinessDetail.css";

function formatReviewedAt(iso: string): string {
  const trimmed = String(iso || "").trim();
  if (!trimmed) return "—";
  const d = new Date(trimmed);
  if (Number.isNaN(d.getTime())) return trimmed;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatAcceptedTypes(types: string[]): string {
  if (!types.length) return "—";
  return types.map((t) => t.toUpperCase()).join(", ");
}

type Props = {
  system: MigrationSystemResearch;
  template: MigrationAdapterReadinessTemplate | null;
  templateLoading: boolean;
  templateError: string | null;
  onClose: () => void;
};

export default function AdapterReadinessDetail({
  system,
  template,
  templateLoading,
  templateError,
  onClose,
}: Props) {
  const [sessionTestResult, setSessionTestResult] = useState<MigrationAdapterTestResult | null>(
    () => getMigrationAdapterTestResult(system.systemId)
  );

  useEffect(() => {
    setSessionTestResult(getMigrationAdapterTestResult(system.systemId));
    return subscribeMigrationAdapterTestSession(() => {
      setSessionTestResult(getMigrationAdapterTestResult(system.systemId));
    });
  }, [system.systemId]);

  const uiStatus = deriveAdapterReadinessUiStatus(system.adapterStatus as MigrationAdapterStatus);
  const { required: requiredFiles, optional: optionalFiles } = template
    ? splitReadinessFiles(template)
    : { required: [], optional: [] };

  return (
    <div className="uc-migration-readiness-detail" role="region" aria-label={`Readiness for ${system.systemName}`}>
      <div className="uc-migration-readiness-detail-header">
        <div>
          <h3 className="uc-migration-readiness-detail-title">{system.systemName}</h3>
          <p className="uc-migration-readiness-detail-id">{system.systemId}</p>
        </div>
        <button type="button" className="uc-migration-readiness-detail-close" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="uc-migration-readiness-detail-status-row">
        <span
          className={`uc-migration-readiness-detail-status uc-migration-readiness-detail-status--${uiStatus}`}
        >
          {readinessUiStatusLabel(uiStatus)}
        </span>
        <span
          className={`uc-migration-systems-registry-badge uc-migration-systems-registry-badge--${system.adapterStatus}`}
        >
          Adapter: {system.adapterStatus}
        </span>
      </div>

      {system.systemId === "kideesys" ? (
        <section className="uc-migration-readiness-detail-section uc-migration-readiness-detail-adapter-v1">
          <h4>Adapter v1</h4>
          <ul className="uc-migration-readiness-detail-list uc-migration-readiness-detail-list--compact">
            <li>
              <strong>Detection support</strong>
              <span className="uc-migration-readiness-detail-meta">Conservative filename and header signals</span>
            </li>
            <li>
              <strong>Normalization support</strong>
              <span className="uc-migration-readiness-detail-meta">
                Common Kid-e-Sys columns → EduClear fields (unknown columns skipped)
              </span>
            </li>
            <li>
              <strong>Readiness support</strong>
              <span className="uc-migration-readiness-detail-meta">
                Expected files, fields, and adapter test harness checks
              </span>
            </li>
          </ul>
          <p className="uc-migration-readiness-detail-muted">
            Parse, map, validate, and stage are not enabled in v1. Registry adapter status is not updated
            automatically.
          </p>
        </section>
      ) : null}

      {system.systemId === "sasams" ? (
        <section className="uc-migration-readiness-detail-section uc-migration-readiness-detail-adapter-v1">
          <h4>Adapter v1</h4>
          <ul className="uc-migration-readiness-detail-list uc-migration-readiness-detail-list--compact">
            <li>
              <strong>Detection support</strong>
              <span className="uc-migration-readiness-detail-meta">
                Conservative SA-SAMS filename and header signals
              </span>
            </li>
            <li>
              <strong>Normalization support</strong>
              <span className="uc-migration-readiness-detail-meta">
                Common SA-SAMS columns → EduClear fields (unknown columns skipped)
              </span>
            </li>
            <li>
              <strong>Administrative identifiers</strong>
              <span className="uc-migration-readiness-detail-meta">
                EMIS, admission number, register number, and admission date headers recognised
              </span>
            </li>
            <li>
              <strong>Readiness testing</strong>
              <span className="uc-migration-readiness-detail-meta">
                Expected files, fields, and adapter test harness checks
              </span>
            </li>
          </ul>
          <p className="uc-migration-readiness-detail-muted">
            Parse, map, validate, and stage are not enabled in v1. Registry adapter status is not updated
            automatically.
          </p>
        </section>
      ) : null}

      {system.systemId === "generic-excel-csv" ? (
        <section className="uc-migration-readiness-detail-section uc-migration-readiness-detail-adapter-v1">
          <h4>Adapter v1</h4>
          <ul className="uc-migration-readiness-detail-list uc-migration-readiness-detail-list--compact">
            <li>
              <strong>Spreadsheet detection</strong>
              <span className="uc-migration-readiness-detail-meta">
                CSV/XLS/XLSX with readable headers; excludes strong Kid-e-Sys signals
              </span>
            </li>
            <li>
              <strong>Generic normalization</strong>
              <span className="uc-migration-readiness-detail-meta">
                Common school column aliases → EduClear fields (unknown columns skipped)
              </span>
            </li>
            <li>
              <strong>Ambiguity warnings</strong>
              <span className="uc-migration-readiness-detail-meta">
                Short headers such as Name, Contact, and Type map at lower confidence for manual review
              </span>
            </li>
            <li>
              <strong>Readiness testing</strong>
              <span className="uc-migration-readiness-detail-meta">
                Adapter test harness checks structure, headers, field recognition, and mapping confidence
              </span>
            </li>
          </ul>
          <p className="uc-migration-readiness-detail-muted">
            Parse, map, validate, and stage are not enabled in v1. Legacy migration routes are unchanged.
          </p>
        </section>
      ) : null}

      <section className="uc-migration-readiness-detail-section uc-migration-readiness-detail-session-test">
        <h4>Session adapter test</h4>
        {sessionTestResult ? (
          <>
            <p className="uc-migration-readiness-detail-session-test-summary">
              Latest test from Upload Area ·{" "}
              {new Date(sessionTestResult.testedAt).toLocaleString()}
            </p>
            <div className="uc-migration-readiness-detail-session-test-row">
              <span
                className={`uc-migration-adapter-test-overall uc-migration-adapter-test-overall--${sessionTestResult.overallStatus}`}
              >
                Overall: {adapterTestStatusLabel(sessionTestResult.overallStatus)}
              </span>
              <span
                className={`uc-migration-adapter-test-recommendation uc-migration-adapter-test-recommendation--${sessionTestResult.recommendation}`}
              >
                Status recommendation:{" "}
                {adapterTestRecommendationLabel(sessionTestResult.recommendation)}
              </span>
            </div>
            <p className="uc-migration-readiness-detail-muted">
              {sessionTestResult.passed.length} passed · {sessionTestResult.warnings.length}{" "}
              warnings · {sessionTestResult.failed.length} failed ·{" "}
              {sessionTestResult.notSupported.length} not supported. Registry adapter status is not
              updated automatically.
            </p>
          </>
        ) : (
          <p className="uc-migration-readiness-detail-muted">
            No adapter test in this session yet. Run &quot;Test Adapter Readiness&quot; in the Upload
            Area for {system.systemName}.
          </p>
        )}
      </section>

      {templateLoading ? (
        <p className="uc-migration-readiness-detail-muted" role="status">
          Loading readiness template…
        </p>
      ) : null}

      {templateError ? (
        <p className="uc-migration-readiness-detail-error" role="alert">
          {templateError}
        </p>
      ) : null}

      {!templateLoading && !template && !templateError ? (
        <p className="uc-migration-readiness-detail-muted">No readiness template on file for this system.</p>
      ) : null}

      {template ? (
        <>
          <p className="uc-migration-readiness-detail-version">
            Template v{template.version} · Last reviewed {formatReviewedAt(template.lastReviewedAt)}
          </p>

          {template.notes ? (
            <section className="uc-migration-readiness-detail-section">
              <h4>Notes</h4>
              <p className="uc-migration-readiness-detail-notes">{template.notes}</p>
            </section>
          ) : null}

          <section className="uc-migration-readiness-detail-section">
            <h4>Required files</h4>
            {requiredFiles.length === 0 ? (
              <p className="uc-migration-readiness-detail-muted">None defined.</p>
            ) : (
              <ul className="uc-migration-readiness-detail-list">
                {requiredFiles.map((file) => (
                  <li key={file.fileKey}>
                    <strong>{file.label}</strong>
                    <span className="uc-migration-readiness-detail-meta">
                      {file.category} · {formatAcceptedTypes(file.acceptedTypes)}
                    </span>
                    {file.description ? <p>{file.description}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="uc-migration-readiness-detail-section">
            <h4>Optional files</h4>
            {optionalFiles.length === 0 ? (
              <p className="uc-migration-readiness-detail-muted">None defined.</p>
            ) : (
              <ul className="uc-migration-readiness-detail-list">
                {optionalFiles.map((file) => (
                  <li key={file.fileKey}>
                    <strong>{file.label}</strong>
                    <span className="uc-migration-readiness-detail-meta">
                      {file.category} · {formatAcceptedTypes(file.acceptedTypes)}
                    </span>
                    {file.description ? <p>{file.description}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="uc-migration-readiness-detail-section">
            <h4>Required fields</h4>
            {template.requiredFields.length === 0 ? (
              <p className="uc-migration-readiness-detail-muted">None defined.</p>
            ) : (
              <ul className="uc-migration-readiness-detail-list uc-migration-readiness-detail-list--compact">
                {template.requiredFields.map((field) => (
                  <li key={field.fieldKey}>
                    <strong>{field.label}</strong>
                    <span className="uc-migration-readiness-detail-meta">
                      → {field.targetField} ({field.category})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="uc-migration-readiness-detail-section">
            <h4>Optional fields</h4>
            {template.optionalFields.length === 0 ? (
              <p className="uc-migration-readiness-detail-muted">None defined.</p>
            ) : (
              <ul className="uc-migration-readiness-detail-list uc-migration-readiness-detail-list--compact">
                {template.optionalFields.map((field) => (
                  <li key={field.fieldKey}>
                    <strong>{field.label}</strong>
                    <span className="uc-migration-readiness-detail-meta">
                      → {field.targetField} ({field.category})
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
