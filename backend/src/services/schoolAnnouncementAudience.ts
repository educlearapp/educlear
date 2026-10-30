/**
 * Shared announcement audience resolution (preview ≡ publish).
 * Individual targeting uses SchoolNotice.audienceParentIds only — never school-wide fallback.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { uniqueParentLearnerLinks } from "./parentPortalService";
import { loadSchoolClassMembership } from "../utils/classroomMembership";
import type { AnnouncementActor } from "./schoolAnnouncementService";

export type AnnouncementAudienceMode = "all_parents" | "by_class" | "individual";
export type AnnouncementClassScope = "grade" | "all_in_grade" | "classroom";

export type AnnouncementAudienceInput = {
  audienceMode?: AnnouncementAudienceMode | string | null;
  classScope?: AnnouncementClassScope | string | null;
  grade?: string | null;
  className?: string | null;
  learnerId?: string | null;
  parentIds?: unknown;
  audienceParentIds?: unknown;
};

export type AnnouncementStoredTargeting = {
  grade: string | null;
  className: string | null;
  learnerId: string | null;
  audienceParentIds: string[] | null;
};

export type AnnouncementAudienceRecipient = {
  parentId: string;
  parentName: string;
  learnerIds: string[];
  learnerLabels: string[];
};

export type AnnouncementAudienceResolution = {
  mode: AnnouncementAudienceMode;
  classScope: AnnouncementClassScope | null;
  label: string;
  targeting: AnnouncementStoredTargeting;
  uniqueParentCount: number;
  learnerCount: number;
  recipients: AnnouncementAudienceRecipient[];
};

/** Parse explicit individual parent ids. Returns null when field absent (legacy/non-individual). */
export function parseAudienceParentIds(raw: unknown): string[] | null {
  if (raw == null) return null;
  if (!Array.isArray(raw)) {
    throw Object.assign(new Error("audienceParentIds must be an array of parent ids"), { status: 400 });
  }
  const ids = [
    ...new Set(
      raw
        .map((v) => String(v || "").trim())
        .filter(Boolean)
    ),
  ];
  if (ids.length === 0) {
    throw Object.assign(
      new Error("Individual parent targeting requires at least one parent id"),
      { status: 400 }
    );
  }
  return ids;
}

/** Safe read for visibility: invalid/empty ⇒ treat as individual-empty (visible to nobody), never school-wide. */
export function readAudienceParentIdsForVisibility(raw: unknown): string[] | "absent" | "invalid_empty" {
  if (raw == null) return "absent";
  if (!Array.isArray(raw)) return "invalid_empty";
  const ids = [...new Set(raw.map((v) => String(v || "").trim()).filter(Boolean))];
  if (ids.length === 0) return "invalid_empty";
  return ids;
}

export function noticeHasExplicitParentAudience(raw: unknown): boolean {
  const v = readAudienceParentIdsForVisibility(raw);
  return v !== "absent";
}

export function parseAudienceMode(raw: unknown): AnnouncementAudienceMode | null {
  const v = String(raw || "").trim();
  if (v === "all_parents" || v === "by_class" || v === "individual") return v;
  return null;
}

export function parseClassScope(raw: unknown): AnnouncementClassScope | null {
  const v = String(raw || "").trim();
  if (v === "grade" || v === "all_in_grade" || v === "classroom") return v;
  return null;
}

function parentDisplayName(p: {
  firstName?: string | null;
  surname?: string | null;
}): string {
  return `${String(p.firstName || "").trim()} ${String(p.surname || "").trim()}`.trim() || "Parent";
}

function inferModeFromStored(t: AnnouncementStoredTargeting): AnnouncementAudienceMode {
  if (t.audienceParentIds && t.audienceParentIds.length) return "individual";
  if (t.className || t.grade || t.learnerId) return "by_class";
  return "all_parents";
}

/**
 * Normalize client/body targeting into stored columns.
 * Rejects empty individual lists. Does not hit the DB.
 */
export function normalizeAnnouncementTargeting(
  input: AnnouncementAudienceInput
): AnnouncementStoredTargeting & { mode: AnnouncementAudienceMode; classScope: AnnouncementClassScope | null } {
  const explicitMode = parseAudienceMode(input.audienceMode);
  const parentIdsRaw = input.parentIds ?? input.audienceParentIds;

  if (explicitMode === "individual" || (parentIdsRaw != null && explicitMode == null)) {
    const parentIds = parseAudienceParentIds(parentIdsRaw);
    return {
      mode: "individual",
      classScope: null,
      grade: null,
      className: null,
      learnerId: null,
      audienceParentIds: parentIds,
    };
  }

  if (explicitMode === "all_parents") {
    return {
      mode: "all_parents",
      classScope: null,
      grade: null,
      className: null,
      learnerId: null,
      audienceParentIds: null,
    };
  }

  // by_class or legacy fields
  const classScope =
    parseClassScope(input.classScope) ||
    (String(input.className || "").trim()
      ? "classroom"
      : String(input.grade || "").trim()
        ? "grade"
        : null);
  const grade = String(input.grade || "").trim() || null;
  const className = String(input.className || "").trim() || null;
  const learnerId = String(input.learnerId || "").trim() || null;

  if (explicitMode === "by_class" || classScope || grade || className || learnerId) {
    if (classScope === "classroom") {
      if (!className) {
        throw Object.assign(new Error("Classroom targeting requires className"), { status: 400 });
      }
      return {
        mode: "by_class",
        classScope: "classroom",
        grade: null,
        className,
        learnerId: null,
        audienceParentIds: null,
      };
    }
    if (classScope === "grade" || classScope === "all_in_grade") {
      if (!grade) {
        throw Object.assign(new Error("Grade targeting requires grade"), { status: 400 });
      }
      return {
        mode: "by_class",
        classScope: classScope || "grade",
        grade,
        className: null,
        learnerId: null,
        audienceParentIds: null,
      };
    }
    if (learnerId) {
      return {
        mode: "by_class",
        classScope: null,
        grade: null,
        className: className,
        learnerId,
        audienceParentIds: null,
      };
    }
    if (className) {
      return {
        mode: "by_class",
        classScope: "classroom",
        grade: null,
        className,
        learnerId: null,
        audienceParentIds: null,
      };
    }
    if (grade) {
      return {
        mode: "by_class",
        classScope: "grade",
        grade,
        className: null,
        learnerId: null,
        audienceParentIds: null,
      };
    }
  }

  // Legacy default: blank targeting = school-wide
  return {
    mode: "all_parents",
    classScope: null,
    grade: null,
    className: null,
    learnerId: null,
    audienceParentIds: null,
  };
}

export function targetingFromNotice(n: {
  grade?: string | null;
  className?: string | null;
  learnerId?: string | null;
  audienceParentIds?: unknown;
}): AnnouncementStoredTargeting {
  let audienceParentIds: string[] | null = null;
  const vis = readAudienceParentIdsForVisibility(n.audienceParentIds);
  if (vis === "invalid_empty") {
    // Persist-safe sentinel: empty array rejected on write; on read treat as empty list (nobody).
    audienceParentIds = [];
  } else if (vis !== "absent") {
    audienceParentIds = vis;
  }
  return {
    grade: n.grade ? String(n.grade).trim() || null : null,
    className: n.className ? String(n.className).trim() || null : null,
    learnerId: n.learnerId ? String(n.learnerId).trim() || null : null,
    audienceParentIds,
  };
}

function audienceLabel(
  mode: AnnouncementAudienceMode,
  classScope: AnnouncementClassScope | null,
  t: AnnouncementStoredTargeting
): string {
  if (mode === "all_parents") return "All Parents (school-wide)";
  if (mode === "individual") {
    const n = t.audienceParentIds?.length || 0;
    return `Individual Parents (${n})`;
  }
  if (classScope === "classroom" || t.className) return `By Class · ${t.className}`;
  if (classScope === "all_in_grade") return `By Class · all classrooms in grade ${t.grade}`;
  if (t.grade) return `By Class · grade ${t.grade}`;
  if (t.learnerId) return "Learner-specific";
  return "By Class";
}

/**
 * Resolve eligible parents for preview and publish. Enforces school isolation and teacher class scope.
 */
export async function resolveAnnouncementAudience(opts: {
  schoolId: string;
  actor: AnnouncementActor;
  input: AnnouncementAudienceInput;
}): Promise<AnnouncementAudienceResolution> {
  const normalized = normalizeAnnouncementTargeting(opts.input);
  const { mode, classScope, ...targeting } = normalized;

  if (mode === "all_parents" && !opts.actor.isSchoolWideAdmin) {
    throw Object.assign(new Error("Only school administrators may target all parents"), {
      status: 403,
    });
  }
  if (mode === "by_class" && (classScope === "grade" || classScope === "all_in_grade") && !opts.actor.isSchoolWideAdmin) {
    throw Object.assign(new Error("Teachers may not target an entire grade"), { status: 403 });
  }
  if (mode === "by_class" && classScope === "classroom" && targeting.className) {
    if (!opts.actor.isSchoolWideAdmin) {
      const allowed = new Set(opts.actor.assignedClassNames.map((c) => String(c || "").trim()).filter(Boolean));
      if (!allowed.has(targeting.className)) {
        throw Object.assign(new Error("You are not assigned to this class"), { status: 403 });
      }
    }
  }
  if (mode === "by_class" && targeting.learnerId && !targeting.className && !opts.actor.isSchoolWideAdmin) {
    throw Object.assign(new Error("Teachers may not manage learner-only announcements without a class"), {
      status: 403,
    });
  }

  const membership = await loadSchoolClassMembership(opts.schoolId);
  const assigned = new Set(opts.actor.assignedClassNames.map((c) => String(c || "").trim()).filter(Boolean));

  let links = await prisma.parentLearnerLink.findMany({
    where: { schoolId: opts.schoolId },
    include: {
      learner: { select: { id: true, firstName: true, lastName: true, grade: true, className: true } },
      parent: { select: { id: true, firstName: true, surname: true, schoolId: true } },
    },
  });

  // Cross-school guard
  links = links.filter((l) => l.parent?.schoolId === opts.schoolId);

  if (mode === "individual") {
    const wanted = new Set(targeting.audienceParentIds || []);
    if (!wanted.size) {
      throw Object.assign(new Error("Individual parent targeting requires at least one parent id"), {
        status: 400,
      });
    }
    const foundParents = await prisma.parent.findMany({
      where: { schoolId: opts.schoolId, id: { in: [...wanted] } },
      select: { id: true },
    });
    const found = new Set(foundParents.map((p) => p.id));
    const missing = [...wanted].filter((id) => !found.has(id));
    if (missing.length) {
      throw Object.assign(new Error("One or more parents are not in this school"), { status: 400 });
    }
    links = links.filter((l) => wanted.has(l.parentId));
    if (!opts.actor.isSchoolWideAdmin) {
      links = links.filter((l) => {
        const cn = String(l.learner.className || "").trim();
        if (assigned.has(cn)) return true;
        for (const a of assigned) {
          if (membership.resolver.sameClassroom(a, cn)) return true;
        }
        return false;
      });
      const remainingParents = new Set(links.map((l) => l.parentId));
      const unauthorized = [...wanted].filter((id) => !remainingParents.has(id));
      if (unauthorized.length) {
        throw Object.assign(
          new Error("You may only message parents linked to your assigned classrooms"),
          { status: 403 }
        );
      }
    }
  } else if (mode === "by_class") {
    links = links.filter((link) => {
      if (targeting.learnerId && targeting.learnerId === link.learnerId) return true;
      if (targeting.grade && targeting.grade === link.learner.grade) return true;
      if (
        targeting.className &&
        membership.resolver.sameClassroom(targeting.className, link.learner.className)
      ) {
        return true;
      }
      return false;
    });
    if (!opts.actor.isSchoolWideAdmin && targeting.className) {
      // already permission-checked; filter is class match only
    }
  } else {
    // all_parents — no extra filter
  }

  const deduped = uniqueParentLearnerLinks(links);
  const byParent = new Map<
    string,
    { parent: (typeof links)[0]["parent"]; learnerIds: string[]; learnerLabels: string[] }
  >();
  for (const link of links) {
    const cur = byParent.get(link.parentId) || {
      parent: link.parent,
      learnerIds: [],
      learnerLabels: [],
    };
    if (!cur.learnerIds.includes(link.learnerId)) {
      cur.learnerIds.push(link.learnerId);
      const label = `${link.learner.firstName || ""} ${link.learner.lastName || ""}`.trim();
      const cls = link.learner.className ? ` (${link.learner.className})` : "";
      cur.learnerLabels.push(`${label || "Learner"}${cls}`);
    }
    byParent.set(link.parentId, cur);
  }

  // Prefer uniqueParentLearnerLinks order for parent set, but aggregate all learners per parent
  const parentOrder = deduped.map((l) => l.parentId);
  const recipients: AnnouncementAudienceRecipient[] = parentOrder.map((parentId) => {
    const row = byParent.get(parentId)!;
    return {
      parentId,
      parentName: parentDisplayName(row.parent),
      learnerIds: row.learnerIds,
      learnerLabels: row.learnerLabels,
    };
  });

  const learnerCount = new Set(links.map((l) => l.learnerId)).size;

  return {
    mode,
    classScope,
    label: audienceLabel(mode, classScope, targeting),
    targeting: {
      grade: targeting.grade,
      className: targeting.className,
      learnerId: targeting.learnerId,
      audienceParentIds: targeting.audienceParentIds,
    },
    uniqueParentCount: recipients.length,
    learnerCount,
    recipients,
  };
}

export function storedTargetingToAudienceInput(t: AnnouncementStoredTargeting): AnnouncementAudienceInput {
  const mode = inferModeFromStored(t);
  if (mode === "individual") {
    return { audienceMode: "individual", parentIds: t.audienceParentIds || [] };
  }
  if (mode === "all_parents") {
    return { audienceMode: "all_parents" };
  }
  if (t.className) {
    return { audienceMode: "by_class", classScope: "classroom", className: t.className };
  }
  if (t.grade) {
    return { audienceMode: "by_class", classScope: "grade", grade: t.grade };
  }
  if (t.learnerId) {
    return { audienceMode: "by_class", learnerId: t.learnerId, className: t.className };
  }
  return { audienceMode: "all_parents" };
}

/** Prisma OR branch for parent-visible notices for one authenticated parent + their learners. */
export function parentNoticeVisibilityOr(opts: {
  parentId: string;
  learners: { id: string; grade: string; className: string | null }[];
  spellingsFor: (className: string | null | undefined) => string[];
}): Prisma.SchoolNoticeWhereInput[] {
  const or: Prisma.SchoolNoticeWhereInput[] = [
    // School-wide: no grade/class/learner AND no explicit parent audience
    {
      AND: [
        { learnerId: null },
        { grade: null },
        { className: null },
        { audienceParentIds: { equals: Prisma.DbNull } },
      ],
    },
    // Explicit individual: JSON array contains this parent id
    {
      audienceParentIds: { array_contains: opts.parentId },
    },
  ];
  for (const learner of opts.learners) {
    or.push({ learnerId: learner.id });
    if (learner.grade) or.push({ grade: learner.grade });
    const spellings = learner.className ? opts.spellingsFor(learner.className) : [];
    if (spellings.length) or.push({ className: { in: spellings } });
  }
  return or;
}

export function parentMayViewNotice(opts: {
  parentId: string;
  learners: { id: string; grade: string; className: string | null }[];
  notice: {
    learnerId?: string | null;
    grade?: string | null;
    className?: string | null;
    audienceParentIds?: unknown;
  };
  sameClassroom: (a: string, b: string | null | undefined) => boolean;
}): boolean {
  const audience = readAudienceParentIdsForVisibility(opts.notice.audienceParentIds);
  if (audience === "invalid_empty") return false;
  if (audience !== "absent") {
    return audience.includes(opts.parentId);
  }
  for (const learner of opts.learners) {
    if (opts.notice.learnerId && opts.notice.learnerId === learner.id) return true;
    if (opts.notice.grade && opts.notice.grade === learner.grade) return true;
    if (
      opts.notice.className &&
      opts.sameClassroom(opts.notice.className, learner.className)
    ) {
      return true;
    }
  }
  if (!opts.notice.learnerId && !opts.notice.grade && !opts.notice.className) return true;
  return false;
}
