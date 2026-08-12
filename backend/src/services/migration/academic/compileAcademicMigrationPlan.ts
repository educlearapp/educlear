/**
 * Compile AcademicMigrationPlan from staged/source rows (zero writes).
 */

import { createHash, randomUUID } from "crypto";
import { normalizeClassroomInput } from "../../../utils/classroomNormalization";
import { mapAcademicColumns } from "./semanticFieldDetection";
import { normalizeGradeLabel, normalizeSubjectName } from "./normalizeAcademicValues";
import type {
  AcademicClassProposal,
  AcademicGradeProposal,
  AcademicGroupProposal,
  AcademicLearnerPlacement,
  AcademicMigrationPlan,
  AcademicStructureDiscovery,
  AcademicSubjectEnrollment,
  AcademicSubjectProposal,
  AcademicTeacherAssignment,
  SourceEvidence,
} from "./AcademicMigrationTypes";
import { ACADEMIC_MIGRATION_VERSION } from "./AcademicMigrationTypes";

function evidence(
  sourceValue: string,
  column: string | undefined,
  rowCount: number,
  file?: { fileId?: string; filename?: string }
): SourceEvidence {
  return {
    sourceFileId: file?.fileId,
    sourceFilename: file?.filename,
    column,
    sourceValue,
    rowCount,
  };
}

function learnerKey(row: {
  idNumber?: string;
  admissionNo?: string;
  name?: string;
}): string {
  const id = String(row.idNumber || "").replace(/\D/g, "");
  if (id) return `id:${id}`;
  const adm = String(row.admissionNo || "").trim().toUpperCase();
  if (adm) return `adm:${adm}`;
  return `name:${String(row.name || "").trim().toLowerCase()}`;
}

export function compileAcademicMigrationPlan(input: {
  targetSchoolId: string;
  stageId?: string | null;
  sourceAnalysisId?: string | null;
  compiledPlanId?: string | null;
  academicYearHint?: string | null;
  files: Array<{
    fileId: string;
    filename: string;
    columns: string[];
    rows: Record<string, string>[];
  }>;
  /** Existing classroom names at school (for reuse detection). */
  existingClassroomNames?: string[];
  existingSubjectNames?: string[];
  existingStaffEmails?: string[];
}): { discovery: AcademicStructureDiscovery; plan: AcademicMigrationPlan } {
  const gradeBag = new Map<string, AcademicGradeProposal>();
  const classBag = new Map<string, AcademicClassProposal>();
  const subjectBag = new Map<string, AcademicSubjectProposal>();
  const groupBag = new Map<string, AcademicGroupProposal>();
  const placements: AcademicLearnerPlacement[] = [];
  const enrollments: AcademicSubjectEnrollment[] = [];
  const teachers: AcademicTeacherAssignment[] = [];
  const warnings: string[] = [];

  const existingClassSet = new Set(
    (input.existingClassroomNames || []).map((n) => n.trim().toLowerCase())
  );
  const existingSubjectSet = new Set(
    (input.existingSubjectNames || []).map((n) => n.trim().toLowerCase())
  );
  const staffEmails = new Set(
    (input.existingStaffEmails || []).map((e) => e.trim().toLowerCase())
  );

  // Track per-learner class observations for ambiguity
  const learnerClassObs = new Map<
    string,
    {
      name: string;
      idNumber: string | null;
      admissionNo: string | null;
      classes: Map<string, { grade: string | null; year: string | null; count: number }>;
      subjects: string[];
    }
  >();

  let currentYearHint =
    String(input.academicYearHint || "").trim() ||
    String(new Date().getFullYear());

  for (const file of input.files) {
    const colMap = mapAcademicColumns(file.columns);
    for (let i = 0; i < file.rows.length; i++) {
      const row = file.rows[i]!;
      const gradeRaw = colMap.grade ? String(row[colMap.grade] || "").trim() : "";
      const classRaw = colMap.classroom ? String(row[colMap.classroom] || "").trim() : "";
      const subjectRaw = colMap.subject ? String(row[colMap.subject] || "").trim() : "";
      const groupRaw = colMap.group ? String(row[colMap.group] || "").trim() : "";
      const yearRaw = colMap.academicYear
        ? String(row[colMap.academicYear] || "").trim()
        : "";
      const teacherName = colMap.teacherName
        ? String(row[colMap.teacherName] || "").trim()
        : "";
      const teacherEmail = colMap.teacherEmail
        ? String(row[colMap.teacherEmail] || "").trim()
        : "";
      const idNumber = colMap.learnerId ? String(row[colMap.learnerId] || "").trim() : "";
      const admissionNo = colMap.admissionNo
        ? String(row[colMap.admissionNo] || "").trim()
        : "";
      const learnerName = colMap.learnerName
        ? String(row[colMap.learnerName] || "").trim()
        : "";

      if (yearRaw && /^\d{4}$/.test(yearRaw)) {
        // prefer max year as current context candidate
        if (parseInt(yearRaw, 10) >= parseInt(currentYearHint, 10)) {
          currentYearHint = yearRaw;
        }
      }

      if (gradeRaw) {
        const g = normalizeGradeLabel(gradeRaw);
        const key = g.normalizeKey || gradeRaw.toLowerCase();
        const existing = gradeBag.get(key);
        if (existing) {
          existing.learnerCount += 1;
          existing.evidence[0]!.rowCount += 1;
        } else {
          gradeBag.set(key, {
            proposalId: `agrade_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
            sourceValue: gradeRaw,
            proposedLabel: g.proposedLabel || gradeRaw,
            normalizeKey: key,
            confidence: g.confidence,
            matchState: g.matchState,
            learnerCount: 1,
            evidence: [evidence(gradeRaw, colMap.grade, 1, file)],
            warnings: g.warnings,
            existingEduClearReuse: false,
          });
        }
      }

      if (classRaw) {
        const norm = normalizeClassroomInput(classRaw);
        const key = norm.matchKey || norm.classroomName.toLowerCase();
        const hist =
          Boolean(norm.importYear) &&
          String(norm.importYear) !== currentYearHint &&
          Boolean(yearRaw) &&
          yearRaw !== currentYearHint;
        const existing = classBag.get(key);
        if (existing) {
          existing.learnerCount += 1;
          existing.evidence[0]!.rowCount += 1;
          if (hist) existing.isHistoricalSuspect = true;
        } else {
          const reuse = existingClassSet.has(norm.classroomName.toLowerCase());
          classBag.set(key, {
            proposalId: `aclass_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
            sourceValue: classRaw,
            proposedClassroomName: norm.classroomName,
            matchKey: key,
            gradeLabel: norm.gradeLabel || (gradeRaw ? normalizeGradeLabel(gradeRaw).proposedLabel : null),
            confidence: norm.needsConfirmation ? "MEDIUM" : "HIGH",
            matchState: norm.needsConfirmation ? "REVIEW_REQUIRED" : "AUTO_MATCH",
            learnerCount: 1,
            evidence: [evidence(classRaw, colMap.classroom, 1, file)],
            warnings: [...norm.warnings],
            existingClassroomId: reuse ? "existing" : null,
            importYear: norm.importYear,
            isHistoricalSuspect: hist,
          });
        }
      }

      if (subjectRaw) {
        // Support multi-subject cells separated by ; or |
        const parts = subjectRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean);
        for (const part of parts) {
          const s = normalizeSubjectName(part);
          const key = s.normalizeKey || part.toLowerCase();
          const existing = subjectBag.get(key);
          if (existing) {
            existing.learnerCount += 1;
            existing.evidence[0]!.rowCount += 1;
          } else {
            const reuse = existingSubjectSet.has(s.proposedName.toLowerCase());
            subjectBag.set(key, {
              proposalId: `asubj_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
              sourceValue: part,
              proposedName: s.proposedName || part,
              normalizeKey: key,
              subjectCode: colMap.subjectCode
                ? String(row[colMap.subjectCode] || "").trim() || null
                : null,
              confidence: s.confidence,
              matchState: s.matchState,
              learnerCount: 1,
              evidence: [evidence(part, colMap.subject, 1, file)],
              warnings: s.warnings,
              existingSubjectId: reuse ? "existing" : null,
              possibleDuplicateOf: s.possibleDuplicateKey,
            });
          }
        }
      }

      if (groupRaw) {
        const key = groupRaw.toLowerCase().replace(/\s+/g, " ");
        const looksLikeClass = /grade|gr\s*\d|\d[a-z]\b/i.test(groupRaw);
        const existing = groupBag.get(key);
        if (existing) {
          existing.learnerCount += 1;
        } else {
          groupBag.set(key, {
            proposalId: `agrp_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
            sourceValue: groupRaw,
            proposedName: groupRaw,
            confidence: looksLikeClass ? "LOW" : "MEDIUM",
            matchState: "REVIEW_REQUIRED",
            severity: looksLikeClass ? "CRITICAL" : "NON_CRITICAL",
            learnerCount: 1,
            evidence: [evidence(groupRaw, colMap.group, 1, file)],
            warnings: looksLikeClass
              ? ["Source ‘group’ looks like a classroom — do not import as EduClear Group."]
              : ["Confirm this is an EduClear Group (not a homeroom)."],
            safeToApplyAsGroup: !looksLikeClass,
          });
        }
      }

      if (idNumber || admissionNo || learnerName) {
        const key = learnerKey({ idNumber, admissionNo, name: learnerName });
        let obs = learnerClassObs.get(key);
        if (!obs) {
          obs = {
            name: learnerName || key,
            idNumber: idNumber || null,
            admissionNo: admissionNo || null,
            classes: new Map(),
            subjects: [],
          };
          learnerClassObs.set(key, obs);
        }
        if (classRaw || gradeRaw) {
          const norm = classRaw ? normalizeClassroomInput(classRaw) : null;
          const ckey = norm?.classroomName || classRaw || "";
          const year = yearRaw || (norm?.importYear ? String(norm.importYear) : null);
          const prev = obs.classes.get(ckey) || {
            grade: gradeRaw || null,
            year,
            count: 0,
          };
          prev.count += 1;
          obs.classes.set(ckey, prev);
        }
        if (subjectRaw) {
          for (const part of subjectRaw.split(/[;|]/).map((s) => s.trim()).filter(Boolean)) {
            obs.subjects.push(part);
            const s = normalizeSubjectName(part);
            enrollments.push({
              enrollmentId: `aenr_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
              learnerKey: key,
              sourceSubject: part,
              proposedSubjectName: s.proposedName || part,
              scope: "LEARNER_LEVEL",
              persistMode: "UNSUPPORTED_LEARNER_ENROLLMENT",
              confidence: s.confidence,
              matchState: "REVIEW_REQUIRED",
              severity: "NON_CRITICAL",
              warnings: [
                "EduClear has no learner-level subject enrollment model — subject will be added to the school catalog only; per-learner selection is recorded for review.",
              ],
            });
          }
        }
      }

      if (teacherName || teacherEmail) {
        const email = teacherEmail.toLowerCase();
        const matched = email && staffEmails.has(email);
        teachers.push({
          assignmentId: `atch_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
          sourceTeacherName: teacherName || teacherEmail,
          sourceTeacherEmail: teacherEmail || null,
          proposedClassroomName: classRaw
            ? normalizeClassroomInput(classRaw).classroomName
            : null,
          state: matched
            ? "MATCHED_EXISTING"
            : teacherEmail
              ? "PROPOSED_NEW_STAFF"
              : "REVIEW_REQUIRED",
          severity: matched ? "INFO" : "NON_CRITICAL",
          confidence: matched ? "HIGH" : "LOW",
          matchedUserId: matched ? "existing-email" : null,
          warnings: matched
            ? []
            : [
                "Teacher not auto-created in Phase 1J — match existing staff or resolve later. Loose name matching will not create duplicates.",
              ],
          applyAllowed: Boolean(matched),
        });
      }
    }
  }

  // Build placements from learner observations
  let clear = 0;
  let ambiguous = 0;
  let none = 0;
  for (const [key, obs] of learnerClassObs) {
    const classEntries = [...obs.classes.entries()].filter(([c]) => c);
    // Prefer current-year classes
    const currentClasses = classEntries.filter(([, v]) => !v.year || v.year === currentYearHint);
    const candidates = currentClasses.length ? currentClasses : classEntries;

    if (candidates.length === 0) {
      none += 1;
      placements.push({
        placementId: `aplc_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        learnerKey: key,
        learnerIdNumber: obs.idNumber,
        admissionNo: obs.admissionNo,
        learnerName: obs.name,
        sourceGrade: null,
        sourceClass: null,
        proposedClassroomName: null,
        proposedGrade: null,
        state: "UNPLACED",
        severity: "CRITICAL",
        confidence: "LOW",
        warnings: ["No class supplied for this learner."],
        evidence: [],
        canonicalLearnerId: null,
        academicYear: null,
      });
      continue;
    }

    if (candidates.length > 1) {
      ambiguous += 1;
      placements.push({
        placementId: `aplc_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        learnerKey: key,
        learnerIdNumber: obs.idNumber,
        admissionNo: obs.admissionNo,
        learnerName: obs.name,
        sourceGrade: candidates[0]![1].grade,
        sourceClass: candidates.map(([c]) => c).join(" | "),
        proposedClassroomName: null,
        proposedGrade: candidates[0]![1].grade,
        state: "REVIEW_REQUIRED",
        severity: "CRITICAL",
        confidence: "LOW",
        warnings: [
          `Multiple class placements found (${candidates.map(([c]) => c).join(", ")}) — confirm the current class.`,
        ],
        evidence: candidates.map(([c]) => evidence(c, "classroom", candidates.find((x) => x[0] === c)![1].count)),
        canonicalLearnerId: null,
        academicYear: currentYearHint,
      });
      continue;
    }

    const [cname, meta] = candidates[0]!;
    const histOnly =
      Boolean(meta.year) &&
      meta.year !== currentYearHint &&
      currentClasses.length === 0 &&
      classEntries.some(([, v]) => v.year && v.year !== currentYearHint);

    if (histOnly) {
      ambiguous += 1;
      placements.push({
        placementId: `aplc_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        learnerKey: key,
        learnerIdNumber: obs.idNumber,
        admissionNo: obs.admissionNo,
        learnerName: obs.name,
        sourceGrade: meta.grade,
        sourceClass: cname,
        proposedClassroomName: null,
        proposedGrade: meta.grade,
        state: "REVIEW_REQUIRED",
        severity: "CRITICAL",
        confidence: "MEDIUM",
        warnings: [
          `Class appears historical (year ${meta.year}) — not auto-placed as current.`,
        ],
        evidence: [evidence(cname, "classroom", meta.count)],
        canonicalLearnerId: null,
        academicYear: meta.year,
      });
      continue;
    }

    clear += 1;
    const gradeNorm = meta.grade ? normalizeGradeLabel(meta.grade) : null;
    placements.push({
      placementId: `aplc_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      learnerKey: key,
      learnerIdNumber: obs.idNumber,
      admissionNo: obs.admissionNo,
      learnerName: obs.name,
      sourceGrade: meta.grade,
      sourceClass: cname,
      proposedClassroomName: cname,
      proposedGrade: gradeNorm?.proposedLabel || meta.grade,
      state: "MATCHED",
      severity: "INFO",
      confidence: "HIGH",
      warnings: [],
      evidence: [evidence(cname, "classroom", meta.count)],
      canonicalLearnerId: null,
      academicYear: meta.year || currentYearHint,
    });
  }

  const grades = [...gradeBag.values()];
  const classes = [...classBag.values()];
  const subjects = [...subjectBag.values()];
  const groups = [...groupBag.values()];

  // Duplicate subject detection (Maths vs Mathematics already merged by key; flag medium English etc.)
  const possibleDupes = subjects.filter((s) => s.matchState === "REVIEW_REQUIRED").length;

  const reviewItems: AcademicMigrationPlan["reviewItems"] = [];
  for (const g of grades) {
    if (g.matchState === "REVIEW_REQUIRED" || g.matchState === "UNRESOLVED") {
      reviewItems.push({
        kind: "grade",
        proposalId: g.proposalId,
        message: `Grade “${g.sourceValue}” needs confirmation → proposed “${g.proposedLabel}”.`,
        severity: "CRITICAL",
      });
    }
  }
  for (const c of classes) {
    if (c.matchState === "REVIEW_REQUIRED" || c.isHistoricalSuspect) {
      reviewItems.push({
        kind: "class",
        proposalId: c.proposalId,
        message: `Class “${c.sourceValue}” needs confirmation → proposed “${c.proposedClassroomName}”.`,
        severity: "CRITICAL",
      });
    }
  }
  for (const p of placements) {
    if (p.state !== "MATCHED") {
      reviewItems.push({
        kind: "placement",
        proposalId: p.placementId,
        message: `${p.learnerName}: ${p.warnings[0] || p.state}`,
        severity: p.severity,
      });
    }
  }
  for (const s of subjects) {
    if (s.matchState === "REVIEW_REQUIRED") {
      reviewItems.push({
        kind: "subject",
        proposalId: s.proposalId,
        message: `Subject “${s.sourceValue}” → “${s.proposedName}” needs confirmation.`,
        severity: "NON_CRITICAL",
      });
    }
  }
  for (const g of groups) {
    reviewItems.push({
      kind: "group",
      proposalId: g.proposalId,
      message: g.warnings[0] || `Group “${g.sourceValue}” needs review.`,
      severity: g.severity,
    });
  }
  for (const t of teachers) {
    if (t.state !== "MATCHED_EXISTING") {
      reviewItems.push({
        kind: "teacher",
        proposalId: t.assignmentId,
        message: t.warnings[0] || `Teacher “${t.sourceTeacherName}” needs review.`,
        severity: t.severity,
      });
    }
  }

  const criticalUnresolvedCount = reviewItems.filter((r) => r.severity === "CRITICAL").length;
  const nonCriticalUnresolvedCount = reviewItems.filter(
    (r) => r.severity === "NON_CRITICAL"
  ).length;

  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        grades: grades.map((g) => g.normalizeKey).sort(),
        classes: classes.map((c) => c.matchKey).sort(),
        subjects: subjects.map((s) => s.normalizeKey).sort(),
        placements: placements.map((p) => `${p.learnerKey}:${p.proposedClassroomName}`).sort(),
      })
    )
    .digest("hex")
    .slice(0, 24);

  const discovery: AcademicStructureDiscovery = {
    discoveryId: `adisc_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: ACADEMIC_MIGRATION_VERSION,
    generatedAt: new Date().toISOString(),
    targetSchoolId: input.targetSchoolId,
    stageId: input.stageId || null,
    detectedGrades: grades.length,
    detectedClasses: classes.length,
    detectedSubjects: subjects.length,
    detectedGroups: groups.length,
    learnersWithClearPrimaryClass: clear,
    learnersWithAmbiguousClass: ambiguous,
    learnersWithNoClass: none,
    subjectsConfident: subjects.filter((s) => s.confidence === "HIGH").length,
    possibleDuplicateSubjects: possibleDupes,
    teacherLinksConfident: teachers.filter((t) => t.state === "MATCHED_EXISTING").length,
    teacherLinksNeedingReview: teachers.filter((t) => t.state !== "MATCHED_EXISTING").length,
    plainLanguage: [
      `We found ${grades.length} grade${grades.length === 1 ? "" : "s"}.`,
      `We found ${classes.length} class${classes.length === 1 ? "" : "es"}.`,
      `${clear} learner${clear === 1 ? "" : "s"} can be placed automatically.`,
      `${ambiguous} learner${ambiguous === 1 ? "" : "s"} need you to confirm their class.`,
      `${none} learner${none === 1 ? "" : "s"} have no class supplied.`,
      subjects.length
        ? `We found ${subjects.length} subject${subjects.length === 1 ? "" : "s"} (${subjects.filter((s) => s.confidence === "HIGH").length} confident).`
        : "No subjects detected in this package.",
    ],
  };

  if (!grades.length && !classes.length) {
    warnings.push(
      "Partial/unknown academic source — structure incomplete rather than fabricated."
    );
  }

  const plan: AcademicMigrationPlan = {
    planId: `aplan_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    version: ACADEMIC_MIGRATION_VERSION,
    generatedAt: discovery.generatedAt,
    targetSchoolId: input.targetSchoolId,
    stageId: input.stageId || null,
    sourceAnalysisId: input.sourceAnalysisId || null,
    compiledPlanId: input.compiledPlanId || null,
    discoveryId: discovery.discoveryId,
    fingerprint,
    academicYearContext: currentYearHint,
    grades,
    classes,
    groups,
    subjects,
    learnerPlacements: placements,
    subjectEnrollments: enrollments,
    teacherAssignments: teachers,
    warnings,
    reviewItems,
    criticalUnresolvedCount,
    nonCriticalUnresolvedCount,
    stale: false,
  };

  return { discovery, plan };
}
