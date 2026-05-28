import fs from "fs";
import path from "path";

import type { PrismaClient } from "@prisma/client";

import { normalizeClassroomInput } from "../../../utils/classroomNormalization";
import { normalizeLearnerGender, resolveLearnerGender } from "../../../utils/learnerGender";
import { resolveDaSilvaSasamsPaths } from "../daSilvaMigrationStrategy";
import { parseSasamsClassListDirectory, parseSasamsLearnerRegister } from "../sasamsParsers";
import type { KidESysCsvBundle } from "./kideesysCsvParser";
import { pickCsvField } from "./kideesysCsvParser";

export type SasamsGenderIndex = {
  byIdNumber: Map<string, "Male" | "Female">;
  byNameKey: Map<string, "Male" | "Female">;
};

function nameKey(firstName: string, lastName: string): string {
  return `${String(firstName || "").trim().toLowerCase()}|${String(lastName || "").trim().toLowerCase()}`;
}

function normalizeIdKey(idNumber: string | null | undefined): string {
  return String(idNumber || "").replace(/\D/g, "");
}

/** SA-SAMS class lists + learner register → gender lookup (child.csv has no gender column). */
export function buildSasamsGenderIndex(desktopRoot: string): SasamsGenderIndex {
  const byIdNumber = new Map<string, "Male" | "Female">();
  const byNameKey = new Map<string, "Male" | "Female">();

  const ingest = (firstName: string, lastName: string, idNumber: string | null, genderRaw: string | null) => {
    const gender = normalizeLearnerGender(genderRaw);
    if (!gender) return;
    const idKey = normalizeIdKey(idNumber);
    if (idKey.length >= 10) byIdNumber.set(idKey, gender);
    const nk = nameKey(firstName, lastName);
    if (nk !== "|") byNameKey.set(nk, gender);
  };

  try {
    const paths = resolveDaSilvaSasamsPaths(desktopRoot);
    if (fs.existsSync(paths.classListDir)) {
      const { learners } = parseSasamsClassListDirectory(paths.classListDir);
      for (const l of learners) {
        ingest(l.firstName, l.lastName, l.idNumber, l.gender);
      }
    }
    if (fs.existsSync(paths.learnerRegister)) {
      const registerLearners = parseSasamsLearnerRegister(paths.learnerRegister);
      for (const l of registerLearners) {
        ingest(l.firstName, l.lastName, l.idNumber, l.gender);
      }
    }
  } catch {
    /* optional enrichment — CSV classification still runs */
  }

  return { byIdNumber, byNameKey };
}

export function lookupSasamsGender(
  index: SasamsGenderIndex,
  opts: { firstName: string; lastName: string; idNumber?: string | null }
): "Male" | "Female" | null {
  const idKey = normalizeIdKey(opts.idNumber);
  if (idKey.length >= 10) {
    const fromId = index.byIdNumber.get(idKey);
    if (fromId) return fromId;
  }
  return index.byNameKey.get(nameKey(opts.firstName, opts.lastName)) || null;
}

export function resolveLearnerGenderFromSources(opts: {
  existingGender?: string | null;
  idNumber?: string | null;
  firstName?: string;
  lastName?: string;
  sasams?: SasamsGenderIndex | null;
}): "Male" | "Female" | null {
  const preserved = normalizeLearnerGender(opts.existingGender);
  if (preserved) return preserved;

  if (opts.sasams && opts.firstName != null && opts.lastName != null) {
    const fromSasams = lookupSasamsGender(opts.sasams, {
      firstName: opts.firstName,
      lastName: opts.lastName,
      idNumber: opts.idNumber,
    });
    if (fromSasams) return fromSasams;
  }

  return resolveLearnerGender({ gender: null, idNumber: opts.idNumber });
}

export function mergeKidESysChildIdManifests(schoolId: string): Record<string, string> {
  const merged: Record<string, string> = {};
  const stagingRoot = path.join(process.cwd(), "uploads", "migration-staging", schoolId);
  if (!fs.existsSync(stagingRoot)) return merged;

  for (const name of fs.readdirSync(stagingRoot)) {
    if (!name.endsWith(".manifest.json")) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(stagingRoot, name), "utf8")) as Record<
        string,
        unknown
      >;
      const map = (raw.childIdToLearnerId || {}) as Record<string, string>;
      for (const [childId, learnerId] of Object.entries(map)) {
        if (childId && learnerId) merged[childId] = learnerId;
      }
    } catch {
      /* skip corrupt manifest */
    }
  }
  return merged;
}

function buildLearnerNameClassIndex(
  learners: Array<{
    id: string;
    firstName: string;
    lastName: string;
    className: string | null;
    admissionNo: string | null;
  }>
): {
  byAdmission: Map<string, string>;
  byNameClass: Map<string, string>;
  byNameOnly: Map<string, string>;
} {
  const byAdmission = new Map<string, string>();
  const byNameClass = new Map<string, string>();
  const byNameOnly = new Map<string, string>();

  for (const l of learners) {
    const adm = String(l.admissionNo || "").trim();
    if (adm) byAdmission.set(adm, l.id);
    const base = adm.includes("-") ? adm.slice(0, adm.indexOf("-")) : adm;
    if (base) byAdmission.set(base, l.id);

    const nk = nameKey(l.firstName, l.lastName);
    const cls = String(l.className || "").trim().toLowerCase();
    if (nk !== "|") {
      byNameOnly.set(nk, l.id);
      if (cls) byNameClass.set(`${nk}|${cls}`, l.id);
    }
  }

  return { byAdmission, byNameClass, byNameOnly };
}

/**
 * Resolve every child.csv child_id to a DB learner id.
 * Uses merged manifests, then account_no/admission, then name+class, then name-only.
 */
export async function resolveChildIdToLearnerMap(opts: {
  prisma: PrismaClient;
  schoolId: string;
  bundle: KidESysCsvBundle;
  manifestMap?: Record<string, string>;
}): Promise<Map<string, string>> {
  const { prisma, schoolId, bundle } = opts;
  const out = new Map<string, string>(Object.entries(opts.manifestMap || {}));

  const dbLearners = await prisma.learner.findMany({
    where: { schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      admissionNo: true,
    },
  });
  const index = buildLearnerNameClassIndex(dbLearners);

  for (const child of bundle.children) {
    const childId = String(child.childId || "").trim();
    if (!childId || out.has(childId)) continue;

    const norm = normalizeClassroomInput(child.className);
    const className = norm.classroomName || child.className || "";
    const clsKey = className.trim().toLowerCase();
    const nk = nameKey(child.firstName, child.lastName);
    const byNc = index.byNameClass.get(`${nk}|${clsKey}`);
    if (byNc) {
      out.set(childId, byNc);
      continue;
    }

    const byName = index.byNameOnly.get(nk);
    if (byName) out.set(childId, byName);
  }

  return out;
}

export function pickChildIdFromRow(row: Record<string, string>): string {
  return pickCsvField(row, ["child_id", "id", "childid", "learner_id"]);
}
