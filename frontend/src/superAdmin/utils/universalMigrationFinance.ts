/** Client helpers for Phase 1G Finance Check + Accept Migration. */

export type FinanceTotalsCents = {
  debitCents: number;
  creditCents: number;
  netCents: number;
  accountCount: number;
  transactionCount: number;
  openingBalanceCount: number;
};

export type MigrationFinanceReconciliation = {
  reconciliationId: string;
  stageId: string;
  targetSchoolId: string;
  sourceTotals: FinanceTotalsCents;
  migratedTotals: FinanceTotalsCents;
  differenceCents: number;
  perAccount: Array<{
    accountRef: string;
    sourceCents: number;
    educlearCents: number;
    diffCents: number;
    ok: boolean;
  }>;
  mismatches: Array<{
    accountRef: string;
    sourceCents: number;
    educlearCents: number;
    diffCents: number;
    ok: boolean;
  }>;
  canAccept: boolean;
  blockedReasons: string[];
  stale: boolean;
  skippedUnsupported: Array<{ reason: string; detail?: string }>;
};

export type FinanceReconcilePlainLanguage = {
  accountsChecked: number;
  sourceTotal: string;
  educlearTotal: string;
  difference: string;
  ok: boolean;
  mismatchCount: number;
};

export async function postFinanceReconcile(input: {
  stageId: string;
  targetSchoolId?: string;
  parentReviewUnresolved?: number;
}): Promise<{
  reconciliation: MigrationFinanceReconciliation;
  plainLanguage: FinanceReconcilePlainLanguage;
}> {
  const res = await fetch("/api/migration/finance-reconcile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Finance check failed");
  }
  return {
    reconciliation: data.reconciliation,
    plainLanguage: data.plainLanguage,
  };
}

export async function postAcceptMigration(input: {
  stageId: string;
  reconciliationId: string;
  statementAuthorityCheckId: string;
  feeCheckAuthorityCheckId: string;
  targetSchoolId?: string;
  confirmation: boolean;
  parentReviewUnresolved?: number;
  summary: Record<string, number>;
}): Promise<{ acceptance: { acceptanceId: string; status: string; rollbackNote: string } }> {
  const res = await fetch("/api/migration/accept-migration", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Accept migration failed");
  }
  return { acceptance: data.acceptance };
}

export type MigrationStatementAuthorityCheck = {
  checkId: string;
  stageId: string;
  targetSchoolId: string;
  accountsChecked: number;
  matchCount: number;
  mismatchCount: number;
  statementAuthorityMatch: boolean;
  canFinalizeBaseline: boolean;
  blockedReasons: string[];
  stale: boolean;
  perAccount: Array<{
    accountRef: string;
    sourceMigratedCents: number;
    financeCheckCents: number;
    statementAuthorityCents: number;
    ok: boolean;
    snapshotCase: string;
    operatorMessage: string;
  }>;
  mismatches: Array<{
    accountRef: string;
    sourceMigratedCents: number;
    financeCheckCents: number;
    statementAuthorityCents: number;
    ok: boolean;
    operatorMessage: string;
  }>;
};

export async function postStatementAuthorityCheck(input: {
  stageId: string;
  reconciliationId: string;
  targetSchoolId?: string;
  confirmSameDatePrecedence?: boolean;
}): Promise<{
  check: MigrationStatementAuthorityCheck;
  plainLanguage: {
    accountsChecked: number;
    matchCount: number;
    mismatchCount: number;
    statementAuthorityMatch: boolean;
    canFinalizeBaseline: boolean;
  };
}> {
  const res = await fetch("/api/migration/statement-authority-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Statement Balance Check failed");
  }
  return { check: data.check, plainLanguage: data.plainLanguage };
}

export async function postStatementAuthorityFinalize(input: {
  stageId: string;
  reconciliationId: string;
  targetSchoolId?: string;
  confirmSameDatePrecedence?: boolean;
}): Promise<{
  baseline: { baselineId: string; idempotentReplay: boolean };
  check: MigrationStatementAuthorityCheck;
  statementAuthorityMatch: boolean;
}> {
  const res = await fetch("/api/migration/statement-authority-finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Could not apply statement balances");
  }
  return {
    baseline: data.baseline,
    check: data.check,
    statementAuthorityMatch: Boolean(data.statementAuthorityMatch),
  };
}

export type MigrationFeeCheckAuthorityCheck = {
  checkId: string;
  stageId: string;
  targetSchoolId: string;
  accountsChecked: number;
  matchCount: number;
  mismatchCount: number;
  feeCheckAuthorityMatch: boolean;
  blockedReasons: string[];
  stale: boolean;
  perAccount: Array<{
    accountRef: string;
    sourceCents: number;
    financeCents: number;
    statementCents: number;
    feeCheckCents: number;
    ok: boolean;
    operatorMessage: string;
  }>;
  mismatches: Array<{
    accountRef: string;
    sourceCents: number;
    financeCents: number;
    statementCents: number;
    feeCheckCents: number;
    ok: boolean;
    operatorMessage: string;
  }>;
};

export async function postFeeCheckAuthority(input: {
  stageId: string;
  reconciliationId: string;
  statementAuthorityCheckId: string;
  targetSchoolId?: string;
}): Promise<{
  check: MigrationFeeCheckAuthorityCheck;
  plainLanguage: {
    accountsChecked: number;
    matchCount: number;
    mismatchCount: number;
    feeCheckAuthorityMatch: boolean;
  };
}> {
  const res = await fetch("/api/migration/fee-check-authority", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Fee Check Authority Check failed");
  }
  return { check: data.check, plainLanguage: data.plainLanguage };
}

export type MigrationAgingCheck = {
  checkId: string;
  stageId: string;
  accountsChecked: number;
  sourceBucketsCount: number;
  balanceOnlyCount: number;
  matchCount: number;
  mismatchCount: number;
  agingCheckPass: boolean;
  blockedReasons: string[];
  stale: boolean;
  perAccount: Array<{
    accountRef: string;
    mode: "SOURCE_BUCKETS" | "BALANCE_ONLY";
    acceptedBalanceCents: number;
    sourceBucketSumCents: number | null;
    baselineBucketSumCents: number;
    ok: boolean;
    operatorMessage: string;
  }>;
};

export async function postAgingCheck(input: {
  stageId: string;
  reconciliationId: string;
  targetSchoolId?: string;
}): Promise<{
  check: MigrationAgingCheck;
  plainLanguage: {
    accountsChecked: number;
    sourceBucketsCount: number;
    balanceOnlyCount: number;
    agingCheckPass: boolean;
  };
}> {
  const res = await fetch("/api/migration/aging-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || "Aging Check failed");
  }
  return { check: data.check, plainLanguage: data.plainLanguage };
}
