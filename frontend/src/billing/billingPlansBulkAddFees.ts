/**
 * Bulk "Add Fees To Multiple" helpers for Billing Plans.
 * Reuses the same plan-append + PATCH /billing-plan behaviour as single-learner Continue.
 * Does not invent a separate billing domain — callers pass the canonical savePlan.
 */

export type BulkAddFee = {
  id: string;
  description: string;
  type: string;
  amount: number;
  dueDate?: string;
};

export type BulkAddLearner = {
  id: string;
  name: string;
  surname: string;
  classroom: string;
  billingPlan: BulkAddFee[];
};

export type BulkAddLearnerResult = {
  learnerId: string;
  learnerLabel: string;
  status: "success" | "failed" | "skipped";
  reason?: string;
};

export type BulkAddApplySummary = {
  successCount: number;
  skippedCount: number;
  failedCount: number;
  results: BulkAddLearnerResult[];
  outcome: "COMPLETE" | "PARTIAL" | "FAILED" | "EMPTY";
};

export type BulkAddValidation =
  | { ok: true }
  | { ok: false; error: string };

/** Same append semantics as single-learner fee picker Continue (no duplicate suppression). */
export function appendFeesToPlan(
  existingPlan: BulkAddFee[],
  selectedFees: BulkAddFee[]
): BulkAddFee[] {
  return [
    ...existingPlan.map((fee) => ({ ...fee })),
    ...selectedFees.map((fee) => ({
      ...fee,
      dueDate: fee.dueDate || "",
    })),
  ];
}

export function validateBulkAddSelection(
  selectedLearnerIds: string[],
  selectedFees: BulkAddFee[]
): BulkAddValidation {
  if (!selectedLearnerIds.length) {
    return { ok: false, error: "Select at least one learner." };
  }
  if (!selectedFees.length) {
    return { ok: false, error: "Select at least one fee." };
  }
  return { ok: true };
}

export function filterLearnersForBulkAdd(
  learners: BulkAddLearner[],
  search: string,
  classroomFilter: string
): BulkAddLearner[] {
  const q = String(search || "").trim().toLowerCase();
  const classroom = String(classroomFilter || "").trim().toLowerCase();
  return learners.filter((learner) => {
    if (classroom && classroom !== "all") {
      if (String(learner.classroom || "").trim().toLowerCase() !== classroom) {
        return false;
      }
    }
    if (!q) return true;
    const haystack = [
      learner.name,
      learner.surname,
      learner.classroom,
      learner.id,
    ]
      .map((v) => String(v || "").trim().toLowerCase())
      .join(" ");
    return haystack.includes(q);
  });
}

/** Select All applies only to the current filtered set — never silent outer-set selection. */
export function selectAllFilteredLearnerIds(
  filteredLearners: BulkAddLearner[],
  currentSelected: Set<string>
): Set<string> {
  const next = new Set(currentSelected);
  for (const learner of filteredLearners) {
    const id = String(learner.id || "").trim();
    if (id) next.add(id);
  }
  return next;
}

/** Clear only the current filtered set from selection (keeps selections outside filter). */
export function clearFilteredLearnerIds(
  filteredLearners: BulkAddLearner[],
  currentSelected: Set<string>
): Set<string> {
  const filteredIds = new Set(
    filteredLearners.map((l) => String(l.id || "").trim()).filter(Boolean)
  );
  const next = new Set<string>();
  for (const id of currentSelected) {
    if (!filteredIds.has(id)) next.add(id);
  }
  return next;
}

export function clearAllLearnerIds(): Set<string> {
  return new Set();
}

export function uniqueClassrooms(learners: BulkAddLearner[]): string[] {
  const set = new Set<string>();
  for (const learner of learners) {
    const c = String(learner.classroom || "").trim();
    if (c && c !== "—") set.add(c);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function summarizeBulkAddOutcome(
  results: BulkAddLearnerResult[]
): BulkAddApplySummary {
  const successCount = results.filter((r) => r.status === "success").length;
  const skippedCount = results.filter((r) => r.status === "skipped").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  let outcome: BulkAddApplySummary["outcome"] = "EMPTY";
  if (results.length === 0) {
    outcome = "EMPTY";
  } else if (failedCount === 0 && skippedCount === 0) {
    outcome = "COMPLETE";
  } else if (successCount === 0) {
    outcome = "FAILED";
  } else {
    outcome = "PARTIAL";
  }
  return { successCount, skippedCount, failedCount, results, outcome };
}

export type SavePlanOptions = {
  reloadList?: boolean;
  /** Bulk apply must update list rows without opening learner detail. */
  suppressDetailSelection?: boolean;
};

export type SavePlanFn = (
  learner: { id: string; billingPlan?: BulkAddFee[]; [key: string]: unknown },
  plan: BulkAddFee[],
  options?: SavePlanOptions
) => Promise<{ ok: boolean; error?: string }>;

/**
 * Resolve selectedPlanLearner after a billing-plan save.
 * Default (single-learner): keep existing detail open / open saved learner when none selected.
 * Bulk mode: never auto-select a learner — preserves the bulk result modal mount.
 */
export function resolveSelectedPlanLearnerAfterPlanSave(
  prev: any | null,
  learnerKey: string,
  learnerRow: any,
  options?: { suppressDetailSelection?: boolean }
): any | null {
  const key = String(learnerKey || "").trim();
  if (options?.suppressDetailSelection) {
    if (!prev) return null;
    const prevKey = String(prev?.id || prev?.learnerId || "").trim();
    return prevKey === key ? learnerRow : prev;
  }
  if (!prev) return learnerRow;
  const prevKey = String(prev?.id || prev?.learnerId || "").trim();
  return prevKey === key ? learnerRow : prev;
}

/**
 * Apply selected fees to each selected learner via the canonical savePlan path.
 * Mirrors single-add: concatenates fees onto the existing plan with no dedupe.
 */
export async function applyBulkAddFees(input: {
  selectedLearnerIds: string[];
  learnersById: Map<string, BulkAddLearner & { raw?: any }>;
  selectedFees: BulkAddFee[];
  savePlan: SavePlanFn;
}): Promise<BulkAddApplySummary> {
  const validation = validateBulkAddSelection(
    input.selectedLearnerIds,
    input.selectedFees
  );
  if (!validation.ok) {
    return {
      successCount: 0,
      skippedCount: 0,
      failedCount: 0,
      results: [],
      outcome: "EMPTY",
    };
  }

  const results: BulkAddLearnerResult[] = [];

  for (const learnerId of input.selectedLearnerIds) {
    const learner = input.learnersById.get(learnerId);
    const learnerLabel = learner
      ? `${learner.name} ${learner.surname}`.trim() || learnerId
      : learnerId;

    if (!learner) {
      results.push({
        learnerId,
        learnerLabel,
        status: "skipped",
        reason: "Learner not found in current list",
      });
      continue;
    }

    const nextPlan = appendFeesToPlan(learner.billingPlan || [], input.selectedFees);
    const raw = learner.raw || learner;
    try {
      const result = await input.savePlan(
        { ...raw, id: learnerId, billingPlan: learner.billingPlan },
        nextPlan,
        { suppressDetailSelection: true }
      );
      if (result.ok) {
        results.push({ learnerId, learnerLabel, status: "success" });
      } else {
        results.push({
          learnerId,
          learnerLabel,
          status: "failed",
          reason: result.error || "Save failed",
        });
      }
    } catch (error) {
      results.push({
        learnerId,
        learnerLabel,
        status: "failed",
        reason: error instanceof Error ? error.message : "Save failed",
      });
    }
  }

  return summarizeBulkAddOutcome(results);
}

export function formatBulkAddSummaryMessage(summary: BulkAddApplySummary): string {
  if (summary.outcome === "EMPTY") {
    return "No learners were updated.";
  }
  const parts = [
    `${summary.successCount} succeeded`,
    `${summary.skippedCount} skipped`,
    `${summary.failedCount} failed`,
  ];
  if (summary.outcome === "COMPLETE") {
    return `Bulk add complete: ${parts.join(", ")}.`;
  }
  if (summary.outcome === "PARTIAL") {
    return `Bulk add partially completed: ${parts.join(", ")}.`;
  }
  return `Bulk add failed: ${parts.join(", ")}.`;
}

/** Refresh plans only after the operator dismisses the result screen (Done). */
export function shouldRefreshBillingPlansAfterBulkResult(
  summary: BulkAddApplySummary | null | undefined
): boolean {
  return Boolean(summary && summary.successCount > 0);
}
