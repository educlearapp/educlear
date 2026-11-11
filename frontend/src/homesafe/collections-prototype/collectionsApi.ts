/**
 * HomeSafe Collections V2 — staff API client (live persistence).
 * Used by AdminHomeSafePage Collections tab. Local __local prototype routes stay in-memory.
 */
import { apiFetch } from "../../api";
import type { DemoGroup, DemoLearner, DemoSession, RegisterRow, SessionMembership, Weekday } from "./types";

type ApiGroup = {
  id: string;
  schoolId: string;
  name: string;
  kind: "TRANSPORT" | "ACTIVITY";
  driverName?: string | null;
  driverContact?: string | null;
  vehicleReg?: string | null;
  sessions?: Array<{
    id: string;
    groupId: string;
    weekday: Weekday;
    startTime: string;
    endTime: string;
    responsibleAdult: string;
    location?: string | null;
  }>;
};

function hueForId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * 17) % 360;
  return h;
}

export async function fetchCollectionsBootstrap(): Promise<{
  groups: DemoGroup[];
  sessions: DemoSession[];
  memberships: SessionMembership[];
  learners: DemoLearner[];
}> {
  const [groupsRes, learnersRes] = await Promise.all([
    apiFetch("/api/homesafe/collections/groups") as Promise<{ success: boolean; groups: ApiGroup[] }>,
    apiFetch("/api/homesafe/collections/learners") as Promise<{
      success: boolean;
      learners: Array<{ id: string; firstName: string; lastName: string; className: string }>;
    }>,
  ]);

  const groups: DemoGroup[] = (groupsRes.groups || []).map((g) => ({
    id: g.id,
    kind: g.kind,
    name: g.name,
    driverName: g.driverName || undefined,
    driverContact: g.driverContact || undefined,
    vehicleReg: g.vehicleReg || undefined,
    driverInitials: (g.driverName || "DR")
      .split(/\s+/)
      .map((p) => p[0] || "")
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  }));

  const sessions: DemoSession[] = [];
  const memberships: SessionMembership[] = [];

  for (const g of groupsRes.groups || []) {
    for (const s of g.sessions || []) {
      sessions.push({
        id: s.id,
        groupId: s.groupId,
        weekday: s.weekday,
        start: s.startTime,
        end: s.endTime,
        responsibleAdult: s.responsibleAdult,
        location: s.location || undefined,
      });
    }
    // Load memberships per session for accurate counts
    const detail = await apiFetch(`/api/homesafe/collections/groups/${g.id}/sessions`) as {
      sessions: Array<{ id: string; learnerCount: number }>;
    };
    for (const s of detail.sessions || []) {
      const roster = (await apiFetch(`/api/homesafe/collections/sessions/${s.id}/learners`)) as {
        learnerIds: string[];
      };
      for (const learnerId of roster.learnerIds || []) {
        memberships.push({ learnerId, sessionId: s.id });
      }
    }
  }

  const learners: DemoLearner[] = (learnersRes.learners || []).map((l) => ({
    id: l.id,
    firstName: l.firstName,
    lastName: l.lastName,
    className: l.className,
    hue: hueForId(l.id),
    transportAuthorised: true,
  }));

  return { groups, sessions, memberships, learners };
}

export async function apiCreateGroup(input: {
  name: string;
  kind: "TRANSPORT" | "ACTIVITY";
  driverName?: string;
  driverContact?: string;
  vehicleReg?: string;
}): Promise<DemoGroup> {
  const res = (await apiFetch("/api/homesafe/collections/groups", {
    method: "POST",
    body: JSON.stringify(input),
  })) as { group: ApiGroup };
  const g = res.group;
  return {
    id: g.id,
    kind: g.kind,
    name: g.name,
    driverName: g.driverName || undefined,
    driverContact: g.driverContact || undefined,
    vehicleReg: g.vehicleReg || undefined,
  };
}

export async function apiCreateSession(input: {
  groupId: string;
  weekday: Weekday;
  start: string;
  end: string;
  responsibleAdult: string;
  location?: string;
  learnerIds?: string[];
}): Promise<DemoSession> {
  const res = (await apiFetch(`/api/homesafe/collections/groups/${input.groupId}/sessions`, {
    method: "POST",
    body: JSON.stringify({
      weekday: input.weekday,
      startTime: input.start,
      endTime: input.end,
      responsibleAdult: input.responsibleAdult,
      location: input.location,
      learnerIds: input.learnerIds || [],
    }),
  })) as {
    session: {
      id: string;
      groupId: string;
      weekday: Weekday;
      startTime: string;
      endTime: string;
      responsibleAdult: string;
      location?: string | null;
    };
  };
  const s = res.session;
  return {
    id: s.id,
    groupId: s.groupId,
    weekday: s.weekday,
    start: s.startTime,
    end: s.endTime,
    responsibleAdult: s.responsibleAdult,
    location: s.location || undefined,
  };
}

export async function apiSetSessionLearners(sessionId: string, learnerIds: string[]): Promise<void> {
  await apiFetch(`/api/homesafe/collections/sessions/${sessionId}/learners`, {
    method: "PUT",
    body: JSON.stringify({ learnerIds }),
  });
}

export async function apiAssignLearners(learnerIds: string[], sessionIds: string[]): Promise<void> {
  await apiFetch("/api/homesafe/collections/assignments", {
    method: "POST",
    body: JSON.stringify({ learnerIds, sessionIds }),
  });
}

export async function apiRemoveLearnerFromSession(sessionId: string, learnerId: string): Promise<void> {
  await apiFetch(`/api/homesafe/collections/sessions/${sessionId}/learners/${learnerId}`, {
    method: "DELETE",
  });
}

export async function apiGetRegisters(date: string): Promise<{
  weekday: Weekday;
  rows: RegisterRow[];
  sessions: DemoSession[];
}> {
  const res = (await apiFetch(`/api/homesafe/collections/registers?date=${encodeURIComponent(date)}`)) as {
    weekday: Weekday;
    rows: Array<{
      learnerId: string;
      sessionId: string;
      schoolLocalDate: string;
      attendance: RegisterRow["attendance"];
      progress: RegisterRow["progress"];
      note?: string | null;
    }>;
    sessions: Array<{
      id: string;
      groupId: string;
      weekday: Weekday;
      startTime: string;
      endTime: string;
      responsibleAdult: string;
      location?: string | null;
    }>;
  };
  return {
    weekday: res.weekday,
    rows: (res.rows || []).map((r) => ({
      learnerId: r.learnerId,
      sessionId: r.sessionId,
      date: r.schoolLocalDate,
      attendance: r.attendance,
      progress: r.progress,
      collectionAuthorised: true,
      alreadyHomeDismissed: false,
      note: r.note || undefined,
    })),
    sessions: (res.sessions || []).map((s) => ({
      id: s.id,
      groupId: s.groupId,
      weekday: s.weekday,
      start: s.startTime,
      end: s.endTime,
      responsibleAdult: s.responsibleAdult,
      location: s.location || undefined,
    })),
  };
}

/**
 * Persist one register row via existing PATCH /api/homesafe/collections/registers.
 * Does not invent classroom Call/Ack workflows or actor audit trails.
 */
export async function apiPatchRegister(input: {
  sessionId: string;
  learnerId: string;
  date: string;
  attendance?: RegisterRow["attendance"];
  progress?: RegisterRow["progress"];
  note?: string | null;
}): Promise<RegisterRow> {
  const res = (await apiFetch("/api/homesafe/collections/registers", {
    method: "PATCH",
    body: JSON.stringify({
      sessionId: input.sessionId,
      learnerId: input.learnerId,
      date: input.date,
      schoolLocalDate: input.date,
      ...(input.attendance !== undefined ? { attendance: input.attendance } : {}),
      ...(input.progress !== undefined ? { progress: input.progress } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    }),
  })) as {
    success?: boolean;
    error?: string;
    row?: {
      learnerId: string;
      sessionId: string;
      schoolLocalDate: string;
      attendance: RegisterRow["attendance"];
      progress: RegisterRow["progress"];
      note?: string | null;
    };
  };
  if (!res?.row) {
    throw new Error(res?.error || "Failed to save register status");
  }
  return {
    learnerId: res.row.learnerId,
    sessionId: res.row.sessionId,
    date: res.row.schoolLocalDate,
    attendance: res.row.attendance,
    progress: res.row.progress,
    collectionAuthorised: true,
    alreadyHomeDismissed: res.row.progress === "COLLECTED",
    note: res.row.note || undefined,
  };
}
