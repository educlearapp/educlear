/**
 * Universal Migration ↔ Parent Identity Resolver bridge.
 * All Universal Migration parent writes must go through this path.
 */

import type { PrismaClient } from "@prisma/client";
import { normalizeSaPhone } from "../../parentPortalService";
import {
  buildParentIdentityReviewArtifact,
  isParentIdentityPreflightClear,
  loadSchoolParentCandidates,
  normalizeParentCellphone,
  normalizeParentIdentityNumber,
  runParentIdentityPreflight,
  type IncomingParentIdentity,
  type ParentIdentityPreflightReport,
  type ParentIdentityResolution,
  type PreflightIncomingRow,
  type SourceSystemKind,
} from "../parentIdentity";
import type { MigrationTargetField } from "../types/MigrationTargetField";

type MappedRow = Record<MigrationTargetField, string>;

export type UniversalParentRowContext = {
  fileId: string;
  filename: string;
  rowNumber: number;
  mapped: MappedRow;
  raw: Record<string, string>;
};

export type UniversalMigrationParentReviewContract = {
  status: "MIGRATION_REQUIRES_REVIEW" | "READY_TO_APPLY";
  message: string;
  counts: ParentIdentityPreflightReport["counts"];
  reviewQueue: ReturnType<typeof buildParentIdentityReviewArtifact>["reviewQueue"];
  conflictQueue: ReturnType<typeof buildParentIdentityReviewArtifact>["conflictQueue"];
  readyToReuse: ReturnType<typeof buildParentIdentityReviewArtifact>["readyToReuse"];
  readyToCreate: ReturnType<typeof buildParentIdentityReviewArtifact>["readyToCreate"];
  resolutionTemplate: ParentIdentityResolution[];
  allowedResolutions: Array<
    "LINK_TO_EXISTING_PARENT" | "CREATE_AS_NEW_PARENT" | "SKIP_HOLD"
  >;
  conflictNote: string;
};

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

function splitPersonName(fullOrSingle: string): { firstName: string; lastName: string } {
  const trimmed = cleanString(fullOrSingle);
  if (!trimmed) return { firstName: "", lastName: "" };
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts[0]!, lastName: parts.slice(1).join(" ") };
}

export function parentNamesFromMapped(mapped: MappedRow): { firstName: string; surname: string } {
  const explicitFirst = cleanString((mapped as MappedRow & { parentFirstName?: string }).parentFirstName);
  const explicitSurname = cleanString((mapped as MappedRow & { parentSurname?: string }).parentSurname);
  if (explicitFirst || explicitSurname) {
    return {
      firstName: explicitFirst || "Parent",
      surname: explicitSurname || "Guardian",
    };
  }
  const fromName = splitPersonName(cleanString(mapped.parentName));
  return {
    firstName: fromName.firstName || "Parent",
    surname: fromName.lastName || "Guardian",
  };
}

export function enrichParentMappedFromContactList(
  mapped: MappedRow,
  raw: Record<string, string>
): MappedRow {
  if (cleanString(mapped.parentPhone)) return mapped;
  const work = cleanString(raw["Work No"]);
  const home = cleanString(raw["Home No"]);
  if (work) return { ...mapped, parentPhone: work };
  if (home) return { ...mapped, parentPhone: home };
  return mapped;
}

export function mapSourceSystem(sourceSystem: string | null | undefined): SourceSystemKind {
  const s = String(sourceSystem || "").trim().toUpperCase();
  if (s.includes("SAMS") || s === "SA-SAMS") return "SA-SAMS";
  if (s.includes("KID") || s.includes("KIDEESYS") || s === "KID-E-SYS") return "KID-E-SYS";
  if (s.includes("MANUAL")) return "MANUAL";
  return "UNKNOWN";
}

export function learnerNamesFromMapped(mapped: MappedRow): { firstName: string; lastName: string } {
  const first = cleanString(mapped.firstName);
  const last = cleanString(mapped.lastName);
  if (first || last) return { firstName: first, lastName: last };
  return splitPersonName(cleanString(mapped.fullName));
}

/** Resolve an existing learner id for a parent-row link (read-only). */
export async function findLearnerIdForParentLinkRead(
  prisma: PrismaClient | { learner: { findFirst: Function } },
  schoolId: string,
  mapped: MappedRow
): Promise<string | null> {
  const names = learnerNamesFromMapped(mapped);
  if (!names.firstName && !names.lastName) return null;

  const idNumber = cleanString(mapped.idNumber) || null;
  const className = cleanString(mapped.classroom) || null;

  const existing = await prisma.learner.findFirst({
    where: {
      schoolId,
      ...(idNumber
        ? { idNumber }
        : {
            firstName: names.firstName,
            lastName: names.lastName || names.firstName,
            ...(className ? { className } : {}),
          }),
    },
    select: { id: true },
  });

  return existing?.id ?? null;
}

export function buildIncomingFromMapped(
  mapped: MappedRow,
  opts: {
    sourceSystem: SourceSystemKind;
    sourceFile?: string | null;
    sourceRow?: number | null;
    learnerLabel?: string | null;
    sourceParentId?: string | null;
  }
): IncomingParentIdentity {
  const names = parentNamesFromMapped(mapped);
  const mobile = cleanString(mapped.parentPhone);
  const parentIdNumber =
    cleanString((mapped as MappedRow & { parentIdNumber?: string }).parentIdNumber) || null;
  return {
    firstName: names.firstName,
    surname: names.surname,
    idNumber: parentIdNumber,
    cellNo: mobile || null,
    email: cleanString(mapped.parentEmail) || null,
    relationship: cleanString(mapped.relationship) || null,
    sourceSystem: opts.sourceSystem,
    sourceParentId: opts.sourceParentId || null,
    learnerLabel: opts.learnerLabel || null,
    sourceFile: opts.sourceFile || null,
    sourceRow: opts.sourceRow ?? null,
  };
}

/**
 * Build preflight rows for Universal Migration parent files.
 * Learner links resolve against current DB when possible (zero writes).
 */
export async function buildUniversalParentPreflightRows(opts: {
  prisma: PrismaClient | { learner: { findFirst: Function } };
  schoolId: string;
  sourceSystem: string;
  rows: UniversalParentRowContext[];
}): Promise<PreflightIncomingRow[]> {
  const sourceSystem = mapSourceSystem(opts.sourceSystem);
  const out: PreflightIncomingRow[] = [];

  for (const row of opts.rows) {
    const mapped = enrichParentMappedFromContactList(row.mapped, row.raw);
    const names = parentNamesFromMapped(mapped);
    const learnerNames = learnerNamesFromMapped(mapped);
    const learnerLabel = [learnerNames.firstName, learnerNames.lastName].filter(Boolean).join(" ");
    const mobile = cleanString(mapped.parentPhone);
    const phone = mobile ? normalizeSaPhone(mobile) : null;
    const cellNoForStorage =
      normalizeParentCellphone(mobile) || phone?.localCell || mobile || "0000000000";
    const cleanedId = normalizeParentIdentityNumber(
      cleanString((mapped as MappedRow & { parentIdNumber?: string }).parentIdNumber) || null
    );
    const workPhone = cleanString(
      (mapped as MappedRow & { parentWorkPhone?: string }).parentWorkPhone
    );

    const incoming = buildIncomingFromMapped(mapped, {
      sourceSystem,
      sourceFile: row.filename,
      sourceRow: row.rowNumber,
      learnerLabel: learnerLabel || null,
      sourceParentId: null,
    });
    // Ensure cleaned id used for matching
    incoming.idNumber = cleanedId;
    incoming.firstName = names.firstName;
    incoming.surname = names.surname;

    const learnerId = await findLearnerIdForParentLinkRead(opts.prisma, opts.schoolId, mapped);

    out.push({
      incoming,
      cellNoForStorage,
      workNo: workPhone || null,
      homeNo: null,
      link: learnerId
        ? {
            learnerId,
            relation: cleanString(mapped.relationship) || null,
            isPrimary: true,
            familyAccountId: null,
            cellNoForStorage,
            workNo: workPhone || null,
            homeNo: null,
          }
        : null,
    });
  }

  return out;
}

export async function runUniversalMigrationParentPreflight(opts: {
  prisma: PrismaClient;
  schoolId: string;
  sourceSystem: string;
  parentRows: UniversalParentRowContext[];
  resolutions?: ParentIdentityResolution[];
}): Promise<{
  report: ParentIdentityPreflightReport;
  reviewContract: UniversalMigrationParentReviewContract;
  clear: boolean;
}> {
  const candidates = await loadSchoolParentCandidates(opts.prisma, opts.schoolId);
  const rows = await buildUniversalParentPreflightRows({
    prisma: opts.prisma,
    schoolId: opts.schoolId,
    sourceSystem: opts.sourceSystem,
    rows: opts.parentRows,
  });
  const report = runParentIdentityPreflight({
    candidates,
    rows,
    resolutions: opts.resolutions,
  });
  const artifact = buildParentIdentityReviewArtifact(report);
  const reviewContract: UniversalMigrationParentReviewContract = {
    status: report.status,
    message: report.message,
    counts: report.counts,
    reviewQueue: artifact.reviewQueue,
    conflictQueue: artifact.conflictQueue,
    readyToReuse: artifact.readyToReuse,
    readyToCreate: artifact.readyToCreate,
    resolutionTemplate: artifact.resolutionTemplate,
    allowedResolutions: ["LINK_TO_EXISTING_PARENT", "CREATE_AS_NEW_PARENT", "SKIP_HOLD"],
    conflictNote:
      "CONFLICT requires explicit authorised resolution. No silent CREATE. Do not auto-merge.",
  };
  return {
    report,
    reviewContract,
    clear: isParentIdentityPreflightClear(report),
  };
}
