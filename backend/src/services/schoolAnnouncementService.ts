import type {
  Prisma,
  SchoolNoticeLifecycle,
  SchoolNoticeType,
  TeacherContentVisibility,
} from "@prisma/client";
import { prisma } from "../prisma";
import { createParentNotification, uniqueParentLearnerLinks } from "./parentPortalService";
import { loadSchoolClassMembership } from "../utils/classroomMembership";

export type AnnouncementTargeting = {
  grade?: string | null;
  className?: string | null;
  learnerId?: string | null;
};

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

/** Parent-facing notice gate: published + class-teacher visibility + legacy isDraft false. */
export function parentVisibleNoticeWhere() {
  return {
    lifecycleStatus: "PUBLISHED" as const,
    visibility: "CLASS_TEACHERS" as const,
    isDraft: false,
  };
}

export function targetingSnapshot(n: AnnouncementTargeting) {
  return {
    grade: n.grade ?? null,
    className: n.className ?? null,
    learnerId: n.learnerId ?? null,
  };
}

export function isSchoolWideTarget(t: AnnouncementTargeting): boolean {
  return !String(t.className || "").trim() && !String(t.learnerId || "").trim();
  // grade-only still counts as school-admin scope (not class-assigned)
}

export function assertActorMayManageTarget(actor: AnnouncementActor, t: AnnouncementTargeting): string | null {
  const className = String(t.className || "").trim();
  const learnerId = String(t.learnerId || "").trim();
  const grade = String(t.grade || "").trim();

  if (actor.isSchoolWideAdmin) return null;

  // Teachers: class-scoped only (must have className in assigned set); no school-wide / grade-only / learner-only.
  if (!className) {
    return "Teachers may only manage class-scoped announcements for assigned classrooms";
  }
  if (grade && !className) {
    return "Teachers may not publish grade-only announcements";
  }
  if (learnerId && !className) {
    return "Teachers may not manage learner-only announcements without a class";
  }
  const allowed = new Set(actor.assignedClassNames.map((c) => String(c || "").trim()).filter(Boolean));
  if (!allowed.has(className)) {
    return "You are not assigned to this class";
  }
  return null;
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
  notice: {
    id: string;
    title: string;
    body: string;
    noticeType: SchoolNoticeType;
    grade: string | null;
    className: string | null;
    learnerId: string | null;
  };
}) {
  const notifType =
    opts.notice.noticeType === "ASSESSMENT"
      ? ("ASSESSMENT" as const)
      : opts.notice.noticeType === "EXAM"
        ? ("EXAM" as const)
        : ("SCHOOL_NOTICE" as const);

  const membership = await loadSchoolClassMembership(opts.schoolId);
  const links = await prisma.parentLearnerLink.findMany({
    where: { schoolId: opts.schoolId },
    include: { learner: true },
  });

  const matched = uniqueParentLearnerLinks(
    links.filter((link) => {
      const n = opts.notice;
      if (n.learnerId && n.learnerId === link.learnerId) return true;
      if (n.grade && n.grade === link.learner.grade) return true;
      if (n.className && membership.resolver.sameClassroom(n.className, link.learner.className)) {
        return true;
      }
      if (!n.learnerId && !n.grade && !n.className) return true;
      return false;
    })
  );

  for (const link of matched) {
    await createParentNotification({
      schoolId: opts.schoolId,
      parentId: link.parentId,
      learnerId: link.learnerId,
      type: notifType,
      title: opts.notice.title,
      message: String(opts.notice.body || opts.notice.title).slice(0, 500),
      metadata: { noticeId: opts.notice.id },
    });
  }
  return matched.length;
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

  const where: Prisma.SchoolNoticeWhereInput = {
    schoolId: opts.schoolId,
    ...(lifecycle !== "ALL" ? { lifecycleStatus: lifecycle } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { body: { contains: q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  if (!opts.actor.isSchoolWideAdmin) {
    const classes = opts.actor.assignedClassNames.filter(Boolean);
    where.className = classes.length ? { in: classes } : "__none__";
  }

  const rows = await prisma.schoolNotice.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
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

  const targeting = {
    grade: opts.targeting.grade ? String(opts.targeting.grade).trim() || null : null,
    className: opts.targeting.className ? String(opts.targeting.className).trim() || null : null,
    learnerId: opts.targeting.learnerId ? String(opts.targeting.learnerId).trim() || null : null,
  };
  const deny = assertActorMayManageTarget(opts.actor, targeting);
  if (deny) throw Object.assign(new Error(deny), { status: 403 });

  const lifecycle: SchoolNoticeLifecycle = opts.publishNow ? "PUBLISHED" : "DRAFT";
  const visibility = opts.visibility || "CLASS_TEACHERS";
  const notice = await prisma.schoolNotice.create({
    data: {
      schoolId: opts.schoolId,
      noticeType: mapNoticeType(opts.noticeType || (targeting.className ? "CLASS" : "SCHOOL")),
      title,
      body,
      grade: targeting.grade,
      className: targeting.className,
      learnerId: targeting.learnerId,
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
  });

  if (opts.publishNow && visibility === "CLASS_TEACHERS") {
    await fanOutPublishNotifications({ schoolId: opts.schoolId, notice });
  }

  return notice;
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
  if (existing.lifecycleStatus === "ARCHIVED") {
    throw Object.assign(new Error("Archived announcements cannot be edited"), { status: 400 });
  }

  const denyExisting = assertActorMayManageTarget(opts.actor, existing);
  if (denyExisting) throw Object.assign(new Error(denyExisting), { status: 403 });

  const nextTarget = {
    grade:
      opts.targeting && "grade" in opts.targeting
        ? opts.targeting.grade
          ? String(opts.targeting.grade).trim() || null
          : null
        : existing.grade,
    className:
      opts.targeting && "className" in opts.targeting
        ? opts.targeting.className
          ? String(opts.targeting.className).trim() || null
          : null
        : existing.className,
    learnerId:
      opts.targeting && "learnerId" in opts.targeting
        ? opts.targeting.learnerId
          ? String(opts.targeting.learnerId).trim() || null
          : null
        : existing.learnerId,
  };
  const denyNext = assertActorMayManageTarget(opts.actor, nextTarget);
  if (denyNext) throw Object.assign(new Error(denyNext), { status: 403 });

  const updated = await prisma.schoolNotice.update({
    where: { id: existing.id },
    data: {
      title: opts.title != null ? String(opts.title).trim() || existing.title : existing.title,
      body: opts.body != null ? String(opts.body) : existing.body,
      noticeType: opts.noticeType ? mapNoticeType(opts.noticeType) : existing.noticeType,
      grade: nextTarget.grade,
      className: nextTarget.className,
      learnerId: nextTarget.learnerId,
      visibility: opts.visibility || existing.visibility,
      // Ordinary edits do not change lifecycle / do not re-notify.
    },
  });

  await writeAudit({
    schoolId: opts.schoolId,
    noticeId: existing.id,
    actor: opts.actor,
    action: existing.lifecycleStatus === "PUBLISHED" ? "EDIT_PUBLISHED" : "EDIT_DRAFT",
    previousLifecycle: existing.lifecycleStatus,
    newLifecycle: existing.lifecycleStatus,
    previousTargeting: existing,
    newTargeting: nextTarget,
    detail: { titleChanged: opts.title != null, bodyChanged: opts.body != null },
  });

  return updated;
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

  const deny = assertActorMayManageTarget(opts.actor, existing);
  if (deny) throw Object.assign(new Error(deny), { status: 403 });

  const from = existing.lifecycleStatus;
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
    previousTargeting: existing,
    newTargeting: existing,
  });

  // Notify on first publish from DRAFT, CREATE_AND_PUBLISH path, and REPUBLISH attempts.
  // Phase 0 dedupeKey (school+parent+noticeId) prevents duplicate rows / rewrite of existing alerts.
  if (
    (actionName === "PUBLISH" || actionName === "REPUBLISH") &&
    updated.visibility === "CLASS_TEACHERS"
  ) {
    await fanOutPublishNotifications({ schoolId: opts.schoolId, notice: updated });
  }

  return updated;
}

export async function getAnnouncement(schoolId: string, noticeId: string) {
  return prisma.schoolNotice.findFirst({ where: { id: noticeId, schoolId } });
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
  learners: ParentLearnerTarget[];
  spellingsFor: (className: string | null | undefined) => string[];
  limit: number;
  offset?: number;
  cursor?: string | null;
}) {
  const limit = Math.min(Math.max(opts.limit, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  const cursor = opts.cursor ? String(opts.cursor).trim() : "";

  if (!opts.learners.length) {
    return { notices: [], hasMore: false, nextCursor: null as string | null, limit, offset };
  }

  const or: Prisma.SchoolNoticeWhereInput[] = [
    { AND: [{ learnerId: null }, { grade: null }, { className: null }] },
  ];
  for (const learner of opts.learners) {
    or.push({ learnerId: learner.id });
    if (learner.grade) or.push({ grade: learner.grade });
    const spellings = learner.className ? opts.spellingsFor(learner.className) : [];
    if (spellings.length) or.push({ className: { in: spellings } });
  }

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
