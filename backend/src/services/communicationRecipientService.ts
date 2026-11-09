import { prisma } from "../prisma";
import { normalizeSaPhone } from "./parentPortalService";
import { loadSchoolClassMembership, type SchoolClassMembership } from "../utils/classroomMembership";
import { ACTIVE_LEARNER_WHERE } from "../utils/learnerEnrollment";
import { analyseSmsMessage, SMS_CREDITS_PER_SEGMENT } from "./smsSegmentCalculator";

export type CommunicationRecipientChannel = "email" | "sms";
export type CommunicationRecipientKind = "parents" | "learners" | "teachers" | "employees" | "all";

/** Parent-focused audience modes. Omit / legacy keeps prior kind+className behaviour. */
export type CommunicationAudienceMode = "legacy" | "individual" | "all_parents" | "by_class";

/**
 * by_class scopes:
 * - classroom: one classroom (className required)
 * - grade: entire grade (grade required; match Learner.grade)
 * - all_in_grade: all classrooms that contain learners of that grade
 */
export type CommunicationClassScope = "classroom" | "grade" | "all_in_grade";

export type CommunicationActor = {
  isSchoolWideAdmin: boolean;
  assignedClassNames: string[];
};

export type CommunicationAudienceTargeting = {
  audience?: CommunicationAudienceMode | string | null;
  grade?: string | null;
  className?: string | null;
  classScope?: CommunicationClassScope | string | null;
  kind?: CommunicationRecipientKind | string | null;
};

export type CommunicationRecipient = {
  id: string;
  contactName: string;
  relationship: string;
  email?: string;
  cellNo?: string;
  source: "parent" | "learner" | "teacher" | "employee";
  sourceId: string;
  learnerIds: string[];
  classNames: string[];
};

export type CommunicationRecipientsResult = {
  contacts: CommunicationRecipient[];
  classFilters: string[];
  gradeFilters: string[];
  classroomsByGrade: Record<string, string[]>;
  counts: {
    parents: number;
    learners: number;
    teachers: number;
    employees: number;
    total: number;
  };
};

function clean(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value: unknown) {
  const email = clean(value).toLowerCase();
  return isValidEmail(email) ? email : "";
}

function normalizeSms(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  const normalized = normalizeSaPhone(raw).plainInternational;
  return normalized.length >= 10 ? normalized : "";
}

function matchesClass(membership: SchoolClassMembership, classNames: string[], className: string) {
  if (!className) return true;
  return classNames.some((name) => membership.resolver.sameClassroom(name, className));
}

function contactKey(channel: CommunicationRecipientChannel, contact: CommunicationRecipient) {
  return channel === "email" ? String(contact.email || "").toLowerCase() : normalizeSms(contact.cellNo);
}

function pushUnique(
  contacts: CommunicationRecipient[],
  seen: Set<string>,
  channel: CommunicationRecipientChannel,
  contact: CommunicationRecipient
) {
  const key = contactKey(channel, contact);
  if (!key || seen.has(key)) return;
  seen.add(key);
  contacts.push(contact);
}

export function parseAudienceMode(raw: unknown): CommunicationAudienceMode {
  const value = clean(raw).toLowerCase();
  if (value === "individual" || value === "all_parents" || value === "by_class") return value;
  return "legacy";
}

export function parseClassScope(raw: unknown): CommunicationClassScope {
  const value = clean(raw).toLowerCase();
  if (value === "grade" || value === "all_in_grade") return value;
  return "classroom";
}

/**
 * School-wide / grade-wide / unassigned-class rules for Communication Centre contacts+send.
 * Returns null when allowed, otherwise a staff-facing deny reason.
 */
export function assertCommunicationAudienceAllowed(
  actor: CommunicationActor,
  targeting: CommunicationAudienceTargeting
): string | null {
  const audience = parseAudienceMode(targeting.audience);
  const kind = (clean(targeting.kind || "parents") || "parents") as CommunicationRecipientKind;
  const grade = clean(targeting.grade);
  const className = clean(targeting.className);
  const classScope = parseClassScope(targeting.classScope);

  if (actor.isSchoolWideAdmin) {
    if (audience === "by_class") {
      if (classScope === "classroom" && !className) {
        return "Select a classroom, or choose All Parents / a grade scope.";
      }
      if ((classScope === "grade" || classScope === "all_in_grade") && !grade) {
        return "Select a grade for grade-based messaging.";
      }
    }
    return null;
  }

  // Teachers: no school-wide parent blasts, no employees/all-school, no grade-wide.
  if (audience === "all_parents") {
    return "Teachers may only message parents of their assigned classrooms.";
  }
  if (kind === "employees" || kind === "all") {
    return "Teachers may not load school-wide employee or all-contact lists.";
  }
  if (audience === "by_class" && (classScope === "grade" || classScope === "all_in_grade")) {
    return "Teachers may not message an entire grade. Choose one assigned classroom.";
  }
  if (grade && !className && audience !== "individual") {
    return "Teachers may not message by grade alone.";
  }

  const assigned = new Set(actor.assignedClassNames.map((c) => clean(c)).filter(Boolean));
  if (!assigned.size) {
    return "No assigned classrooms. Ask an administrator to assign your classes.";
  }

  if (className) {
    const ok = [...assigned].some((name) => name === className);
    // Membership-insensitive exact match first; callers also pass labels from filters.
    if (!ok) {
      return "You may only message parents linked to your assigned classrooms.";
    }
  }

  // Legacy / individual without class: only allowed when we will restrict to assigned classes in the loader.
  if (!className && (audience === "legacy" || audience === "individual") && (kind === "parents" || kind === "teachers")) {
    return null;
  }

  if (!className && audience === "by_class") {
    return "Select one of your assigned classrooms.";
  }

  if (!className && kind === "parents" && audience === "legacy") {
    return null;
  }

  return null;
}

/** Whether a loaded/submitted contact is within the actor's messaging rights. */
export function assertContactAllowedForActor(
  actor: CommunicationActor,
  contact: {
    source?: string;
    sourceId?: string;
    classNames?: string[];
    contactName?: string;
  },
  membership?: SchoolClassMembership | null
): string | null {
  if (actor.isSchoolWideAdmin) return null;

  const source = clean(contact.source);
  if (source !== "parent" || !clean(contact.sourceId)) {
    return "Teachers may only send to verified parents linked to their assigned classrooms.";
  }

  const assigned = actor.assignedClassNames.map((c) => clean(c)).filter(Boolean);
  const classNames = Array.isArray(contact.classNames) ? contact.classNames.map(clean).filter(Boolean) : [];
  if (!classNames.length) {
    return `Parent ${clean(contact.contactName) || contact.sourceId} is not linked to your assigned classrooms.`;
  }

  const overlaps = classNames.some((cn) =>
    assigned.some((a) => (membership ? membership.resolver.sameClassroom(cn, a) : cn === a))
  );
  if (!overlaps) {
    return `Parent ${clean(contact.contactName) || contact.sourceId} is not linked to your assigned classrooms.`;
  }
  return null;
}

export function assertContactsAllowedForActor(
  actor: CommunicationActor,
  contacts: Array<{
    source?: string;
    sourceId?: string;
    classNames?: string[];
    contactName?: string;
  }>,
  membership?: SchoolClassMembership | null
): string | null {
  if (!contacts.length) return "Add at least one contact before sending";
  for (const contact of contacts) {
    const deny = assertContactAllowedForActor(actor, contact, membership);
    if (deny) return deny;
  }
  return null;
}

export function estimateCommunicationSmsCredits(message: string, recipientCount: number) {
  const segments = analyseSmsMessage(String(message || "").trim()).segments || 0;
  const recipients = Math.max(0, Math.floor(Number(recipientCount) || 0));
  return {
    segments,
    recipientCount: recipients,
    estimatedCredits: segments * recipients * SMS_CREDITS_PER_SEGMENT,
  };
}

async function loadClassFilters(membership: SchoolClassMembership) {
  return membership.classLabels();
}

async function loadGradeCatalog(schoolId: string, membership: SchoolClassMembership) {
  const learners = await prisma.learner.findMany({
    where: { schoolId, ...ACTIVE_LEARNER_WHERE },
    select: { grade: true, className: true },
  });
  const gradeSet = new Set<string>();
  const classroomsByGrade: Record<string, Set<string>> = {};
  for (const learner of learners) {
    const grade = clean(learner.grade);
    if (!grade) continue;
    gradeSet.add(grade);
    const label = membership.labelFor(learner.className);
    if (!label) continue;
    if (!classroomsByGrade[grade]) classroomsByGrade[grade] = new Set();
    classroomsByGrade[grade].add(label);
  }
  const gradeFilters = Array.from(gradeSet).sort((a, b) => a.localeCompare(b));
  const mapped: Record<string, string[]> = {};
  for (const grade of gradeFilters) {
    mapped[grade] = Array.from(classroomsByGrade[grade] || []).sort((a, b) => a.localeCompare(b));
  }
  return { gradeFilters, classroomsByGrade: mapped };
}

async function classroomLabelsForGrade(
  schoolId: string,
  grade: string,
  membership: SchoolClassMembership
): Promise<string[]> {
  const learners = await prisma.learner.findMany({
    where: { schoolId, ...ACTIVE_LEARNER_WHERE, grade },
    select: { className: true },
  });
  const labels = new Set<string>();
  for (const learner of learners) {
    const label = membership.labelFor(learner.className);
    if (label) labels.add(label);
  }
  return Array.from(labels);
}

async function loadParentRecipients(
  schoolId: string,
  channel: CommunicationRecipientChannel,
  opts: {
    className: string;
    grade: string;
    classScope: CommunicationClassScope;
    restrictToClassNames?: string[];
  },
  membership: SchoolClassMembership
) {
  const learnerWhere: Record<string, unknown> = { ...ACTIVE_LEARNER_WHERE };

  if (opts.grade && opts.classScope === "grade") {
    learnerWhere.grade = opts.grade;
  } else if (opts.grade && opts.classScope === "all_in_grade") {
    const labels = await classroomLabelsForGrade(schoolId, opts.grade, membership);
    const spellings = labels.flatMap((label) => membership.spellingsFor(label));
    if (!spellings.length) return [];
    learnerWhere.className = { in: spellings };
  } else if (opts.className) {
    learnerWhere.className = { in: membership.spellingsFor(opts.className) };
  } else if (opts.restrictToClassNames?.length) {
    const spellings = opts.restrictToClassNames.flatMap((label) => membership.spellingsFor(label));
    if (!spellings.length) return [];
    learnerWhere.className = { in: spellings };
  }

  const hasLearnerFilter =
    Boolean(opts.className) ||
    Boolean(opts.grade) ||
    Boolean(opts.restrictToClassNames?.length) ||
    opts.classScope === "all_in_grade";

  const links = await prisma.parentLearnerLink.findMany({
    where: {
      schoolId,
      learner: hasLearnerFilter ? learnerWhere : undefined,
    },
    include: {
      parent: {
        select: {
          id: true,
          firstName: true,
          surname: true,
          email: true,
          cellNo: true,
          communicationByEmail: true,
          communicationBySMS: true,
        },
      },
      learner: {
        select: {
          id: true,
          className: true,
          grade: true,
        },
      },
    },
  });

  const byParent = new Map<
    string,
    {
      id: string;
      contactName: string;
      email: string;
      cellNo: string;
      learnerIds: Set<string>;
      classNames: Set<string>;
    }
  >();

  for (const link of links) {
    const parent = link.parent;
    if (!parent) continue;
    if (channel === "email" && parent.communicationByEmail === false) continue;
    if (channel === "sms" && parent.communicationBySMS === false) continue;

    const email = normalizeEmail(parent.email);
    const cellNo = normalizeSms(parent.cellNo);
    if (channel === "email" && !email) continue;
    if (channel === "sms" && !cellNo) continue;

    const current =
      byParent.get(parent.id) ||
      {
        id: parent.id,
        contactName: clean(`${parent.firstName || ""} ${parent.surname || ""}`) || "Parent/Guardian",
        email,
        cellNo,
        learnerIds: new Set<string>(),
        classNames: new Set<string>(),
      };
    current.learnerIds.add(link.learnerId);
    const linkedClassName = clean(link.learner?.className);
    if (linkedClassName) current.classNames.add(linkedClassName);
    byParent.set(parent.id, current);
  }

  let contacts = Array.from(byParent.values()).map(
    (parent): CommunicationRecipient => ({
      id: `parent:${parent.id}`,
      contactName: parent.contactName,
      relationship: "Parent/Guardian",
      email: parent.email,
      cellNo: parent.cellNo,
      source: "parent",
      sourceId: parent.id,
      learnerIds: Array.from(parent.learnerIds),
      classNames: Array.from(parent.classNames).sort((a, b) => a.localeCompare(b)),
    })
  );

  if (opts.className) {
    contacts = contacts.filter((contact) => matchesClass(membership, contact.classNames, opts.className));
  }
  if (opts.restrictToClassNames?.length && !opts.className) {
    contacts = contacts.filter((contact) =>
      contact.classNames.some((cn) =>
        opts.restrictToClassNames!.some((allowed) => membership.resolver.sameClassroom(cn, allowed))
      )
    );
  }

  return contacts;
}

async function loadTeacherRecipients(
  schoolId: string,
  channel: CommunicationRecipientChannel,
  className: string,
  membership: SchoolClassMembership,
  restrictToClassNames?: string[]
) {
  if (channel !== "email") return [];
  const effectiveClass =
    className ||
    (restrictToClassNames?.length === 1 ? restrictToClassNames[0] : "");
  const targetClassroomId = effectiveClass
    ? membership.resolver.classroomFor(effectiveClass)?.id ?? "__no_classroom__"
    : null;

  let classroomIdFilter: string[] | undefined;
  if (!targetClassroomId && restrictToClassNames?.length) {
    classroomIdFilter = restrictToClassNames
      .map((label) => membership.resolver.classroomFor(label)?.id)
      .filter((id): id is string => Boolean(id));
    if (!classroomIdFilter.length) return [];
  }

  const [classroomTeachers, classrooms] = await Promise.all([
    prisma.classroomTeacher.findMany({
      where: {
        schoolId,
        ...(targetClassroomId
          ? { classroomId: targetClassroomId }
          : classroomIdFilter
            ? { classroomId: { in: classroomIdFilter } }
            : {}),
      },
      include: {
        classroom: { select: { name: true } },
      },
    }),
    prisma.classroom.findMany({
      where: {
        schoolId,
        ...(targetClassroomId
          ? { id: targetClassroomId }
          : classroomIdFilter
            ? { id: { in: classroomIdFilter } }
            : {}),
      },
      select: { id: true, name: true, teacherName: true, teacherEmail: true },
    }),
  ]);

  const contacts: CommunicationRecipient[] = [];
  for (const teacher of classroomTeachers) {
    const email = normalizeEmail(teacher.teacherEmail);
    if (!email) continue;
    const teacherClassName = clean(teacher.classroom?.name);
    contacts.push({
      id: `teacher:${teacher.id}`,
      contactName: clean(teacher.teacherName) || "Teacher",
      relationship: "Teacher",
      email,
      source: "teacher",
      sourceId: teacher.id,
      learnerIds: [],
      classNames: teacherClassName ? [teacherClassName] : [],
    });
  }

  for (const classroom of classrooms) {
    const email = normalizeEmail(classroom.teacherEmail);
    if (!email) continue;
    const teacherClassName = clean(classroom.name);
    contacts.push({
      id: `classroom-teacher:${classroom.id}`,
      contactName: clean(classroom.teacherName) || "Teacher",
      relationship: "Teacher",
      email,
      source: "teacher",
      sourceId: classroom.id,
      learnerIds: [],
      classNames: teacherClassName ? [teacherClassName] : [],
    });
  }

  let filtered = contacts;
  if (effectiveClass) {
    filtered = filtered.filter((contact) => matchesClass(membership, contact.classNames, effectiveClass));
  } else if (restrictToClassNames?.length) {
    filtered = filtered.filter((contact) =>
      contact.classNames.some((cn) =>
        restrictToClassNames.some((allowed) => membership.resolver.sameClassroom(cn, allowed))
      )
    );
  }
  return filtered;
}

async function loadEmployeeRecipients(schoolId: string, channel: CommunicationRecipientChannel) {
  const employees = await prisma.employee.findMany({
    where: { schoolId, isActive: true },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      fullName: true,
      email: true,
      mobileNumber: true,
      jobTitle: true,
    },
  });

  return employees
    .map((employee): CommunicationRecipient | null => {
      const email = normalizeEmail(employee.email);
      const cellNo = normalizeSms(employee.mobileNumber);
      if (channel === "email" && !email) return null;
      if (channel === "sms" && !cellNo) return null;
      return {
        id: `employee:${employee.id}`,
        contactName:
          clean(employee.fullName) ||
          clean(`${employee.firstName || ""} ${employee.lastName || ""}`) ||
          "Employee",
        relationship: clean(employee.jobTitle) || "Employee",
        email,
        cellNo,
        source: "employee",
        sourceId: employee.id,
        learnerIds: [],
        classNames: [],
      };
    })
    .filter((contact): contact is CommunicationRecipient => Boolean(contact));
}

function restrictClassNamesForActor(
  actor: CommunicationActor | undefined,
  className: string
): string[] | undefined {
  if (!actor || actor.isSchoolWideAdmin) return undefined;
  const assigned = actor.assignedClassNames.map(clean).filter(Boolean);
  if (className) return undefined;
  return assigned;
}

export async function loadCommunicationRecipients(opts: {
  schoolId: string;
  channel: CommunicationRecipientChannel;
  kind: CommunicationRecipientKind;
  className?: string;
  grade?: string;
  audience?: CommunicationAudienceMode | string;
  classScope?: CommunicationClassScope | string;
  actor?: CommunicationActor;
}): Promise<CommunicationRecipientsResult> {
  const schoolId = clean(opts.schoolId);
  const channel = opts.channel === "sms" ? "sms" : "email";
  const kind = opts.kind || "parents";
  const audience = parseAudienceMode(opts.audience);
  const classScope = parseClassScope(opts.classScope);
  const className = clean(opts.className);
  const grade = clean(opts.grade);
  const actor = opts.actor;

  const deny = assertCommunicationAudienceAllowed(actor || { isSchoolWideAdmin: true, assignedClassNames: [] }, {
    audience,
    grade,
    className,
    classScope,
    kind,
  });
  // When actor is omitted (legacy internal callers), treat as admin. Route layer always passes actor.
  if (opts.actor && deny) {
    const err = new Error(deny) as Error & { status?: number };
    err.status = 403;
    throw err;
  }

  const membership = await loadSchoolClassMembership(schoolId);
  const restrictToClassNames = restrictClassNamesForActor(actor, className);

  // Teachers selecting a class must match assigned labels (membership-aware).
  if (actor && !actor.isSchoolWideAdmin && className) {
    const assigned = actor.assignedClassNames.map(clean).filter(Boolean);
    const ok = assigned.some((a) => membership.resolver.sameClassroom(a, className) || a === className);
    if (!ok) {
      const err = new Error("You may only message parents linked to your assigned classrooms.") as Error & {
        status?: number;
      };
      err.status = 403;
      throw err;
    }
  }

  let parentClassName = className;
  let parentGrade = grade;
  let parentScope = classScope;
  let parentRestrict = restrictToClassNames;

  if (audience === "all_parents") {
    parentClassName = "";
    parentGrade = "";
    parentScope = "classroom";
    parentRestrict = undefined;
  } else if (audience === "individual") {
    parentGrade = "";
    parentScope = "classroom";
    // className optional; teachers get restrictToClassNames
  } else if (audience === "by_class") {
    if (classScope === "grade") {
      parentClassName = "";
      parentRestrict = undefined;
    } else if (classScope === "all_in_grade") {
      parentClassName = "";
      parentRestrict = undefined;
    }
  }

  const effectiveKind =
    audience === "all_parents" || audience === "individual" || audience === "by_class" ? "parents" : kind;

  const [classFilters, gradeCatalog, parentContacts, teacherContacts, employeeContacts] = await Promise.all([
    loadClassFilters(membership),
    loadGradeCatalog(schoolId, membership),
    effectiveKind === "parents" || effectiveKind === "all"
      ? loadParentRecipients(
          schoolId,
          channel,
          {
            className: parentClassName,
            grade: parentGrade,
            classScope: parentScope,
            restrictToClassNames: parentRestrict,
          },
          membership
        )
      : Promise.resolve([]),
    effectiveKind === "teachers" || effectiveKind === "all"
      ? loadTeacherRecipients(schoolId, channel, parentClassName, membership, restrictToClassNames)
      : Promise.resolve([]),
    effectiveKind === "employees" || effectiveKind === "all"
      ? loadEmployeeRecipients(schoolId, channel)
      : Promise.resolve([]),
  ]);

  let visibleClassFilters = classFilters;
  if (actor && !actor.isSchoolWideAdmin) {
    visibleClassFilters = classFilters.filter((label) =>
      actor.assignedClassNames.some((a) => membership.resolver.sameClassroom(a, label) || clean(a) === label)
    );
  }

  const selectedGroups =
    effectiveKind === "all"
      ? [parentContacts, teacherContacts, employeeContacts]
      : [parentContacts, teacherContacts, employeeContacts];
  const contacts: CommunicationRecipient[] = [];
  const seen = new Set<string>();
  for (const group of selectedGroups) {
    for (const contact of group) pushUnique(contacts, seen, channel, contact);
  }

  return {
    contacts,
    classFilters: visibleClassFilters,
    gradeFilters: actor && !actor.isSchoolWideAdmin ? [] : gradeCatalog.gradeFilters,
    classroomsByGrade: actor && !actor.isSchoolWideAdmin ? {} : gradeCatalog.classroomsByGrade,
    counts: {
      parents: parentContacts.length,
      learners: 0,
      teachers: teacherContacts.length,
      employees: employeeContacts.length,
      total: contacts.length,
    },
  };
}
