import type { Prisma, SchoolEventLifecycle } from "@prisma/client";
import { prisma } from "../prisma";
import { createParentNotification, uniqueParentLearnerLinks } from "./parentPortalService";
import { loadSchoolClassMembership } from "../utils/classroomMembership";
import type { AnnouncementActor, AnnouncementTargeting } from "./schoolAnnouncementService";
import { assertActorMayManageTarget, targetingSnapshot } from "./schoolAnnouncementService";

export type EventActor = AnnouncementActor;
export type EventTargeting = AnnouncementTargeting;

export type NormalizedEventTarget = {
  grade: string | null;
  className: string | null;
  learnerId: string | null;
  mode: "SCHOOL" | "GRADE" | "CLASS" | "LEARNER";
};

/**
 * Explicit targeting: school-wide | grade-only | class (± optional grade) | learner (± optional class).
 * Rejects ambiguous grade+learner without class, and learner+grade without class.
 */
export function normalizeEventTargeting(raw: EventTargeting): NormalizedEventTarget {
  const grade = raw.grade ? String(raw.grade).trim() || null : null;
  const className = raw.className ? String(raw.className).trim() || null : null;
  const learnerId = raw.learnerId ? String(raw.learnerId).trim() || null : null;

  if (learnerId) {
    if (grade && !className) {
      throw Object.assign(
        new Error("Learner-targeted events cannot combine grade without a class"),
        { status: 400 }
      );
    }
    return { grade: null, className, learnerId, mode: "LEARNER" };
  }
  if (className) {
    return { grade, className, learnerId: null, mode: "CLASS" };
  }
  if (grade) {
    return { grade, className: null, learnerId: null, mode: "GRADE" };
  }
  return { grade: null, className: null, learnerId: null, mode: "SCHOOL" };
}

export function parseEventInstant(raw: unknown, field: string): Date {
  const s = String(raw ?? "").trim();
  if (!s) throw Object.assign(new Error(`${field} required`), { status: 400 });
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error(`${field} must be a valid ISO date/time`), { status: 400 });
  }
  return d;
}

export function assertEventWindow(startsAt: Date, endsAt: Date) {
  if (startsAt.getTime() > endsAt.getTime()) {
    throw Object.assign(new Error("startsAt must be less than or equal to endsAt"), { status: 400 });
  }
}

/** Parent-visible: published schedule + cancelled (so families see cancellations). Never drafts/archived. */
export function parentVisibleEventWhere() {
  return {
    lifecycleStatus: { in: ["PUBLISHED", "CANCELLED"] as SchoolEventLifecycle[] },
  };
}

/** Upcoming dashboard strip — active schedule only. */
export function parentUpcomingEventWhere(now = new Date()) {
  return {
    lifecycleStatus: "PUBLISHED" as const,
    endsAt: { gte: now },
  };
}

export function staffEventLifecycleWhere(
  lifecycle: SchoolEventLifecycle | "ALL"
): Prisma.SchoolEventWhereInput {
  if (lifecycle === "ALL") return {};
  return { lifecycleStatus: lifecycle };
}

async function writeAudit(opts: {
  schoolId: string;
  eventId: string;
  actor: EventActor;
  action: string;
  previousLifecycle?: string | null;
  newLifecycle?: string | null;
  previousTargeting?: EventTargeting | null;
  newTargeting?: EventTargeting | null;
  detail?: Record<string, unknown>;
}) {
  await prisma.schoolEventAuditLog.create({
    data: {
      schoolId: opts.schoolId,
      eventId: opts.eventId,
      actorUserId: opts.actor.userId || null,
      actorEmail: opts.actor.email || "",
      action: opts.action,
      previousLifecycle: opts.previousLifecycle ?? null,
      newLifecycle: opts.newLifecycle ?? null,
      previousTargeting: opts.previousTargeting
        ? (targetingSnapshot(opts.previousTargeting) as object)
        : undefined,
      newTargeting: opts.newTargeting ? (targetingSnapshot(opts.newTargeting) as object) : undefined,
      detail: opts.detail ? (opts.detail as object) : undefined,
    },
  });
}

async function fanOutPublishNotifications(opts: {
  schoolId: string;
  event: {
    id: string;
    title: string;
    description: string;
    startsAt: Date;
    grade: string | null;
    className: string | null;
    learnerId: string | null;
  };
}) {
  const membership = await loadSchoolClassMembership(opts.schoolId);
  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId: opts.schoolId },
    include: { learner: true },
  });

  const matched = uniqueParentLearnerLinks(
    links.filter((link) => {
      const e = opts.event;
      if (e.learnerId && e.learnerId === link.learnerId) return true;
      if (e.grade && e.grade === link.learner.grade) return true;
      if (e.className && membership.resolver.sameClassroom(e.className, link.learner.className)) {
        return true;
      }
      if (!e.learnerId && !e.grade && !e.className) return true;
      return false;
    })
  );

  const when = opts.event.startsAt.toISOString();
  for (const link of matched) {
    await createParentNotification({
      schoolId: opts.schoolId,
      parentId: link.parentId,
      learnerId: link.learnerId,
      type: "SCHOOL_EVENT",
      title: opts.event.title,
      message: `${String(opts.event.description || opts.event.title).slice(0, 400)} · ${when}`,
      metadata: { eventId: opts.event.id },
    });
  }
  return matched.length;
}

export async function listStaffEvents(opts: {
  schoolId: string;
  actor: EventActor;
  lifecycle?: SchoolEventLifecycle | "ALL";
  q?: string;
  from?: Date | null;
  to?: Date | null;
  take?: number;
  cursor?: string | null;
}) {
  const take = Math.min(Math.max(opts.take ?? 40, 1), 100);
  const lifecycle = opts.lifecycle || "ALL";
  const q = String(opts.q || "").trim();
  const and: Prisma.SchoolEventWhereInput[] = [staffEventLifecycleWhere(lifecycle)];
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { location: { contains: q, mode: "insensitive" } },
      ],
    });
  }
  if (opts.from) and.push({ startsAt: { gte: opts.from } });
  if (opts.to) and.push({ startsAt: { lte: opts.to } });

  const where: Prisma.SchoolEventWhereInput = {
    schoolId: opts.schoolId,
    AND: and,
  };
  if (!opts.actor.isSchoolWideAdmin) {
    const classes = opts.actor.assignedClassNames.filter(Boolean);
    where.className = classes.length ? { in: classes } : "__none__";
  }

  const rows = await prisma.schoolEvent.findMany({
    where,
    orderBy: [{ startsAt: "asc" }, { id: "asc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = rows.slice(0, take);
  return {
    items,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]?.id || null : null,
  };
}

export async function createEventDraft(opts: {
  schoolId: string;
  actor: EventActor;
  title: string;
  description?: string;
  startsAt: unknown;
  endsAt: unknown;
  location?: string | null;
  targeting: EventTargeting;
  publishNow?: boolean;
}) {
  const title = String(opts.title || "").trim();
  if (!title) throw Object.assign(new Error("title required"), { status: 400 });
  const startsAt = parseEventInstant(opts.startsAt, "startsAt");
  const endsAt = parseEventInstant(opts.endsAt, "endsAt");
  assertEventWindow(startsAt, endsAt);

  const targeting = normalizeEventTargeting(opts.targeting);
  const deny = assertActorMayManageTarget(opts.actor, targeting);
  if (deny) throw Object.assign(new Error(deny), { status: 403 });

  const lifecycle: SchoolEventLifecycle = opts.publishNow ? "PUBLISHED" : "DRAFT";
  const event = await prisma.schoolEvent.create({
    data: {
      schoolId: opts.schoolId,
      title,
      description: String(opts.description || ""),
      startsAt,
      endsAt,
      location: opts.location ? String(opts.location).trim() || null : null,
      grade: targeting.grade,
      className: targeting.className,
      learnerId: targeting.learnerId,
      createdBy: opts.actor.email,
      createdByTeacherId: opts.actor.userId,
      lifecycleStatus: lifecycle,
      publishedAt: opts.publishNow ? new Date() : null,
    },
  });

  await writeAudit({
    schoolId: opts.schoolId,
    eventId: event.id,
    actor: opts.actor,
    action: opts.publishNow ? "CREATE_AND_PUBLISH" : "CREATE_DRAFT",
    previousLifecycle: null,
    newLifecycle: lifecycle,
    newTargeting: targeting,
    detail: { mode: targeting.mode },
  });

  if (opts.publishNow) {
    await fanOutPublishNotifications({ schoolId: opts.schoolId, event });
  }
  return event;
}

export async function updateEvent(opts: {
  schoolId: string;
  eventId: string;
  actor: EventActor;
  title?: string;
  description?: string;
  startsAt?: unknown;
  endsAt?: unknown;
  location?: string | null;
  targeting?: EventTargeting;
}) {
  const existing = await prisma.schoolEvent.findFirst({
    where: { id: opts.eventId, schoolId: opts.schoolId },
  });
  if (!existing) throw Object.assign(new Error("Event not found"), { status: 404 });
  if (existing.lifecycleStatus === "ARCHIVED") {
    throw Object.assign(new Error("Archived events cannot be edited"), { status: 400 });
  }
  if (existing.lifecycleStatus === "CANCELLED") {
    throw Object.assign(new Error("Cancelled events cannot be edited — archive instead"), { status: 400 });
  }

  const denyExisting = assertActorMayManageTarget(opts.actor, existing);
  if (denyExisting) throw Object.assign(new Error(denyExisting), { status: 403 });

  const nextTarget = opts.targeting
    ? normalizeEventTargeting({
        grade: "grade" in opts.targeting ? opts.targeting.grade : existing.grade,
        className: "className" in opts.targeting ? opts.targeting.className : existing.className,
        learnerId: "learnerId" in opts.targeting ? opts.targeting.learnerId : existing.learnerId,
      })
    : normalizeEventTargeting(existing);
  const denyNext = assertActorMayManageTarget(opts.actor, nextTarget);
  if (denyNext) throw Object.assign(new Error(denyNext), { status: 403 });

  const startsAt =
    opts.startsAt != null ? parseEventInstant(opts.startsAt, "startsAt") : existing.startsAt;
  const endsAt = opts.endsAt != null ? parseEventInstant(opts.endsAt, "endsAt") : existing.endsAt;
  assertEventWindow(startsAt, endsAt);

  const updated = await prisma.schoolEvent.update({
    where: { id: existing.id },
    data: {
      title: opts.title != null ? String(opts.title).trim() || existing.title : existing.title,
      description: opts.description != null ? String(opts.description) : existing.description,
      startsAt,
      endsAt,
      location:
        opts.location !== undefined
          ? opts.location
            ? String(opts.location).trim() || null
            : null
          : existing.location,
      grade: nextTarget.grade,
      className: nextTarget.className,
      learnerId: nextTarget.learnerId,
    },
  });

  await writeAudit({
    schoolId: opts.schoolId,
    eventId: existing.id,
    actor: opts.actor,
    action: existing.lifecycleStatus === "PUBLISHED" ? "EDIT_PUBLISHED" : "EDIT_DRAFT",
    previousLifecycle: existing.lifecycleStatus,
    newLifecycle: existing.lifecycleStatus,
    previousTargeting: existing,
    newTargeting: nextTarget,
  });

  return updated;
}

export async function transitionEvent(opts: {
  schoolId: string;
  eventId: string;
  actor: EventActor;
  action: "publish" | "cancel" | "archive";
  cancellationReason?: string | null;
}) {
  const existing = await prisma.schoolEvent.findFirst({
    where: { id: opts.eventId, schoolId: opts.schoolId },
  });
  if (!existing) throw Object.assign(new Error("Event not found"), { status: 404 });
  const deny = assertActorMayManageTarget(opts.actor, existing);
  if (deny) throw Object.assign(new Error(deny), { status: 403 });

  const from = existing.lifecycleStatus;
  let to: SchoolEventLifecycle = from;
  let actionName = opts.action.toUpperCase();

  if (opts.action === "publish") {
    if (from !== "DRAFT") {
      throw Object.assign(
        new Error(
          from === "CANCELLED"
            ? "Cancelled events cannot be republished in this phase"
            : `Cannot publish from ${from}`
        ),
        { status: 400 }
      );
    }
    to = "PUBLISHED";
    actionName = "PUBLISH";
  } else if (opts.action === "cancel") {
    if (from !== "PUBLISHED") {
      throw Object.assign(new Error("Only published events can be cancelled"), { status: 400 });
    }
    to = "CANCELLED";
  } else if (opts.action === "archive") {
    if (from === "ARCHIVED") {
      throw Object.assign(new Error("Already archived"), { status: 400 });
    }
    if (from === "DRAFT") {
      // Allow archiving drafts without parent exposure.
      to = "ARCHIVED";
    } else {
      to = "ARCHIVED";
    }
  }

  const updated = await prisma.schoolEvent.update({
    where: { id: existing.id },
    data: {
      lifecycleStatus: to,
      publishedAt: to === "PUBLISHED" ? new Date() : existing.publishedAt,
      cancelledAt: to === "CANCELLED" ? new Date() : existing.cancelledAt,
      cancellationReason:
        to === "CANCELLED"
          ? String(opts.cancellationReason || "").trim() || null
          : existing.cancellationReason,
      archivedAt: to === "ARCHIVED" ? new Date() : existing.archivedAt,
    },
  });

  await writeAudit({
    schoolId: opts.schoolId,
    eventId: existing.id,
    actor: opts.actor,
    action: actionName,
    previousLifecycle: from,
    newLifecycle: to,
    previousTargeting: existing,
    newTargeting: existing,
    detail:
      to === "CANCELLED" ? { cancellationReason: updated.cancellationReason } : undefined,
  });

  if (actionName === "PUBLISH" || actionName === "CREATE_AND_PUBLISH") {
    await fanOutPublishNotifications({ schoolId: opts.schoolId, event: updated });
  }

  return updated;
}

export async function getEvent(schoolId: string, eventId: string) {
  return prisma.schoolEvent.findFirst({ where: { id: eventId, schoolId } });
}

export async function listEventAudit(schoolId: string, eventId: string) {
  return prisma.schoolEventAuditLog.findMany({
    where: { schoolId, eventId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

type ParentLearnerTarget = { id: string; grade: string; className: string | null; firstName?: string; lastName?: string };

export async function listParentVisibleEvents(opts: {
  schoolId: string;
  learners: ParentLearnerTarget[];
  spellingsFor: (className: string | null | undefined) => string[];
  limit: number;
  cursor?: string | null;
  /** upcoming | past | all — relative to now; cancelled included in all/past/upcoming windows */
  range?: "upcoming" | "past" | "all";
  now?: Date;
}) {
  const limit = Math.min(Math.max(opts.limit, 1), 100);
  const cursor = opts.cursor ? String(opts.cursor).trim() : "";
  const now = opts.now || new Date();
  const range = opts.range || "all";

  if (!opts.learners.length) {
    return { events: [], hasMore: false, nextCursor: null as string | null, limit };
  }

  const or: Prisma.SchoolEventWhereInput[] = [
    { AND: [{ learnerId: null }, { grade: null }, { className: null }] },
  ];
  for (const learner of opts.learners) {
    or.push({ learnerId: learner.id });
    if (learner.grade) or.push({ grade: learner.grade });
    const spellings = learner.className ? opts.spellingsFor(learner.className) : [];
    if (spellings.length) or.push({ className: { in: spellings } });
  }

  // PUBLISHED + CANCELLED (never drafts/archived). Cancelled remain visible so families see the change.
  const and: Prisma.SchoolEventWhereInput[] = [parentVisibleEventWhere(), { OR: or }];
  if (range === "upcoming") and.push({ endsAt: { gte: now } });
  if (range === "past") and.push({ endsAt: { lt: now } });

  const orderBy =
    range === "past"
      ? ([{ startsAt: "desc" as const }, { id: "desc" as const }] as const)
      : ([{ startsAt: "asc" as const }, { id: "asc" as const }] as const);

  const rows = await prisma.schoolEvent.findMany({
    where: { schoolId: opts.schoolId, AND: and },
    orderBy: [...orderBy],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = rows.length > limit;
  const events = rows.slice(0, limit);

  // Attach which linked children the event applies to (for labels; school-wide → empty = all).
  const membership = await loadSchoolClassMembership(opts.schoolId);
  const enriched = events.map((ev) => {
    const matchedLearners = opts.learners.filter((l) => {
      if (!ev.learnerId && !ev.grade && !ev.className) return true;
      if (ev.learnerId && ev.learnerId === l.id) return true;
      if (ev.grade && ev.grade === l.grade) return true;
      if (ev.className && membership.resolver.sameClassroom(ev.className, l.className)) return true;
      return false;
    });
    return {
      ...ev,
      matchedLearners: matchedLearners.map((l) => ({
        id: l.id,
        firstName: l.firstName || "",
        lastName: l.lastName || "",
        grade: l.grade,
        className: l.className,
      })),
      isSchoolWide: !ev.learnerId && !ev.grade && !ev.className,
    };
  });

  return {
    events: enriched,
    hasMore,
    nextCursor: hasMore ? events[events.length - 1]?.id || null : null,
    limit,
  };
}
