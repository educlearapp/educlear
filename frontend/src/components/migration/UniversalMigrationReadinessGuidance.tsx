import { useMemo } from "react";
import type { MigrationFileColumnMappings } from "../../superAdmin/utils/buildEffectiveFileMappings";
import type { MigrationAdapterReadinessTemplate } from "../../superAdmin/utils/universalMigrationReadiness";
import {
  computeAdapterReadinessWarnings,
  splitReadinessFiles,
} from "../../superAdmin/utils/universalMigrationReadiness";
import type { UniversalMigrationUploadedFile } from "../../superAdmin/utils/universalMigrationUpload";
import "./UniversalMigrationReadinessGuidance.css";

function formatAcceptedTypes(types: string[]): string {
  if (!types.length) return "CSV, XLS, XLSX";
  return types.map((t) => t.toUpperCase()).join(", ");
}

const KIDEESYS_KNOWN_EXPORTS = [
  "Account List",
  "Transaction List",
  "Contact List",
  "Billing Plan",
  "Age Analysis",
] as const;

const GENERIC_EXCEL_UPLOAD_GUIDANCE =
  "Upload any CSV/XLS/XLSX files. EduClear will detect columns and suggest mappings, but ambiguous fields must be reviewed manually.";

const GENERIC_EXCEL_SUGGESTED_FILES = [
  "Learner list",
  "Parent/contact list",
  "Account/balance list",
  "Transaction/payment list",
] as const;

const SASAMS_UPLOAD_GUIDANCE =
  "Upload SA-SAMS exports or related school administration spreadsheets. EduClear will recognise common SA-SAMS terminology and suggest mappings conservatively.";

const SASAMS_SUGGESTED_UPLOADS = [
  "Learner register",
  "Class list",
  "Parent/contact list",
  "Administrative register",
] as const;

type Props = {
  template: MigrationAdapterReadinessTemplate | null;
  templateLoading: boolean;
  uploadedFiles: UniversalMigrationUploadedFile[];
  mappings: MigrationFileColumnMappings[];
};

export default function UniversalMigrationReadinessGuidance({
  template,
  templateLoading,
  uploadedFiles,
  mappings,
}: Props) {
  const { required: requiredFiles, optional: optionalFiles } = useMemo(
    () => (template ? splitReadinessFiles(template) : { required: [], optional: [] }),
    [template]
  );

  const warnings = useMemo(
    () =>
      computeAdapterReadinessWarnings({
        template,
        uploadedFiles,
        mappings,
      }),
    [template, uploadedFiles, mappings]
  );

  if (templateLoading) {
    return (
      <p className="uc-migration-readiness-guidance-status" role="status">
        Loading upload guidance for selected source system…
      </p>
    );
  }

  if (!template) {
    return (
      <p className="uc-migration-readiness-guidance-status" role="note">
        Select a registered source system to see expected files and fields. Warnings are advisory only —
        upload and mapping are not blocked.
      </p>
    );
  }

  return (
    <div className="uc-migration-readiness-guidance" aria-label="Adapter upload guidance">
      <h3 className="uc-migration-readiness-guidance-title">
        Expected uploads — {template.systemName}
      </h3>
      <p className="uc-migration-readiness-guidance-hint">
        Accepted types: {formatAcceptedTypes(
          [...new Set(template.requiredFiles.flatMap((f) => f.acceptedTypes))]
        )}
        . Guidance only — imports are not blocked.
      </p>

      {template.systemId === "kideesys" ? (
        <section className="uc-migration-readiness-guidance-kideesys" aria-label="Known Kid-e-Sys exports">
          <h4>Known Kid-e-Sys exports</h4>
          <p className="uc-migration-readiness-guidance-muted">
            Advisory only — upload class lists and other registers as needed. Legacy Kid-e-Sys import is
            unchanged.
          </p>
          <ul>
            {KIDEESYS_KNOWN_EXPORTS.map((label) => (
              <li key={label}>
                <strong>{label}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {template.systemId === "sasams" ? (
        <section className="uc-migration-readiness-guidance-kideesys" aria-label="SA-SAMS upload guidance">
          <h4>SA-SAMS uploads</h4>
          <p className="uc-migration-readiness-guidance-muted">{SASAMS_UPLOAD_GUIDANCE}</p>
          <p className="uc-migration-readiness-guidance-muted">Suggested uploads:</p>
          <ul>
            {SASAMS_SUGGESTED_UPLOADS.map((label) => (
              <li key={label}>
                <strong>{label}</strong>
              </li>
            ))}
          </ul>
          <p className="uc-migration-readiness-guidance-muted">
            Advisory only — legacy migration routes are unchanged. Adapter v1 does not parse or stage
            imports automatically.
          </p>
        </section>
      ) : null}

      {template.systemId === "generic-excel-csv" ? (
        <section
          className="uc-migration-readiness-guidance-kideesys"
          aria-label="Generic Excel/CSV upload guidance"
        >
          <h4>Generic Excel/CSV uploads</h4>
          <p className="uc-migration-readiness-guidance-muted">{GENERIC_EXCEL_UPLOAD_GUIDANCE}</p>
          <p className="uc-migration-readiness-guidance-muted">Suggested file types:</p>
          <ul>
            {GENERIC_EXCEL_SUGGESTED_FILES.map((label) => (
              <li key={label}>
                <strong>{label}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="uc-migration-readiness-guidance-grid">
        <section>
          <h4>Required files</h4>
          {requiredFiles.length === 0 ? (
            <p className="uc-migration-readiness-guidance-muted">None</p>
          ) : (
            <ul>
              {requiredFiles.map((file) => (
                <li key={file.fileKey}>
                  <strong>{file.label}</strong> ({file.category})
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4>Optional files</h4>
          {optionalFiles.length === 0 ? (
            <p className="uc-migration-readiness-guidance-muted">None</p>
          ) : (
            <ul>
              {optionalFiles.map((file) => (
                <li key={file.fileKey}>
                  <strong>{file.label}</strong> ({file.category})
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h4>Required fields</h4>
          <ul>
            {template.requiredFields.map((field) => (
              <li key={field.fieldKey}>
                {field.label} → <code>{field.targetField}</code>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h4>Optional fields</h4>
          {template.optionalFields.length === 0 ? (
            <p className="uc-migration-readiness-guidance-muted">None listed</p>
          ) : (
            <ul>
              {template.optionalFields.slice(0, 8).map((field) => (
                <li key={field.fieldKey}>
                  {field.label} → <code>{field.targetField}</code>
                </li>
              ))}
              {template.optionalFields.length > 8 ? (
                <li className="uc-migration-readiness-guidance-more">
                  +{template.optionalFields.length - 8} more optional fields
                </li>
              ) : null}
            </ul>
          )}
        </section>
      </div>

      {template.notes ? (
        <p className="uc-migration-readiness-guidance-notes">{template.notes}</p>
      ) : null}

      {warnings.length > 0 ? (
        <div className="uc-migration-readiness-guidance-warnings" role="status">
          <h4>Readiness warnings</h4>
          <ul>
            {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`}>{w.message}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
