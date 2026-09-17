import type {
  GuardianDecisionMode,
  ReactivationDecisionDto,
  ReactivationFamilyMode,
  ReactivationPreflight,
  ReactivationResult,
} from "./staffAdmissionsTypes";

export type ReactivationGuardianUiDecision = {
  mode: GuardianDecisionMode | "";
  existingParentId?: string;
  confirmCreateDespiteMatch?: boolean;
};

export type ReactivationFamilyUiDecision = {
  mode: ReactivationFamilyMode | "";
  familyAccountId?: string;
  acknowledgeHistoricalFamilyChange?: boolean;
};

export type ReactivationUiState = {
  guardians: Record<string, ReactivationGuardianUiDecision>;
  family: ReactivationFamilyUiDecision;
  grade: string;
  className: string;
  acknowledgeExistingBillingPlan: boolean;
};

export function initialReactivationGuardianDecisions(
  preflight: ReactivationPreflight
): Record<string, ReactivationGuardianUiDecision> {
  const out: Record<string, ReactivationGuardianUiDecision> = {};
  for (const g of preflight.guardians) {
    out[g.admissionGuardianId] = { mode: "" };
  }
  return out;
}

export function initialReactivationFamilyDecision(
  preflight: ReactivationPreflight
): ReactivationFamilyUiDecision {
  return {
    mode: preflight.family.defaultMode || "KEEP_EXISTING",
    familyAccountId: preflight.currentFamily?.familyAccountId || "",
  };
}

export type ReactivationValidationResult =
  | { ok: true }
  | { ok: false; message: string; field?: string };

export function validateReactivationUiState(
  preflight: ReactivationPreflight,
  state: ReactivationUiState
): ReactivationValidationResult {
  if (!preflight.historicalLearner) {
    return { ok: false, message: "No historical learner candidate is available." };
  }
  if (!state.grade.trim()) {
    return { ok: false, message: "Current grade is required.", field: "grade" };
  }
  if (!state.family.mode) {
    return { ok: false, message: "Choose a family option.", field: "family" };
  }
  if (state.family.mode === "USE_EXISTING") {
    if (!state.family.familyAccountId?.trim()) {
      return { ok: false, message: "Select an existing family account.", field: "family" };
    }
    const currentId = preflight.currentFamily?.familyAccountId;
    if (
      currentId &&
      state.family.familyAccountId !== currentId &&
      !state.family.acknowledgeHistoricalFamilyChange
    ) {
      return {
        ok: false,
        message: "Acknowledge the historical family account change before continuing.",
        field: "family-ack",
      };
    }
  }
  if (
    preflight.billingPlan.requiresAcknowledgeExistingBillingPlan &&
    !state.acknowledgeExistingBillingPlan
  ) {
    return {
      ok: false,
      message: "Acknowledge that the existing billing plan must be reviewed before invoice run.",
      field: "billing-ack",
    };
  }

  for (const g of preflight.guardians) {
    const decision = state.guardians[g.admissionGuardianId];
    if (!decision?.mode) {
      return {
        ok: false,
        message: `Choose create or link for guardian ${g.firstName} ${g.surname}.`,
        field: `guardian-${g.admissionGuardianId}`,
      };
    }
    if (decision.mode === "LINK_EXISTING" && !decision.existingParentId?.trim()) {
      return {
        ok: false,
        message: `Select an existing parent record for ${g.firstName} ${g.surname}.`,
        field: `guardian-${g.admissionGuardianId}`,
      };
    }
    if (decision.mode === "CREATE_NEW" && g.matchStrength === "STRONG") {
      return {
        ok: false,
        message: `Strong parent match for ${g.firstName} ${g.surname} requires linking the existing parent.`,
        field: `guardian-${g.admissionGuardianId}`,
      };
    }
    if (
      decision.mode === "CREATE_NEW" &&
      g.matchStrength === "PROBABLE" &&
      !decision.confirmCreateDespiteMatch
    ) {
      return {
        ok: false,
        message: `Confirm create despite probable match for ${g.firstName} ${g.surname}, or link instead.`,
        field: `guardian-${g.admissionGuardianId}`,
      };
    }
  }

  return { ok: true };
}

export function buildReactivationDecisionDto(
  preflight: ReactivationPreflight,
  state: ReactivationUiState
): ReactivationDecisionDto {
  if (!preflight.historicalLearner) {
    throw new Error("Missing historical learner");
  }
  return {
    learnerId: preflight.historicalLearner.id,
    family: {
      mode: state.family.mode as ReactivationFamilyMode,
      familyAccountId:
        state.family.mode === "USE_EXISTING"
          ? state.family.familyAccountId?.trim() || undefined
          : undefined,
      acknowledgeHistoricalFamilyChange: state.family.acknowledgeHistoricalFamilyChange === true,
    },
    guardians: preflight.guardians.map((g) => {
      const d = state.guardians[g.admissionGuardianId];
      return {
        admissionGuardianId: g.admissionGuardianId,
        mode: d.mode as GuardianDecisionMode,
        existingParentId:
          d.mode === "LINK_EXISTING" ? d.existingParentId?.trim() || undefined : undefined,
        confirmCreateDespiteMatch: d.confirmCreateDespiteMatch === true,
      };
    }),
    placement: {
      grade: state.grade.trim(),
      className: state.className.trim() || null,
    },
    acknowledgeExistingBillingPlan: state.acknowledgeExistingBillingPlan === true,
  };
}

export function isReactivationFinanceBaselineWarningOnly(result: ReactivationResult): boolean {
  return Boolean(result.financeBaselineWarning === "FINANCE_BASELINE_SYNC_FAILED");
}

export function describeReactivationBlocker(code: string, fallback?: string): string {
  switch (code) {
    case "AMBIGUOUS_HISTORICAL_LEARNER_MATCH":
      return "Multiple possible historical learner records were found. Resolve records manually before reactivation.";
    case "LEARNER_IDENTITY_CONFLICT":
      return "An active learner already matches this identity. Reactivation is not offered.";
    case "NO_USABLE_FAMILY_ACCOUNT":
      return "No usable family account exists for this historical learner. CREATE_NEW family is not supported here.";
    case "HISTORICAL_LEARNER_ALREADY_REACTIVATED":
      return "This historical learner is already linked to another application.";
    case "APPLICATION_NOT_ACCEPTED":
      return "Only accepted applications can reactivate a historical learner.";
    default:
      return fallback || code;
  }
}
