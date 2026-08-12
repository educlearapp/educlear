import { useCallback, useEffect, useState } from "react";
import {
  compileUniversalMigrationPlan,
  fetchUniversalMigrationCompiledPlan,
  type CompiledMigrationPlan,
} from "../../superAdmin/utils/universalMigrationCompiledPlan";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

type Props = {
  onNotice?: (message: string) => void;
};

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="uc-migration-plan-count-row">
      <span className="uc-migration-plan-count-label">{label}</span>
      <span className="uc-migration-plan-count-value">{value.toLocaleString()}</span>
    </div>
  );
}

export default function UniversalMigrationPlanSection({ onNotice }: Props) {
  const {
    selectedSessionSchoolId,
    sourceAnalysisId,
    setSourceAnalysisId,
    compiledPlanId,
    setCompiledPlanId,
    compiledPlan,
    setCompiledPlan,
  } = useUniversalMigrationWorkflow();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const schoolId = selectedSessionSchoolId.trim();

  useEffect(() => {
    if (!compiledPlanId || !schoolId || compiledPlan) return;
    let cancelled = false;
    void (async () => {
      try {
        const plan = await fetchUniversalMigrationCompiledPlan({
          planId: compiledPlanId,
          targetSchoolId: schoolId,
        });
        if (!cancelled) setCompiledPlan(plan);
      } catch {
        // ignore restore miss
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [compiledPlanId, schoolId, compiledPlan, setCompiledPlan]);

  const handleCompile = useCallback(async () => {
    if (!schoolId) {
      setError("Select the Migration Target school first.");
      return;
    }
    if (!sourceAnalysisId) {
      setError("Run Package Analysis first — the Migration Plan is compiled from that analysis.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const plan = await compileUniversalMigrationPlan({
        targetSchoolId: schoolId,
        sourceAnalysisId,
      });
      setCompiledPlan(plan);
      setCompiledPlanId(plan.planId);
      setSourceAnalysisId(plan.sourceAnalysisId);
      onNotice?.(
        plan.canProceedToStage
          ? "Migration Plan compiled. You can validate and stage using these mappings."
          : "Migration Plan compiled but needs attention before staging."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to compile migration plan");
    } finally {
      setBusy(false);
    }
  }, [
    schoolId,
    sourceAnalysisId,
    setCompiledPlan,
    setCompiledPlanId,
    setSourceAnalysisId,
    onNotice,
  ]);

  if (!schoolId) {
    return (
      <p className="uc-migration-dry-run-hint" role="note">
        Select the Migration Target school, upload exports, and run Package Analysis before compiling
        a Migration Plan.
      </p>
    );
  }

  return (
    <div className="uc-migration-plan-section">
      <p className="uc-migration-dry-run-hint" role="note">
        The Migration Plan turns Package Analysis into the exact field mappings and create/reuse
        counts that validation, staging, Parent Review, and apply will use. You do not need to remap
        fields Source Analysis already identified.
      </p>

      {!sourceAnalysisId ? (
        <p className="uc-migration-upload-error" role="status">
          No Package Analysis found for this school yet. Complete section 3 first.
        </p>
      ) : null}

      <button
        type="button"
        className="uc-migration-primary-btn"
        onClick={() => void handleCompile()}
        disabled={busy || !sourceAnalysisId}
      >
        {busy ? "Compiling…" : compiledPlan ? "Recompile Migration Plan" : "Compile Migration Plan"}
      </button>

      {error ? (
        <p className="uc-migration-upload-error" role="alert">
          {error}
        </p>
      ) : null}

      {compiledPlan ? (
        <div className="uc-migration-plan-summary" aria-live="polite">
          <h3 className="uc-migration-plan-summary-title">What this plan will do</h3>
          <div className="uc-migration-plan-counts">
            <CountRow label="Learners to create" value={compiledPlan.summary.learnersToCreate} />
            <CountRow
              label="Learners already present"
              value={compiledPlan.summary.learnersAlreadyPresent}
            />
            <CountRow label="Parents to create" value={compiledPlan.summary.parentsToCreate} />
            <CountRow label="Parents to reuse" value={compiledPlan.summary.parentsToReuse} />
            <CountRow label="Parent links" value={compiledPlan.summary.parentLinks} />
            <CountRow label="Classrooms" value={compiledPlan.summary.classrooms} />
            <CountRow label="Family accounts" value={compiledPlan.summary.familyAccounts} />
            <CountRow label="Employees" value={compiledPlan.summary.employees} />
            <CountRow label="Fields unsupported" value={compiledPlan.summary.fieldsUnsupported} />
            <CountRow
              label="Items needing attention"
              value={compiledPlan.summary.itemsNeedingAttention}
            />
          </div>

          {compiledPlan.summary.financePlannedNotApplicable > 0 ? (
            <p className="uc-migration-dry-run-hint" role="note">
              Opening balances and some finance items are planned but will not be posted by this
              migration path yet.
            </p>
          ) : null}

          {compiledPlan.blockedReasons.length > 0 ? (
            <ul className="uc-migration-plan-blocked">
              {compiledPlan.blockedReasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}

          {compiledPlan.canProceedToStage ? (
            <p className="uc-migration-dry-run-hint" role="status">
              Plan is ready for validation and staging. Parent Review still applies for ambiguous
              guardians.
            </p>
          ) : (
            <p className="uc-migration-upload-error" role="status">
              Resolve Package Analysis confirmations before staging.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
