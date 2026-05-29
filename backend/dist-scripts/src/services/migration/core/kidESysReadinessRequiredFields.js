"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isKidESysRequiredFieldMapped = isKidESysRequiredFieldMapped;
exports.isReadinessRequiredFieldMapped = isReadinessRequiredFieldMapped;
/**
 * Kid-e-Sys class lists normalize to classroom labels (Grade 1A, Creche, etc.).
 * Readiness treats mapped classroom OR grade as satisfying the required "Grade or class" slot.
 */
function isKidESysRequiredFieldMapped(field, mappedTargets) {
    if (field.fieldKey === "grade-or-class" && field.category === "learners") {
        return mappedTargets.has("grade") || mappedTargets.has("classroom");
    }
    return mappedTargets.has(field.targetField);
}
function isReadinessRequiredFieldMapped(systemId, field, mappedTargets) {
    if (systemId === "kideesys") {
        return isKidESysRequiredFieldMapped(field, mappedTargets);
    }
    return mappedTargets.has(field.targetField);
}
