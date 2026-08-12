import { useState } from "react";
import {
  postParentFamilyApply,
  postParentFamilyCheck,
  postParentFamilyPlan,
  postParentFamilyReview,
  type ParentFamilyCheck,
  type ParentFamilyDiscovery,
  type ParentFamilyMigrationPlan,
} from "../../superAdmin/utils/universalMigrationParentFamily";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

type Props = {
  onNotice?: (message: string) => void;
};

export default function UniversalMigrationParentFamilySection({ onNotice }: Props) {
  const { dryRunStage } = useUniversalMigrationWorkflow();
  const stageId = dryRunStage?.stageId || "";
  const targetSchoolId = dryRunStage?.targetSchoolId || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<ParentFamilyDiscovery | null>(null);
  const [plan, setPlan] = useState<ParentFamilyMigrationPlan | null>(null);
  const [check, setCheck] = useState<ParentFamilyCheck | null>(null);

  async function compilePlan() {
    if (!stageId) {
      setError("Create a dry run (Staging) first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postParentFamilyPlan({
        stageId,
        targetSchoolId: targetSchoolId || undefined,
      });
      setDiscovery(result.discovery);
      setPlan(result.plan);
      setCheck(null);
      onNotice?.(
        result.readiness.parentFamilyReviewRequired
          ? "Parents & families found — some identities need your confirmation."
          : "Parents & families look clear — you can apply and run the check."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Parent/family plan failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(
    proposalId: string,
    action:
      | "ACCEPT_MATCH"
      | "CHOOSE_EXISTING"
      | "CREATE_NEW"
      | "IGNORE"
      | "KEEP_EXISTING_INFO",
    chosenParentId?: string
  ) {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postParentFamilyReview({
        planId: plan.planId,
        proposalId,
        action,
        chosenParentId,
      });
      setPlan(result.plan);
      setCheck(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyPlan() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const { result } = await postParentFamilyApply({ planId: plan.planId });
      onNotice?.(
        `Parents & families applied — created ${String(result.parentsCreated)}, reused ${String(result.parentsReused)}, links ${String(result.linksUpserted)}.`
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Apply failed");
    } finally {
      setBusy(false);
    }
  }

  async function runCheck() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postParentFamilyCheck({ planId: plan.planId });
      setCheck(result.check);
      onNotice?.(
        result.check.parentFamilyMatch
          ? "Parents & Families Check passed."
          : "Parents & Families Check needs attention."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy(false);
    }
  }

  const needsReview =
    plan?.people.filter(
      (p) =>
        p.matchState === "REVIEW_REQUIRED" ||
        p.matchState === "IDENTITY_CONFLICT" ||
        p.matchState === "INSUFFICIENT_EVIDENCE"
    ) || [];

  return (
    <div className="uc-migration-parent-family-review">
      <p className="uc-migration-dry-run-hint" role="note">
        EduClear discovers parents and guardians from your export, matches strong identities
        automatically, and asks only about genuine exceptions. No field mapping or database IDs.
      </p>
      <div className="uc-migration-apply-stage-row">
        <button
          type="button"
          className="uc-migration-upload-primary"
          disabled={busy || !stageId}
          onClick={() => void compilePlan()}
        >
          {busy ? "Working…" : "Discover parents & families"}
        </button>
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={busy || !plan}
          onClick={() => void applyPlan()}
        >
          Apply safe parent links
        </button>
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={busy || !plan}
          onClick={() => void runCheck()}
        >
          Run Parents & Families Check
        </button>
      </div>
      {error ? (
        <p className="uc-migration-error" role="alert">
          {error}
        </p>
      ) : null}

      {discovery ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>Parents & Families</h3>
          <ul className="uc-migration-finance-totals">
            {discovery.plainLanguage.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {plan ? (
            <p>
              Summary: {plan.metrics.automaticallyResolved} resolved automatically ·{" "}
              {plan.metrics.proposedNew} new parents ready · {plan.metrics.reviewRequired} need
              review · {plan.metrics.ignored} incomplete ignored
            </p>
          ) : null}
        </div>
      ) : null}

      {needsReview.length > 0 ? (
        <div className="uc-migration-finance-summary">
          <h3>Needs your attention</h3>
          <ul>
            {needsReview.map((p) => (
              <li key={p.proposalId}>
                <strong>{p.displayName || "Unnamed"}</strong>
                {p.relationship ? ` (${p.relationship})` : ""} — {p.operatorMessage}
                {p.cellNo ? ` · cellphone ${p.cellNo}` : ""}
                {p.email ? ` · email ${p.email}` : ""}
                <div>
                  {p.candidateSummaries.length >= 2 ? (
                    p.candidateSummaries.map((c, idx) => (
                      <button
                        key={c.parentId}
                        type="button"
                        disabled={busy}
                        onClick={() => void review(p.proposalId, "CHOOSE_EXISTING", c.parentId)}
                      >
                        Use {c.label || `Parent ${idx + 1}`}
                        {c.linkedLearners.length
                          ? ` (learners: ${c.linkedLearners.slice(0, 3).join(", ")})`
                          : ""}
                      </button>
                    ))
                  ) : null}
                  {p.matchState === "REVIEW_REQUIRED" && p.candidateSummaries.length === 1 ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void review(p.proposalId, "ACCEPT_MATCH")}
                    >
                      Accept match
                    </button>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void review(p.proposalId, "CREATE_NEW")}
                  >
                    Create new parent
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void review(p.proposalId, "IGNORE")}
                  >
                    Ignore
                  </button>
                  {p.matchState === "IDENTITY_CONFLICT" ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void review(p.proposalId, "KEEP_EXISTING_INFO")}
                    >
                      Keep existing information
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : plan ? (
        <p className="uc-migration-dry-run-hint">No parent identity exceptions — ready to apply.</p>
      ) : null}

      {check ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>Parents & Families Check</h3>
          <p>Status: {check.status}</p>
          <ul>
            {check.plainLanguage.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
