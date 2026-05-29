import crypto from "crypto";
import fs from "fs";
import path from "path";

import { prisma } from "../../prisma";
import type { DbLearnerForParentMatch } from "../daSilvaMigration/daSilvaParentLearnerMatching";
import {
  isFemaleGender,
  isMaleGender,
  normalizeLearnerGender,
  pickLearnerGenderForWrite,
} from "../../utils/learnerGender";
import { buildLearnerRepairIndexes, matchImportedLearnerToLive } from "./learnerRepairMatch";
import { parseSasamsLearnerUploadFile } from "./parseSasamsUpload";

const SESSION_ROOT = path.join(process.cwd(), "uploads", "migration-centre", "learner-gender-repair");
const PREVIEW_SAMPLE = 200;

export type LearnerGenderRepairPreviewRow = {
  importKey: string;
  importedLearnerLabel: string;
  importedClass: string | null;
  matchedLearnerId: string | null;
  currentLearnerName: string;
  currentGender: string | null;
  importedGender: string | null;
  matchType: string;
  action: string;
  ambiguous: boolean;
};

export type MigrationLearnerGenderRepairPreview = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  sessionId: string;
  fileName: string;
  canApply: boolean;
  counts: {
    totalRows: number;
    matched: number;
    ambiguous: number;
    noMatch: number;
    boysDetected: number;
    girlsDetected: number;
    genderUpdates: number;
    boysAfter: number;
    girlsAfter: number;
    boysBefore: number;
    girlsBefore: number;
  };
  rows: LearnerGenderRepairPreviewRow[];
};

type PendingGenderUpdate = {
  learnerId: string;
  gender: "Male" | "Female";
};

type SessionPayload = {
  schoolId: string;
  fileName: string;
  createdAt: string;
  updates: PendingGenderUpdate[];
  stats: {
    skipped: number;
    ambiguous: number;
  };
};

function sessionPath(schoolId: string, sessionId: string): string {
  return path.join(SESSION_ROOT, schoolId, `${sessionId}.json`);
}

function newSessionId(): string {
  return `lgr-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function formatMatchType(strategy: string | null, ambiguous: boolean): string {
  if (ambiguous) return "Ambiguous";
  switch (strategy) {
    case "id_number":
      return "SA ID number";
    case "admission_number":
      return "Admission number";
    case "name_surname_classroom":
      return "Name + classroom";
    case "name_surname":
      return "Name + surname";
    default:
      return strategy ? strategy.replace(/_/g, " ") : "—";
  }
}

function resolveAction(opts: {
  ambiguous: boolean;
  matched: boolean;
  willUpdateGender: boolean;
}): string {
  if (opts.ambiguous) return "Skip — ambiguous";
  if (!opts.matched) return "Skip — no match";
  if (opts.willUpdateGender) return "Update gender";
  return "Skip — no change";
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

export async function previewMigrationLearnerGenderRepair(opts: {
  schoolId: string;
  uploadFilePath: string;
  originalFileName: string;
}): Promise<MigrationLearnerGenderRepairPreview> {
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
  const previewRows: LearnerGenderRepairPreviewRow[] = [];
  const pendingByLearner = new Map<string, PendingGenderUpdate>();

  let matched = 0;
  let ambiguous = 0;
  let noMatch = 0;
  let genderUpdates = 0;
  let boysDetected = 0;
  let girlsDetected = 0;

  const simulatedGender = new Map<string, string | null>(
    dbLearners.map((l) => [l.id, l.gender])
  );

  for (const imported of importedRows) {
    const importKey = imported.matchKey;
    const importedLearnerLabel =
      imported.fullName || `${imported.firstName} ${imported.lastName}`.trim();
    const importedClass = imported.canonicalClassName || imported.className || null;
    const importedGenderNorm = normalizeLearnerGender(imported.gender);

    if (isMaleGender(imported.gender)) boysDetected += 1;
    else if (isFemaleGender(imported.gender)) girlsDetected += 1;

    const match = matchImportedLearnerToLive(imported, indexes);

    if (match.ambiguous) {
      ambiguous += 1;
      previewRows.push({
        importKey,
        importedLearnerLabel,
        importedClass,
        matchedLearnerId: null,
        currentLearnerName: "",
        currentGender: null,
        importedGender: importedGenderNorm,
        matchType: formatMatchType(match.strategy, true),
        action: resolveAction({ ambiguous: true, matched: false, willUpdateGender: false }),
        ambiguous: true,
      });
      continue;
    }

    if (!match.learnerId) {
      noMatch += 1;
      previewRows.push({
        importKey,
        importedLearnerLabel,
        importedClass,
        matchedLearnerId: null,
        currentLearnerName: "",
        currentGender: null,
        importedGender: importedGenderNorm,
        matchType: "No match",
        action: resolveAction({ ambiguous: false, matched: false, willUpdateGender: false }),
        ambiguous: false,
      });
      continue;
    }

    matched += 1;
    const existing = learnersById.get(match.learnerId);
    if (!existing) continue;

    const genderToWrite = pickLearnerGenderForWrite({
      existingGender: existing.gender,
      gender: imported.gender,
      idNumber: imported.idNumber ?? existing.idNumber,
    });
    const willUpdateGender = Boolean(genderToWrite);

    if (willUpdateGender) {
      genderUpdates += 1;
      simulatedGender.set(match.learnerId, genderToWrite!);
      pendingByLearner.set(match.learnerId, {
        learnerId: match.learnerId,
        gender: genderToWrite!,
      });
    }

    previewRows.push({
      importKey,
      importedLearnerLabel,
      importedClass,
      matchedLearnerId: match.learnerId,
      currentLearnerName: `${existing.firstName} ${existing.lastName}`.trim(),
      currentGender: existing.gender,
      importedGender: importedGenderNorm,
      matchType: formatMatchType(match.strategy, false),
      action: resolveAction({
        ambiguous: false,
        matched: true,
        willUpdateGender,
      }),
      ambiguous: false,
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
    stats: {
      skipped: matched - updates.length,
      ambiguous,
    },
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
      totalRows: importedRows.length,
      matched,
      ambiguous,
      noMatch,
      boysDetected,
      girlsDetected,
      genderUpdates,
      boysBefore: beforeAudit.boys,
      girlsBefore: beforeAudit.girls,
      boysAfter,
      girlsAfter,
    },
    rows: previewRows.slice(0, PREVIEW_SAMPLE),
  };
}

export async function applyMigrationLearnerGenderRepair(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<{
  success: boolean;
  schoolId: string;
  fileName: string;
  updatedLearners: number;
  boys: number;
  girls: number;
  skipped: number;
  ambiguous: number;
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
    throw new Error("No gender updates to apply");
  }

  await prisma.$transaction(async (tx) => {
    for (const row of updates) {
      await tx.learner.update({
        where: { id: row.learnerId, schoolId },
        data: { gender: row.gender },
      });
    }
  });

  try {
    fs.unlinkSync(file);
  } catch {
    /* ignore */
  }

  const audit = await genderAudit(schoolId);

  return {
    success: true,
    schoolId,
    fileName: payload.fileName,
    updatedLearners: updates.length,
    boys: audit.boys,
    girls: audit.girls,
    skipped: payload.stats?.skipped ?? 0,
    ambiguous: payload.stats?.ambiguous ?? 0,
  };
}
