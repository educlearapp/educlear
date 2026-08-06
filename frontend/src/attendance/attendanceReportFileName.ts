import type { AttendanceRegisterKind } from "./attendanceReportCatalog";

function slugPart(value: string, fallback: string): string {
  const cleaned = String(value || "")
    .trim()
    .replace(/[^\w\s.-]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

export type AttendanceExportView =
  | AttendanceRegisterKind
  | "learner"
  | "classroom_summary"
  | "school_summary"
  | "weekly_period_subject";

export function buildAttendanceExportFileName(input: {
  schoolName: string;
  classroom: string | null | undefined;
  view: AttendanceExportView;
  startDate: string;
  endDate: string;
  extension: "xlsx" | "pdf" | "csv";
}): string {
  const school = slugPart(input.schoolName, "School");
  const classroom = slugPart(input.classroom || "All-Classrooms", "All-Classrooms");
  const viewLabel: Record<AttendanceExportView, string> = {
    daily: "Daily-Register",
    list: "Attendance-List",
    weekly: "Weekly-Register",
    monthly: "Monthly-Register",
    learner: "Learner-History",
    classroom_summary: "Classroom-Summary",
    school_summary: "School-Summary",
    weekly_period_subject: "Weekly-Period-Subject-Register",
  };
  const datePart =
    input.startDate === input.endDate
      ? input.startDate
      : `${input.startDate}_to_${input.endDate}`;
  return `${school}_${classroom}_${viewLabel[input.view]}_${datePart}.${input.extension}`;
}
