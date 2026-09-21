import type { AdmissionsRequiredDocument } from "../admissions/admissionsSettingsApi";

export const BUILTIN_DOCUMENTS = [
  ["birth_certificate", "Birth certificate"],
  ["learner_id", "Learner ID / passport"],
  ["parent_id", "Parent ID / passport"],
  ["guardian_id", "Guardian ID / passport"],
  ["previous_school_report", "Previous school report"],
  ["transfer_document", "Transfer document"],
  ["proof_of_residence", "Proof of residence"],
  ["medical_document", "Medical document"],
  ["supporting_document", "Supporting document"],
] as const;

export const BUILTIN_DOCUMENT_KEYS = new Set(BUILTIN_DOCUMENTS.map(([key]) => key));

export function newDocumentRequirement(index: number): AdmissionsRequiredDocument {
  return {
    key: `custom_document_${index + 1}`,
    label: "Supporting document",
    required: false,
    allowMultiple: false,
    maxCount: 1,
    condition: null,
  };
}

export function requiredDocumentValidation(
  items: AdmissionsRequiredDocument[]
): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(String(item.key || "").trim())) {
      return "Document keys must use lowercase letters, numbers, hyphens, or underscores.";
    }
    if (item.key === "proof_of_payment") {
      return "Proof of payment must remain in the separate payment flow.";
    }
    if (seen.has(item.key)) return `Duplicate document key: ${item.key}`;
    seen.add(item.key);
    if (!String(item.label || "").trim()) return `Add a display label for ${item.key}.`;
    if (
      item.allowMultiple &&
      (!Number.isInteger(Number(item.maxCount)) ||
        Number(item.maxCount) < 1 ||
        Number(item.maxCount) > 20)
    ) {
      return `Maximum files for ${item.key} must be between 1 and 20.`;
    }
  }
  return null;
}
