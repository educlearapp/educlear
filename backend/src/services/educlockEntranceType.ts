/**
 * EduClock entrance type labels for owner wizard.
 * Stored in EduClockEntrance.description as structured JSON (no schema change).
 * Clock GPS still uses EduClockEntrance lat/lng + radius only.
 */

export const EDUCLOCK_ENTRANCE_TYPE_CODES = [
  "MAIN_GATE",
  "HIGH_SCHOOL",
  "FOUNDATION_PHASE",
  "STAFF",
  "TRANSPORT",
  "VISITOR",
  "OTHER",
] as const;

export type EduClockEntranceTypeCode = (typeof EDUCLOCK_ENTRANCE_TYPE_CODES)[number];

export const EDUCLOCK_ENTRANCE_TYPE_LABELS: Record<EduClockEntranceTypeCode, string> = {
  MAIN_GATE: "Main Gate",
  HIGH_SCHOOL: "High School Entrance",
  FOUNDATION_PHASE: "Foundation Phase Entrance",
  STAFF: "Staff Entrance",
  TRANSPORT: "Transport Entrance",
  VISITOR: "Visitor Entrance",
  OTHER: "Other",
};

export type EduClockEntranceDescriptionMeta = {
  v: 1;
  type: EduClockEntranceTypeCode;
  customLabel?: string | null;
  note?: string | null;
  captureAccuracyMetres?: number | null;
};

const META_KEY = "__eduEntrance";

export function isEduClockEntranceTypeCode(value: unknown): value is EduClockEntranceTypeCode {
  return (
    typeof value === "string" &&
    (EDUCLOCK_ENTRANCE_TYPE_CODES as readonly string[]).includes(value)
  );
}

export function encodeEntranceDescription(meta: EduClockEntranceDescriptionMeta): string {
  return JSON.stringify({ [META_KEY]: meta });
}

export function parseEntranceDescription(raw: string | null | undefined): {
  meta: EduClockEntranceDescriptionMeta | null;
  legacyNote: string | null;
} {
  const text = raw == null ? "" : String(raw).trim();
  if (!text) return { meta: null, legacyNote: null };
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const inner = parsed?.[META_KEY] as EduClockEntranceDescriptionMeta | undefined;
    if (inner && inner.v === 1 && isEduClockEntranceTypeCode(inner.type)) {
      return {
        meta: {
          v: 1,
          type: inner.type,
          customLabel: inner.customLabel ?? null,
          note: inner.note ?? null,
          captureAccuracyMetres:
            inner.captureAccuracyMetres == null || !Number.isFinite(Number(inner.captureAccuracyMetres))
              ? null
              : Number(inner.captureAccuracyMetres),
        },
        legacyNote: null,
      };
    }
  } catch {
    // legacy free-text description
  }
  return { meta: null, legacyNote: text };
}

export function resolveEntranceTypeLabel(meta: EduClockEntranceDescriptionMeta | null): string | null {
  if (!meta) return null;
  if (meta.type === "OTHER") {
    const custom = String(meta.customLabel || "").trim();
    return custom || EDUCLOCK_ENTRANCE_TYPE_LABELS.OTHER;
  }
  return EDUCLOCK_ENTRANCE_TYPE_LABELS[meta.type];
}

export function buildEntranceDescriptionFromWizard(input: {
  entranceType?: unknown;
  customTypeLabel?: unknown;
  note?: unknown;
  captureAccuracyMetres?: unknown;
  /** Raw description from Advanced details (legacy free text) when no type provided. */
  description?: unknown;
}): string | null | undefined {
  if (input.entranceType !== undefined && input.entranceType !== null && input.entranceType !== "") {
    if (!isEduClockEntranceTypeCode(input.entranceType)) {
      throw new Error("Invalid entrance type.");
    }
    const type = input.entranceType;
    const customLabel =
      type === "OTHER" ? String(input.customTypeLabel || "").trim() || null : null;
    if (type === "OTHER" && !customLabel) {
      throw new Error("Please enter a custom label for Other entrance type.");
    }
    const note = input.note == null || input.note === "" ? null : String(input.note).trim();
    const accuracy =
      input.captureAccuracyMetres == null || input.captureAccuracyMetres === ""
        ? null
        : Number(input.captureAccuracyMetres);
    return encodeEntranceDescription({
      v: 1,
      type,
      customLabel,
      note,
      captureAccuracyMetres: accuracy != null && Number.isFinite(accuracy) ? accuracy : null,
    });
  }
  if (input.description === undefined) return undefined;
  if (input.description == null || input.description === "") return null;
  return String(input.description).trim() || null;
}
