export type SasamsUploadTypeId =
  | "learnerMarks"
  | "termReports"
  | "subjectResults"
  | "classLists"
  | "parentContact";

export type SasamsReportActionId =
  | "validateFile"
  | "prepareReports"
  | "emailReports"
  | "downloadTemplate";

export type SasamsReportSummary = {
  filesUploaded: number;
  learnersMatched: number;
  reportsReady: number;
  errorsNeedsReview: number;
};

export type SasamsValidationRow = {
  id: string;
  learner: string;
  gradeClass: string;
  subjectsFound: string;
  parentEmail: string;
  status: string;
  notes: string;
};

export type UploadedSasamsFile = {
  id: string;
  schoolId: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
};

export type SasamsModalState = {
  title: string;
  message: string;
} | null;

/** Future API requests must include this context so data stays scoped to one school. */
export type SasamsApiContext = {
  schoolId: string;
  uploadType: SasamsUploadTypeId | "";
  fileIds: string[];
};
