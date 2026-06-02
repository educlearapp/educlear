import { prisma } from "../prisma";
import { activeLearnerWhere } from "../utils/learnerEnrollment";
import type { LearnerReportPdfInput, LearnerReportSubjectRow } from "./learnerReportPdfTypes";

function clampMark(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function guessOverallAverage(subjects: LearnerReportSubjectRow[]): number | null {
  if (!subjects.length) return null;
  const sum = subjects.reduce((acc, r) => acc + (Number.isFinite(r.mark) ? r.mark : 0), 0);
  return Math.round((sum / subjects.length) * 10) / 10;
}

function placeholderSubjects(): LearnerReportSubjectRow[] {
  return [
    { subject: "English Home Language", mark: 0, scoreText: "—", comment: "Result data not yet connected" },
    { subject: "Mathematics", mark: 0, scoreText: "—", comment: "Result data not yet connected" },
    { subject: "Natural Sciences", mark: 0, scoreText: "—", comment: "Result data not yet connected" },
    { subject: "Life Orientation", mark: 0, scoreText: "—", comment: "Result data not yet connected" },
  ];
}

export async function buildLearnerReportPdfInput(
  schoolId: string,
  learnerId: string
): Promise<LearnerReportPdfInput | null> {
  const learner = await prisma.learner.findFirst({
    where: { id: learnerId, ...activeLearnerWhere(schoolId) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      grade: true,
      className: true,
    },
  });
  if (!learner) return null;

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      name: true,
      email: true,
      phone: true,
      cellNo: true,
      address: true,
      logoUrl: true,
    },
  });
  if (!school) return null;

  const reportRow = await prisma.learnerReport.findFirst({
    where: { schoolId, learnerId },
    orderBy: { updatedAt: "desc" },
  });

  const resultRows = await prisma.learnerResult.findMany({
    where: { schoolId, learnerId },
    orderBy: [{ term: "desc" }, { subject: "asc" }],
  });

  const term =
    String(reportRow?.term || "").trim() ||
    String(resultRows[0]?.term || "").trim() ||
    "Current Term";

  const termResults = resultRows.filter((r) => String(r.term || "").trim() === term);
  const sourceResults = termResults.length ? termResults : resultRows;

  let subjects: LearnerReportSubjectRow[] = sourceResults.map((r) => {
    const mark = clampMark(Number(r.mark ?? r.percentage ?? 0));
    return {
      subject: String(r.subject || "Subject").trim() || "Subject",
      mark,
      scoreText: `${mark}%`,
      comment: String(r.comment || "—").trim() || "—",
    };
  });

  if (!subjects.length) subjects = placeholderSubjects();

  const overallAverage =
    reportRow?.overallAverage != null
      ? clampMark(Number(reportRow.overallAverage))
      : guessOverallAverage(subjects.filter((s) => s.mark > 0));

  return {
    school: {
      name: String(school.name || "School").trim() || "School",
      email: String(school.email || "").trim() || undefined,
      phone: String(school.phone || school.cellNo || "").trim() || undefined,
      address: String(school.address || "").trim() || undefined,
      logoUrl: String(school.logoUrl || "").trim() || undefined,
    },
    learner: {
      firstName: String(learner.firstName || "").trim(),
      lastName: String(learner.lastName || "").trim(),
      grade: String(learner.grade || "").trim(),
      className: String(learner.className || "").trim(),
    },
    term,
    overallAverage,
    attendancePercent:
      reportRow?.attendancePercent != null ? clampMark(Number(reportRow.attendancePercent)) : null,
    classTeacherRemark: reportRow?.classTeacherRemark
      ? String(reportRow.classTeacherRemark).trim()
      : null,
    principalRemark: reportRow?.principalRemark ? String(reportRow.principalRemark).trim() : null,
    subjects: subjects.slice(0, 16),
    reportDate: new Date().toISOString().slice(0, 10),
  };
}

export function learnerReportPdfFilename(firstName: string, lastName: string): string {
  const base = `${firstName}-${lastName}`.replace(/[^\w.-]+/g, "_").replace(/_+/g, "_");
  return `${base || "learner"}-report.pdf`;
}
