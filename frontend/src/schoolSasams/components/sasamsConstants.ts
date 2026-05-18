import type { SasamsUploadTypeId } from "../types/sasamsReport";

export const SASAMS_ACCEPTED_EXTENSIONS = [".csv", ".xlsx", ".xls"];

export const SASAMS_UPLOAD_TYPES: { id: SasamsUploadTypeId; label: string }[] = [
  { id: "learnerMarks", label: "Learner marks" },
  { id: "termReports", label: "Term reports" },
  { id: "subjectResults", label: "Subject results" },
  { id: "classLists", label: "Class lists" },
  { id: "parentContact", label: "Parent email/contact data" },
];

export const SASAMS_CSV_TEMPLATE_HEADERS = [
  "Learner Name",
  "Grade",
  "Class",
  "Subject",
  "Term",
  "Mark",
  "Parent Email",
] as const;

const SASAMS_TEMPLATE_FILENAME = "sasams-report-template.csv";

/** Downloads a blank CSV template for schools to fill before upload. */
export function downloadSasamsCsvTemplate(): void {
  const headerLine = SASAMS_CSV_TEMPLATE_HEADERS.join(",");
  const blob = new Blob([`${headerLine}\n`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = SASAMS_TEMPLATE_FILENAME;
  anchor.click();
  URL.revokeObjectURL(url);
}
