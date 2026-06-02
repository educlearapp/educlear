export type LearnerReportSubjectRow = {
  subject: string;
  mark: number;
  scoreText: string;
  comment: string;
};

export type LearnerReportPdfInput = {
  school: {
    name: string;
    email?: string;
    phone?: string;
    address?: string;
    logoUrl?: string;
  };
  learner: {
    firstName: string;
    lastName: string;
    grade: string;
    className: string;
  };
  term: string;
  overallAverage: number | null;
  attendancePercent: number | null;
  classTeacherRemark: string | null;
  principalRemark: string | null;
  subjects: LearnerReportSubjectRow[];
  reportDate: string;
};
