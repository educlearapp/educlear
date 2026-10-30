import {
  Prisma,
  type SchoolNoticeLifecycle,
  type SchoolNoticeType,
  type TeacherContentVisibility,
} from "@prisma/client";
import { prisma } from "../prisma";
import { createParentNotification } from "./parentPortalService";
import {
  normalizeAnnouncementTargeting,
  noticeHasExplicitParentAudience,
  parentNoticeVisibilityOr,
  resolveAnnouncementAudience,
  storedTargetingToAudienceInput,
  targetingFromNotice,
  type AnnouncementAudienceInput,
  type AnnouncementStoredTargeting,
} from "./schoolAnnouncementAudience";

export type AnnouncementTargeting = {
  grade?: string | null;
  className?: string | null;
  learnerId?: string | null;
  audienceParentIds?: string[] | null;
  audienceMode?: string | null;
  classScope?: string | null;
  parentIds?: string[] | null;
};

export type {
  AnnouncementAudienceInput,
  AnnouncementAudienceResolution,
  AnnouncementStoredTargeting,
} from "./schoolAnnouncementAudience";
export {
  normalizeAnnouncementTargeting,
  parseAudienceParentIds,
  parentMayViewNotice,
  resolveAnnouncementAudience,
  noticeHasExplicitParentAudience,
} from "./schoolAnnouncementAudience";

export type AnnouncementActor = {
  userId: string;
  email: string;
  role: string;
  appRole?: string | null;
  isSchoolWideAdmin: boolean;
  assignedClassNames: string[];
};

export function lifecycleToIsDraft(lifecycle: SchoolNoticeLifecycle): boolean {
  return lifecycle === "DRAFT";
}

/**
 * Authoritative effective lifecycle for staff UI / transitions.
 * Legacy rows may have isDraft=true with lifecycleStatus still PUBLISHED (schema default).
 * isDraft=true always wins as DRAFT — never treat those as published.
 * Does not mutate stored rows.
 */
export function resolveNoticeLifecycle(n: {
  isDraft?: boolean | null;
  lifecycleStatus?: SchoolNoticeLifecycle | string | null;
}): SchoolNoticeLifecycle {
  if (n.isDraft === true) return "DRAFT";
  const raw = String(n.lifecycleStatus || "PUBLISHED").toUpperCase();
  if (raw === "DRAFT" || raw === "PUBLISHED" || raw === "UNPUBLISHED" || raw === "ARCHIVED") {
    return raw as SchoolNoticeLifecycle;
  }
  return "PUBLISHED";
}

/** Staff list filter that keeps isDraft=true out of published/unpublished/archived buckets. */
export function staffLifecycleWhere(
  lifecycle: SchoolNoticeLifecycle | "ALL"
): Prisma.SchoolNoticeWhereInput {
  if (lifecycle === "ALL") return {};
  if (lifecycle === "DRAFT") {
    return { OR: [{ lifecycleStatus: "DRAFT" }, { isDraft: true }] };
  }
  return { lifecycleStatus: lifecycle, isDraft: false };
}

/** Present notices with effective lifecycleStatus; never rewrite DB. */
export function presentAnnouncement<T extends { isDraft?: boolean | null; lifecycleStatus?: SchoolNoticeLifecycle }>(
  notice: T
): T {
  const effective = resolveNoticeLifecycle(notice);
  return { ...notice, lifecycleStatus: effective, isDraft: lifecycleToIsDraft(effective) };
}

/** Parent-facing notice gate: published + class-teacher visibility + legacy isDraft false. */
export function parentVisibleNoticeWhere() {
  return {
    lifecycleStatus: "PUBLISHED" as const,
    visibility: "CLASS_TEACHERS" as const,
    isDraft: false,
  };
}

export function targetingSnapshot(n: AnnouncementTargeting | AnnouncementStoredTargeting) {
  const stored = targetingFromNotice(n);
  return {
    grade: stored.grade,
    className: stored.className,
    learnerId: stored.learnerId,
    audienceParentIds: stored.audienceParentIds,
  };
}

export function isSchoolWideTarget(t: AnnouncementTargeting): boolean {
  if (noticeHasExplicitParentAudience(t.audienceParentIds ?? t.parentIds)) return false;
  return !String(t.className || "").trim() && !String(t.learnerId || "").trim();
  // grade-only still counts as school-admin scope (not class-assigned)
}

export function assertActorMayManageTarget(actor: AnnouncementActor, t: AnnouncementTargeting): string | null {
  try {
    const normalized = normalizeAnnouncementTargeting({
      audienceMode: t.audienceMode,
      classScope: t.classScope,
      grade: t.grade,
      className: t.className,
      learnerId: t.learnerId,
      parentIds: t.parentIds ?? t.audienceParentIds,
      audienceParentIds: t.audienceParentIds,
    });
    if (normalized.mode === "all_parents" && !actor.isSchoolWideAdmin) {
      return "Only school administrators may target all parents";
    }
    if (
      normalized.mode === "by_class" &&
      (normalized.classScope === "grade" || normalized.classScope === "all_in_grade") &&
      !actor.isSchoolWideAdmin
    ) {
      return "Teachers may not publish grade-only announcements";
    }
    if (normalized.mode === "individual") {
      if (actor.isSchoolWideAdmin) return null;
      // Detailed parent/class authorisation runs in resolveAnnouncementAudience.
      return null;
    }
    if (actor.isSchoolWideAdmin) return null;
    const className = String(normalized.className || "").trim();
    const learnerId = String(normalized.learnerId || "").trim();
    if (!className) {
      return "Teachers may only manage class-scoped announcements for assigned classrooms";
    }
    if (learnerId && !className) {
      return "Teachers may not manage learner-only announcements without a class";
    }
    const allowed = new Set(actor.assignedClassNames.map((c) => String(c || "").trim()).filter(Boolean));
    if (!allowed.has(className)) {
      return "You are not assigned to this class";
    }
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid targeting";
  }
}

async function writeAudit(opts: {
  schoolId: string;
  noticeId: string;
  actor: AnnouncementActor;
  action: string;
  previousLifecycle?: string | null;
  newLifecycle?: string | null;
  previousTargeting?: AnnouncementTargeting | null;
  newTargeting?: AnnouncementTargeting | null;
  detail?: Record<string, unknown>;
}) {
  await prisma.schoolNoticeAuditLog.create({
    data: {
      schoolId: opts.schoolId,
      noticeId: opts.noticeId,
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

function mapNoticeType(raw: string): SchoolNoticeType {
  const v = String(raw || "SCHOOL").toUpperCase();
  const allowed: SchoolNoticeType[] = ["SCHOOL", "GRADE", "CLASS", "ASSESSMENT", "EXAM"];
  return (allowed.includes(v as SchoolNoticeType) ? v : "SCHOOL") as SchoolNoticeType;
}

async function fanOutPublishNotifications(opts: {
  schoolId: string;
  actor: AnnouncementActor;
  notice: {
    id: string;
    title: string;
    body: string;
    noticeType: SchoolNoticeType;
    grade: string | null;
    className: string | null;
    learnerId: string | null;
    audienceParentIds?: unknown;
  };
}) {
  const notifType =
    opts.notice.noticeType === "ASSESSMENT"
      ? ("ASSESSMENT" as const)
      : opts.notice.noticeType === "EXAM"
        ? ("EXAM" as const)
        : ("SCHOOL_NOTICE" as const);

  const stored = targetingFromNotice(opts.notice);
  // Re-resolve with the publishing actor so permissions and audience stay aligned with preview.
  const resolved = await resolveAnnouncementAudience({
    schoolId: opts.schoolId,
    actor: opts.actor,
    input: storedTargetingToAudienceInput(stored),
  });

  for (const recipient of resolved.recipients) {
    await createParentNotification({
      schoolId: opts.schoolId,
      parentId: recipient.parentId,
      learnerId: recipient.learnerIds[0] || null,
      type: notifType,
      title: opts.notice.title,
      message: String(opts.notice.body || opts.notice.title).slice(0, 500),
      metadata: { noticeId: opts.notice.id },
    });
  }
  return resolved.uniqueParentCount;
}

export async function listAnnouncements(opts: {
  schoolId: string;
  actor: AnnouncementActor;
  lifecycle?: SchoolNoticeLifecycle | "ALL";
  q?: string;
  take?: number;
  cursor?: string | null;
}) {
  const take = Math.min(Math.max(opts.take ?? 40, 1), 100);
  const lifecycle = opts.lifecycle || "ALL";
  const q = String(opts.q || "").trim();

  const and: Prisma.SchoolNoticeWhereInput[] = [staffLifecycleWhere(lifecycle)];
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { body: { contains: q, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.SchoolNoticeWhereInput = {
    schoolId: opts.schoolId,
    AND: and,
  };

  if (!opts.actor.isSchoolWideAdmin) {
    const classes = opts.actor.assignedClassNames.filter(Boolean);
    // Class-scoped notices for assigned rooms, plus own individual-audience notices.
    and.push({
      OR: [
        ...(classes.length ? [{ className: { in: classes } as const }] : []),
        { createdByTeacherId: opts.actor.userId },
      ],
    });
  }

  const rows = await prisma.schoolNotice.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > take;
  const items = rows.slice(0, take).map((n) => presentAnnouncement(n));
  return {
    items,
    hasMore,
    nextCursor: hasMore ? items[items.length - 1]?.id || null : null,
  };
}

export async function previewAnnouncementAudience(opts: {
  schoolId: string;
  actor: AnnouncementActor;
  targeting: AnnouncementAudienceInput;
}) {
  return resolveAnnouncementAudience({
    schoolId: opts.schoolId,
    actor: opts.actor,
    input: opts.targeting,
  });
}

export async function createAnnouncementDraft(opts: {
  schoolId: string;
  actor: AnnouncementActor;
  title: string;
  body: string;
  noticeType?: string;
  targeting: AnnouncementTargeting;
  visibility?: TeacherContentVisibility;
  publishNow?: boolean;
}) {
  const title = String(opts.title || "").trim();
  const body = String(opts.body || "").trim();
  if (!title) throw Object.assign(new Error("title required"), { status: 400 });

  const resolved = await resolveAnnouncementAudience({
    schoolId: opts.schoolId,
    actor: opts.actor,
    input: opts.targeting,
  });
  const targeting = resolved.targeting;

  const lifecycle: SchoolNoticeLifecycle = opts.publishNow ? "PUBLISHED" : "DRAFT";
  const visibility = opts.visibility || "CLASS_TEACHERS";
  const noticeTypeDefault =
    targeting.audienceParentIds?.length
      ? "SCHOOL"
      : targeting.className
        ? "CLASS"
        : targeting.grade
          ? "GRADE"
          : "SCHOOL";
  const notice = await prisma.schoolNotice.create({
    data: {
      schoolId: opts.schoolId,
      noticeType: mapNoticeType(opts.noticeType || noticeTypeDefault),
      title,
      body,
      grade: targeting.grade,
      className: targeting.className,
      learnerId: targeting.learnerId,
      audienceParentIds:
        targeting.audienceParentIds === null ? Prisma.DbNull : targeting.audienceParentIds,
      createdBy: opts.actor.email,
      createdByTeacherId: opts.actor.userId,
      visibility,
      lifecycleStatus: lifecycle,
      isDraft: lifecycleToIsDraft(lifecycle),
      // publishedAt is non-null in schema; refreshed again on publish/republish.
      publishedAt: new Date(),
      unpublishedAt: null,
      archivedAt: null,
    },
  });

  await writeAudit({
    schoolId: opts.schoolId,
    noticeId: notice.id,
    actor: opts.actor,
    action: opts.publishNow ? "CREATE_AND_PUBLISH" : "CREATE_DRAFT",
    previousLifecycle: null,
    newLifecycle: lifecycle,
    newTargeting: targeting,
    detail: {
      audienceMode: resolved.mode,
      uniqueParentCount: resolved.uniqueParentCount,
      learnerCount: resolved.learnerCount,
    },
  });

  if (opts.publishNow && visibility === "CLASS_TEACHERS") {
    await fanOutPublishNotifications({ schoolId: opts.schoolId, actor: opts.actor, notice });
  }

  return presentAnnouncement(notice);
}

export async function updateAnnouncement(opts: {
  schoolId: string;
  noticeId: string;
  actor: AnnouncementActor;
  title?: string;
  body?: string;
  noticeType?: string;
  targeting?: AnnouncementTargeting;
  visibility?: TeacherContentVisibility;
}) {
  const existing = await prisma.schoolNotice.findFirst({
    where: { id: opts.noticeId, schoolId: opts.schoolId },
  });
  if (!existing) throw Object.assign(new Error("Announcement not found"), { status: 404 });
  const effectiveBefore = resolveNoticeLifecycle(existing);
  if (effectiveBefore === "ARCHIVED") {
    throw Object.assign(new Error("Archived announcements cannot be edited"), { status: 400 });
  }

  const denyExisting = assertActorMayManageTarget(opts.actor, {
    ...targetingFromNotice(existing),
    audienceMode: storedTargetingToAudienceInput(targetingFromNotice(existing)).audienceMode,
  });
  if (denyExisting) throw Object.assign(new Error(denyExisting), { status: 403 });

  let nextTarget = targetingFromNotice(existing);
  const t = opts.targeting;
  const retarget =
    t &&
    (t.audienceMode != null ||
      t.classScope != null ||
      t.parentIds != null ||
      t.audienceParentIds != null ||
      ("grade" in t && t.grade !== undefined) ||
      ("className" in t && t.className !== undefined) ||
      ("learnerId" in t && t.learnerId !== undefined));
  if (retarget) {
    const resolved = await resolveAnnouncementAudience({
      schoolId: opts.schoolId,
      actor: opts.actor,
      input: {
        audienceMode: t!.audienceMode,
        classScope: t!.classScope,
        grade: t!.grade,
        className: t!.className,
        learnerId: t!.learnerId,
        parentIds: t!.parentIds ?? t!.audienceParentIds,
      },
    });
    nextTarget = resolved.targeting;
  }

  const updated = await prisma.schoolNotice.update({
    where: { id: existing.id },
    data: {
      title: opts.title != null ? String(opts.title).trim() || existing.title : existing.title,
      body: opts.body != null ? String(opts.body) : existing.body,
      noticeType: opts.noticeType ? mapNoticeType(opts.noticeType) : existing.noticeType,
      grade: nextTarget.grade,
      className: nextTarget.className,
      learnerId: nextTarget.learnerId,
      audienceParentIds: nextTarget.audienceParentIds === null ? Prisma.DbNull : nextTarget.audienceParentIds,
      visibility: opts.visibility || existing.visibility,
      // Ordinary edits do not change lifecycle / do not re-notify.
    },
  });

  await writeAudit({
    schoolId: opts.schoolId,
    noticeId: existing.id,
    actor: opts.actor,
    action: effectiveBefore === "PUBLISHED" ? "EDIT_PUBLISHED" : "EDIT_DRAFT",
    previousLifecycle: effectiveBefore,
    newLifecycle: effectiveBefore,
    previousTargeting: targetingFromNotice(existing),
    newTargeting: nextTarget,
    detail: { titleChanged: opts.title != null, bodyChanged: opts.body != null },
  });

  return presentAnnouncement(updated);
}

export async function transitionAnnouncement(opts: {
  schoolId: string;
  noticeId: string;
  actor: AnnouncementActor;
  action: "publish" | "unpublish" | "republish" | "archive";
}) {
  const existing = await prisma.schoolNotice.findFirst({
    where: { id: opts.noticeId, schoolId: opts.schoolId },
  });
  if (!existing) throw Object.assign(new Error("Announcement not found"), { status: 404 });

  const deny = assertActorMayManageTarget(opts.actor, {
    ...targetingFromNotice(existing),
    audienceMode: storedTargetingToAudienceInput(targetingFromNotice(existing)).audienceMode,
  });
  if (deny) throw Object.assign(new Error(deny), { status: 403 });

  // Use effective lifecycle so isDraft=true never transitions as if PUBLISHED.
  const from = resolveNoticeLifecycle(existing);
  let to: SchoolNoticeLifecycle = from;
  let actionName = opts.action.toUpperCase();

  if (opts.action === "publish") {
    if (from !== "DRAFT" && from !== "UNPUBLISHED") {
      throw Object.assign(new Error(`Cannot publish from ${from}`), { status: 400 });
    }
    to = "PUBLISHED";
    actionName = from === "UNPUBLISHED" ? "REPUBLISH" : "PUBLISH";
  } else if (opts.action === "republish") {
    if (from !== "UNPUBLISHED") {
      throw Object.assign(new Error("Only unpublished announcements can be republished"), { status: 400 });
    }
    to = "PUBLISHED";
    actionName = "REPUBLISH";
  } else if (opts.action === "unpublish") {
    if (from !== "PUBLISHED") {
      throw Object.assign(new Error("Only published announcements can be unpublished"), { status: 400 });
    }
    to = "UNPUBLISHED";
  } else if (opts.action === "archive") {
    if (from === "ARCHIVED") {
      throw Object.assign(new Error("Already archived"), { status: 400 });
    }
    to = "ARCHIVED";
  }

  const updated = await prisma.schoolNotice.update({
    where: { id: existing.id },
    data: {
      lifecycleStatus: to,
      isDraft: lifecycleToIsDraft(to),
      publishedAt: to === "PUBLISHED" ? new Date() : existing.publishedAt,
      unpublishedAt: to === "UNPUBLISHED" ? new Date() : to === "PUBLISHED" ? null : existing.unpublishedAt,
      archivedAt: to === "ARCHIVED" ? new Date() : existing.archivedAt,
    },
  });

  await writeAudit({
    schoolId: opts.schoolId,
    noticeId: existing.id,
    actor: opts.actor,
    action: actionName,
    previousLifecycle: from,
    newLifecycle: to,
    previousTargeting: targetingFromNotice(existing),
    newTargeting: targetingFromNotice(updated),
  });

  // First publish + republish attempt fan-out. Phase 0 dedupeKey prevents a second row /
  // rewrite when the parent already has an alert for this noticeId (read status preserved).
  if (
    (actionName === "PUBLISH" || actionName === "REPUBLISH") &&
    updated.visibility === "CLASS_TEACHERS"
  ) {
    // Revalidate audience immediately before fan-out (same resolver as preview).
    await fanOutPublishNotifications({
      schoolId: opts.schoolId,
      actor: opts.actor,
      notice: updated,
    });
  }

  return presentAnnouncement(updated);
}

export async function getAnnouncement(schoolId: string, noticeId: string) {
  const notice = await prisma.schoolNotice.findFirst({ where: { id: noticeId, schoolId } });
  return notice ? presentAnnouncement(notice) : null;
}

export async function listAnnouncementAudit(schoolId: string, noticeId: string) {
  return prisma.schoolNoticeAuditLog.findMany({
    where: { schoolId, noticeId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

type ParentLearnerTarget = { id: string; grade: string; className: string | null };

/** Parent notice list with DB targeting + cursor/offset pagination (replaces 300-row scan). */
export async function listParentVisibleNotices(opts: {
  schoolId: string;
  parentId: string;
  learners: ParentLearnerTarget[];
  spellingsFor: (className: string | null | undefined) => string[];
  limit: number;
  offset?: number;
  cursor?: string | null;
}) {
  const limit = Math.min(Math.max(opts.limit, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const cursor = opts.cursor ? String(opts.cursor).trim() : "";

  if (!opts.parentId) {
    return { notices: [], hasMore: false, nextCursor: null as string | null, limit, offset };
  }

  const or = parentNoticeVisibilityOr({
    parentId: opts.parentId,
    learners: opts.learners,
    spellingsFor: opts.spellingsFor,
  });

  const where: Prisma.SchoolNoticeWhereInput = {
    schoolId: opts.schoolId,
    ...parentVisibleNoticeWhere(),
    OR: or,
  };

  const rows = await prisma.schoolNotice.findMany({
    where,
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(cursor
      ? { cursor: { id: cursor }, skip: 1 }
      : offset > 0
        ? { skip: offset }
        : {}),
  });

  const hasMore = rows.length > limit;
  const notices = rows.slice(0, limit);
  return {
    notices,
    hasMore,
    nextCursor: hasMore ? notices[notices.length - 1]?.id || null : null,
    limit,
    offset,
  };
}
