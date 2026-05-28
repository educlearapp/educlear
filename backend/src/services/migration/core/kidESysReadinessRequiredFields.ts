import type { MigrationRequiredField } from "../types/MigrationAdapterReadinessTemplate";

/**
 * Kid-e-Sys class lists normalize to classroom labels (Grade 1A, Creche, etc.).
 * Readiness treats mapped classroom OR grade as satisfying the required "Grade or class" slot.
 */
export function isKidESysRequiredFieldMapped(
  field: MigrationRequiredField,
  mappedTargets: Set<string>
): boolean {
  if (field.fieldKey === "grade-or-class" && field.category === "learners") {
    return mappedTargets.has("grade") || mappedTargets.has("classroom");
  }
  return mappedTargets.has(field.targetField);
}

export function isReadinessRequiredFieldMapped(
  systemId: string,
  field: MigrationRequiredField,
  mappedTargets: Set<string>
): boolean {
  if (systemId === "kideesys") {
    return isKidESysRequiredFieldMapped(field, mappedTargets);
  }
  return mappedTargets.has(field.targetField);
}
