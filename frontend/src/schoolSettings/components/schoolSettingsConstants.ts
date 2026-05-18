import type { DocumentDisplayFieldId, SchoolSettingsState } from "../types/schoolSettings";

export const DOCUMENT_DISPLAY_FIELDS: { id: DocumentDisplayFieldId; label: string }[] = [
  { id: "schoolName", label: "School Name" },
  { id: "schoolPhysicalAddress", label: "School Physical Address" },
  { id: "schoolPostalAddress", label: "School Postal Address" },
  { id: "schoolTelNo", label: "School Tel No" },
  { id: "schoolCellNo", label: "School Cell No" },
  { id: "schoolFaxNo", label: "School Fax No" },
  { id: "schoolEmail", label: "School Email" },
];

export function createDefaultSchoolSettings(): SchoolSettingsState {
  return {
    general: {
      studentMode: false,
      extraMuralMode: false,
    },
    documents: {
      schoolName: false,
      schoolPhysicalAddress: false,
      schoolPostalAddress: false,
      schoolTelNo: false,
      schoolCellNo: false,
      schoolFaxNo: false,
      schoolEmail: false,
    },
  };
}
