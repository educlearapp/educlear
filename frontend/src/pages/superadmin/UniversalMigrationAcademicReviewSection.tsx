import { useState } from "react";
import {
  postAcademicApply,
  postAcademicPlan,
  postAcademicReview,
  postAcademicStructureCheck,
  type AcademicMigrationPlan,
  type AcademicStructureCheck,
  type AcademicStructureDiscovery,
} from "../../superAdmin/utils/universalMigrationAcademic";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

type Props = {
  onNotice?: (message: string) => void;
};

export default function UniversalMigrationAcademicReviewSection({ onNotice }: Props) {
  const { dryRunStage } = useUniversalMigrationWorkflow();
  const stageId = dryRunStage?.stageId || "";
  const targetSchoolId = dryRunStage?.targetSchoolId || "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<AcademicStructureDiscovery | null>(null);
  const [plan, setPlan] = useState<AcademicMigrationPlan | null>(null);
  const [check, setCheck] = useState<AcademicStructureCheck | null>(null);

  async function compilePlan() {
    if (!stageId) {
      setError("Create a dry run (Staging) first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await postAcademicPlan({
        stageId,
        targetSchoolId: targetSchoolId || undefined,
      });
      setDiscovery(result.discovery);
      setPlan(result.plan);
      setCheck(null);
      onNotice?.(
        result.readiness.academicReviewRequired
          ? "Academic structure found — some items need your confirmation."
          : "Academic structure looks clear — you can apply and run the Academic Structure Check."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Academic plan failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(
    kind: string,
    proposalId: string,
    action: "ACCEPT_PROPOSED" | "IGNORE" | "MARK_UNRESOLVED",
    chosenValue?: string
  ) {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const result = await postAcademicReview({
        planId: plan.planId,
        kind,
        proposalId,
        action,
        chosenValue,
      });
      setPlan(result.plan);
      setCheck(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyStructure() {
    if (!plan) return;
    setBusy(true);
    setError(null);
    try {
      const { result } = await postAcademicApply({ planId: plan.planId });
      onNotice?.(
        `Academic structure applied — classes created ${String(result.classroomsCreated)}, reused ${String(result.classroomsReused)}, learners placed ${String(result.learnersPlaced)}.`
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
      const result = await postAcademicStructureCheck({ planId: plan.planId });
      setCheck(result.check);
      onNotice?.(
        result.check.academicStructureMatch
          ? "Academic Structure Check passed."
          : "Academic Structure Check needs attention."
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="uc-migration-academic-review">
      <p className="uc-migration-dry-run-hint" role="note">
        EduClear looks at your export and proposes grades, classes, subjects and learner placements.
        You only confirm uncertain items — no database IDs required.
      </p>
      <div className="uc-migration-apply-stage-row">
        <button
          type="button"
          className="uc-migration-upload-primary"
          disabled={busy || !stageId}
          onClick={() => void compilePlan()}
        >
          {busy ? "Working…" : "Discover academic structure"}
        </button>
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={busy || !plan}
          onClick={() => void applyStructure()}
        >
          Apply safe academic structure
        </button>
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={busy || !plan}
          onClick={() => void runCheck()}
        >
          Run Academic Structure Check
        </button>
      </div>
      {error ? (
        <p className="uc-migration-error" role="alert">
          {error}
        </p>
      ) : null}

      {discovery ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>What we found</h3>
          <ul className="uc-migration-finance-totals">
            {discovery.plainLanguage.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            Status:{" "}
            {plan && plan.criticalUnresolvedCount === 0
              ? "ACADEMIC READY (pending apply/check)"
              : "ACADEMIC REVIEW REQUIRED"}
          </p>
        </div>
      ) : null}

      {plan ? (
        <>
          <div className="uc-migration-finance-summary">
            <h3>Classes</h3>
            <ul>
              {plan.classes.slice(0, 30).map((c) => (
                <li key={c.proposalId}>
                  Source “{c.sourceValue}” → proposed “{c.proposedClassroomName}” ({c.confidence},{" "}
                  {c.learnerCount} learners) — {c.matchState}
                  {c.matchState === "REVIEW_REQUIRED" ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void review("class", c.proposalId, "ACCEPT_PROPOSED")}
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void review("class", c.proposalId, "IGNORE")}
                      >
                        Ignore
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="uc-migration-finance-summary">
            <h3>Learner placements needing attention</h3>
            {plan.learnerPlacements.filter((p) => p.state !== "MATCHED").length === 0 ? (
              <p>All detected learners with class data can be placed automatically.</p>
            ) : (
              <ul>
                {plan.learnerPlacements
                  .filter((p) => p.state !== "MATCHED")
                  .slice(0, 40)
                  .map((p) => (
                    <li key={p.placementId}>
                      {p.learnerName}: {p.warnings[0] || p.state}
                      {p.sourceClass ? ` (source: ${p.sourceClass})` : ""}
                      {" "}
                      <button
                        type="button"
                        disabled={busy || !p.proposedClassroomName}
                        onClick={() =>
                          void review(
                            "placement",
                            p.placementId,
                            "ACCEPT_PROPOSED",
                            p.proposedClassroomName || undefined
                          )
                        }
                      >
                        Accept proposed class
                      </button>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="uc-migration-finance-summary">
            <h3>Subjects</h3>
            <ul>
              {plan.subjects.slice(0, 30).map((s) => (
                <li key={s.proposalId}>
                  “{s.sourceValue}” → “{s.proposedName}” ({s.confidence}) — {s.matchState}
                  {s.warnings[0] ? ` — ${s.warnings[0]}` : ""}
                  {s.matchState === "REVIEW_REQUIRED" ? (
                    <>
                      {" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void review("subject", s.proposalId, "ACCEPT_PROPOSED")}
                      >
                        Accept
                      </button>
                    </>
                  ) : null}
                </li>
              ))}
              {plan.subjects.length === 0 ? <li>No subjects detected.</li> : null}
            </ul>
          </div>

          <div className="uc-migration-finance-summary">
            <h3>Groups & teachers</h3>
            <ul>
              {plan.groups.map((g) => (
                <li key={g.proposalId}>
                  Group “{g.sourceValue}” — {g.warnings[0] || g.matchState}
                </li>
              ))}
              {plan.teacherAssignments.slice(0, 20).map((t) => (
                <li key={t.assignmentId}>
                  Teacher “{t.sourceTeacherName}” — {t.state}
                  {t.warnings[0] ? ` — ${t.warnings[0]}` : ""}
                </li>
              ))}
              {plan.groups.length === 0 && plan.teacherAssignments.length === 0 ? (
                <li>No group/teacher links requiring action.</li>
              ) : null}
            </ul>
          </div>
        </>
      ) : null}

      {check ? (
        <div className="uc-migration-finance-summary" role="status">
          <h3>Academic Structure Check — {check.status}</h3>
          <ul className="uc-migration-finance-totals">
            {check.plainLanguage.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
