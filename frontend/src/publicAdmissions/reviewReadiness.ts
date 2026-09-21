/**
 * Review / readiness helpers mirroring backend validateApplicationForSubmit (OA-06E).
 * Client guidance only — server remains authoritative.
 */
import {
  buildSupportingDocumentRequirements,
  currentDocumentForType,
  deriveSupportingDocumentCompleteness,
  parseRequiredDocumentsConfig,
} from "./documentRequirements";
import type {
  ApplicantApplicationView,
  ApplicantDocumentView,
  PublicAdmissionsConfig,
  PublicApplicationQuestion,
  PublicValidationDetail,
} from "./publicAdmissionsTypes";

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function answerIsPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as object).length > 0;
  return false;
}

export function parseApplicationQuestions(raw: unknown): PublicApplicationQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: PublicApplicationQuestion[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { key?: unknown; label?: unknown; required?: unknown };
    const key = clean(row.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: clean(row.label) || key,
      required: row.required === true,
    });
  }
  return out;
}

export function isEditableDraftStatus(status: string | null | undefined): boolean {
  return String(status || "").toUpperCase() === "DRAFT";
}

export function isPostSubmitStatus(status: string | null | undefined): boolean {
  const s = String(status || "").toUpperCase();
  return (
    s === "SUBMITTED" ||
    s === "UNDER_REVIEW" ||
    s === "INFO_REQUESTED" ||
    s === "ACCEPTED" ||
    s === "DECLINED" ||
    s === "WITHDRAWN" ||
    s === "CANCELLED"
  );
}

/**
 * Advisory readiness checklist aligned with backend submit validation.
 * Does NOT treat missing supporting documents as submit blockers.
 */
export function deriveSubmitReadiness(input: {
  application: ApplicantApplicationView;
  config: PublicAdmissionsConfig | null;
  privacyAccepted: boolean;
  declarationsAccepted: boolean;
  answerValues: Record<string, string>;
}): {
  issues: PublicValidationDetail[];
  canAttemptSubmit: boolean;
} {
  const { application, config } = input;
  const issues: PublicValidationDetail[] = [];
  const learner = application.learner;
  const guardians = application.guardians || [];

  if (!learner || !clean(learner.firstName)) {
    issues.push({ field: "learner.firstName", message: "Learner first name is required" });
  }
  if (!learner || !clean(learner.lastName)) {
    issues.push({ field: "learner.lastName", message: "Learner surname is required" });
  }
  if (!learner?.birthDate) {
    issues.push({ field: "learner.birthDate", message: "Learner date of birth is required" });
  }
  const hasConditionalDocuments = parseRequiredDocumentsConfig(
    config?.requiredDocuments
  ).some((requirement) => requirement.required && requirement.condition);
  if (hasConditionalDocuments && !clean(learner?.citizenship)) {
    issues.push({
      field: "learner.citizenship",
      message: "Learner citizenship is required for document requirements",
    });
  }
  if (!clean(application.requestedGrade)) {
    issues.push({ field: "requestedGrade", message: "Requested grade is required" });
  } else if (
    config?.acceptedGrades?.length &&
    !config.acceptedGrades.includes(String(application.requestedGrade))
  ) {
    issues.push({
      field: "requestedGrade",
      message: "Requested grade is not accepted for this school",
    });
  }

  if (
    config?.intakeYear != null &&
    application.intakeYear !== Number(config.intakeYear)
  ) {
    issues.push({
      field: "intakeYear",
      message: `Intake year must be ${config.intakeYear}`,
    });
  }

  if (!guardians.length) {
    issues.push({ field: "guardians", message: "At least one guardian is required" });
  } else {
    const primaryCount = guardians.filter((g) => g.isPrimary).length;
    if (primaryCount !== 1) {
      issues.push({
        field: "guardians.isPrimary",
        message: "Exactly one primary guardian is required",
      });
    }
    if (publishedFinancialDocuments(config)) {
      const payingCount = guardians.filter((g) => g.isPayingPerson).length;
      if (payingCount !== 1) {
        issues.push({
          field: "guardians.isPayingPerson",
          message: "Exactly one guardian must be marked Responsible for fees",
        });
      }
    } else if (!guardians.some((g) => g.isPayingPerson)) {
      issues.push({
        field: "guardians.isPayingPerson",
        message: "At least one paying person must be designated",
      });
    }
    guardians.forEach((g, i) => {
      if (!clean(g.firstName)) {
        issues.push({
          field: `guardians[${i}].firstName`,
          message: "Guardian first name is required",
        });
      }
      if (!clean(g.surname)) {
        issues.push({
          field: `guardians[${i}].surname`,
          message: "Guardian surname is required",
        });
      }
      if (!clean(g.cellNo) && !clean(g.email)) {
        issues.push({
          field: `guardians[${i}].contact`,
          message: "Guardian cell number or email is required",
        });
      }
    });
  }

  const privacyOk = Boolean(application.privacyAcceptedAt) || input.privacyAccepted;
  const declarationsOk =
    Boolean(application.declarationsAcceptedAt) || input.declarationsAccepted;
  if (!privacyOk) {
    issues.push({
      field: "privacyAccepted",
      message: "Privacy notice acceptance is required",
    });
  }
  if (!declarationsOk) {
    issues.push({
      field: "declarationsAccepted",
      message: "Declarations acceptance is required",
    });
  }

  const questions = parseApplicationQuestions(config?.applicationQuestions);
  const answerMap = new Map(
    (application.answers || []).map((a) => [a.questionKey, a.valueJson])
  );
  for (const q of questions.filter((x) => x.required)) {
    const fromApp = answerMap.get(q.key);
    const fromLocal = input.answerValues[q.key];
    if (!answerIsPresent(fromApp) && !answerIsPresent(fromLocal)) {
      issues.push({
        field: `answers.${q.key}`,
        message: `Required answer missing: ${q.label}`,
      });
    }
  }

  if (!financialAgreementMatchesCurrentDocuments(application, config)) {
    issues.push({
      field: "financialAgreement.signature",
      message: "The financial policy and declaration must be signed before submission",
    });
  }

  return { issues, canAttemptSubmit: issues.length === 0 };
}

export function documentReviewSummary(input: {
  config: PublicAdmissionsConfig | null;
  documents: ApplicantDocumentView[];
  listRequiredDocumentTypes?: string[];
  learnerCitizenship?: string | null;
}): {
  requiredTotal: number;
  requiredUploaded: number;
  missingLabels: string[];
  unresolvedLabels: string[];
  summary: string | null;
} {
  const requirements = buildSupportingDocumentRequirements({
    config: input.config,
    listRequiredDocumentTypes: input.listRequiredDocumentTypes || [],
  });
  const completeness = deriveSupportingDocumentCompleteness({
    requirements,
    documents: input.documents,
    learnerCitizenship: input.learnerCitizenship,
  });
  const missingLabels = completeness.missingKeys.map((key) => {
    const req = requirements.find((r) => r.key === key);
    return req?.label || key;
  });
  const unresolvedLabels = completeness.unresolvedConditionKeys.map((key) => {
    const req = requirements.find((r) => r.key === key);
    return req?.label || key;
  });
  return {
    requiredTotal: completeness.requiredTotal,
    requiredUploaded: completeness.requiredUploaded,
    missingLabels,
    unresolvedLabels,
    summary: completeness.summary,
  };
}

export function parentFacingStatusTitle(status: string): string {
  switch (String(status || "").toUpperCase()) {
    case "SUBMITTED":
      return "Application submitted";
    case "UNDER_REVIEW":
      return "Application under review";
    case "INFO_REQUESTED":
      return "Additional information requested";
    case "ACCEPTED":
      return "Application accepted";
    case "DECLINED":
      return "Application declined";
    case "WITHDRAWN":
      return "Application withdrawn";
    case "CANCELLED":
      return "Application cancelled";
    case "DRAFT":
      return "Application draft";
    default:
      return "Application status";
  }
}

export function parentFacingStatusBody(status: string): string {
  switch (String(status || "").toUpperCase()) {
    case "SUBMITTED":
      return "Your application has been received. The school will review it in due course.";
    case "UNDER_REVIEW":
      return "The school is currently reviewing your application.";
    case "INFO_REQUESTED":
      return "The school has asked for additional information. A response flow will be available in a later update.";
    case "ACCEPTED":
      return "Congratulations — your application has been accepted. The school may contact you with next steps.";
    case "DECLINED":
      return "This application was not successful. Please contact the school if you need further information.";
    case "WITHDRAWN":
      return "This application has been withdrawn.";
    case "CANCELLED":
      return "This application has been cancelled.";
    default:
      return "Your application status is shown below.";
  }
}

export function mapValidationDetailsToGuidance(
  details: PublicValidationDetail[]
): PublicValidationDetail[] {
  return (details || []).map((d) => ({
    field: d.field,
    message: d.message || "Please review this item",
  }));
}

export function publishedFinancialDocuments(config: PublicAdmissionsConfig | null) {
  const documents = config?.financialDocuments || [];
  const policy = documents.find((document) => document.kind === "FINANCIAL_POLICY");
  const declaration = documents.find((document) => document.kind === "FINANCIAL_DECLARATION");
  if (!policy || !declaration) return null;
  return [policy, declaration];
}

export function financialAgreementMatchesCurrentDocuments(
  application: ApplicantApplicationView,
  config: PublicAdmissionsConfig | null
): boolean {
  const required = publishedFinancialDocuments(config);
  if (!required) return true;
  const acceptances = application.financialAgreement?.acceptances || [];
  return required.every((document) =>
    acceptances.some(
      (acceptance) =>
        acceptance.kind === document.kind &&
        acceptance.contentSha256 === document.contentSha256
    )
  );
}

export function sectionForValidationField(field: string): "details" | "documents" | "review" {
  const f = String(field || "");
  if (f.startsWith("financialAgreement.")) return "review";
  if (f.startsWith("answers.") || f === "privacyAccepted" || f === "declarationsAccepted") {
    return "review";
  }
  if (f.includes("document")) return "documents";
  return "details";
}

/** Re-export for review document row checks */
export { currentDocumentForType };
