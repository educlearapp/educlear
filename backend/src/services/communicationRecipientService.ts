import { prisma } from "../prisma";
import { normalizeSaPhone } from "./parentPortalService";

export type CommunicationRecipientChannel = "email" | "sms";
export type CommunicationRecipientKind = "parents" | "learners" | "teachers" | "employees" | "all";

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

function matchesClass(classNames: string[], className: string) {
  if (!className) return true;
  return classNames.some((name) => name.toLowerCase() === className.toLowerCase());
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

async function loadClassFilters(schoolId: string) {
  const rows = await prisma.learner.findMany({
    where: { schoolId },
    select: { className: true },
    distinct: ["className"],
    orderBy: { className: "asc" },
  });
  return rows.map((row) => clean(row.className)).filter(Boolean);
}

async function loadParentRecipients(
  schoolId: string,
  channel: CommunicationRecipientChannel,
  className: string
) {
  const links = await prisma.parentLearnerLink.findMany({
    where: {
      schoolId,
      learner: className ? { className: { equals: className, mode: "insensitive" } } : undefined,
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

  return Array.from(byParent.values())
    .map((parent): CommunicationRecipient => ({
      id: `parent:${parent.id}`,
      contactName: parent.contactName,
      relationship: "Parent/Guardian",
      email: parent.email,
      cellNo: parent.cellNo,
      source: "parent",
      sourceId: parent.id,
      learnerIds: Array.from(parent.learnerIds),
      classNames: Array.from(parent.classNames).sort((a, b) => a.localeCompare(b)),
    }))
    .filter((contact) => matchesClass(contact.classNames, className));
}

async function loadTeacherRecipients(
  schoolId: string,
  channel: CommunicationRecipientChannel,
  className: string
) {
  if (channel !== "email") return [];
  const [classroomTeachers, classrooms] = await Promise.all([
    prisma.classroomTeacher.findMany({
      where: {
        schoolId,
        classroom: className ? { name: { equals: className, mode: "insensitive" } } : undefined,
      },
      include: {
        classroom: { select: { name: true } },
      },
    }),
    prisma.classroom.findMany({
      where: {
        schoolId,
        ...(className ? { name: { equals: className, mode: "insensitive" } } : {}),
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

  return contacts.filter((contact) => matchesClass(contact.classNames, className));
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

export async function loadCommunicationRecipients(opts: {
  schoolId: string;
  channel: CommunicationRecipientChannel;
  kind: CommunicationRecipientKind;
  className?: string;
}): Promise<CommunicationRecipientsResult> {
  const schoolId = clean(opts.schoolId);
  const channel = opts.channel === "sms" ? "sms" : "email";
  const kind = opts.kind || "parents";
  const className = clean(opts.className);
  const [classFilters, parentContacts, teacherContacts, employeeContacts] = await Promise.all([
    loadClassFilters(schoolId),
    kind === "parents" || kind === "all" ? loadParentRecipients(schoolId, channel, className) : Promise.resolve([]),
    kind === "teachers" || kind === "all" ? loadTeacherRecipients(schoolId, channel, className) : Promise.resolve([]),
    kind === "employees" || kind === "all" ? loadEmployeeRecipients(schoolId, channel) : Promise.resolve([]),
  ]);

  const selectedGroups =
    kind === "all" ? [parentContacts, teacherContacts, employeeContacts] : [parentContacts, teacherContacts, employeeContacts];
  const contacts: CommunicationRecipient[] = [];
  const seen = new Set<string>();
  for (const group of selectedGroups) {
    for (const contact of group) pushUnique(contacts, seen, channel, contact);
  }

  return {
    contacts,
    classFilters,
    counts: {
      parents: parentContacts.length,
      learners: 0,
      teachers: teacherContacts.length,
      employees: employeeContacts.length,
      total: contacts.length,
    },
  };
}
