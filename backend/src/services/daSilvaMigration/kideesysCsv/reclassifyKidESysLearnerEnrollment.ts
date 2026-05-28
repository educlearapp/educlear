import fs from "fs";
import path from "path";

import { PrismaClient } from "@prisma/client";

import { normalizeClassroomInput } from "../../../utils/classroomNormalization";
import { classifyKidESysChildRow } from "./kideesysChildClassifier";
import {
  buildSasamsGenderIndex,
  mergeKidESysChildIdManifests,
  pickChildIdFromRow,
  resolveChildIdToLearnerMap,
  resolveLearnerGenderFromSources,
  type SasamsGenderIndex,
} from "./kideesysChildLearnerResolve";
import { loadKidESysCsvBundle, parseCsvFile, pickCsvField, type KidESysCsvBundle } from "./kideesysCsvParser";

export type ReclassifyKidESysResult = {
  schoolId: string;
  sourcePath: string;
  csvChildRows: number;
  csvUniqueChildIds: number;
  manifestMapped: number;
  resolvedMapped: number;
  splitFromSharedLearner: number;
  created: number;
  updated: number;
  activeAfter: number;
  historicalAfter: number;
  genderBackfilled: number;
  dryRun: boolean;
};

/** One child_id → one learner; split siblings wrongly merged via account_no. */
async function splitSharedLearnersPerChildId(opts: {
  prisma: PrismaClient;
  schoolId: string;
  childIdToLearnerId: Map<string, string>;
  childById: Map<string, Record<string, string>>;
  accountLearnerSeq: Map<string, number>;
  dryRun: boolean;
}): Promise<number> {
  const learnerToChildIds = new Map<string, string[]>();
  for (const [childId, learnerId] of opts.childIdToLearnerId) {
    const list = learnerToChildIds.get(learnerId) || [];
    list.push(childId);
    learnerToChildIds.set(learnerId, list);
  }

  let split = 0;
  for (const [, childIds] of learnerToChildIds) {
    if (childIds.length <= 1) continue;
    childIds.sort();
    for (let i = 1; i < childIds.length; i++) {
      const childId = childIds[i];
      const row = opts.childById.get(childId);
      if (!row) continue;
      opts.childIdToLearnerId.delete(childId);
      const newId = await ensureLearnerForChildRow({
        prisma: opts.prisma,
        schoolId: opts.schoolId,
        childId,
        row,
        childIdToLearnerId: opts.childIdToLearnerId,
        accountLearnerSeq: opts.accountLearnerSeq,
        dryRun: opts.dryRun,
      });
      if (newId && !newId.startsWith("dry-run-")) split += 1;
    }
  }
  return split;
}

function findLatestKidESysManifest(schoolId: string): Record<string, unknown> | null {
  const stagingRoot = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  if (!fs.existsSync(stagingRoot)) return null;
  const candidates = fs
    .readdirSync(stagingRoot)
    .filter((name) => name.startsWith("kideesys-csv-") && name.endsWith(".manifest.json"))
    .map((name) => ({
      name,
      mtime: fs.statSync(path.join(stagingRoot, name)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates.length) return null;
  return JSON.parse(
    fs.readFileSync(path.join(stagingRoot, candidates[0].name), "utf8")
  ) as Record<string, unknown>;
}

function parseBirthDate(raw: string | null | undefined): Date | null {
  const v = String(raw || "").trim();
  if (!v) return null;
  const d = new Date(v.includes("/") ? v.replace(/\//g, "-") : v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function seedAccountLearnerSeqFromExisting(
  existing: Array<{ admissionNo: string | null }>
): Map<string, number> {
  const accountLearnerSeq = new Map<string, number>();
  for (const row of existing) {
    const adm = String(row.admissionNo || "").trim();
    if (!adm) continue;
    const dash = adm.indexOf("-");
    if (dash === -1) {
      accountLearnerSeq.set(adm, Math.max(accountLearnerSeq.get(adm) || 0, 1));
      continue;
    }
    const base = adm.slice(0, dash);
    const seq = Number.parseInt(adm.slice(dash + 1), 10);
    if (base && Number.isFinite(seq)) {
      accountLearnerSeq.set(base, Math.max(accountLearnerSeq.get(base) || 0, seq));
    }
  }
  return accountLearnerSeq;
}

function allocateAdmissionNo(accountNo: string, seq: Map<string, number>): string | null {
  const trimmed = String(accountNo || "").trim();
  if (!trimmed) return null;
  const next = (seq.get(trimmed) || 0) + 1;
  seq.set(trimmed, next);
  return next === 1 ? trimmed : `${trimmed}-${next}`;
}

async function ensureLearnerForChildRow(opts: {
  prisma: PrismaClient;
  schoolId: string;
  childId: string;
  row: Record<string, string>;
  childIdToLearnerId: Map<string, string>;
  accountLearnerSeq: Map<string, number>;
  dryRun: boolean;
}): Promise<string | null> {
  const existing = opts.childIdToLearnerId.get(opts.childId);
  if (existing) return existing;

  const firstName = pickCsvField(opts.row, ["child_name", "first_name", "firstname", "name"]);
  const lastName = pickCsvField(opts.row, [
    "child_surname",
    "last_name",
    "lastname",
    "surname",
    "family_name",
  ]);
  const accountNo =
    pickCsvField(opts.row, [
      "account_no",
      "account_number",
      "account_ref",
      "account_id",
      "billing_account",
      "account",
    ]) || null;

  const classification = classifyKidESysChildRow(opts.row);
  const isHistorical = classification.enrollmentStatus === "HISTORICAL";
  const norm = normalizeClassroomInput(
    classification.hasValidClassroom ? classification.classroomRaw : ""
  );
  const canonicalClassName = isHistorical
    ? null
    : norm.classroomName || classification.classroomRaw || null;
  const grade = isHistorical
    ? "Historical"
    : norm.gradeLabel ||
      classification.classroomRaw.replace(/[A-Za-z]+$/, "").trim() ||
      "Unknown";

  const idNumber =
    pickCsvField(opts.row, ["child_id_no", "id_number", "identity_number", "id_no", "sa_id"]) || null;
  const birthRaw = pickCsvField(opts.row, [
    "date_of_birth",
    "dob",
    "birth_date",
    "birthdate",
    "birthday",
  ]);

  const admissionNo = accountNo ? allocateAdmissionNo(accountNo, opts.accountLearnerSeq) : null;

  if (opts.dryRun) {
    const placeholder = `dry-run-${opts.childId}`;
    opts.childIdToLearnerId.set(opts.childId, placeholder);
    return placeholder;
  }

  const created = await opts.prisma.learner.create({
    data: {
      schoolId: opts.schoolId,
      firstName: firstName || "Unknown",
      lastName: lastName || "",
      birthDate: parseBirthDate(birthRaw),
      idNumber,
      grade,
      className: canonicalClassName,
      enrollmentStatus: classification.enrollmentStatus,
      admissionNo,
      totalFee: 0,
      tuitionFee: 0,
    },
    select: { id: true },
  });
  opts.childIdToLearnerId.set(opts.childId, created.id);
  return created.id;
}

async function applyCsvRowToLearner(opts: {
  prisma: PrismaClient;
  schoolId: string;
  learnerId: string;
  row: Record<string, string>;
  sasams: SasamsGenderIndex;
  dryRun: boolean;
}): Promise<{ genderBackfilled: boolean }> {
  const classification = classifyKidESysChildRow(opts.row);
  const isHistorical = classification.enrollmentStatus === "HISTORICAL";
  const norm = normalizeClassroomInput(
    classification.hasValidClassroom ? classification.classroomRaw : ""
  );
  const canonicalClassName = isHistorical
    ? null
    : norm.classroomName || classification.classroomRaw || null;
  const grade = isHistorical
    ? "Historical"
    : norm.gradeLabel ||
      classification.classroomRaw.replace(/[A-Za-z]+$/, "").trim() ||
      "Unknown";

  const firstName = pickCsvField(opts.row, ["child_name", "first_name", "firstname", "name"]);
  const lastName = pickCsvField(opts.row, [
    "child_surname",
    "last_name",
    "lastname",
    "surname",
    "family_name",
  ]);
  const idNumber =
    pickCsvField(opts.row, ["child_id_no", "id_number", "identity_number", "id_no", "sa_id"]) || null;
  const birthRaw = pickCsvField(opts.row, [
    "date_of_birth",
    "dob",
    "birth_date",
    "birthdate",
    "birthday",
  ]);

  const existing = await opts.prisma.learner.findUnique({
    where: { id: opts.learnerId },
    select: { gender: true, schoolId: true, firstName: true, lastName: true },
  });
  if (!existing || existing.schoolId !== opts.schoolId) {
    return { genderBackfilled: false };
  }

  const resolvedFirst = firstName || existing.firstName;
  const resolvedLast = lastName || existing.lastName;
  const gender = resolveLearnerGenderFromSources({
    existingGender: existing.gender,
    idNumber,
    firstName: resolvedFirst,
    lastName: resolvedLast,
    sasams: opts.sasams,
  });

  const data: {
    enrollmentStatus: "ACTIVE" | "HISTORICAL";
    className: string | null;
    grade: string;
    firstName?: string;
    lastName?: string;
    idNumber?: string | null;
    birthDate?: Date | null;
    gender?: string | null;
  } = {
    enrollmentStatus: classification.enrollmentStatus,
    className: canonicalClassName,
    grade,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    idNumber,
    birthDate: parseBirthDate(birthRaw),
  };

  const hadGender = Boolean(String(existing.gender || "").trim());
  if (gender) {
    data.gender = gender;
  }

  if (!opts.dryRun) {
    await opts.prisma.learner.update({ where: { id: opts.learnerId }, data });
  }

  return { genderBackfilled: Boolean(gender) && !hadGender };
}

export async function reclassifyKidESysLearnerEnrollment(opts: {
  prisma: PrismaClient;
  schoolId: string;
  sourcePath: string;
  dryRun?: boolean;
  manifest?: Record<string, unknown> | null;
  sasamsDesktopRoot?: string;
}): Promise<ReclassifyKidESysResult> {
  const { prisma, schoolId, sourcePath, dryRun = false } = opts;
  const bundle: KidESysCsvBundle = loadKidESysCsvBundle(sourcePath);
  const sasamsRoot = opts.sasamsDesktopRoot || path.dirname(bundle.sourcePath) || sourcePath;
  const sasams = buildSasamsGenderIndex(sasamsRoot);

  const latestManifest = opts.manifest ?? findLatestKidESysManifest(schoolId);
  const mergedManifest = {
    ...mergeKidESysChildIdManifests(schoolId),
    ...((latestManifest?.childIdToLearnerId || {}) as Record<string, string>),
  };

  const childIdToLearnerId = await resolveChildIdToLearnerMap({
    prisma,
    schoolId,
    bundle,
    manifestMap: mergedManifest,
  });

  const childFile = bundle.filesFound.child;
  const rawRows = parseCsvFile(childFile);
  const childById = new Map<string, Record<string, string>>();
  for (const row of rawRows) {
    const childId = pickChildIdFromRow(row);
    if (childId) childById.set(childId, row);
  }

  const existingAdmissionRows = await prisma.learner.findMany({
    where: { schoolId, admissionNo: { not: null } },
    select: { admissionNo: true },
  });
  const accountLearnerSeq = seedAccountLearnerSeqFromExisting(existingAdmissionRows);

  const splitCount = await splitSharedLearnersPerChildId({
    prisma,
    schoolId,
    childIdToLearnerId,
    childById,
    accountLearnerSeq,
    dryRun,
  });

  let created = 0;
  let updated = 0;
  let genderBackfilled = 0;

  for (const [childId, row] of childById) {
    let learnerId = childIdToLearnerId.get(childId);
    if (!learnerId) {
      const newId = await ensureLearnerForChildRow({
        prisma,
        schoolId,
        childId,
        row,
        childIdToLearnerId,
        accountLearnerSeq,
        dryRun,
      });
      if (newId) {
        learnerId = newId;
        created += 1;
      }
    }
    if (!learnerId || learnerId.startsWith("dry-run-")) continue;

    const { genderBackfilled: gb } = await applyCsvRowToLearner({
      prisma,
      schoolId,
      learnerId,
      row,
      sasams,
      dryRun,
    });
    if (gb) genderBackfilled += 1;
    updated += 1;
  }

  if (!dryRun) {
    const stagingRoot = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
    if (fs.existsSync(stagingRoot)) {
      for (const name of fs.readdirSync(stagingRoot)) {
        if (!name.startsWith("kideesys-csv-") || !name.endsWith(".manifest.json")) continue;
        const manifestPath = path.join(stagingRoot, name);
        try {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
          manifest.childIdToLearnerId = Object.fromEntries(childIdToLearnerId);
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch {
          /* non-fatal */
        }
      }
    }
  }

  const activeAfter = await prisma.learner.count({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
  });
  const historicalAfter = await prisma.learner.count({
    where: { schoolId, enrollmentStatus: "HISTORICAL" },
  });

  return {
    schoolId,
    sourcePath,
    csvChildRows: rawRows.length,
    csvUniqueChildIds: childById.size,
    manifestMapped: Object.keys(mergedManifest).length,
    resolvedMapped: childIdToLearnerId.size,
    splitFromSharedLearner: splitCount,
    created,
    updated,
    activeAfter,
    historicalAfter,
    genderBackfilled,
    dryRun,
  };
}
