import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchUniversalMigrationStage,
  fetchUniversalMigrationStages,
  type MigrationStage,
  type MigrationStageListItem,
} from "../../superAdmin/utils/universalMigrationStage";
import {
  runUniversalMigrationFullPreflight,
  UniversalMigrationApplyError,
  type MigrationApplyResult,
} from "../../superAdmin/utils/universalMigrationApply";
import {
  groupSiblingLearnerLabels,
  isHighRiskReviewItem,
  operatorDecisionLabel,
  operatorReasonLabel,
  siblingKeyForItem,
  type BoundParentIdentityResolutions,
  type ParentIdentityResolution,
  type ParentIdentityResolutionKind,
  type ParentIdentityReviewContract,
  type ParentReviewQueueItem,
} from "../../superAdmin/utils/parentIdentityReview";
import { useUniversalMigrationWorkflow } from "./UniversalMigrationWorkflowContext";

type Props = {
  onNotice?: (message: string) => void;
};

function formatStageDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function displayId(value?: string | null): string {
  const v = String(value || "").trim();
  return v || "—";
}

export default function UniversalMigrationParentReviewSection({ onNotice }: Props) {
  const {
    selectedSessionSchoolId,
    parentIdentityResolutionsBound,
    setParentIdentityResolutionsBound,
  } = useUniversalMigrationWorkflow();

  const [stages, setStages] = useState<MigrationStageListItem[]>([]);
  const [selectedStageId, setSelectedStageId] = useState("");
  const [stage, setStage] = useState<MigrationStage | null>(null);
  const [listBusy, setListBusy] = useState(false);
  const [stageBusy, setStageBusy] = useState(false);
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<MigrationApplyResult | null>(null);
  const [review, setReview] = useState<ParentIdentityReviewContract | null>(null);
  const [draftResolutions, setDraftResolutions] = useState<
    Record<string, ParentIdentityResolution>
  >({});
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const boundSchoolId = String(stage?.targetSchoolId || "").trim();
  const boundSchoolName = String(stage?.targetSchoolName || "").trim();

  const refreshStages = useCallback(async () => {
    setListBusy(true);
    setError(null);
    try {
      const schoolFilter = selectedSessionSchoolId.trim() || undefined;
      const list = await fetchUniversalMigrationStages(
        schoolFilter ? { targetSchoolId: schoolFilter } : undefined
      );
      setStages(list);
      if (selectedStageId && !list.some((s) => s.stageId === selectedStageId)) {
        setSelectedStageId("");
        setStage(null);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load dry runs");
    } finally {
      setListBusy(false);
    }
  }, [selectedStageId, selectedSessionSchoolId]);

  useEffect(() => {
    void refreshStages();
  }, [refreshStages]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!selectedStageId) {
        setStage(null);
        return;
      }
      setStageBusy(true);
      setError(null);
      try {
        const loaded = await fetchUniversalMigrationStage(selectedStageId);
        if (!cancelled) setStage(loaded);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load dry run");
          setStage(null);
        }
      } finally {
        if (!cancelled) setStageBusy(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedStageId]);

  // Restore draft resolutions only when bound to this stage + school.
  useEffect(() => {
    if (!stage) {
      setDraftResolutions({});
      return;
    }
    const bound = parentIdentityResolutionsBound;
    if (
      bound &&
      bound.stageId === stage.stageId &&
      bound.targetSchoolId === stage.targetSchoolId
    ) {
      const map: Record<string, ParentIdentityResolution> = {};
      for (const r of bound.resolutions) map[r.itemKey] = r;
      setDraftResolutions(map);
    } else {
      setDraftResolutions({});
    }
    setPreflightResult(null);
    setReview(null);
  }, [stage, parentIdentityResolutionsBound]);

  const queueItems = useMemo(() => {
    if (!review) return [] as ParentReviewQueueItem[];
    return [...(review.conflictQueue || []), ...(review.reviewQueue || [])];
  }, [review]);

  const siblingGroups = useMemo(() => groupSiblingLearnerLabels(queueItems), [queueItems]);

  const unresolvedBlocking = useMemo(() => {
    if (!review) return 0;
    return queueItems.filter((item) => {
      const r = draftResolutions[item.itemKey];
      if (!r) return true;
      if (r.kind === "SKIP_HOLD") return true;
      if (r.kind === "LINK_TO_EXISTING_PARENT" && !String(r.existingParentId || "").trim()) {
        return true;
      }
      return false;
    }).length;
  }, [queueItems, draftResolutions, review]);

  const persistResolutions = useCallback(
    (nextMap: Record<string, ParentIdentityResolution>) => {
      if (!stage) return;
      const payload: BoundParentIdentityResolutions = {
        stageId: stage.stageId,
        migrationRunId: stage.migrationRunId || stage.stageId,
        targetSchoolId: stage.targetSchoolId,
        resolutions: Object.values(nextMap),
        updatedAt: new Date().toISOString(),
      };
      setParentIdentityResolutionsBound(payload);
    },
    [stage, setParentIdentityResolutionsBound]
  );

  const setResolution = useCallback(
    (itemKey: string, kind: ParentIdentityResolutionKind, existingParentId?: string | null) => {
      setDraftResolutions((prev) => {
        const next = {
          ...prev,
          [itemKey]: {
            itemKey,
            kind,
            existingParentId: existingParentId ?? null,
          },
        };
        persistResolutions(next);
        return next;
      });
    },
    [persistResolutions]
  );

  const clearResolution = useCallback(
    (itemKey: string) => {
      setDraftResolutions((prev) => {
        const next = { ...prev };
        delete next[itemKey];
        persistResolutions(next);
        return next;
      });
    },
    [persistResolutions]
  );

  const runPreflight = useCallback(async () => {
    if (!stage || !boundSchoolId) {
      setError("Select a dry run that is locked to a target school.");
      return;
    }
    setPreflightBusy(true);
    setError(null);
    try {
      const resolutions = Object.values(draftResolutions);
      const result = await runUniversalMigrationFullPreflight({
        stageId: stage.stageId,
        targetSchoolId: boundSchoolId,
        confirmationText: boundSchoolName || "PREFLIGHT",
        parentIdentityResolutions: resolutions,
      });
      setPreflightResult(result);
      const contract =
        result.parentIdentityReview ||
        (result.parentIdentityPreflight
          ? {
              status: result.parentIdentityPreflight.status,
              message: result.parentIdentityPreflight.message,
              counts: result.parentIdentityPreflight.counts,
              reviewQueue: [],
              conflictQueue: [],
              readyToReuse: [],
              readyToCreate: [],
              allowedResolutions: [
                "LINK_TO_EXISTING_PARENT" as const,
                "CREATE_AS_NEW_PARENT" as const,
                "SKIP_HOLD" as const,
              ],
            }
          : null);
      setReview(contract);

      if (contract?.status === "READY_TO_APPLY" && (contract.counts.unresolved ?? 0) === 0) {
        onNotice?.(
          `Parent review clear for ${boundSchoolName}. Ready for full preview / apply.`
        );
      } else {
        onNotice?.(
          `Parent review needs attention: ${contract?.counts.unresolved ?? "?"} item(s). No school data was changed.`
        );
      }
    } catch (e: unknown) {
      if (e instanceof UniversalMigrationApplyError && e.result) {
        setPreflightResult(e.result);
        setReview(e.result.parentIdentityReview || null);
      }
      const message = e instanceof Error ? e.message : "Full preflight failed";
      setError(message);
      onNotice?.(message);
    } finally {
      setPreflightBusy(false);
    }
  }, [
    stage,
    boundSchoolId,
    boundSchoolName,
    draftResolutions,
    onNotice,
  ]);

  const counts = review?.counts;
  const clean =
    Boolean(review) &&
    review?.status === "READY_TO_APPLY" &&
    (review?.counts.unresolved ?? 1) === 0;

  return (
    <div className="uc-migration-parent-review">
      <p className="uc-migration-dry-run-hint" role="note">
        Parent Review uses the same staged Migration Plan and resolution layer as apply. Resolutions
        stay bound to this dry run and school — they do not create a separate identity model.
        {stage?.compiledPlanId
          ? " This dry run is linked to a compiled Migration Plan."
          : ""}
      </p>
      <div className="uc-migration-apply-stage-row">
        <label className="uc-migration-staging-source-label">
          Dry run package
          <select
            className="uc-migration-staging-source-input"
            value={selectedStageId}
            onChange={(e) => setSelectedStageId(e.target.value)}
            disabled={listBusy || stages.length === 0}
          >
            <option value="">
              {stages.length === 0
                ? "No dry runs — stage from Upload Area first"
                : "Select a dry run"}
            </option>
            {stages.map((item) => (
              <option key={item.stageId} value={item.stageId}>
                {item.targetSchoolName || "Unbound"} · {item.sourceSystem} ·{" "}
                {formatStageDate(item.createdAt)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="uc-migration-upload-clear"
          disabled={listBusy}
          onClick={() => void refreshStages()}
        >
          {listBusy ? "Refreshing…" : "Refresh list"}
        </button>
        <button
          type="button"
          className="uc-migration-template-toolbar-btn"
          disabled={!stage || preflightBusy || stageBusy}
          onClick={() => void runPreflight()}
        >
          {preflightBusy ? "Checking parents…" : "Run parent check"}
        </button>
      </div>

      {stage ? (
        <p className="uc-migration-dry-run-hint" role="status">
          Migration locked to <strong>{boundSchoolName || "Unknown school"}</strong>. Parent
          matching uses only parents at this school.
        </p>
      ) : null}

      {error ? (
        <p className="uc-migration-upload-error" role="alert">
          {error}
        </p>
      ) : null}

      {stageBusy ? (
        <p className="uc-migration-upload-empty" role="status">
          Loading dry run…
        </p>
      ) : null}

      {counts ? (
        <section className="uc-migration-parent-review-summary" aria-label="Parent review summary">
          <h3 className="uc-migration-validation-section-title">Parent Review</h3>
          <ul className="uc-migration-parent-review-summary-list">
            <li>
              Ready to use existing parents: <strong>{counts.readyToReuse}</strong>
            </li>
            <li>
              New parents to create: <strong>{counts.readyToCreate}</strong>
            </li>
            <li>
              Needs your attention: <strong>{counts.unresolved}</strong>
            </li>
            <li>
              Parent–learner links planned: <strong>{counts.expectedLinks}</strong>
            </li>
          </ul>
          {clean ? (
            <p className="uc-migration-parent-review-clean" role="status">
              No parent identity issues found ✓ — you may continue to Full Preview / Apply.
            </p>
          ) : (
            <p className="uc-migration-dry-run-hint" role="status">
              Resolve each item below, then run parent check again. Nothing is written to the
              school until Apply.
              {unresolvedBlocking > 0
                ? ` ${unresolvedBlocking} blocking decision(s) still open.`
                : " All decisions selected — re-run check to confirm."}
            </p>
          )}
        </section>
      ) : stage ? (
        <p className="uc-migration-dry-run-hint" role="status">
          Run parent check to analyse guardian matches for this dry run (zero school writes).
        </p>
      ) : null}

      {queueItems.length > 0 ? (
        <div className="uc-migration-parent-review-queue">
          {queueItems.map((item) => {
            const draft = draftResolutions[item.itemKey];
            const highRisk = isHighRiskReviewItem(item);
            const siblings = siblingGroups.get(siblingKeyForItem(item)) || [];
            const reasons = [
              ...(item.conflictReasons || []),
              ...(item.reasons || []),
            ];

            return (
              <article
                key={item.itemKey}
                className={`uc-migration-parent-review-card${
                  highRisk ? " uc-migration-parent-review-card--risk" : ""
                }${draft && draft.kind !== "SKIP_HOLD" ? " uc-migration-parent-review-card--resolved" : ""}`}
              >
                <header className="uc-migration-parent-review-card-header">
                  <h4>
                    {item.sourceNameExact ||
                      `${item.incoming.firstName} ${item.incoming.surname}`.trim()}
                  </h4>
                  <span className="uc-migration-parent-review-badge">
                    {item.decision === "CONFLICT"
                      ? "Details conflict — choose carefully"
                      : "We found more than one possible match"}
                  </span>
                </header>

                <div className="uc-migration-parent-review-grid">
                  <div>
                    <h5>Incoming parent</h5>
                    <dl className="uc-migration-parent-review-dl">
                      <div>
                        <dt>Name</dt>
                        <dd>
                          {item.incoming.firstName} {item.incoming.surname}
                        </dd>
                      </div>
                      <div>
                        <dt>SA ID / passport</dt>
                        <dd className="uc-migration-parent-review-wrap">
                          {displayId(item.incoming.idNumber)}
                        </dd>
                      </div>
                      <div>
                        <dt>Cellphone</dt>
                        <dd className="uc-migration-parent-review-wrap">
                          {displayId(item.incoming.cellNo)}
                        </dd>
                      </div>
                      <div>
                        <dt>Email</dt>
                        <dd className="uc-migration-parent-review-wrap">
                          {displayId(item.incoming.email)}
                        </dd>
                      </div>
                      <div>
                        <dt>Relationship</dt>
                        <dd>{displayId(item.incoming.relationship)}</dd>
                      </div>
                    </dl>
                    {siblings.length > 0 ? (
                      <div className="uc-migration-parent-review-siblings">
                        <p>
                          This parent appears on {siblings.length} learner record
                          {siblings.length === 1 ? "" : "s"}:
                        </p>
                        <ul>
                          {siblings.map((label) => (
                            <li key={label}>{label}</li>
                          ))}
                        </ul>
                        <p className="uc-migration-upload-empty">
                          Choosing one parent will use that parent for these learner links where
                          applicable.
                        </p>
                      </div>
                    ) : item.incoming.learnerLabel ? (
                      <p className="uc-migration-dry-run-hint">
                        Linked learner in import: <strong>{item.incoming.learnerLabel}</strong>
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <h5>Possible existing matches (this school only)</h5>
                    {item.candidates.length === 0 ? (
                      <p className="uc-migration-upload-empty">
                        No strong same-school matches listed. You can create a new parent record.
                      </p>
                    ) : (
                      <ul className="uc-migration-parent-review-candidates">
                        {item.candidates.map((c) => {
                          const selected =
                            draft?.kind === "LINK_TO_EXISTING_PARENT" &&
                            draft.existingParentId === c.parentId;
                          return (
                            <li
                              key={c.parentId}
                              className={
                                selected
                                  ? "uc-migration-parent-review-candidate uc-migration-parent-review-candidate--selected"
                                  : "uc-migration-parent-review-candidate"
                              }
                            >
                              <div>
                                <strong>
                                  {c.firstName} {c.surname}
                                </strong>
                                <div className="uc-migration-parent-review-wrap">
                                  ID {c.maskedIdNumber || "—"} · Cell {c.maskedCellphone || "—"} ·{" "}
                                  {c.maskedEmail || "—"}
                                </div>
                                {c.linkedLearners && c.linkedLearners.length > 0 ? (
                                  <div className="uc-migration-upload-empty">
                                    Already linked:{" "}
                                    {c.linkedLearners.map((l) => l.label).join(", ")}
                                  </div>
                                ) : null}
                              </div>
                              <button
                                type="button"
                                className="uc-migration-template-toolbar-btn uc-migration-template-toolbar-btn--secondary"
                                onClick={() =>
                                  setResolution(
                                    item.itemKey,
                                    "LINK_TO_EXISTING_PARENT",
                                    c.parentId
                                  )
                                }
                              >
                                {operatorDecisionLabel("LINK_TO_EXISTING_PARENT")}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                </div>

                {highRisk ? (
                  <p className="uc-migration-parent-review-warning" role="alert">
                    High-risk decision: evidence conflicts or is weak. Do not merge unless you are
                    sure these are the same person.
                  </p>
                ) : null}

                {reasons.length > 0 ? (
                  <ul className="uc-migration-parent-review-reasons">
                    {reasons.slice(0, 6).map((r) => (
                      <li key={r}>{operatorReasonLabel(r)}</li>
                    ))}
                  </ul>
                ) : null}

                <div className="uc-migration-parent-review-actions">
                  <button
                    type="button"
                    className="uc-migration-template-toolbar-btn"
                    onClick={() => setResolution(item.itemKey, "CREATE_AS_NEW_PARENT")}
                  >
                    {operatorDecisionLabel("CREATE_AS_NEW_PARENT")}
                  </button>
                  <button
                    type="button"
                    className="uc-migration-template-toolbar-btn uc-migration-template-toolbar-btn--secondary"
                    onClick={() => setResolution(item.itemKey, "SKIP_HOLD")}
                  >
                    {operatorDecisionLabel("SKIP_HOLD")}
                  </button>
                  {draft ? (
                    <button
                      type="button"
                      className="uc-migration-upload-clear"
                      onClick={() => clearResolution(item.itemKey)}
                    >
                      Clear decision
                    </button>
                  ) : null}
                </div>

                {draft ? (
                  <p className="uc-migration-dry-run-hint" role="status">
                    Selected: <strong>{operatorDecisionLabel(draft.kind)}</strong>
                    {draft.kind === "SKIP_HOLD"
                      ? " — migration cannot finish while this is left for later."
                      : null}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}

      {preflightResult && clean ? (
        <section className="uc-migration-parent-review-preview" aria-label="Full preview counts">
          <h3 className="uc-migration-validation-section-title">Full preview (parents)</h3>
          <ul className="uc-migration-parent-review-summary-list">
            <li>
              Parents reused: <strong>{counts?.readyToReuse ?? 0}</strong>
            </li>
            <li>
              Parents created: <strong>{counts?.readyToCreate ?? 0}</strong>
            </li>
            <li>
              Parent→learner links: <strong>{counts?.expectedLinks ?? 0}</strong>
            </li>
            <li>
              Unresolved: <strong>0</strong>
            </li>
          </ul>
          <p className="uc-migration-dry-run-hint">
            Continue to Apply Migration. Apply still requires checklist confirmation and will
            re-check parent resolutions.
          </p>
        </section>
      ) : null}

      <details
        className="uc-migration-parent-review-diagnostics"
        open={diagnosticsOpen}
        onToggle={(e) => setDiagnosticsOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Developer diagnostics</summary>
        <pre className="uc-migration-parent-review-diagnostics-pre">
          {JSON.stringify(
            {
              stageId: stage?.stageId,
              targetSchoolId: boundSchoolId,
              migrationStatus: preflightResult?.migrationStatus,
              counts,
              resolutionCount: Object.keys(draftResolutions).length,
            },
            null,
            2
          )}
        </pre>
      </details>
    </div>
  );
}
