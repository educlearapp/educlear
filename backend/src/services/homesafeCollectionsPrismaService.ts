/**
 * HomeSafe Collections V2 — Prisma persistence (local isolated DB / future staging).
 * Session-scoped memberships; never touches GroupLearner or HomeSafeEvent.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import {
  HsCgDomainError,
  assertSameSchool,
  uniqueLearnerIds,
  validateNewSessionInput,
  weekdayForIsoDate,
  type HsCgAttendance,
  type HsCgGroup,
  type HsCgGroupKind,
  type HsCgProgress,
  type HsCgRegisterRow,
  type HsCgSession,
  type HsCgWeekday,
} from "./homesafeCollectionsDomain";

function mapGroup(g: {
  id: string;
  schoolId: string;
  name: string;
  kind: string;
  driverName: string | null;
  driverContact: string | null;
  vehicleReg: string | null;
}): HsCgGroup {
  return {
    id: g.id,
    schoolId: g.schoolId,
    name: g.name,
    kind: g.kind as HsCgGroupKind,
    driverName: g.driverName,
    driverContact: g.driverContact,
    vehicleReg: g.vehicleReg,
  };
}

function mapSession(s: {
  id: string;
  schoolId: string;
  groupId: string;
  weekday: string;
  startTime: string;
  endTime: string;
  responsibleAdult: string;
  location: string | null;
}): HsCgSession {
  return {
    id: s.id,
    schoolId: s.schoolId,
    groupId: s.groupId,
    weekday: s.weekday as HsCgWeekday,
    startTime: s.startTime,
    endTime: s.endTime,
    responsibleAdult: s.responsibleAdult,
    location: s.location,
  };
}

function mapRegister(r: {
  id: string;
  schoolId: string;
  sessionId: string;
  learnerId: string;
  schoolLocalDate: string;
  attendance: string;
  progress: string;
  note: string | null;
}): HsCgRegisterRow {
  return {
    id: r.id,
    schoolId: r.schoolId,
    sessionId: r.sessionId,
    learnerId: r.learnerId,
    schoolLocalDate: r.schoolLocalDate,
    attendance: r.attendance as HsCgAttendance,
    progress: r.progress as HsCgProgress,
    note: r.note,
  };
}

function sortSessions(a: HsCgSession, b: HsCgSession): number {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const d = order.indexOf(a.weekday) - order.indexOf(b.weekday);
  return d !== 0 ? d : a.startTime.localeCompare(b.startTime);
}

function prismaError(e: unknown): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      throw new HsCgDomainError("CONFLICT", "A conflicting collections record already exists");
    }
    if (e.code === "P2025") {
      throw new HsCgDomainError("NOT_FOUND", "Collections record not found");
    }
  }
  throw e;
}

export class PrismaHomeSafeCollectionsService {
  async listGroups(schoolId: string): Promise<
    Array<HsCgGroup & { sessionCount: number; learnerCount: number; sessions: HsCgSession[] }>
  > {
    const groups = await prisma.homeSafeCollectionGroup.findMany({
      where: { schoolId },
      include: {
        sessions: {
          include: { memberships: { select: { learnerId: true } } },
          orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    });
    return groups.map((g) => {
      const sessions = g.sessions.map(mapSession).sort(sortSessions);
      const learnerIds = uniqueLearnerIds(
        g.sessions.flatMap((s) =>
          s.memberships.map((m) => ({
            id: "",
            schoolId,
            sessionId: s.id,
            learnerId: m.learnerId,
          }))
        )
      );
      return {
        ...mapGroup(g),
        sessions,
        sessionCount: sessions.length,
        learnerCount: learnerIds.length,
      };
    });
  }

  async createGroup(input: {
    schoolId: string;
    name: string;
    kind: HsCgGroupKind;
    driverName?: string;
    driverContact?: string;
    vehicleReg?: string;
  }): Promise<HsCgGroup> {
    const name = String(input.name || "").trim();
    if (!name) throw new HsCgDomainError("VALIDATION", "Group name is required");
    if (input.kind !== "TRANSPORT" && input.kind !== "ACTIVITY") {
      throw new HsCgDomainError("VALIDATION", "Kind must be TRANSPORT or ACTIVITY");
    }
    try {
      const g = await prisma.homeSafeCollectionGroup.create({
        data: {
          schoolId: input.schoolId,
          name,
          kind: input.kind,
          driverName:
            input.kind === "TRANSPORT" ? String(input.driverName || "").trim() || "Driver" : null,
          driverContact:
            input.kind === "TRANSPORT" ? String(input.driverContact || "").trim() || null : null,
          vehicleReg:
            input.kind === "TRANSPORT" ? String(input.vehicleReg || "").trim() || null : null,
        },
      });
      return mapGroup(g);
    } catch (e) {
      prismaError(e);
    }
  }

  async getGroup(schoolId: string, groupId: string): Promise<HsCgGroup> {
    const group = await prisma.homeSafeCollectionGroup.findUnique({ where: { id: groupId } });
    if (!group) throw new HsCgDomainError("NOT_FOUND", "Collections group not found");
    assertSameSchool(group.schoolId, schoolId, "Collections group");
    return mapGroup(group);
  }

  async createSession(input: {
    schoolId: string;
    groupId: string;
    weekday: string;
    startTime: string;
    endTime: string;
    responsibleAdult?: string;
    location?: string;
    learnerIds?: string[];
  }): Promise<{ session: HsCgSession; membershipsAdded: number }> {
    const group = await this.getGroup(input.schoolId, input.groupId);
    const adultDefault =
      group.kind === "TRANSPORT" ? group.driverName || "Driver" : String(input.responsibleAdult || "");
    const validated = validateNewSessionInput({
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      responsibleAdult: String(input.responsibleAdult || adultDefault),
      kind: group.kind,
    });
    const learnerIds = Array.from(
      new Set((input.learnerIds || []).map((id) => String(id).trim()).filter(Boolean))
    );

    try {
      const result = await prisma.$transaction(async (tx) => {
        const session = await tx.homeSafeCollectionSession.create({
          data: {
            schoolId: input.schoolId,
            groupId: group.id,
            weekday: validated.weekday,
            startTime: validated.startTime,
            endTime: validated.endTime,
            responsibleAdult: validated.responsibleAdult,
            location: String(input.location || "").trim() || null,
          },
        });
        if (learnerIds.length) {
          // Ensure learners belong to this school
          const ok = await tx.learner.count({
            where: { schoolId: input.schoolId, id: { in: learnerIds } },
          });
          if (ok !== learnerIds.length) {
            throw new HsCgDomainError("VALIDATION", "One or more learners are not in this school");
          }
          await tx.homeSafeCollectionMembership.createMany({
            data: learnerIds.map((learnerId) => ({
              schoolId: input.schoolId,
              sessionId: session.id,
              learnerId,
            })),
            skipDuplicates: true,
          });
        }
        return session;
      });
      return { session: mapSession(result), membershipsAdded: learnerIds.length };
    } catch (e) {
      if (e instanceof HsCgDomainError) throw e;
      prismaError(e);
    }
  }

  async listSessionsForGroup(
    schoolId: string,
    groupId: string
  ): Promise<Array<HsCgSession & { learnerCount: number }>> {
    await this.getGroup(schoolId, groupId);
    const sessions = await prisma.homeSafeCollectionSession.findMany({
      where: { schoolId, groupId },
      include: { _count: { select: { memberships: true } } },
      orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
    });
    return sessions
      .map((s) => ({ ...mapSession(s), learnerCount: s._count.memberships }))
      .sort(sortSessions);
  }

  async getSession(schoolId: string, sessionId: string): Promise<HsCgSession> {
    const session = await prisma.homeSafeCollectionSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new HsCgDomainError("NOT_FOUND", "Session not found");
    assertSameSchool(session.schoolId, schoolId, "Session");
    return mapSession(session);
  }

  /** Replace roster for ONE session inside a transaction (other sessions untouched). */
  async setSessionLearners(input: {
    schoolId: string;
    sessionId: string;
    learnerIds: string[];
  }): Promise<{ sessionId: string; learnerIds: string[] }> {
    await this.getSession(input.schoolId, input.sessionId);
    const learnerIds = Array.from(
      new Set(input.learnerIds.map((id) => String(id).trim()).filter(Boolean))
    );
    try {
      await prisma.$transaction(async (tx) => {
        if (learnerIds.length) {
          const ok = await tx.learner.count({
            where: { schoolId: input.schoolId, id: { in: learnerIds } },
          });
          if (ok !== learnerIds.length) {
            throw new HsCgDomainError("VALIDATION", "One or more learners are not in this school");
          }
        }
        await tx.homeSafeCollectionMembership.deleteMany({
          where: { schoolId: input.schoolId, sessionId: input.sessionId },
        });
        if (learnerIds.length) {
          await tx.homeSafeCollectionMembership.createMany({
            data: learnerIds.map((learnerId) => ({
              schoolId: input.schoolId,
              sessionId: input.sessionId,
              learnerId,
            })),
          });
        }
      });
      return { sessionId: input.sessionId, learnerIds };
    } catch (e) {
      if (e instanceof HsCgDomainError) throw e;
      prismaError(e);
    }
  }

  async assignLearnersToSessions(input: {
    schoolId: string;
    learnerIds: string[];
    sessionIds: string[];
  }): Promise<{ added: number; skippedDup: number }> {
    const learnerIds = Array.from(
      new Set(input.learnerIds.map((id) => String(id).trim()).filter(Boolean))
    );
    const sessionIds = Array.from(
      new Set(input.sessionIds.map((id) => String(id).trim()).filter(Boolean))
    );
    if (!learnerIds.length) throw new HsCgDomainError("VALIDATION", "Select at least one learner");
    if (!sessionIds.length) throw new HsCgDomainError("VALIDATION", "Select at least one session");

    for (const sessionId of sessionIds) {
      await this.getSession(input.schoolId, sessionId);
    }
    const ok = await prisma.learner.count({
      where: { schoolId: input.schoolId, id: { in: learnerIds } },
    });
    if (ok !== learnerIds.length) {
      throw new HsCgDomainError("VALIDATION", "One or more learners are not in this school");
    }

    const existing = await prisma.homeSafeCollectionMembership.findMany({
      where: { schoolId: input.schoolId, sessionId: { in: sessionIds }, learnerId: { in: learnerIds } },
      select: { sessionId: true, learnerId: true },
    });
    const have = new Set(existing.map((e) => `${e.sessionId}::${e.learnerId}`));
    const toCreate: { schoolId: string; sessionId: string; learnerId: string }[] = [];
    let skippedDup = 0;
    for (const sessionId of sessionIds) {
      for (const learnerId of learnerIds) {
        const key = `${sessionId}::${learnerId}`;
        if (have.has(key)) {
          skippedDup += 1;
          continue;
        }
        toCreate.push({ schoolId: input.schoolId, sessionId, learnerId });
      }
    }
    if (toCreate.length) {
      await prisma.homeSafeCollectionMembership.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
    }
    return { added: toCreate.length, skippedDup };
  }

  async removeLearnerFromSession(input: {
    schoolId: string;
    sessionId: string;
    learnerId: string;
  }): Promise<void> {
    await this.getSession(input.schoolId, input.sessionId);
    await prisma.homeSafeCollectionMembership.deleteMany({
      where: {
        schoolId: input.schoolId,
        sessionId: input.sessionId,
        learnerId: input.learnerId,
      },
    });
  }

  async getSessionLearnerIds(schoolId: string, sessionId: string): Promise<string[]> {
    await this.getSession(schoolId, sessionId);
    const rows = await prisma.homeSafeCollectionMembership.findMany({
      where: { schoolId, sessionId },
      select: { learnerId: true },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => r.learnerId);
  }

  async getRegistersForDate(
    schoolId: string,
    schoolLocalDate: string
  ): Promise<{ weekday: HsCgWeekday; rows: HsCgRegisterRow[]; sessions: HsCgSession[] }> {
    const weekday = weekdayForIsoDate(schoolLocalDate);
    if (!weekday) throw new HsCgDomainError("VALIDATION", "Date must be a weekday (Mon–Fri)");

    const sessions = await prisma.homeSafeCollectionSession.findMany({
      where: { schoolId, weekday },
      include: { memberships: { select: { learnerId: true } } },
      orderBy: [{ startTime: "asc" }],
    });

    const existing = await prisma.homeSafeCollectionRegisterRow.findMany({
      where: { schoolId, schoolLocalDate },
    });
    const existingKey = new Map<string, (typeof existing)[number]>(
      existing.map((r) => [`${r.sessionId}::${r.learnerId}`, r])
    );

    const toCreate: Prisma.HomeSafeCollectionRegisterRowCreateManyInput[] = [];
    const rows: HsCgRegisterRow[] = [];

    for (const session of sessions) {
      for (const m of session.memberships) {
        const key = `${session.id}::${m.learnerId}`;
        const found = existingKey.get(key);
        if (found) {
          rows.push(mapRegister(found));
        } else {
          toCreate.push({
            schoolId,
            sessionId: session.id,
            learnerId: m.learnerId,
            schoolLocalDate,
            attendance: "PRESENT",
            progress: "WAITING",
          });
        }
      }
    }

    if (toCreate.length) {
      await prisma.homeSafeCollectionRegisterRow.createMany({
        data: toCreate,
        skipDuplicates: true,
      });
      const created = await prisma.homeSafeCollectionRegisterRow.findMany({
        where: {
          schoolId,
          schoolLocalDate,
          OR: toCreate.map((t) => ({ sessionId: t.sessionId!, learnerId: t.learnerId! })),
        },
      });
      for (const r of created) rows.push(mapRegister(r));
    }

    return {
      weekday,
      rows,
      sessions: sessions.map(mapSession).sort(sortSessions),
    };
  }

  async patchRegisterRow(input: {
    schoolId: string;
    sessionId: string;
    learnerId: string;
    schoolLocalDate: string;
    attendance?: HsCgAttendance;
    progress?: HsCgProgress;
    note?: string | null;
  }): Promise<HsCgRegisterRow> {
    await this.getSession(input.schoolId, input.sessionId);
    await this.getRegistersForDate(input.schoolId, input.schoolLocalDate);
    try {
      const row = await prisma.homeSafeCollectionRegisterRow.update({
        where: {
          sessionId_learnerId_schoolLocalDate: {
            sessionId: input.sessionId,
            learnerId: input.learnerId,
            schoolLocalDate: input.schoolLocalDate,
          },
        },
        data: {
          ...(input.attendance ? { attendance: input.attendance } : {}),
          ...(input.progress ? { progress: input.progress } : {}),
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
      });
      return mapRegister(row);
    } catch (e) {
      prismaError(e);
    }
  }

  /** Directory of school learners for assignment pickers (active only). */
  async listSchoolLearners(schoolId: string): Promise<
    Array<{ id: string; firstName: string; lastName: string; className: string }>
  > {
    const learners = await prisma.learner.findMany({
      where: { schoolId, enrollmentStatus: "ACTIVE" },
      select: { id: true, firstName: true, lastName: true, grade: true, className: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      take: 2000,
    });
    return learners.map((l) => ({
      id: l.id,
      firstName: l.firstName,
      lastName: l.lastName,
      className: String(l.className || l.grade || "").trim() || "—",
    }));
  }

  /**
   * Teacher Portal snapshot: school-owned groups/sessions with per-session rosters,
   * learner directory (names/classes; photos not modelled yet), and dated register rows.
   * Read-only structure — does not create groups/memberships.
   */
  async getTeacherCollectionsSnapshot(
    schoolId: string,
    schoolLocalDate: string
  ): Promise<{
    weekday: HsCgWeekday;
    groups: Array<
      HsCgGroup & {
        sessions: Array<HsCgSession & { learnerIds: string[] }>;
      }
    >;
    learners: Array<{
      id: string;
      firstName: string;
      lastName: string;
      displayName: string;
      className: string;
      /** Learner photos are not stored on Learner yet — always null. */
      photoUrl: string | null;
    }>;
    registers: HsCgRegisterRow[];
    daySessions: HsCgSession[];
  }> {
    const weekday = weekdayForIsoDate(schoolLocalDate);
    if (!weekday) throw new HsCgDomainError("VALIDATION", "Date must be a weekday (Mon–Fri)");

    const groupsRaw = await prisma.homeSafeCollectionGroup.findMany({
      where: { schoolId },
      include: {
        sessions: {
          include: { memberships: { select: { learnerId: true } } },
          orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
        },
      },
      orderBy: { name: "asc" },
    });

    const groups = groupsRaw.map((g) => ({
      ...mapGroup(g),
      sessions: g.sessions
        .map((s) => ({
          ...mapSession(s),
          learnerIds: s.memberships.map((m) => m.learnerId),
        }))
        .sort(sortSessions),
    }));

    const learnerIdSet = new Set<string>();
    for (const g of groups) {
      for (const s of g.sessions) {
        for (const id of s.learnerIds) learnerIdSet.add(id);
      }
    }

    const learnerRows =
      learnerIdSet.size === 0
        ? []
        : await prisma.learner.findMany({
            where: { schoolId, id: { in: Array.from(learnerIdSet) } },
            select: { id: true, firstName: true, lastName: true, grade: true, className: true },
            orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
          });

    const learners = learnerRows.map((l) => {
      const firstName = String(l.firstName || "").trim();
      const lastName = String(l.lastName || "").trim();
      return {
        id: l.id,
        firstName,
        lastName,
        displayName: `${firstName} ${lastName}`.trim(),
        className: String(l.className || l.grade || "").trim() || "—",
        photoUrl: null as string | null,
      };
    });

    const { rows, sessions: daySessions } = await this.getRegistersForDate(schoolId, schoolLocalDate);

    return {
      weekday,
      groups,
      learners,
      registers: rows,
      daySessions,
    };
  }
}

let sharedPrismaService: PrismaHomeSafeCollectionsService | null = null;

export function getPrismaHomeSafeCollectionsService(): PrismaHomeSafeCollectionsService {
  if (!sharedPrismaService) sharedPrismaService = new PrismaHomeSafeCollectionsService();
  return sharedPrismaService;
}
