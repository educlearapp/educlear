export type SchoolSettingsTab = "general" | "documents";

export type GeneralSettings = {
  studentMode: boolean;
  extraMuralMode: boolean;
};

export type DocumentDisplayFieldId =
  | "schoolName"
  | "schoolPhysicalAddress"
  | "schoolPostalAddress"
  | "schoolTelNo"
  | "schoolCellNo"
  | "schoolFaxNo"
  | "schoolEmail";

export type DocumentDisplaySettings = Record<DocumentDisplayFieldId, boolean>;

export type SchoolSettingsState = {
  general: GeneralSettings;
  documents: DocumentDisplaySettings;
};
