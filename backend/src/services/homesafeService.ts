import type { HomeSafeCollectionMethod, Prisma } from "@prisma/client";
import { Prisma as PrismaNs } from "@prisma/client";
import { prisma } from "../prisma";
import {
  activeLearnerWhere,
  resolveLearnerClassroomLabel,
} from "../utils/learnerEnrollment";
import {
  DEFAULT_SCHOOL_TIMEZONE,
  formatSchoolLocalTimeDisplay,
  resolveSchoolLocalParts,
} from "../utils/schoolLocalTime";

export const HOMESAFE_SEARCH_LIMIT = 20;

export type HomeSafeDismissalSummary = {
  id: string;
  learnerId: string;
  displayName: string;
  classroom: string;
  collectionMethod: HomeSafeCollectionMethod;
  occurredAt: string;
  schoolLocalDate: string;
  schoolLocalTime: string;
  schoolLocalTimeDisplay: string;
  teacherId: string;
  teacherName: string | null;
};

export type HomeSafeLearnerSearchRow = {
  learnerId: string;
  firstName: string;
  surname: string;
  displayName: string;
  classroom: string;
  dismissedToday: boolean;
  dismissalToday: HomeSafeDismissalSummary | null;
};

function learnerDisplayName(firstName: string, lastName: string): string {
  return `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();
}

function buildActiveLearnerSearchWhere(
  schoolId: string,
  search: string
): Prisma.LearnerWhereInput | null {
  const term = String(search || "").trim();
  if (!term) return null;

  const base = activeLearnerWhere(schoolId);
  const parts = term.split(/\s+/).filter(Boolean);

  if (parts.length >= 2) {
    return {
      ...base,
      AND: [
        { firstName: { contains: parts[0], mode: "insensitive" } },
        { lastName: { contains: parts.slice(1).join(" "), mode: "insensitive" } },
      ],
    };
  }

  return {
    ...base,
    OR: [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
    ],
  };
}

function mapEventToSummary(
  event: {
    id: string;
    learnerId: string;
    teacherId: string;
    collectionMethod: HomeSafeCollectionMethod;
    occurredAt: Date;
    schoolLocalDate: string;
    schoolLocalTime: string;
    learnerNameSnapshot: string;
    classroomSnapshot: string;
    teacher?: { fullName: string | null } | null;
  }
): HomeSafeDismissalSummary {
  return {
    id: event.id,
    learnerId: event.learnerId,
    displayName: event.learnerNameSnapshot,
    classroom: event.classroomSnapshot,
    collectionMethod: event.collectionMethod,
    occurredAt: event.occurredAt.toISOString(),
    schoolLocalDate: event.schoolLocalDate,
    schoolLocalTime: event.schoolLocalTime,
    schoolLocalTimeDisplay: formatSchoolLocalTimeDisplay(event.schoolLocalTime),
    teacherId: event.teacherId,
    teacherName: event.teacher?.fullName ?? null,
  };
}

export async function searchHomeSafeLearners(input: {
  schoolId: string;
  search: string;
  now?: Date;
}): Promise<{ learners: HomeSafeLearnerSearchRow[]; schoolLocalDate: string }> {
  const where = buildActiveLearnerSearchWhere(input.schoolId, input.search);
  const now = input.now ?? new Date();
  const { schoolLocalDate } = resolveSchoolLocalParts(now);

  if (!where) {
    return { learners: [], schoolLocalDate };
  }

  const rows = await prisma.learner.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    take: HOMESAFE_SEARCH_LIMIT,
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      grade: true,
    },
  });

  if (!rows.length) {
    return { learners: [], schoolLocalDate };
  }

  const learnerIds = rows.map((r) => r.id);
  const todayEvents = await prisma.homeSafeEvent.findMany({
    where: {
      schoolId: input.schoolId,
      learnerId: { in: learnerIds },
      schoolLocalDate,
      eventType: "DISMISSED",
    },
    include: {
      teacher: { select: { fullName: true } },
    },
  });
  const eventByLearner = new Map(todayEvents.map((e) => [e.learnerId, e]));

  const learners = rows.map((row) => {
    const event = eventByLearner.get(row.id);
    const dismissalToday = event ? mapEventToSummary(event) : null;
    return {
      learnerId: row.id,
      firstName: row.firstName,
      surname: row.lastName,
      displayName: learnerDisplayName(row.firstName, row.lastName),
      classroom: resolveLearnerClassroomLabel(row),
      dismissedToday: Boolean(dismissalToday),
      dismissalToday,
    };
  });

  return { learners, schoolLocalDate };
}

export const HOMESAFE_COLLECTION_METHODS = [
  "PARENT",
  "UNCLE",
  "SIBLING",
  "GRANDPARENT",
  "BOLT",
  "SCHOOL_TRANSPORT",
  "TAXI",
  "OTHER",
] as const;

export function normalizeHomeSafeCollectionMethod(
  raw: unknown
): HomeSafeCollectionMethod | null {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "TRANSPORT") return "TRANSPORT";
  if ((HOMESAFE_COLLECTION_METHODS as readonly string[]).includes(value)) {
    return value as HomeSafeCollectionMethod;
  }
  return null;
}

export function collectionMethodLabel(
  method: HomeSafeCollectionMethod | string | null | undefined
): string {
  switch (String(method || "").trim().toUpperCase()) {
    case "PARENT":
      return "Parent";
    case "UNCLE":
      return "Uncle";
    case "SIBLING":
      return "Sibling";
    case "GRANDPARENT":
      return "Grandparent";
    case "BOLT":
      return "Bolt";
    case "SCHOOL_TRANSPORT":
      return "School Transport";
    case "TAXI":
      return "Taxi";
    case "OTHER":
      return "Other";
    case "TRANSPORT":
      return "Transport";
    default:
      return method ? String(method) : "—";
  }
}

export type DismissHomeSafeResult =
  | { ok: true; dismissal: HomeSafeDismissalSummary }
  | {
      ok: false;
      code: "NOT_FOUND" | "INACTIVE" | "INVALID_METHOD" | "NOTE_REQUIRED" | "CONFLICT";
      message: string;
      existing?: HomeSafeDismissalSummary;
    };

export async function dismissHomeSafeLearner(input: {
  schoolId: string;
  teacherId: string;
  learnerId: string;
  collectionMethod: HomeSafeCollectionMethod;
  collectionNote?: string | null;
  now?: Date;
}): Promise<DismissHomeSafeResult> {
  const collectionNote = String(input.collectionNote || "").trim() || null;
  if (input.collectionMethod === "OTHER" && !collectionNote) {
    return {
      ok: false,
      code: "NOTE_REQUIRED",
      message: "A short description is required when Collected by is Other.",
    };
  }
  const learner = await prisma.learner.findFirst({
    where: { id: input.learnerId, schoolId: input.schoolId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      className: true,
      grade: true,
      enrollmentStatus: true,
    },
  });

  if (!learner) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Learner not found in your school.",
    };
  }

  if (learner.enrollmentStatus !== "ACTIVE") {
    return {
      ok: false,
      code: "INACTIVE",
      message: "This learner is no longer active.",
    };
  }

  const occurredAt = input.now ?? new Date();
  const { schoolLocalDate, schoolLocalTime } = resolveSchoolLocalParts(occurredAt);
  const learnerNameSnapshot = learnerDisplayName(learner.firstName, learner.lastName);
  const classroomSnapshot = resolveLearnerClassroomLabel(learner);

  try {
    const created = await prisma.homeSafeEvent.create({
      data: {
        schoolId: input.schoolId,
        learnerId: learner.id,
        teacherId: input.teacherId,
        eventType: "DISMISSED",
        collectionMethod: input.collectionMethod,
        collectionNote: input.collectionMethod === "OTHER" ? collectionNote : null,
        occurredAt,
        schoolLocalDate,
        schoolLocalTime,
        learnerNameSnapshot,
        classroomSnapshot,
      },
      include: {
        teacher: { select: { fullName: true } },
      },
    });

    return { ok: true, dismissal: mapEventToSummary(created) };
  } catch (err) {
    if (
      err instanceof PrismaNs.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      const existing = await prisma.homeSafeEvent.findFirst({
        where: {
          schoolId: input.schoolId,
          learnerId: learner.id,
          schoolLocalDate,
          eventType: "DISMISSED",
        },
        include: {
          teacher: { select: { fullName: true } },
        },
      });
      return {
        ok: false,
        code: "CONFLICT",
        message: "This learner was already dismissed today.",
        existing: existing ? mapEventToSummary(existing) : undefined,
      };
    }
    throw err;
  }
}

export function homesafeSchoolTimezoneLabel(): string {
  return DEFAULT_SCHOOL_TIMEZONE;
}
