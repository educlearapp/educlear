/**
 * Immutable school binding for Universal Migration stages (Phase 1C).
 * Stage.targetSchoolId is authoritative; client school ids may only confirm it.
 */

import type { MigrationStage } from "../types/MigrationStage";
import type { PersistentMigrationSession } from "./migrationSessionStore";

export const MIGRATION_SCHOOL_MISMATCH = "MIGRATION_SCHOOL_MISMATCH" as const;
export const MIGRATION_STAGE_UNBOUND = "MIGRATION_STAGE_UNBOUND" as const;
export const MIGRATION_SCHOOL_REQUIRED = "MIGRATION_SCHOOL_REQUIRED" as const;
export const MIGRATION_UPLOAD_SCHOOL_MISMATCH = "MIGRATION_UPLOAD_SCHOOL_MISMATCH" as const;

export class MigrationSchoolBindingError extends Error {
  readonly code:
    | typeof MIGRATION_SCHOOL_MISMATCH
    | typeof MIGRATION_STAGE_UNBOUND
    | typeof MIGRATION_SCHOOL_REQUIRED
    | typeof MIGRATION_UPLOAD_SCHOOL_MISMATCH;

  constructor(
    code:
      | typeof MIGRATION_SCHOOL_MISMATCH
      | typeof MIGRATION_STAGE_UNBOUND
      | typeof MIGRATION_SCHOOL_REQUIRED
      | typeof MIGRATION_UPLOAD_SCHOOL_MISMATCH,
    message: string
  ) {
    super(message);
    this.name = "MigrationSchoolBindingError";
    this.code = code;
  }
}

function cleanString(v: unknown): string {
  return String(v ?? "").trim();
}

/** Bound school on a stage — required for apply/preflight/expectations. */
export function getStageBoundSchoolId(stage: MigrationStage): string {
  return cleanString(stage.targetSchoolId);
}

/**
 * Resolve the school that apply/preflight must use.
 * Prefers immutable stage binding. Optional client targetSchoolId must match when present.
 */
export function resolveBoundTargetSchoolId(opts: {
  stage: MigrationStage;
  requestedTargetSchoolId?: string | null;
}): string {
  const bound = getStageBoundSchoolId(opts.stage);
  if (!bound) {
    throw new MigrationSchoolBindingError(
      MIGRATION_STAGE_UNBOUND,
      `${MIGRATION_STAGE_UNBOUND}: This dry run has no immutable school binding. Re-create the dry run with a target school selected.`
    );
  }

  const requested = cleanString(opts.requestedTargetSchoolId);
  if (requested && requested !== bound) {
    throw new MigrationSchoolBindingError(
      MIGRATION_SCHOOL_MISMATCH,
      `${MIGRATION_SCHOOL_MISMATCH}: Dry run is locked to school ${bound}; request targeted ${requested}. No school writes occurred.`
    );
  }

  return bound;
}

export function assertRequestedSchoolMatchesBatch(opts: {
  batchTargetSchoolId: string;
  requestedTargetSchoolId: string;
  action: string;
}): void {
  const bound = cleanString(opts.batchTargetSchoolId);
  const requested = cleanString(opts.requestedTargetSchoolId);
  if (!requested) {
    throw new MigrationSchoolBindingError(
      MIGRATION_SCHOOL_REQUIRED,
      `${MIGRATION_SCHOOL_REQUIRED}: targetSchoolId is required for ${opts.action}`
    );
  }
  if (bound !== requested) {
    throw new MigrationSchoolBindingError(
      MIGRATION_SCHOOL_MISMATCH,
      `${MIGRATION_SCHOOL_MISMATCH}: Batch is locked to school ${bound}; request targeted ${requested}. No writes occurred.`
    );
  }
}

/**
 * Uploaded file paths used in a stage must belong to the target school's migration session.
 * Prevents attaching School A uploads to a School B dry run via manipulated requests.
 */
export function assertStagePathsBelongToSchoolSession(opts: {
  targetSchoolId: string;
  session: PersistentMigrationSession | null;
  previews: Array<{ path?: string | null; fileId?: string | null }>;
}): void {
  const schoolId = cleanString(opts.targetSchoolId);
  const allowedPaths = new Set<string>();
  const allowedFileIds = new Set<string>();

  if (opts.session) {
    for (const file of opts.session.uploadedFiles || []) {
      const p = cleanString(file.path);
      if (p) allowedPaths.add(p);
      const id = cleanString(file.id);
      if (id) allowedFileIds.add(id);
    }
    for (const preview of opts.session.previews || []) {
      const p = cleanString(preview.path);
      if (p) allowedPaths.add(p);
      const id = cleanString(preview.fileId);
      if (id) allowedFileIds.add(id);
    }
  }

  for (const preview of opts.previews) {
    const pathValue = cleanString(preview.path);
    if (!pathValue) continue;
    if (!opts.session) {
      throw new MigrationSchoolBindingError(
        MIGRATION_UPLOAD_SCHOOL_MISMATCH,
        `${MIGRATION_UPLOAD_SCHOOL_MISMATCH}: Cannot stage file paths for school ${schoolId} without an upload session for that school.`
      );
    }
    if (!allowedPaths.has(pathValue)) {
      throw new MigrationSchoolBindingError(
        MIGRATION_UPLOAD_SCHOOL_MISMATCH,
        `${MIGRATION_UPLOAD_SCHOOL_MISMATCH}: Upload path is not part of school ${schoolId} migration session. No stage created.`
      );
    }
    const fileId = cleanString(preview.fileId);
    if (fileId && allowedFileIds.size > 0 && !allowedFileIds.has(fileId)) {
      throw new MigrationSchoolBindingError(
        MIGRATION_UPLOAD_SCHOOL_MISMATCH,
        `${MIGRATION_UPLOAD_SCHOOL_MISMATCH}: Upload fileId is not part of school ${schoolId} migration session. No stage created.`
      );
    }
  }
}
