/**
 * HomeSafe Collections V2 — application service.
 * Default store is in-memory (unit tests + local readiness without DB).
 * Prisma-backed store can be swapped in after additive migration is applied.
 *
 * Does not touch Group / GroupLearner, Early Departure (HomeSafeEvent), or other modules.
 */

import {
  HsCgDomainError,
  assertSameSchool,
  buildRegisterRowsForDate,
  membershipsForSession,
  removeLearnerFromSession,
  replaceSessionRoster,
  uniqueLearnerIds,
  validateNewSessionInput,
  weekdayForIsoDate,
  type HsCgGroup,
  type HsCgGroupKind,
  type HsCgMembership,
  type HsCgProgress,
  type HsCgAttendance,
  type HsCgRegisterRow,
  type HsCgSession,
  type HsCgWeekday,
} from "./homesafeCollectionsDomain";

function newId(): string {
  return `hscg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export type CollectionsStore = {
  groups: HsCgGroup[];
  sessions: HsCgSession[];
  memberships: HsCgMembership[];
  registerRows: HsCgRegisterRow[];
};

export function createEmptyCollectionsStore(): CollectionsStore {
  return { groups: [], sessions: [], memberships: [], registerRows: [] };
}

export class HomeSafeCollectionsService {
  constructor(private store: CollectionsStore = createEmptyCollectionsStore()) {}

  /** Snapshot for tests / diagnostics (never mutate). */
  snapshot(): CollectionsStore {
    return {
      groups: [...this.store.groups],
      sessions: [...this.store.sessions],
      memberships: [...this.store.memberships],
      registerRows: [...this.store.registerRows],
    };
  }

  listGroups(schoolId: string): Array<
    HsCgGroup & { sessionCount: number; learnerCount: number; sessions: HsCgSession[] }
  > {
    const groups = this.store.groups.filter((g) => g.schoolId === schoolId);
    return groups.map((g) => {
      const sessions = this.store.sessions.filter((s) => s.groupId === g.id && s.schoolId === schoolId);
      const sessionIds = new Set(sessions.map((s) => s.id));
      const memberships = this.store.memberships.filter(
        (m) => m.schoolId === schoolId && sessionIds.has(m.sessionId)
      );
      return {
        ...g,
        sessions: sessions.slice().sort(sortSessions),
        sessionCount: sessions.length,
        learnerCount: uniqueLearnerIds(memberships).length,
      };
    });
  }

  createGroup(input: {
    schoolId: string;
    name: string;
    kind: HsCgGroupKind;
    driverName?: string;
    driverContact?: string;
    vehicleReg?: string;
  }): HsCgGroup {
    const name = String(input.name || "").trim();
    if (!name) throw new HsCgDomainError("VALIDATION", "Group name is required");
    if (input.kind !== "TRANSPORT" && input.kind !== "ACTIVITY") {
      throw new HsCgDomainError("VALIDATION", "Kind must be TRANSPORT or ACTIVITY");
    }
    const clash = this.store.groups.find(
      (g) => g.schoolId === input.schoolId && g.name.toLowerCase() === name.toLowerCase()
    );
    if (clash) throw new HsCgDomainError("CONFLICT", "A collections group with this name already exists");
    const group: HsCgGroup = {
      id: newId(),
      schoolId: input.schoolId,
      name,
      kind: input.kind,
      driverName: input.kind === "TRANSPORT" ? String(input.driverName || "").trim() || "Driver" : null,
      driverContact: input.kind === "TRANSPORT" ? String(input.driverContact || "").trim() || null : null,
      vehicleReg: input.kind === "TRANSPORT" ? String(input.vehicleReg || "").trim() || null : null,
    };
    this.store.groups.push(group);
    return group;
  }

  getGroup(schoolId: string, groupId: string): HsCgGroup {
    const group = this.store.groups.find((g) => g.id === groupId);
    if (!group) throw new HsCgDomainError("NOT_FOUND", "Collections group not found");
    assertSameSchool(group.schoolId, schoolId, "Collections group");
    return group;
  }

  /**
   * Append a recurring session to an existing group.
   * Does not replace or mutate other sessions/memberships.
   */
  createSession(input: {
    schoolId: string;
    groupId: string;
    weekday: string;
    startTime: string;
    endTime: string;
    responsibleAdult?: string;
    location?: string;
    learnerIds?: string[];
  }): { session: HsCgSession; membershipsAdded: number } {
    const group = this.getGroup(input.schoolId, input.groupId);
    const adultDefault =
      group.kind === "TRANSPORT" ? group.driverName || "Driver" : String(input.responsibleAdult || "");
    const validated = validateNewSessionInput({
      weekday: input.weekday,
      startTime: input.startTime,
      endTime: input.endTime,
      responsibleAdult: String(input.responsibleAdult || adultDefault),
      kind: group.kind,
    });
    const session: HsCgSession = {
      id: newId(),
      schoolId: input.schoolId,
      groupId: group.id,
      weekday: validated.weekday,
      startTime: validated.startTime,
      endTime: validated.endTime,
      responsibleAdult: validated.responsibleAdult,
      location: String(input.location || "").trim() || null,
    };
    // Always append — never replace the group's session list.
    this.store.sessions.push(session);

    let membershipsAdded = 0;
    const learnerIds = input.learnerIds || [];
    if (learnerIds.length) {
      this.store.memberships = replaceSessionRoster(
        this.store.memberships,
        input.schoolId,
        session.id,
        learnerIds,
        newId
      );
      membershipsAdded = learnerIds.length;
    }
    return { session, membershipsAdded };
  }

  listSessionsForGroup(schoolId: string, groupId: string): Array<HsCgSession & { learnerCount: number }> {
    this.getGroup(schoolId, groupId);
    return this.store.sessions
      .filter((s) => s.groupId === groupId && s.schoolId === schoolId)
      .sort(sortSessions)
      .map((s) => ({
        ...s,
        learnerCount: membershipsForSession(this.store.memberships, s.id).length,
      }));
  }

  getSession(schoolId: string, sessionId: string): HsCgSession {
    const session = this.store.sessions.find((s) => s.id === sessionId);
    if (!session) throw new HsCgDomainError("NOT_FOUND", "Session not found");
    assertSameSchool(session.schoolId, schoolId, "Session");
    return session;
  }

  /**
   * Set the full roster for ONE session. Other sessions are unchanged.
   */
  setSessionLearners(input: {
    schoolId: string;
    sessionId: string;
    learnerIds: string[];
  }): { sessionId: string; learnerIds: string[] } {
    this.getSession(input.schoolId, input.sessionId);
    this.store.memberships = replaceSessionRoster(
      this.store.memberships,
      input.schoolId,
      input.sessionId,
      input.learnerIds,
      newId
    );
    return {
      sessionId: input.sessionId,
      learnerIds: membershipsForSession(this.store.memberships, input.sessionId).map((m) => m.learnerId),
    };
  }

  /**
   * Add learners to chosen sessions only (reuse selection across ticks). Unticked sessions untouched.
   */
  assignLearnersToSessions(input: {
    schoolId: string;
    learnerIds: string[];
    sessionIds: string[];
  }): { added: number; skippedDup: number } {
    const learnerIds = Array.from(new Set(input.learnerIds.map((id) => String(id).trim()).filter(Boolean)));
    const sessionIds = Array.from(new Set(input.sessionIds.map((id) => String(id).trim()).filter(Boolean)));
    if (!learnerIds.length) throw new HsCgDomainError("VALIDATION", "Select at least one learner");
    if (!sessionIds.length) throw new HsCgDomainError("VALIDATION", "Select at least one session");

    let added = 0;
    let skippedDup = 0;
    for (const sessionId of sessionIds) {
      this.getSession(input.schoolId, sessionId);
      for (const learnerId of learnerIds) {
        const exists = this.store.memberships.some(
          (m) => m.sessionId === sessionId && m.learnerId === learnerId
        );
        if (exists) {
          skippedDup += 1;
          continue;
        }
        this.store.memberships.push({
          id: newId(),
          schoolId: input.schoolId,
          sessionId,
          learnerId,
        });
        added += 1;
      }
    }
    return { added, skippedDup };
  }

  removeLearnerFromSession(input: {
    schoolId: string;
    sessionId: string;
    learnerId: string;
  }): void {
    this.getSession(input.schoolId, input.sessionId);
    this.store.memberships = removeLearnerFromSession(
      this.store.memberships,
      input.sessionId,
      input.learnerId
    );
  }

  getSessionLearnerIds(schoolId: string, sessionId: string): string[] {
    this.getSession(schoolId, sessionId);
    return membershipsForSession(this.store.memberships, sessionId).map((m) => m.learnerId);
  }

  /**
   * Materialise Today registers for a school-local date from live memberships.
   * Day switching must not wipe memberships (rebuild from store, not seeds).
   */
  getRegistersForDate(schoolId: string, schoolLocalDate: string): {
    weekday: HsCgWeekday;
    rows: HsCgRegisterRow[];
    sessions: HsCgSession[];
  } {
    const weekday = weekdayForIsoDate(schoolLocalDate);
    if (!weekday) throw new HsCgDomainError("VALIDATION", "Date must be a weekday (Mon–Fri)");
    const sessions = this.store.sessions.filter((s) => s.schoolId === schoolId && s.weekday === weekday);
    const rows = buildRegisterRowsForDate({
      schoolId,
      schoolLocalDate,
      weekday,
      sessions: this.store.sessions,
      memberships: this.store.memberships,
      existingRows: this.store.registerRows.filter(
        (r) => r.schoolId === schoolId && r.schoolLocalDate === schoolLocalDate
      ),
      newId,
    });
    // Persist newly materialised rows so subsequent day switches keep progress.
    for (const row of rows) {
      const idx = this.store.registerRows.findIndex(
        (r) =>
          r.sessionId === row.sessionId &&
          r.learnerId === row.learnerId &&
          r.schoolLocalDate === row.schoolLocalDate
      );
      if (idx === -1) this.store.registerRows.push(row);
    }
    return { weekday, rows, sessions: sessions.sort(sortSessions) };
  }

  patchRegisterRow(input: {
    schoolId: string;
    sessionId: string;
    learnerId: string;
    schoolLocalDate: string;
    attendance?: HsCgAttendance;
    progress?: HsCgProgress;
    note?: string | null;
  }): HsCgRegisterRow {
    this.getSession(input.schoolId, input.sessionId);
    const { rows } = this.getRegistersForDate(input.schoolId, input.schoolLocalDate);
    const row = rows.find(
      (r) => r.sessionId === input.sessionId && r.learnerId === input.learnerId
    );
    if (!row) throw new HsCgDomainError("NOT_FOUND", "Learner is not on this session register");
    if (input.attendance) row.attendance = input.attendance;
    if (input.progress) row.progress = input.progress;
    if (input.note !== undefined) row.note = input.note;
    const idx = this.store.registerRows.findIndex((r) => r.id === row.id);
    if (idx >= 0) this.store.registerRows[idx] = row;
    return row;
  }
}

function sortSessions(a: HsCgSession, b: HsCgSession): number {
  const order = ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const d = order.indexOf(a.weekday) - order.indexOf(b.weekday);
  return d !== 0 ? d : a.startTime.localeCompare(b.startTime);
}

/** Process-local store for route handlers until Prisma persistence is enabled. */
let sharedService: HomeSafeCollectionsService | null = null;

export function getHomeSafeCollectionsService(): HomeSafeCollectionsService {
  if (!sharedService) sharedService = new HomeSafeCollectionsService();
  return sharedService;
}

/** Test helper — reset shared singleton. */
export function resetHomeSafeCollectionsServiceForTests(): void {
  sharedService = new HomeSafeCollectionsService(createEmptyCollectionsStore());
}
