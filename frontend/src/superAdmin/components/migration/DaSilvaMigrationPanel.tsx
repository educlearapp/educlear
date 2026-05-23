import { useCallback, useRef, useState } from "react";
import type { DaSilvaMigrationPreview } from "../../types/daSilvaMigration";
import {
  commitDaSilvaImport,
  formatDaSilvaReconciliationSummary,
  rollbackDaSilvaImport,
  uploadDaSilvaPreview,
} from "../../utils/daSilvaMigration";

type Props = {
  schoolId: string;
  disabled?: boolean;
  onNotice: (payload: {
    title: string;
    message: string;
    details?: string;
    primaryAction?: { label: string; onClick: () => void };
  }) => void;
};

export default function DaSilvaMigrationPanel({ schoolId, disabled, onNotice }: Props) {
  const classInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<DaSilvaMigrationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState({
    classListFiles: [] as File[],
    contactList: null as File | null,
    employees: null as File | null,
    billingPlan: null as File | null,
    ageAnalysis: null as File | null,
    transactions: null as File | null,
  });

  const canPreview =
    schoolId &&
    slots.classListFiles.length > 0 &&
    slots.contactList &&
    slots.employees &&
    slots.billingPlan &&
    slots.ageAnalysis &&
    slots.transactions;

  const runPreview = useCallback(async () => {
    if (!canPreview || !schoolId) return;
    setBusy(true);
    try {
      const projectId = preview?.projectId || `dasilva-${Date.now().toString(36)}`;
      const result = await uploadDaSilvaPreview({
        schoolId,
        projectId,
        classListFiles: slots.classListFiles,
        contactList: slots.contactList!,
        employees: slots.employees!,
        billingPlan: slots.billingPlan!,
        ageAnalysis: slots.ageAnalysis!,
        transactions: slots.transactions!,
      });
      setPreview(result);
      onNotice({
        title: result.canImport ? "Da Silva dry-run passed" : "Da Silva dry-run blocked",
        message: result.canImport
          ? "Counts match across class, contact, and billing exports. Review reconciliation before final import."
          : "Learner counts do not match across exports. Import is blocked until resolved.",
        details: formatDaSilvaReconciliationSummary(result),
        primaryAction: result.canImport
          ? {
              label: "Proceed to Final Import",
              onClick: () => {
                void (async () => {
                  setBusy(true);
                  try {
                    const imported = await commitDaSilvaImport({
                      schoolId,
                      projectId: result.projectId,
                      confirmToken: result.confirmToken,
                    });
                    onNotice({
                      title: "Da Silva import complete",
                      message: `Imported ${imported.imported?.learners ?? 0} learners, ${imported.imported?.parents ?? 0} parents, ${imported.imported?.ledgerEntries ?? 0} ledger entries.`,
                      details: formatDaSilvaReconciliationSummary(result),
                    });
                  } catch (e: unknown) {
                    onNotice({
                      title: "Import failed",
                      message: e instanceof Error ? e.message : "Import failed",
                    });
                  } finally {
                    setBusy(false);
                  }
                })();
              },
            }
          : undefined,
      });
    } catch (e: unknown) {
      onNotice({
        title: "Dry-run failed",
        message: e instanceof Error ? e.message : "Preview failed",
      });
    } finally {
      setBusy(false);
    }
  }, [canPreview, schoolId, slots, preview?.projectId, onNotice]);

  const runRollback = useCallback(async () => {
    if (!preview?.projectId || !schoolId) return;
    setBusy(true);
    try {
      const result = await rollbackDaSilvaImport({ schoolId, projectId: preview.projectId });
      onNotice({
        title: "Da Silva rollback complete",
        message: "Last Da Silva import batch was removed.",
        details: JSON.stringify(result.removed ?? {}, null, 2),
      });
    } catch (e: unknown) {
      onNotice({
        title: "Rollback failed",
        message: e instanceof Error ? e.message : "Rollback failed",
      });
    } finally {
      setBusy(false);
    }
  }, [preview?.projectId, schoolId, onNotice]);

  return (
    <section className="sa-migration-dasilva">
      <h2 className="sa-migration-section-title">Kid-e-Sys — Da Silva Academy</h2>
      <p className="sa-migration-subtitle">
        Upload exports in order: class lists (folder 05), employees (06), contacts (04), billing plan
        (03), age analysis (02), transactions (01). Dry-run validates counts and builds a
        reconciliation report before writing to the live database.
      </p>

      <div className="sa-migration-dasilva-slots">
        <label className="sa-migration-dasilva-slot">
          <span>05_class_list — all class .xls files</span>
          <input
            ref={classInputRef}
            type="file"
            accept=".xls"
            multiple
            disabled={disabled || busy}
            onChange={(e) =>
              setSlots((s) => ({
                ...s,
                classListFiles: Array.from(e.target.files || []),
              }))
            }
          />
          {slots.classListFiles.length > 0 ? (
            <small>{slots.classListFiles.length} class file(s) selected</small>
          ) : null}
        </label>

        {(
          [
            ["contactList", "04_contact_list — contact_list.xls"],
            ["employees", "06_employees — employee_contact_list.xls"],
            ["billingPlan", "03_billing_plan_summary_by_child.xls"],
            ["ageAnalysis", "02_account_list_age_analysis.xls"],
            ["transactions", "01_transaction_list — transaction_list.xls"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="sa-migration-dasilva-slot">
            <span>{label}</span>
            <input
              type="file"
              accept=".xls"
              disabled={disabled || busy}
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setSlots((s) => ({ ...s, [key]: file }));
              }}
            />
            {slots[key] ? <small>{slots[key]!.name}</small> : null}
          </label>
        ))}
      </div>

      <div className="sa-migration-dasilva-actions">
        <button
          type="button"
          className="sa-migration-btn sa-migration-btn--gold"
          disabled={!canPreview || disabled || busy}
          onClick={() => void runPreview()}
        >
          {busy ? "Running…" : "Run dry-run / preview"}
        </button>
        {preview?.projectId ? (
          <button
            type="button"
            className="sa-migration-btn"
            disabled={disabled || busy}
            onClick={() => void runRollback()}
          >
            Rollback Da Silva import
          </button>
        ) : null}
      </div>

      {preview ? (
        <pre className="sa-migration-dasilva-report">{formatDaSilvaReconciliationSummary(preview)}</pre>
      ) : null}
    </section>
  );
}
