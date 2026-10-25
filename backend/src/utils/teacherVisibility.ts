import type { TeacherContentVisibility } from "@prisma/client";
import { normalizeStaffEmail } from "./staffJwt";

export type TeacherVisibilityContext = {
  userId: string;
  email: string;
  role: string;
};

export function isSchoolAdminRole(role: string): boolean {
  return role === "SCHOOL_ADMIN";
}

export function normalizeTeacherVisibility(raw: unknown): TeacherContentVisibility {
  const v = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");
  if (v === "PRIVATE") return "PRIVATE";
  if (v === "ADMIN") return "ADMIN";
  return "CLASS_TEACHERS";
}

export function visibilityLabel(visibility: TeacherContentVisibility): string {
  switch (visibility) {
    case "PRIVATE":
      return "Private to me";
    case "ADMIN":
      return "Visible to school admin";
    default:
      return "Shared with class teachers";
  }
}

type OwnableItem = {
  createdByTeacherId?: string | null;
  createdBy?: string | null;
  visibility?: TeacherContentVisibility | null;
};

export function isItemOwner(item: OwnableItem, ctx: TeacherVisibilityContext): boolean {
  if (item.createdByTeacherId && item.createdByTeacherId === ctx.userId) return true;
  const ownerEmail = normalizeStaffEmail(String(item.createdBy || ""));
  const myEmail = normalizeStaffEmail(ctx.email);
  return Boolean(ownerEmail && myEmail && ownerEmail === myEmail);
}

/** Whether a teacher (non-admin) may view this item. Admins always see all. */
export function teacherCanViewItem(item: OwnableItem, ctx: TeacherVisibilityContext): boolean {
  if (isSchoolAdminRole(ctx.role)) return true;
  if (isItemOwner(item, ctx)) return true;
  const vis = item.visibility ?? "CLASS_TEACHERS";
  if (vis === "CLASS_TEACHERS") return true;
  return false;
}

/** Prisma OR filter for teacher-visible content in assigned classes. */
export function teacherVisibilityWhere(ctx: TeacherVisibilityContext) {
  if (isSchoolAdminRole(ctx.role)) {
    return {};
  }
  const myEmail = normalizeStaffEmail(ctx.email);
  return {
    OR: [
      { visibility: "CLASS_TEACHERS" as const },
      { createdByTeacherId: ctx.userId },
      ...(myEmail ? [{ createdBy: myEmail }] : []),
    ],
  };
}

export function shouldNotifyParents(visibility: TeacherContentVisibility, isDraft: boolean): boolean {
  if (isDraft) return false;
  return visibility === "CLASS_TEACHERS";
}

/**
 * Parent-facing publish gate — mirrors shouldNotifyParents.
 * HomeworkPost / SchoolNotice: non-draft + CLASS_TEACHERS.
 */
export function parentPublishedHomeworkOrNoticeWhere() {
  return {
    isDraft: false,
    visibility: "CLASS_TEACHERS" as const,
  };
}

/** ParentDocument has visibility but no isDraft field. */
export function parentPublishedDocumentWhere() {
  return {
    visibility: "CLASS_TEACHERS" as const,
  };
}

/** LearnerIncident: parentVisible flag + CLASS_TEACHERS visibility. */
export function parentPublishedIncidentWhere() {
  return {
    parentVisible: true,
    visibility: "CLASS_TEACHERS" as const,
  };
}

/** In-memory check when a row may predate visibility defaults. */
export function isParentPublishedContent(item: {
  isDraft?: boolean | null;
  visibility?: TeacherContentVisibility | string | null;
  parentVisible?: boolean | null;
  hasDraftField?: boolean;
  hasParentVisibleField?: boolean;
}): boolean {
  if (item.hasParentVisibleField && item.parentVisible === false) return false;
  if (item.hasDraftField !== false && item.isDraft === true) return false;
  const vis = String(item.visibility || "CLASS_TEACHERS").toUpperCase();
  return vis === "CLASS_TEACHERS";
}
