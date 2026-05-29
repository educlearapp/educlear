import crypto from "crypto";
import fs from "fs";
import path from "path";

import { prisma } from "../../prisma";
import type { DbLearnerForParentMatch } from "../daSilvaMigration/daSilvaParentLearnerMatching";
import { normalizeClassroomInput } from "../../utils/classroomNormalization";
import {
  isFemaleGender,
  isMaleGender,
  normalizeLearnerGender,
  pickLearnerGenderForWrite,
} from "../../utils/learnerGender";
import { buildLearnerRepairIndexes, matchImportedLearnerToLive } from "./learnerRepairMatch";
import { parseSasamsLearnerUploadFile } from "./parseSasamsUpload";

const SESSION_ROOT = path.join(process.cwd(), "uploads", "migration-centre", "learner-repair");
const PREVIEW_SAMPLE = 120;

export type LearnerRepairPreviewRow = {
  importKey: string;
  learnerLabel: string;
  matchedLearnerId: string | null;
  matchedLearnerName: string;
  currentGender: string | null;
  importedGender: string | null;
  currentClassroom: string | null;
  importedClassroom: string | null;
  currentIdNumber: string | null;
  importedIdNumber: string | null;
  status: string;
  willUpdateGender: boolean;
  willUpdateClassroom: boolean;
  willUpdateIdNumber: boolean;
};

export type MigrationLearnerRepairPreview = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  sessionId: string;
  fileName: string;
  canApply: boolean;
  counts: {
    sourceRows: number;
    matched: number;
    unmatched: number;
    genderFixes: number;
    classroomFixes: number;
    idFixes: number;
    boysAfter: number;
    girlsAfter: number;
    boysBefore: number;
    girlsBefore: number;
  };
  rows: LearnerRepairPreviewRow[];
  unmatched: Array<{ importKey: string; learnerLabel: string }>;
};

type PendingUpdate = {
  learnerId: string;
  gender?: "Male" | "Female";
  className?: string;
  grade?: string;
  idNumber?: string;
  birthDate?: Date;
  homeLanguage?: string;
  citizenship?: string;
  admissionNo?: string;
};

type SessionPayload = {
  schoolId: string;
  fileName: string;
  createdAt: string;
  updates: PendingUpdate[];
};

function sessionPath(schoolId: string, sessionId: string): string {
  return path.join(SESSION_ROOT, schoolId, `${sessionId}.json`);
}

function newSessionId(): string {
  return `lr-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function pickString(
  incoming: string | null | undefined,
  existing: string | null | undefined
): string | undefined {
  const inc = String(incoming ?? "").trim();
  if (!inc) return undefined;
  const cur = String(existing ?? "").trim();
  if (cur === inc) return undefined;
  return inc;
}

function pickMissingString(
  incoming: string | null | undefined,
  existing: string | null | undefined
): string | undefined {
  const inc = String(incoming ?? "").trim();
  if (!inc) return undefined;
  const cur = String(existing ?? "").trim();
  if (cur) return undefined;
  return inc;
}

async function loadActiveLearners(schoolId: string) {
  return prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      grade: true,
      admissionNo: true,
      idNumber: true,
      gender: true,
      birthDate: true,
      homeLanguage: true,
      citizenship: true,
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
}

async function genderAudit(schoolId: string) {
  const active = await prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    select: { gender: true },
  });
  const boys = active.filter((l) => isMaleGender(l.gender)).length;
  const girls = active.filter((l) => isFemaleGender(l.gender)).length;
  return { boys, girls };
}

export async function previewMigrationLearnerRepair(opts: {
  schoolId: string;
  uploadFilePath: string;
  originalFileName: string;
}): Promise<MigrationLearnerRepairPreview> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw new Error("schoolId required");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const importedRows = parseSasamsLearnerUploadFile(opts.uploadFilePath);
  if (!importedRows.length) {
    throw new Error("No learner rows parsed from file");
  }

  const dbLearners = await loadActiveLearners(schoolId);
  const indexes = buildLearnerRepairIndexes(dbLearners as DbLearnerForParentMatch[]);
  const learnersById = new Map(dbLearners.map((l) => [l.id, l]));

  const beforeAudit = await genderAudit(schoolId);
  const previewRows: LearnerRepairPreviewRow[] = [];
  const unmatched: Array<{ importKey: string; learnerLabel: string }> = [];
  const pendingByLearner = new Map<string, PendingUpdate>();

  let genderFixes = 0;
  let classroomFixes = 0;
  let idFixes = 0;
  let matched = 0;

  const simulatedGender = new Map<string, string | null>(
    dbLearners.map((l) => [l.id, l.gender])
  );

  for (const imported of importedRows) {
    const importKey = imported.matchKey;
    const learnerLabel = imported.fullName || `${imported.firstName} ${imported.lastName}`.trim();
    const match = matchImportedLearnerToLive(imported, indexes);

    if (!match.learnerId || match.ambiguous) {
      unmatched.push({
        importKey,
        learnerLabel,
      });
      previewRows.push({
        importKey,
        learnerLabel,
        matchedLearnerId: null,
        matchedLearnerName: "",
        currentGender: null,
        importedGender: normalizeLearnerGender(imported.gender),
        currentClassroom: null,
        importedClassroom: imported.canonicalClassName || imported.className || null,
        currentIdNumber: imported.idNumber,
        importedIdNumber: imported.idNumber,
        status: match.ambiguous ? "Ambiguous" : "Unmatched",
        willUpdateGender: false,
        willUpdateClassroom: false,
        willUpdateIdNumber: false,
      });
      continue;
    }

    matched += 1;
    const existing = learnersById.get(match.learnerId);
    if (!existing) continue;

    const importedGender = normalizeLearnerGender(imported.gender);
    const importedClass =
      imported.canonicalClassName || imported.className || null;
    const normImportedClass = importedClass
      ? normalizeClassroomInput(importedClass).classroomName || importedClass
      : null;

    const genderToWrite = pickLearnerGenderForWrite({
      existingGender: existing.gender,
      gender: imported.gender,
      idNumber: imported.idNumber ?? existing.idNumber,
    });
    const classToWrite = pickString(normImportedClass, existing.className);
    const idToWrite = pickString(imported.idNumber, existing.idNumber);
    const gradeToWrite = imported.grade
      ? pickString(
          normalizeClassroomInput(imported.className || importedClass || "").gradeLabel ||
            imported.grade,
          existing.grade
        )
      : undefined;

    const willUpdateGender = Boolean(genderToWrite);
    const willUpdateClassroom = Boolean(classToWrite);
    const willUpdateIdNumber = Boolean(idToWrite);

    if (willUpdateGender) {
      genderFixes += 1;
      simulatedGender.set(match.learnerId, genderToWrite!);
    }
    if (willUpdateClassroom) classroomFixes += 1;
    if (willUpdateIdNumber) idFixes += 1;

    const hasPending =
      willUpdateGender ||
      willUpdateClassroom ||
      willUpdateIdNumber ||
      Boolean(
        pickMissingString(imported.language, existing.homeLanguage) ||
          pickMissingString(imported.citizenship, existing.citizenship) ||
          pickMissingString(imported.admissionNo, existing.admissionNo)
      );

    if (hasPending) {
      const pending: PendingUpdate = {
        learnerId: match.learnerId,
        ...(genderToWrite ? { gender: genderToWrite } : {}),
        ...(classToWrite ? { className: classToWrite } : {}),
        ...(gradeToWrite ? { grade: gradeToWrite } : {}),
        ...(idToWrite ? { idNumber: idToWrite } : {}),
        ...(imported.birthDate && !existing.birthDate
          ? { birthDate: imported.birthDate }
          : {}),
        ...(pickMissingString(imported.language, existing.homeLanguage)
          ? { homeLanguage: pickMissingString(imported.language, existing.homeLanguage) }
          : {}),
        ...(pickMissingString(imported.citizenship, existing.citizenship)
          ? { citizenship: pickMissingString(imported.citizenship, existing.citizenship) }
          : {}),
        ...(pickMissingString(imported.admissionNo, existing.admissionNo)
          ? { admissionNo: pickMissingString(imported.admissionNo, existing.admissionNo) }
          : {}),
      };
      pendingByLearner.set(match.learnerId, pending);
    }

    const status =
      willUpdateGender || willUpdateClassroom || willUpdateIdNumber
        ? "Will update"
        : "Matched — no changes";

    previewRows.push({
      importKey,
      learnerLabel,
      matchedLearnerId: match.learnerId,
      matchedLearnerName: `${existing.firstName} ${existing.lastName}`,
      currentGender: existing.gender,
      importedGender,
      currentClassroom: existing.className,
      importedClassroom: normImportedClass,
      currentIdNumber: existing.idNumber,
      importedIdNumber: imported.idNumber,
      status,
      willUpdateGender,
      willUpdateClassroom,
      willUpdateIdNumber,
    });
  }

  let boysAfter = 0;
  let girlsAfter = 0;
  for (const gender of simulatedGender.values()) {
    if (isMaleGender(gender)) boysAfter += 1;
    else if (isFemaleGender(gender)) girlsAfter += 1;
  }

  const updates = [...pendingByLearner.values()];
  const sessionId = newSessionId();
  fs.mkdirSync(path.join(SESSION_ROOT, schoolId), { recursive: true });
  const payload: SessionPayload = {
    schoolId,
    fileName: opts.originalFileName,
    createdAt: new Date().toISOString(),
    updates,
  };
  fs.writeFileSync(sessionPath(schoolId, sessionId), JSON.stringify(payload, null, 2), "utf8");

  return {
    success: true,
    schoolId,
    schoolName: school.name,
    sessionId,
    fileName: opts.originalFileName,
    canApply: updates.length > 0,
    counts: {
      sourceRows: importedRows.length,
      matched,
      unmatched: unmatched.length,
      genderFixes,
      classroomFixes,
      idFixes,
      boysBefore: beforeAudit.boys,
      girlsBefore: beforeAudit.girls,
      boysAfter,
      girlsAfter,
    },
    rows: previewRows.slice(0, PREVIEW_SAMPLE),
    unmatched: unmatched.slice(0, PREVIEW_SAMPLE),
  };
}

export async function applyMigrationLearnerRepair(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<{
  success: boolean;
  schoolId: string;
  learnersUpdated: number;
  fileName: string;
}> {
  const schoolId = String(opts.schoolId || "").trim();
  const sessionId = String(opts.sessionId || "").trim();
  if (!schoolId || !sessionId) {
    throw new Error("schoolId and sessionId required");
  }

  const file = sessionPath(schoolId, sessionId);
  if (!fs.existsSync(file)) {
    throw new Error("Repair session expired or not found — run preview again");
  }

  let payload: SessionPayload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8")) as SessionPayload;
  } catch {
    throw new Error("Invalid repair session data");
  }

  if (payload.schoolId !== schoolId) {
    throw new Error("Session does not match school");
  }

  const updates = payload.updates || [];
  if (!updates.length) {
    throw new Error("No learner updates to apply");
  }

  await prisma.$transaction(async (tx) => {
    for (const row of updates) {
      const data: Record<string, unknown> = {};
      if (row.gender) data.gender = row.gender;
      if (row.className) data.className = row.className;
      if (row.grade) data.grade = row.grade;
      if (row.idNumber) data.idNumber = row.idNumber;
      if (row.birthDate) data.birthDate = row.birthDate;
      if (row.homeLanguage) data.homeLanguage = row.homeLanguage;
      if (row.citizenship) data.citizenship = row.citizenship;
      if (row.admissionNo) data.admissionNo = row.admissionNo;

      if (!Object.keys(data).length) continue;

      await tx.learner.update({
        where: { id: row.learnerId, schoolId },
        data,
      });
    }
  });

  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }

  return {
    success: true,
    schoolId,
    learnersUpdated: updates.length,
    fileName: payload.fileName,
  };
}
