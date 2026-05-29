import crypto from "crypto";
import fs from "fs";
import path from "path";

import { prisma } from "../../prisma";
import type { DbLearnerForParentMatch } from "../daSilvaMigration/daSilvaParentLearnerMatching";
import {
  isFemaleGender,
  isMaleGender,
  normalizeLearnerGender,
} from "../../utils/learnerGender";
import { deduplicateImportedLearners } from "./deduplicateImportedLearners";
import {
  buildLearnerRepairIndexes,
  diagnoseLearnerRepairNoMatch,
  matchImportedLearnerToLive,
} from "./learnerRepairMatch";
import {
  buildLearnerRepairWritePatch,
  describeLearnerRepairAction,
  learnerRepairPatchHasChanges,
  type LearnerRepairWritePatch,
} from "./learnerRepairWrite";
import { parseSasamsLearnerUploadFile } from "./parseSasamsUpload";

const SESSION_ROOT = path.join(process.cwd(), "uploads", "migration-centre", "learner-gender-repair");
const PREVIEW_SAMPLE = 200;
const MAX_UPLOAD_FILES = 50;

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
  closestLearnerName?: string | null;
  closestSimilarityPercent?: number | null;
  noMatchReason?: string | null;
};

export type MigrationLearnerGenderRepairPreview = {
  success: boolean;
  schoolId: string;
  schoolName: string;
  sessionId: string;
  fileName: string;
  fileNames: string[];
  filesUploaded: number;
  canApply: boolean;
  counts: {
    totalRows: number;
    rawRowsParsed: number;
    matched: number;
    ambiguous: number;
    noMatch: number;
    boysDetected: number;
    girlsDetected: number;
    updatesToApply: number;
    genderUpdates: number;
    idNumberUpdates: number;
    classUpdates: number;
    boysAfter: number;
    girlsAfter: number;
    boysBefore: number;
    girlsBefore: number;
  };
  rows: LearnerGenderRepairPreviewRow[];
};

type PendingLearnerUpdate = {
  learnerId: string;
} & LearnerRepairWritePatch;

type SessionPayload = {
  schoolId: string;
  fileName: string;
  fileNames: string[];
  createdAt: string;
  updates: PendingLearnerUpdate[];
  stats: {
    skipped: number;
    ambiguous: number;
  };
};

export type MigrationLearnerRepairUploadFile = {
  uploadFilePath: string;
  originalFileName: string;
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
    case "full_name_classroom":
      return "Full name + class";
    case "name_surname_classroom":
      return "First + surname + class";
    case "full_name":
      return "Full name";
    case "name_surname":
      return "First + surname";
    case "surname_classroom":
      return "Surname + class";
    case "fuzzy_name":
      return "Fuzzy name (90%+)";
    case "relaxed_name":
      return "Relaxed name (90%+)";
    default:
      return strategy ? strategy.replace(/_/g, " ") : "—";
  }
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

function parseAndCombineUploads(files: MigrationLearnerRepairUploadFile[]) {
  if (!files.length) throw new Error("At least one file required");
  if (files.length > MAX_UPLOAD_FILES) {
    throw new Error(`Too many files (max ${MAX_UPLOAD_FILES})`);
  }

  const fileNames: string[] = [];
  const combined: ReturnType<typeof parseSasamsLearnerUploadFile> = [];

  for (const file of files) {
    const name = String(file.originalFileName || "").trim() || path.basename(file.uploadFilePath);
    fileNames.push(name);
    const rows = parseSasamsLearnerUploadFile(file.uploadFilePath);
    combined.push(...rows);
  }

  const rawRowCount = combined.length;
  const importedRows = deduplicateImportedLearners(combined);
  if (!importedRows.length) {
    throw new Error("No learner rows parsed from uploaded files");
  }

  return { fileNames, rawRowCount, importedRows };
}

export async function previewMigrationLearnerGenderRepair(opts: {
  schoolId: string;
  uploadFilePath: string;
  originalFileName: string;
}): Promise<MigrationLearnerGenderRepairPreview> {
  return previewMigrationLearnerGenderRepairFromFiles({
    schoolId: opts.schoolId,
    files: [
      { uploadFilePath: opts.uploadFilePath, originalFileName: opts.originalFileName },
    ],
  });
}

export async function previewMigrationLearnerGenderRepairFromFiles(opts: {
  schoolId: string;
  files: MigrationLearnerRepairUploadFile[];
}): Promise<MigrationLearnerGenderRepairPreview> {
  const schoolId = String(opts.schoolId || "").trim();
  if (!schoolId) throw new Error("schoolId required");

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) throw new Error("School not found");

  const { fileNames, rawRowCount, importedRows } = parseAndCombineUploads(opts.files);

  const dbLearners = await loadActiveLearners(schoolId);
  const indexes = buildLearnerRepairIndexes(dbLearners as DbLearnerForParentMatch[]);
  const learnersById = new Map(dbLearners.map((l) => [l.id, l]));

  const beforeAudit = await genderAudit(schoolId);
  const previewRows: LearnerGenderRepairPreviewRow[] = [];
  const pendingByLearner = new Map<string, PendingLearnerUpdate>();

  let matched = 0;
  let ambiguous = 0;
  let noMatch = 0;
  let updatesToApply = 0;
  let genderUpdates = 0;
  let idNumberUpdates = 0;
  let classUpdates = 0;
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
        action: describeLearnerRepairAction({
          ambiguous: true,
          matched: false,
          patch: {},
        }),
        ambiguous: true,
      });
      continue;
    }

    if (!match.learnerId) {
      noMatch += 1;
      const diagnostic = diagnoseLearnerRepairNoMatch(imported, indexes);
      previewRows.push({
        importKey,
        importedLearnerLabel,
        importedClass,
        matchedLearnerId: null,
        currentLearnerName: "",
        currentGender: null,
        importedGender: importedGenderNorm,
        matchType: "No match",
        action: describeLearnerRepairAction({
          ambiguous: false,
          matched: false,
          patch: {},
        }),
        ambiguous: false,
        closestLearnerName: diagnostic.closestLearnerName || null,
        closestSimilarityPercent: diagnostic.similarityPercent,
        noMatchReason: diagnostic.rejectionReason,
      });
      continue;
    }

    matched += 1;
    const existing = learnersById.get(match.learnerId);
    if (!existing) continue;

    const patch = buildLearnerRepairWritePatch({
      existingGender: existing.gender,
      existingIdNumber: existing.idNumber,
      existingClassName: existing.className,
      grade: existing.grade,
      importedGender: imported.gender,
      importedIdNumber: imported.idNumber,
      importedClassName: imported.canonicalClassName || imported.className,
    });
    const willApply = learnerRepairPatchHasChanges(patch);

    if (willApply) {
      updatesToApply += 1;
      if (patch.gender) {
        genderUpdates += 1;
        simulatedGender.set(match.learnerId, patch.gender);
      }
      if (patch.idNumber) idNumberUpdates += 1;
      if (patch.className) classUpdates += 1;

      const prior = pendingByLearner.get(match.learnerId);
      pendingByLearner.set(match.learnerId, {
        learnerId: match.learnerId,
        gender: patch.gender ?? prior?.gender,
        idNumber: patch.idNumber ?? prior?.idNumber,
        className: patch.className ?? prior?.className,
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
      action: describeLearnerRepairAction({
        ambiguous: false,
        matched: true,
        patch,
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
    fileName: fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`,
    fileNames,
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
    fileName: payload.fileName,
    fileNames,
    filesUploaded: fileNames.length,
    canApply: updates.length > 0,
    counts: {
      totalRows: importedRows.length,
      rawRowsParsed: rawRowCount,
      matched,
      ambiguous,
      noMatch,
      boysDetected,
      girlsDetected,
      updatesToApply,
      genderUpdates,
      idNumberUpdates,
      classUpdates,
      boysBefore: beforeAudit.boys,
      girlsBefore: beforeAudit.girls,
      boysAfter,
      girlsAfter,
    },
    rows: previewRows
      .sort((a, b) => {
        const aNo = a.matchType === "No match" ? 0 : 1;
        const bNo = b.matchType === "No match" ? 0 : 1;
        return aNo - bNo;
      })
      .slice(0, PREVIEW_SAMPLE),
  };
}

export async function applyMigrationLearnerGenderRepair(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<{
  success: boolean;
  schoolId: string;
  fileName: string;
  fileNames: string[];
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
    throw new Error("No learner updates to apply");
  }

  const BATCH_SIZE = 40;
  const txOptions = { maxWait: 30_000, timeout: 120_000 } as const;

  for (let offset = 0; offset < updates.length; offset += BATCH_SIZE) {
    const batch = updates.slice(offset, offset + BATCH_SIZE);
    await prisma.$transaction(async (tx) => {
      for (const row of batch) {
        const data: { gender?: string; idNumber?: string; className?: string } = {};
        if (row.gender) data.gender = row.gender;
        if (row.idNumber) data.idNumber = row.idNumber;
        if (row.className) data.className = row.className;
        if (!Object.keys(data).length) continue;

        await tx.learner.update({
          where: { id: row.learnerId, schoolId },
          data,
        });
      }
    }, txOptions);
  }

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
    fileNames: payload.fileNames || [payload.fileName],
    updatedLearners: updates.length,
    boys: audit.boys,
    girls: audit.girls,
    skipped: payload.stats?.skipped ?? 0,
    ambiguous: payload.stats?.ambiguous ?? 0,
  };
}
