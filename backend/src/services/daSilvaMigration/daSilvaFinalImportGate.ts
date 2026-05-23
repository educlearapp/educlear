import type { DaSilvaMigrationBundle } from "./daSilvaMigrationService";
import {
  countAgeAnalysisVarianceAfterAdjustments,
  type DaSilvaOpeningBalanceAdjustment,
} from "./daSilvaOpeningBalance";
import {
  classifyVarianceGroup,
  isMergedFamilyAccount,
  learnersPerAccount,
} from "./daSilvaVarianceClassification";

export const DA_SILVA_FINAL_IMPORT_ENV = "CONFIRM_DA_SILVA_FINAL_IMPORT";

/** Manual reconciliation in Kid-e-Sys — excluded from opening balance at final import. */
export const DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS = ["MAR005"] as const;

const OPENING_BALANCE_EXCLUDED = new Set<string>(DA_SILVA_OPENING_BALANCE_EXCLUDED_ACCOUNTS);

/** Approved Kid-e-Sys → EduClear snapshot (Da Silva Academy). */
export const DA_SILVA_FINAL_IMPORT_EXPECTED = {
  schoolName: "Da Silva Academy",
  learners: 396,
  parents: 330,
  classes: 21,
  billingAccounts: 344,
  /** 112 base plan minus MAR005 manual exclusion. */
  openingBalanceAdjustments: 111,
  ageAnalysisRemainingVariance: 0,
  mergedFamilyLedgerGaps: 0,
} as const;

export function approvedOpeningBalanceAdjustments(
  bundle: DaSilvaMigrationBundle
): DaSilvaOpeningBalanceAdjustment[] {
  return bundle.openingBalance.adjustments.filter((a) => !OPENING_BALANCE_EXCLUDED.has(a.accountNo));
}

export type DaSilvaFinalImportSnapshot = {
  schoolName: string;
  learners: number;
  parents: number;
  classes: number;
  billingAccounts: number;
  openingBalanceAdjustments: number;
  ageAnalysisRemainingVariance: number;
  mergedFamilyLedgerGaps: number;
};

export type DaSilvaFinalImportMismatch = {
  field: keyof DaSilvaFinalImportSnapshot;
  expected: string | number;
  actual: string | number;
};

export class DaSilvaFinalImportBlockedError extends Error {
  readonly snapshot: DaSilvaFinalImportSnapshot;
  readonly mismatches: DaSilvaFinalImportMismatch[];
  readonly envConfirmed: boolean;

  constructor(
    message: string,
    snapshot: DaSilvaFinalImportSnapshot,
    mismatches: DaSilvaFinalImportMismatch[],
    envConfirmed: boolean
  ) {
    super(message);
    this.name = "DaSilvaFinalImportBlockedError";
    this.snapshot = snapshot;
    this.mismatches = mismatches;
    this.envConfirmed = envConfirmed;
  }
}

export function isDaSilvaFinalImportEnvConfirmed(): boolean {
  return String(process.env[DA_SILVA_FINAL_IMPORT_ENV] || "").trim().toLowerCase() === "true";
}

export function countMergedFamilyLedgerGaps(bundle: DaSilvaMigrationBundle): number {
  const varianceRows = bundle.reconciliation.rows.filter((r) => Math.abs(r.variance) > 0.01);
  const learnerCountByAccount = learnersPerAccount(bundle.learners);
  const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));
  const mergedFamilyAccountNos = new Set(bundle.mergedFamilyAccountNos || []);

  let gaps = 0;
  for (const row of varianceRows) {
    const account = bundle.accounts.find((a) => a.accountNo === row.accountNo);
    const fullName = row.fullName || account?.fullName || "";
    const inAgeAnalysis = ageAnalysisAccountNos.has(row.accountNo);
    const mergedFamily = isMergedFamilyAccount(
      row.accountNo,
      fullName,
      learnerCountByAccount,
      mergedFamilyAccountNos
    );
    const varianceGroup = classifyVarianceGroup(
      { ...row, fullName },
      inAgeAnalysis,
      bundle.transactions,
      mergedFamily
    );
    if (varianceGroup === "mergedFamilyLedgerGap") gaps++;
  }
  return gaps;
}

export function buildDaSilvaFinalImportSnapshot(
  bundle: DaSilvaMigrationBundle,
  schoolName: string
): DaSilvaFinalImportSnapshot {
  const freezeAdjustments = approvedOpeningBalanceAdjustments(bundle);
  const ageAnalysisAccountNos = new Set(bundle.accounts.map((a) => a.accountNo));

  return {
    schoolName: schoolName.trim(),
    learners: bundle.learners.length,
    parents: bundle.reconciliation.totals.totalParents,
    classes: bundle.reconciliation.totals.totalClasses,
    billingAccounts: bundle.countValidation.billingAccountsFromAgeAnalysis,
    openingBalanceAdjustments: freezeAdjustments.length,
    ageAnalysisRemainingVariance: countAgeAnalysisVarianceAfterAdjustments(
      bundle.reconciliation.rows,
      freezeAdjustments,
      ageAnalysisAccountNos
    ),
    mergedFamilyLedgerGaps: countMergedFamilyLedgerGaps(bundle),
  };
}

export type DaSilvaFinalImportGatePreview = {
  snapshot: DaSilvaFinalImportSnapshot;
  mismatches: DaSilvaFinalImportMismatch[];
  importAllowed: boolean;
  gateStatus: "PASS" | "FAIL";
};

/** Preview-only: validates snapshot + import eligibility without env confirmation. */
export function previewDaSilvaFinalImportGate(
  bundle: DaSilvaMigrationBundle,
  schoolName: string
): DaSilvaFinalImportGatePreview {
  const snapshot = buildDaSilvaFinalImportSnapshot(bundle, schoolName);
  const mismatches = findSnapshotMismatches(snapshot);
  const importAllowed = bundle.canImport && mismatches.length === 0;
  return {
    snapshot,
    mismatches,
    importAllowed,
    gateStatus: importAllowed ? "PASS" : "FAIL",
  };
}

export function printDaSilvaFinalImportGatePreview(
  preview: DaSilvaFinalImportGatePreview
): void {
  const expected = DA_SILVA_FINAL_IMPORT_EXPECTED.openingBalanceAdjustments;
  const actual = preview.snapshot.openingBalanceAdjustments;
  console.log("=== Da Silva final import gate — preview only (no import) ===");
  console.log(`Expected opening balance count: ${expected}`);
  console.log(`Actual opening balance count: ${actual}`);
  console.log(`Gate status: ${preview.gateStatus}`);
  if (preview.mismatches.length > 0) {
    for (const m of preview.mismatches) {
      console.log(`  ${m.field}: expected ${m.expected}, got ${m.actual}`);
    }
  }
}

function findSnapshotMismatches(snapshot: DaSilvaFinalImportSnapshot): DaSilvaFinalImportMismatch[] {
  const expected = DA_SILVA_FINAL_IMPORT_EXPECTED;
  const mismatches: DaSilvaFinalImportMismatch[] = [];

  const checks: Array<{
    field: keyof DaSilvaFinalImportSnapshot;
    expected: string | number;
    actual: string | number;
  }> = [
    { field: "schoolName", expected: expected.schoolName, actual: snapshot.schoolName },
    { field: "learners", expected: expected.learners, actual: snapshot.learners },
    { field: "parents", expected: expected.parents, actual: snapshot.parents },
    { field: "classes", expected: expected.classes, actual: snapshot.classes },
    { field: "billingAccounts", expected: expected.billingAccounts, actual: snapshot.billingAccounts },
    {
      field: "openingBalanceAdjustments",
      expected: expected.openingBalanceAdjustments,
      actual: snapshot.openingBalanceAdjustments,
    },
    {
      field: "ageAnalysisRemainingVariance",
      expected: expected.ageAnalysisRemainingVariance,
      actual: snapshot.ageAnalysisRemainingVariance,
    },
    {
      field: "mergedFamilyLedgerGaps",
      expected: expected.mergedFamilyLedgerGaps,
      actual: snapshot.mergedFamilyLedgerGaps,
    },
  ];

  for (const check of checks) {
    if (check.actual !== check.expected) {
      mismatches.push({
        field: check.field,
        expected: check.expected,
        actual: check.actual,
      });
    }
  }

  return mismatches;
}

export function printDaSilvaFinalImportPreImportSummary(
  snapshot: DaSilvaFinalImportSnapshot,
  mismatches: DaSilvaFinalImportMismatch[],
  envConfirmed: boolean
): void {
  const expected = DA_SILVA_FINAL_IMPORT_EXPECTED;
  const mismatchFields = new Set(mismatches.map((m) => m.field));

  const line = (label: string, field: keyof DaSilvaFinalImportSnapshot, actual: string | number) => {
    const exp = expected[field as keyof typeof expected];
    const ok = !mismatchFields.has(field) && actual === exp;
    console.log(`  ${label}: ${actual} (required: ${exp}) ${ok ? "OK" : "MISMATCH"}`);
  };

  console.log("=== Da Silva final import — pre-import summary ===");
  line("School name", "schoolName", snapshot.schoolName);
  line("Learners", "learners", snapshot.learners);
  line("Parents", "parents", snapshot.parents);
  line("Classes", "classes", snapshot.classes);
  line("Billing accounts", "billingAccounts", snapshot.billingAccounts);
  line(
    "Opening balance adjustments",
    "openingBalanceAdjustments",
    snapshot.openingBalanceAdjustments
  );
  line(
    "Age-analysis remaining variance",
    "ageAnalysisRemainingVariance",
    snapshot.ageAnalysisRemainingVariance
  );
  line("Merged-family ledger gaps", "mergedFamilyLedgerGaps", snapshot.mergedFamilyLedgerGaps);
  console.log(
    `  ${DA_SILVA_FINAL_IMPORT_ENV}: ${envConfirmed ? "true (confirmed)" : "not set — import blocked"}`
  );

  if (!envConfirmed) {
    console.log("BLOCKED: final import requires CONFIRM_DA_SILVA_FINAL_IMPORT=true on the server.");
  } else if (mismatches.length > 0) {
    console.log(
      `BLOCKED: ${mismatches.length} value(s) differ from the approved snapshot — re-run preview and fix data before import.`
    );
  } else {
    console.log("Pre-import summary matches approved snapshot (import may proceed when invoked).");
  }
}

/**
 * Hard gate for commitDaSilvaMigration. Prints summary, then throws if env or counts fail.
 */
export function assertDaSilvaFinalImportAllowed(
  bundle: DaSilvaMigrationBundle,
  schoolName: string
): DaSilvaFinalImportSnapshot {
  const snapshot = buildDaSilvaFinalImportSnapshot(bundle, schoolName);
  const envConfirmed = isDaSilvaFinalImportEnvConfirmed();
  const mismatches = findSnapshotMismatches(snapshot);

  printDaSilvaFinalImportPreImportSummary(snapshot, mismatches, envConfirmed);

  if (!envConfirmed) {
    throw new DaSilvaFinalImportBlockedError(
      `Final import blocked: set ${DA_SILVA_FINAL_IMPORT_ENV}=true on the server before running import`,
      snapshot,
      mismatches,
      false
    );
  }

  if (mismatches.length > 0) {
    const detail = mismatches
      .map((m) => `${m.field}: expected ${m.expected}, got ${m.actual}`)
      .join("; ");
    throw new DaSilvaFinalImportBlockedError(
      `Final import blocked: pre-import summary does not match required snapshot (${detail})`,
      snapshot,
      mismatches,
      true
    );
  }

  return snapshot;
}
