import type { ParentRecord } from "./parentFormTypes";

export function emptyParentDraft(overrides: Partial<ParentRecord> = {}): ParentRecord {
  return {
    relationship: "Parent",
    title: "",
    firstName: "",
    surname: "",
    idNumber: "",
    cellNo: "",
    workNo: "",
    email: "",
    homeAddress: "",
    notes: "",
    communicationAdministration: true,
    communicationBilling: true,
    communicationByEmail: true,
    communicationBySMS: true,
    communicationByPrint: true,
    isPayingPerson: false,
    billingStatement: true,
    billingInvoice: true,
    billingReceipt: true,
    isPrimary: true,
    ...overrides,
  };
}

export function normalizeParentRecord(raw: Record<string, unknown> | null | undefined): ParentRecord {
  if (!raw || typeof raw !== "object") return emptyParentDraft();
  const cell = String(raw.cellNo || raw.cell || raw.phone || raw.mobile || "").trim();
  return {
    id: raw.id ? String(raw.id) : undefined,
    relationship: String(raw.relationship || raw.relation || "Parent").trim() || "Parent",
    title: String(raw.title || "").trim(),
    firstName: String(raw.firstName || raw.name || "").trim(),
    surname: String(raw.surname || raw.lastName || "").trim(),
    idNumber: String(raw.idNumber || "").trim(),
    cellNo: cell,
    cell,
    phone: cell,
    workNo: String(raw.workNo || raw.work || raw.workPhone || "").trim(),
    email: String(raw.email || "").trim(),
    homeAddress: String(raw.homeAddress || "").trim(),
    homeNo: String(raw.homeNo || "").trim(),
    notes: String(raw.notes || "").trim(),
    communicationAdministration: raw.communicationAdministration !== false,
    communicationBilling: raw.communicationBilling !== false,
    communicationByEmail: raw.communicationByEmail !== false,
    communicationBySMS: raw.communicationBySMS !== false,
    communicationByPrint: raw.communicationByPrint !== false,
    isPayingPerson: Boolean(raw.isPayingPerson),
    billingStatement: raw.billingStatement !== false,
    billingInvoice: raw.billingInvoice !== false,
    billingReceipt: raw.billingReceipt !== false,
    isPrimary: raw.isPrimary !== false,
    learnerId: raw.learnerId ? String(raw.learnerId) : undefined,
    familyAccountId: raw.familyAccountId ? String(raw.familyAccountId) : undefined,
  };
}

export function parentDisplayName(parent: ParentRecord) {
  return `${parent.firstName || ""} ${parent.surname || ""}`.trim() || "Parent";
}

export function parentToApiPayload(parent: ParentRecord) {
  return {
    id: parent.id && !String(parent.id).startsWith("local-parent-") ? parent.id : undefined,
    relationship: parent.relationship || "Parent",
    title: parent.title || null,
    firstName: (parent.firstName || "").trim(),
    surname: (parent.surname || "").trim(),
    idNumber: (parent.idNumber || "").trim() || null,
    cellNo: (parent.cellNo || parent.cell || parent.phone || "").trim(),
    phone: (parent.cellNo || parent.cell || parent.phone || "").trim(),
    workNo: (parent.workNo || parent.work || "").trim() || null,
    email: (parent.email || "").trim() || null,
    homeAddress: (parent.homeAddress || "").trim() || null,
    notes: (parent.notes || "").trim() || null,
    communicationAdministration: parent.communicationAdministration !== false,
    communicationBilling: parent.communicationBilling !== false,
    communicationByEmail: parent.communicationByEmail !== false,
    communicationByPrint: parent.communicationByPrint !== false,
    communicationBySMS: parent.communicationBySMS !== false,
    isPayingPerson: Boolean(parent.isPayingPerson),
    billingStatement: parent.billingStatement !== false,
    billingInvoice: parent.billingInvoice !== false,
    billingReceipt: parent.billingReceipt !== false,
    isPrimary: parent.isPrimary !== false,
  };
}

export function validateParentForSave(parent: ParentRecord): string | null {
  if (!(parent.firstName || "").trim()) return "Parent first name is required.";
  if (!(parent.surname || "").trim()) return "Parent surname is required.";
  if (!(parent.cellNo || parent.cell || parent.phone || "").trim()) return "Parent cell number is required.";
  const email = (parent.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Parent email must be valid.";
  return null;
}

export function parentsFromLearner(learner: Record<string, unknown> | null | undefined): ParentRecord[] {
  if (!learner) return [];
  const embedded = [
    ...(Array.isArray(learner.parents) ? learner.parents : []),
    ...(Array.isArray(learner.parentLinks)
      ? (learner.parentLinks as Record<string, unknown>[]).map((l) => l.parent || l).filter(Boolean)
      : []),
  ];
  if (embedded.length) return embedded.map((p) => normalizeParentRecord(p as Record<string, unknown>));
  return [];
}
