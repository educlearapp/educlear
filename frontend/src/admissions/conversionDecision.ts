import type {
  ConversionDecisionDto,
  ConversionPreflight,
  ConversionResult,
  FamilyDecisionMode,
  GuardianDecisionMode,
} from "./staffAdmissionsTypes";

export type GuardianUiDecision = {
  mode: GuardianDecisionMode | "";
  existingParentId?: string;
  confirmCreateDespiteMatch?: boolean;
};

export type FamilyUiDecision = {
  mode: FamilyDecisionMode | "";
  existingFamilyAccountId?: string;
  acknowledgeCreateNewFamilyDespiteSiblingDeclaration?: boolean;
};

export type ConversionUiState = {
  guardians: Record<string, GuardianUiDecision>;
  family: FamilyUiDecision;
  grade: string;
  className: string;
};

const FORBIDDEN_DTO_KEYS = new Set([
  "schoolId",
  "promotedLearnerId",
  "promotedFamilyAccountId",
  "status",
  "billing",
  "invoice",
  "portal",
]);

export function initialGuardianDecisions(
  preflight: ConversionPreflight
): Record<string, GuardianUiDecision> {
  const out: Record<string, GuardianUiDecision> = {};
  for (const g of preflight.guardians) {
    // Never auto-select CREATE/LINK — staff must choose explicitly (strong matches are UI-highlighted only).
    out[g.admissionGuardianId] = { mode: "" };
  }
  return out;
}

export function initialFamilyDecision(_preflight?: ConversionPreflight): FamilyUiDecision {
  void _preflight;
  // Family mode must be an explicit staff choice; candidates are shown for selection only.
  return { mode: "" };
}

export function describeBlockerCode(code: string, fallbackMessage?: string): string {
  switch (code) {
    case "LEARNER_IDENTITY_CONFLICT":
      return "An existing learner record matches this application. Review the existing learner before continuing.";
    case "HISTORICAL_LEARNER_REQUIRES_REACTIVATION":
      return "This learner has a historical EduClear record. A new learner cannot be created from this application.";
    default:
      return fallbackMessage || code;
  }
}

export type ConversionValidationResult =
  | { ok: true }
  | { ok: false; message: string; field?: string };

export function validateConversionUiState(
  preflight: ConversionPreflight,
  state: ConversionUiState
): ConversionValidationResult {
  const grade = state.grade.trim();
  if (!grade) {
    return { ok: false, message: "Grade is required for enrolment.", field: "grade" };
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
        message: `Confirm create-new for probable match on ${g.firstName} ${g.surname}.`,
        field: `guardian-${g.admissionGuardianId}`,
      };
    }
  }

  if (!state.family.mode) {
    return { ok: false, message: "Choose family account mode.", field: "family" };
  }
  if (state.family.mode === "USE_EXISTING" && !state.family.existingFamilyAccountId?.trim()) {
    return { ok: false, message: "Select an existing family account.", field: "family" };
  }
  if (
    state.family.mode === "CREATE_NEW" &&
    preflight.family.requiresAckForCreateNewDespiteSiblingDeclaration &&
    !state.family.acknowledgeCreateNewFamilyDespiteSiblingDeclaration
  ) {
    return {
      ok: false,
      message: "Acknowledge creating a new family despite sibling declaration.",
      field: "familyAck",
    };
  }

  return { ok: true };
}

export function buildConversionDecisionDto(state: ConversionUiState): ConversionDecisionDto {
  const dto: ConversionDecisionDto = {
    family: {
      mode: state.family.mode as FamilyDecisionMode,
    },
    guardians: Object.entries(state.guardians).map(([admissionGuardianId, decision]) => {
      const row: ConversionDecisionDto["guardians"][number] = {
        admissionGuardianId,
        mode: decision.mode as GuardianDecisionMode,
      };
      if (decision.mode === "LINK_EXISTING" && decision.existingParentId) {
        row.existingParentId = decision.existingParentId;
      }
      if (decision.mode === "CREATE_NEW" && decision.confirmCreateDespiteMatch) {
        row.confirmCreateDespiteMatch = true;
      }
      return row;
    }),
    placement: {
      grade: state.grade.trim(),
      className: state.className.trim() || null,
    },
  };

  if (dto.family.mode === "USE_EXISTING" && state.family.existingFamilyAccountId) {
    dto.family.existingFamilyAccountId = state.family.existingFamilyAccountId;
  }
  if (
    dto.family.mode === "CREATE_NEW" &&
    state.family.acknowledgeCreateNewFamilyDespiteSiblingDeclaration
  ) {
    dto.family.acknowledgeCreateNewFamilyDespiteSiblingDeclaration = true;
  }

  assertStrictConversionDto(dto);
  return dto;
}

export function assertStrictConversionDto(dto: ConversionDecisionDto): void {
  const walk = (value: unknown, path: string): void => {
    if (value && typeof value === "object") {
      if (Array.isArray(value)) {
        value.forEach((item, index) => walk(item, `${path}[${index}]`));
        return;
      }
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (FORBIDDEN_DTO_KEYS.has(key)) {
          throw new Error(`Forbidden conversion DTO field: ${key}`);
        }
        walk(child, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(dto, "");
}

export function getEnrolmentStatusLabel(
  status: string,
  promotedLearnerId: string | null | undefined
): string | null {
  if (status !== "ACCEPTED") return null;
  return promotedLearnerId ? "Enrolled" : "Awaiting enrolment";
}

export function getEnrolmentDetailLabel(
  status: string,
  promotedLearnerId: string | null | undefined
): string | null {
  if (status !== "ACCEPTED") return null;
  return promotedLearnerId ? "EduClear learner created" : "Awaiting EduClear enrolment";
}

/** Finance baseline sync failure is a post-success warning, not a conversion failure. */
export function isFinanceBaselineWarningOnly(result: ConversionResult): boolean {
  return (
    Boolean(result.learnerId) &&
    (result.financeBaselineRegistered === false ||
      result.financeBaselineWarning === "FINANCE_BASELINE_SYNC_FAILED")
  );
}

export function hasConversionBlocker(
  preflight: ConversionPreflight,
  codes: string[] = ["LEARNER_IDENTITY_CONFLICT", "HISTORICAL_LEARNER_REQUIRES_REACTIVATION"]
): boolean {
  if (preflight.learner.duplicate) return true;
  return preflight.blockers.some((b) => codes.includes(b.code));
}
