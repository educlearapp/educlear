/** Client helpers for Phase 1K Parents & Families Review. */

export type ParentFamilyDiscovery = {
  discoveryId: string;
  sourceParentRecords: number;
  automaticallyResolved: number;
  proposedNew: number;
  reviewRequired: number;
  conflicts: number;
  insufficientEvidence: number;
  ignoredShell: number;
  plainLanguage: string[];
};

export type ParentPersonProposal = {
  proposalId: string;
  displayName: string;
  firstName: string;
  surname: string;
  cellNo: string | null;
  email: string | null;
  relationship: string | null;
  matchState: string;
  severity: string;
  confidence: string;
  operatorMessage: string;
  warnings: string[];
  candidateSummaries: Array<{
    label: string;
    cellphone: string;
    email: string;
    linkedLearners: string[];
    parentId: string;
  }>;
  isShellOrJunk: boolean;
};

export type ParentFamilyMigrationPlan = {
  planId: string;
  stageId: string | null;
  targetSchoolId: string;
  criticalUnresolvedCount: number;
  nonCriticalUnresolvedCount: number;
  stale: boolean;
  people: ParentPersonProposal[];
  links: Array<{
    linkId: string;
    learnerLabel: string;
    relation: string | null;
    matchState: string;
    warnings: string[];
  }>;
  reviewItems: Array<{
    kind: string;
    proposalId: string;
    message: string;
    severity: string;
  }>;
  metrics: {
    sourceParentRecords: number;
    automaticallyResolved: number;
    proposedNew: number;
    reviewRequired: number;
    blockingReview: number;
    ignored: number;
    manualMappingActionsRequired: number;
  };
  warnings: string[];
};

export type ParentFamilyCheck = {
  checkId: string;
  status: string;
  parentFamilyMatch: boolean;
  parentFamilyReviewRequired: boolean;
  stale: boolean;
  plainLanguage: string[];
  parentsExpectedReuse: number;
  parentsMatchedReuse: number;
  parentsExpectedCreate: number;
  parentsMatchedCreate: number;
  linksExpected: number;
  linksMatched: number;
};

export async function postParentFamilyPlan(input: {
  stageId: string;
  targetSchoolId?: string;
}): Promise<{
  discovery: ParentFamilyDiscovery;
  plan: ParentFamilyMigrationPlan;
  readiness: { parentFamilyReady: boolean; parentFamilyReviewRequired: boolean };
}> {
  const res = await fetch("/api/migration/parent-family-plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Parent/family plan failed");
  return data;
}

export async function postParentFamilyReview(input: {
  planId: string;
  proposalId: string;
  action:
    | "ACCEPT_MATCH"
    | "CHOOSE_EXISTING"
    | "CREATE_NEW"
    | "IGNORE"
    | "KEEP_EXISTING_INFO";
  chosenParentId?: string;
}): Promise<{ plan: ParentFamilyMigrationPlan }> {
  const res = await fetch("/api/migration/parent-family-review", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Parent/family review failed");
  return { plan: data.plan };
}

export async function postParentFamilyApply(input: {
  planId: string;
}): Promise<{ result: Record<string, unknown> }> {
  const res = await fetch("/api/migration/parent-family-apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Parent/family apply failed");
  return { result: data.result };
}

export async function postParentFamilyCheck(input: {
  planId: string;
}): Promise<{ check: ParentFamilyCheck }> {
  const res = await fetch("/api/migration/parent-family-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) throw new Error(data?.error || "Parent/family check failed");
  return { check: data.check };
}
