/**
 * Pure helpers for Parent Portal learner linking, selection, and family billing scope.
 * Frontend-only — mirrors existing API contracts; does not mutate parent/learner records.
 */

export type ParentPortalLearner = {
  id: string;
  firstName: string;
  lastName: string;
  grade: string;
  className: string | null;
  admissionNo?: string | null;
  familyAccountId?: string | null;
  familyAccount?: { id: string; accountRef: string; familyName?: string | null } | null;
  schoolId?: string | null;
};

export type ParentPortalLinkRow = {
  linkId: string;
  relation: string | null;
  isPrimary?: boolean;
  learner: ParentPortalLearner;
};

/** Shape from GET /me and verify-otp: { linkId, relation, learner } */
export type MeLearnerRow = {
  linkId?: string;
  id?: string;
  relation?: string | null;
  isPrimary?: boolean;
  learner?: ParentPortalLearner;
};

/** Shape from GET /dashboard: flat learner objects */
export type DashboardLearner = ParentPortalLearner & { linkId?: string; relation?: string | null };

function isValidLearnerId(id: unknown): id is string {
  return typeof id === "string" && id.trim().length > 0;
}

/**
 * Prefer authoritative /me link rows when present; otherwise map dashboard learners.
 * Deduplicates by learner.id. Drops rows without a valid learner id (stale/broken).
 * When both sources exist, /me wins per learner id; dashboard-only ids are appended
 * only if /me list is empty (session not yet refreshed).
 */
export function normalizeLinkedLearners(
  sessionLearners: MeLearnerRow[] | null | undefined,
  dashboardLearners: DashboardLearner[] | null | undefined
): ParentPortalLinkRow[] {
  const meRows = Array.isArray(sessionLearners) ? sessionLearners : [];
  const dashRows = Array.isArray(dashboardLearners) ? dashboardLearners : [];

  const fromMe: ParentPortalLinkRow[] = [];
  const seen = new Set<string>();

  for (const r of meRows) {
    const learner = r?.learner;
    const id = learner?.id;
    if (!isValidLearnerId(id) || !learner) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    fromMe.push({
      linkId: String(r.linkId || r.id || id),
      relation: r.relation ?? null,
      isPrimary: r.isPrimary,
      learner: { ...learner, id },
    });
  }

  if (fromMe.length > 0) return fromMe;

  const fromDash: ParentPortalLinkRow[] = [];
  for (const r of dashRows) {
    const learner = (r as MeLearnerRow)?.learner || r;
    const id = learner?.id;
    if (!isValidLearnerId(id) || !learner) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    fromDash.push({
      linkId: String((r as MeLearnerRow).linkId || id),
      relation: (r as MeLearnerRow).relation ?? null,
      learner: { ...learner, id },
    });
  }
  return fromDash;
}

/**
 * All authorised linked learners for display — no artificial cap.
 * Returns empty array when none (never invents placeholders).
 */
export function listSelectableLearners(rows: ParentPortalLinkRow[]): ParentPortalLinkRow[] {
  return rows.filter((row) => isValidLearnerId(row?.learner?.id));
}

/**
 * Resolve selection after load / unlink: keep current if still linked;
 * otherwise auto-select single learner, else first of many, else "".
 */
export function resolveSelectedLearnerId(
  currentSelectedId: string,
  rows: ParentPortalLinkRow[],
  autoSelectLearnerId?: string | null
): string {
  const linked = listSelectableLearners(rows);
  const ids = new Set(linked.map((r) => r.learner.id));

  if (currentSelectedId && ids.has(currentSelectedId)) {
    return currentSelectedId;
  }

  const auto = String(autoSelectLearnerId || "").trim();
  if (auto && ids.has(auto)) return auto;

  if (linked.length === 1) return linked[0].learner.id;
  if (linked.length > 1) return linked[0].learner.id;
  return "";
}

/**
 * Family billing scope for the selected anchor — mirrors ParentPortalApp /
 * backend resolveParentFamilyBillingScope grouping (familyAccountId, else accountRef).
 * Cross-school learners (optional schoolId mismatch) are excluded from the group.
 */
export function resolveFamilyBillingLearnerIds(
  rows: ParentPortalLinkRow[],
  anchorLearnerId: string,
  opts?: { expectedSchoolId?: string | null }
): { accountRef: string; learnerIds: string[]; learners: ParentPortalLearner[] } {
  const linked = listSelectableLearners(rows);
  const expectedSchool = String(opts?.expectedSchoolId || "").trim();

  const schoolFiltered = expectedSchool
    ? linked.filter((row) => {
        const sid = String(row.learner.schoolId || "").trim();
        // If schoolId absent on payload, keep (API may omit); if present must match.
        return !sid || sid === expectedSchool;
      })
    : linked;

  const anchor =
    schoolFiltered.find((r) => r.learner.id === anchorLearnerId)?.learner ||
    (schoolFiltered.length === 1 ? schoolFiltered[0].learner : null);

  if (!anchor) {
    return { accountRef: "", learnerIds: [], learners: [] };
  }

  const familyId = String(anchor.familyAccountId || anchor.familyAccount?.id || "").trim();
  const accountRef = String(anchor.familyAccount?.accountRef || "").trim();

  let group = [anchor];
  if (familyId) {
    group = schoolFiltered
      .map((r) => r.learner)
      .filter((l) => String(l.familyAccountId || l.familyAccount?.id || "") === familyId);
  } else if (accountRef) {
    group = schoolFiltered
      .map((r) => r.learner)
      .filter((l) => String(l.familyAccount?.accountRef || "") === accountRef);
  }

  return {
    accountRef,
    learnerIds: group.map((l) => l.id),
    learners: group,
  };
}

/**
 * Format outstanding balance for dashboard. Never invent R0.00 for failed/pending.
 * - loading → "Loading…"
 * - no snapshot (failed/pending) → "—"
 * - finite number (including 0) → formatted ZAR
 */
export function formatOutstandingBalanceLabel(
  billing: { balance: number } | null | undefined,
  loading: boolean
): string {
  if (loading) return "Loading…";
  if (!billing) return "—";
  const n = Number(billing.balance);
  if (!Number.isFinite(n)) return "—";
  return `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Parse billing API balance; invalid → null so UI can show em dash, not R0.00. */
export function parseBillingBalance(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
