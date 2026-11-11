import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  DEMO_DATE_OPTIONS,
  DEMO_DATES,
  DEMO_GROUPS,
  DEMO_LEARNERS,
  DEMO_SESSIONS,
  buildInitialExceptions,
  buildInitialMemberships,
  buildInitialRegisters,
  learnerDisplayName,
  weekdayForDate,
} from "./demoData";
import {
  apiAssignLearners,
  apiCreateGroup,
  apiCreateSession,
  apiGetRegisters,
  apiPatchRegister,
  apiRemoveLearnerFromSession,
  apiSetSessionLearners,
  fetchCollectionsBootstrap,
} from "./collectionsApi";
import { classOptionsFromLearners, findOverlapWarnings, sessionsOverlap } from "./overlap";
import { HS_CG_PROTO_BUILT_AT, HS_CG_PROTO_REVISION } from "./prototypeMeta";
import {
  SCHEDULE_EARLIEST,
  SCHEDULE_LATEST,
  SCHEDULE_TIME_HINT,
  normaliseHhMmInput,
  validateScheduleTimes,
} from "./scheduleTime";
import type {
  DatedException,
  DemoGroup,
  DemoLearner,
  DemoLogLine,
  DemoSession,
  GroupKind,
  RegisterRow,
  SessionMembership,
  TeacherCallAck,
  Weekday,
} from "./types";
import "./collectionsPrototype.css";

export type CollectionsPrototypeMode = "demo" | "live";

type Tab = "today" | "manage";
type ManageSub = "sessions" | "learners";
/** Populated = fictional fixture; Empty = new school with no groups (create from scratch). */
type FixtureMode = "populated" | "empty";
type Flash = { kind: "ok" | "warn" | "err" | "info"; text: string } | null;

type Modal =
  | { type: "add-session"; returnTo?: "add-learners" }
  | { type: "edit-group" }
  | { type: "add-learners" }
  /** Edit memberships for one recurring session only (does not touch other sessions). */
  | { type: "manage-session-learners"; sessionId: string }
  | { type: "reschedule"; sessionId: string }
  | { type: "handover"; learnerId: string; sessionId: string }
  | { type: "today-exception"; learnerId: string; mode: "skip" | "add" }
  | { type: "move-learner"; learnerId: string; fromSessionId: string }
  | null;

function nowStamp(): string {
  return new Date().toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function initials(first: string, last: string): string {
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

function avatarStyle(hue: number): CSSProperties {
  return { background: `hsl(${hue} 48% 38%)` };
}

function countBucket(rows: RegisterRow[]) {
  const active = rows.filter((r) => r.attendance !== "ABSENT");
  return {
    expected: rows.length,
    waiting: active.filter((r) => r.progress === "WAITING" || r.progress === "CALLED").length,
    ready: active.filter((r) => r.progress === "READY").length,
    collected: active.filter((r) => r.progress === "COLLECTED").length,
    returned: active.filter((r) => r.progress === "RETURNED" || r.progress === "COMPLETED").length,
    handed: active.filter(
      (r) => r.progress === "HANDED_OVER" || r.progress === "AWAY" || r.progress === "PARTICIPATING"
    ).length,
    absentees: rows.filter((r) => r.attendance === "ABSENT").length,
    unconfirmed: rows.filter((r) => r.attendance === "UNCONFIRMED").length,
  };
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Collections & Groups UI — verified UX (HS-CG-PROTO r2026-11-04h).
 * mode=demo: fictional in-memory fixture (local __local routes).
 * mode=live: Prisma-backed /api/homesafe/collections (AdminHomeSafePage).
 */
export default function HomeSafeCollectionsPrototype({
  mode = "demo",
}: {
  mode?: CollectionsPrototypeMode;
} = {}) {
  const isLive = mode === "live";
  const [tab, setTab] = useState<Tab>("today");
  const [fixtureMode, setFixtureMode] = useState<FixtureMode>(isLive ? "empty" : "populated");
  const [demoDate, setDemoDate] = useState<string>(DEMO_DATES.wednesday);
  const [groups, setGroups] = useState<DemoGroup[]>(() => (isLive ? [] : [...DEMO_GROUPS]));
  const [sessions, setSessions] = useState<DemoSession[]>(() => (isLive ? [] : [...DEMO_SESSIONS]));
  const [memberships, setMemberships] = useState<SessionMembership[]>(() =>
    isLive ? [] : buildInitialMemberships()
  );
  const [exceptions, setExceptions] = useState<DatedException[]>(() =>
    isLive ? [] : buildInitialExceptions()
  );
  const [registers, setRegisters] = useState<RegisterRow[]>(() =>
    isLive ? [] : buildInitialRegisters(DEMO_DATES.wednesday, "Wed")
  );
  const [liveLearners, setLiveLearners] = useState<DemoLearner[]>([]);
  const [liveLoading, setLiveLoading] = useState(isLive);
  const [teacherCalls, setTeacherCalls] = useState<TeacherCallAck[]>([]);
  const [log, setLog] = useState<DemoLogLine[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [transportPick, setTransportPick] = useState(isLive ? "" : "g-bus-a");
  const [flash, setFlash] = useState<Flash>(null);
  const [saveFailDemo, setSaveFailDemo] = useState(false);
  const [handoverName, setHandoverName] = useState("");

  const [editGroupId, setEditGroupId] = useState<string | null>(isLive ? null : "g-swim");
  const [manageSub, setManageSub] = useState<ManageSub>("sessions");
  const [sessionDayFilter, setSessionDayFilter] = useState<Weekday | "ALL">("ALL");
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [learnerSearch, setLearnerSearch] = useState("");
  const [selectedLearnerIds, setSelectedLearnerIds] = useState<Set<string>>(new Set());
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<Modal>(null);

  const learnersCatalog = isLive ? liveLearners : DEMO_LEARNERS;
  const displayName = (id: string) => learnerDisplayName(id, learnersCatalog);
  /** Feedback shown inside the open modal (not behind it). */
  const [modalFlash, setModalFlash] = useState<Flash>(null);
  /** Field-level errors inside the active modal. */
  const [fieldErrors, setFieldErrors] = useState<{
    learners?: string;
    sessions?: string;
    start?: string;
    end?: string;
    adult?: string;
  }>({});

  // Form drafts — type is Transport | Activity only; name is school-chosen
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<GroupKind>("ACTIVITY");
  const [draftDriver, setDraftDriver] = useState("");
  const [draftContact, setDraftContact] = useState("");
  const [draftReg, setDraftReg] = useState("");
  const [draftWeekday, setDraftWeekday] = useState<Weekday>("Mon");
  const [draftStart, setDraftStart] = useState("10:00");
  const [draftEnd, setDraftEnd] = useState("10:30");
  const [draftAdult, setDraftAdult] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [draftScope, setDraftScope] = useState<"one" | "future">("one");
  const [exceptionSessionId, setExceptionSessionId] = useState("");

  const weekday = weekdayForDate(demoDate);
  const pushLog = (text: string) => {
    setLog((prev) => [{ id: `${Date.now()}-${Math.random()}`, at: nowStamp(), text }, ...prev].slice(0, 50));
  };

  // Live bootstrap — load persisted groups/sessions/memberships/learners
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    (async () => {
      try {
        setLiveLoading(true);
        const boot = await fetchCollectionsBootstrap();
        if (cancelled) return;
        setGroups(boot.groups);
        setSessions(boot.sessions);
        setMemberships(boot.memberships);
        setLiveLearners(boot.learners);
        setExceptions([]);
        setEditGroupId(boot.groups[0]?.id || null);
        setTransportPick(boot.groups.find((g) => g.kind === "TRANSPORT")?.id || "");
        setTab("manage");
        setFixtureMode("empty");
        setLog((prev) => [
          {
            id: `${Date.now()}-${Math.random()}`,
            at: nowStamp(),
            text: `[LIVE] Loaded ${boot.groups.length} group(s), ${boot.sessions.length} session(s) from API`,
          },
          ...prev,
        ].slice(0, 50));
        try {
          const reg = await apiGetRegisters(demoDate);
          if (!cancelled) setRegisters(reg.rows);
        } catch {
          if (!cancelled) setRegisters([]);
        }
      } catch (e: any) {
        if (!cancelled) {
          setFlash({
            kind: "err",
            text: e?.message || "Failed to load Collections from API. Is the local backend on the Collections DB?",
          });
        }
      } finally {
        if (!cancelled) setLiveLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once on mount for live mode
  }, [isLive]);

  const loadPopulatedFixture = () => {
    setGroups([...DEMO_GROUPS]);
    setSessions([...DEMO_SESSIONS]);
    setMemberships(buildInitialMemberships());
    setExceptions(buildInitialExceptions());
    setRegisters(buildInitialRegisters(demoDate, weekdayForDate(demoDate) || "Wed"));
    setTeacherCalls([]);
    setActiveSessionId(null);
    setMobileDetailOpen(false);
    setTransportPick("g-bus-a");
    setEditGroupId("g-swim");
    setManageSub("sessions");
    setModal(null);
    setDraftName("");
    pushLog("[DEMO] Loaded populated demonstration fixture (fictional names — not for real schools)");
  };

  const loadEmptySchool = () => {
    setGroups([]);
    setSessions([]);
    setMemberships([]);
    setExceptions([]);
    setRegisters([]);
    setTeacherCalls([]);
    setActiveSessionId(null);
    setMobileDetailOpen(false);
    setTransportPick("");
    setEditGroupId(null);
    setManageSub("sessions");
    setModal(null);
    setDraftName("");
    setDraftKind("ACTIVITY");
    setDraftDriver("");
    setDraftContact("");
    setDraftReg("");
    setTab("manage");
    pushLog("[DEMO] Empty school — no groups. Create Transport or Activity with a school-chosen name.");
  };

  const applyFixtureMode = (mode: FixtureMode) => {
    if (isLive) {
      setFlash({ kind: "info", text: "Live mode uses persisted school data — demo fixtures are disabled." });
      return;
    }
    setFixtureMode(mode);
    setFlash(null);
    if (mode === "empty") loadEmptySchool();
    else loadPopulatedFixture();
  };

  const rebuildRegistersForDate = (
    date: string,
    mem = memberships,
    sess = sessions,
    ex = exceptions
  ) => {
    const wd = weekdayForDate(date);
    if (!wd) return;
    const base = buildInitialRegisters(date, wd);
    const daySessions = sess.filter((s) => s.weekday === wd);
    setRegisters((prev) => {
      const rows: RegisterRow[] = [];
      for (const session of daySessions) {
        const cancelled = ex.some(
          (e) =>
            (e.type === "CANCEL_OCCURRENCE" && e.sessionId === session.id && e.date === date) ||
            (e.type === "CANCEL_FUTURE" && e.sessionId === session.id && e.fromDate <= date)
        );
        if (cancelled) continue;
        const memberIds = new Set(mem.filter((m) => m.sessionId === session.id).map((m) => m.learnerId));
        for (const e of ex) {
          if (e.type === "ADD_TODAY" && e.sessionId === session.id && e.date === date) memberIds.add(e.learnerId);
          if (e.type === "SKIP_TODAY" && e.date === date) memberIds.delete(e.learnerId);
        }
        for (const learnerId of memberIds) {
          const existing = prev.find(
            (r) => r.learnerId === learnerId && r.sessionId === session.id && r.date === date
          );
          const seed = base.find((r) => r.learnerId === learnerId && r.sessionId === session.id);
          const learner = learnersCatalog.find((l) => l.id === learnerId);
          const parentCollect = ex.some(
            (e) => e.type === "PARENT_COLLECT_TODAY" && e.learnerId === learnerId && e.date === date
          );
          rows.push({
            learnerId,
            sessionId: session.id,
            date,
            attendance: existing?.attendance ?? seed?.attendance ?? "PRESENT",
            progress: existing?.progress ?? "WAITING",
            collectionAuthorised: learner?.transportAuthorised ?? false,
            alreadyHomeDismissed: existing?.alreadyHomeDismissed ?? false,
            note:
              existing?.note ||
              (parentCollect && session.groupId === "g-bus-a"
                ? "Parent collecting today (exception)"
                : undefined),
          });
        }
      }
      return rows;
    });
  };

  const onChangeDemoDate = (date: string) => {
    setDemoDate(date);
    setActiveSessionId(null);
    setMobileDetailOpen(false);
    setFlash(null);
    const wd = weekdayForDate(date);
    if (!wd) return;
    setTeacherCalls([]);
    if (isLive) {
      void (async () => {
        try {
          const reg = await apiGetRegisters(date);
          setRegisters(reg.rows);
          pushLog(`[LIVE] Date → ${date} (${wd}) · ${reg.rows.length} register row(s)`);
        } catch (e: any) {
          setFlash({ kind: "err", text: e?.message || "Failed to load registers" });
        }
      })();
      return;
    }
    // Must use live memberships/sessions — never re-seed from the demo fixture
    rebuildRegistersForDate(date, memberships, sessions, exceptions);
    pushLog(`[DEMO] Demonstration date → ${date} (${wd})`);
  };

  const sessionsToday = useMemo(() => {
    if (!weekday) return [];
    return sessions
      .filter((s) => s.weekday === weekday)
      .filter((s) => {
        return !exceptions.some(
          (e) =>
            (e.type === "CANCEL_OCCURRENCE" && e.sessionId === s.id && e.date === demoDate) ||
            (e.type === "CANCEL_FUTURE" && e.sessionId === s.id && e.fromDate <= demoDate)
        );
      })
      .sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  }, [sessions, weekday, exceptions, demoDate]);

  const transportGroups = groups.filter((g) => g.kind === "TRANSPORT");
  const editGroup = (editGroupId && groups.find((g) => g.id === editGroupId)) || null;
  const editSessions = sessions
    .filter((s) => editGroupId && s.groupId === editGroupId)
    .filter((s) => (sessionDayFilter === "ALL" ? true : s.weekday === sessionDayFilter))
    .sort((a, b) => {
      const order = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      const d = order.indexOf(a.weekday) - order.indexOf(b.weekday);
      return d !== 0 ? d : a.start.localeCompare(b.start);
    });

  const learnerCountForGroup = (groupId: string) => {
    const ids = new Set(
      memberships
        .filter((m) => sessions.some((s) => s.id === m.sessionId && s.groupId === groupId))
        .map((m) => m.learnerId)
    );
    return ids.size;
  };

  const overlaps = useMemo(() => findOverlapWarnings(memberships, sessions), [memberships, sessions]);

  const openSession = (sessionId: string) => {
    setActiveSessionId(sessionId);
    setMobileDetailOpen(true);
    setFlash(null);
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId) || null;
  const activeGroup = activeSession ? groups.find((g) => g.id === activeSession.groupId) || null : null;
  const sessionRows = registers.filter((r) => r.sessionId === activeSessionId && r.date === demoDate);
  const sessionCounts = countBucket(sessionRows);

  const applyLocalRowPatch = (
    learnerId: string,
    sessionId: string,
    patch: Partial<RegisterRow>,
    date = demoDate
  ) => {
    setRegisters((prev) =>
      prev.map((r) =>
        r.learnerId === learnerId && r.sessionId === sessionId && r.date === date ? { ...r, ...patch } : r
      )
    );
  };

  /**
   * Demo: local only. Live: persist attendance/progress/note via PATCH /registers.
   * Concurrent edits: last successful PATCH wins; failures re-fetch the date register.
   * No actor/audit trail is claimed.
   */
  const updateRow = async (
    learnerId: string,
    sessionId: string,
    patch: Partial<RegisterRow>,
    opts?: { logText?: string; okFlash?: string }
  ) => {
    const previous = registers.find(
      (r) => r.learnerId === learnerId && r.sessionId === sessionId && r.date === demoDate
    );
    applyLocalRowPatch(learnerId, sessionId, patch);
    if (!isLive) {
      if (opts?.logText) pushLog(opts.logText);
      if (opts?.okFlash) setFlash({ kind: "ok", text: opts.okFlash });
      return;
    }
    try {
      const saved = await apiPatchRegister({
        sessionId,
        learnerId,
        date: demoDate,
        attendance: patch.attendance,
        progress: patch.progress,
        note: patch.note,
      });
      applyLocalRowPatch(learnerId, sessionId, {
        attendance: saved.attendance,
        progress: saved.progress,
        note: saved.note,
        alreadyHomeDismissed: saved.alreadyHomeDismissed,
      });
      if (opts?.logText) pushLog(opts.logText.replace("[DEMO]", "[LIVE]"));
      setFlash({
        kind: "ok",
        text:
          opts?.okFlash?.replace("[DEMO]", "[LIVE]") ||
          "[LIVE] Register status saved. No staff audit trail is recorded yet.",
      });
    } catch (e: unknown) {
      if (previous) applyLocalRowPatch(learnerId, sessionId, previous);
      else {
        try {
          const reg = await apiGetRegisters(demoDate);
          setRegisters(reg.rows);
        } catch {
          /* keep optimistic rollback only */
        }
      }
      setFlash({
        kind: "err",
        text: e instanceof Error ? e.message : "Failed to save register status",
      });
    }
  };

  const callGroup = () => {
    if (!activeSession || !activeGroup) return;
    const targets = sessionRows.filter(
      (r) => r.attendance !== "ABSENT" && r.progress === "WAITING"
    );
    if (!isLive) {
      const classrooms = Array.from(
        new Set(
          sessionRows
            .filter((r) => r.attendance !== "ABSENT")
            .map((r) => learnersCatalog.find((l) => l.id === r.learnerId)?.className || "")
            .filter(Boolean)
        )
      );
      setTeacherCalls(
        classrooms.map((classroom) => ({
          sessionId: activeSession.id,
          date: demoDate,
          classroom,
          teacherName:
            classroom === "Grade 2A" ? "Ms Grove" : classroom === "Grade 2B" ? "Mr Nkosi" : "Ms Abrahams",
          status: "PENDING",
        }))
      );
      setRegisters((prev) =>
        prev.map((r) =>
          r.sessionId === activeSession.id &&
          r.date === demoDate &&
          r.attendance !== "ABSENT" &&
          r.progress === "WAITING"
            ? { ...r, progress: "CALLED" }
            : r
        )
      );
      setFlash({
        kind: "info",
        text: `[DEMO] Call sent to ${classrooms.length} teacher(s). Ack ≠ Ready ≠ Collected.`,
      });
      pushLog(`[DEMO] Called ${activeGroup.name} → ${classrooms.join(", ")}`);
      return;
    }
    // Live: persist CALLED progress only. Classroom acknowledgement workflow does not exist.
    void (async () => {
      try {
        await Promise.all(
          targets.map((r) =>
            apiPatchRegister({
              sessionId: r.sessionId,
              learnerId: r.learnerId,
              date: demoDate,
              progress: "CALLED",
            })
          )
        );
        const reg = await apiGetRegisters(demoDate);
        setRegisters(reg.rows);
        setFlash({
          kind: "ok",
          text: `[LIVE] Marked ${targets.length} learner(s) CALLED. Classroom ack workflow is not available.`,
        });
        pushLog(`[LIVE] Called ${activeGroup.name} → ${targets.length} learner(s) CALLED`);
      } catch (e: unknown) {
        setFlash({
          kind: "err",
          text: e instanceof Error ? e.message : "Failed to mark group as called",
        });
      }
    })();
  };

  const ackTeacher = (classroom: string) => {
    if (isLive) {
      setFlash({
        kind: "warn",
        text: "[LIVE] Classroom acknowledgement is not persisted (no backend workflow).",
      });
      return;
    }
    if (!activeSession) return;
    setTeacherCalls((prev) =>
      prev.map((c) =>
        c.sessionId === activeSession.id && c.date === demoDate && c.classroom === classroom
          ? { ...c, status: "ACKNOWLEDGED", acknowledgedAt: nowStamp() }
          : c
      )
    );
    pushLog(`[DEMO] ${classroom} acknowledged`);
  };

  const confirmHandover = () => {
    if (!modal || modal.type !== "handover" || !activeSession || !activeGroup) return;
    const row = sessionRows.find((r) => r.learnerId === modal.learnerId);
    if (!row) return;
    if (!isLive && saveFailDemo) {
      setFlash({ kind: "err", text: "[DEMO] Save failed — handover NOT recorded." });
      pushLog(`[DEMO] Handover save FAILED for ${displayName(modal.learnerId)}`);
      setModal(null);
      return;
    }
    if (activeGroup.kind === "TRANSPORT") {
      if (row.note?.includes("Parent collecting")) {
        setFlash({ kind: "warn", text: `${isLive ? "[LIVE]" : "[DEMO]"} Blocked: parent collecting today exception.` });
        setModal(null);
        return;
      }
      if (!row.collectionAuthorised) {
        setFlash({
          kind: "err",
          text: `${isLive ? "[LIVE]" : "[DEMO]"} Blocked: ${displayName(row.learnerId)} not authorised for this transport.`,
        });
        setModal(null);
        return;
      }
      if (row.alreadyHomeDismissed || row.progress === "COLLECTED") {
        setFlash({ kind: "warn", text: `${isLive ? "[LIVE]" : "[DEMO]"} Already collected / HomeSafe dismissed.` });
        setModal(null);
        return;
      }
      const collector = handoverName.trim() || activeGroup.driverName || "Driver";
      void updateRow(
        row.learnerId,
        row.sessionId,
        {
          progress: "COLLECTED",
          alreadyHomeDismissed: true,
          note: `Collected by ${collector} · ${nowStamp()}`,
        },
        {
          logText: `${isLive ? "[LIVE]" : "[DEMO]"} Transport handover ${displayName(row.learnerId)} → COLLECTED`,
          okFlash: isLive
            ? "[LIVE] Collected status saved on register (not a HomeSafe Early Departure dismissal)."
            : "[DEMO] Would write one HomeSafe dismissal (SCHOOL_TRANSPORT) — not called here.",
        }
      );
    } else {
      void updateRow(
        row.learnerId,
        row.sessionId,
        {
          progress: "HANDED_OVER",
          note: `With ${handoverName.trim() || activeSession.responsibleAdult} · ${nowStamp()}`,
        },
        {
          logText: `${isLive ? "[LIVE]" : "[DEMO]"} Activity handover ${displayName(row.learnerId)}`,
          okFlash: `${isLive ? "[LIVE]" : "[DEMO]"} Activity handover — NOT home-collected.`,
        }
      );
    }
    setModal(null);
    setHandoverName("");
  };

  const openAddSession = (returnTo?: "add-learners") => {
    // Prefer the Sessions filter day when adding; otherwise keep a sensible default.
    const preferDay =
      sessionDayFilter !== "ALL" ? sessionDayFilter : (weekday as Weekday | null) || "Mon";
    setDraftWeekday(preferDay);
    setDraftStart("10:00");
    setDraftEnd("10:30");
    setDraftAdult(editGroup?.kind === "TRANSPORT" ? editGroup.driverName || "" : "");
    setDraftLocation(editGroup?.kind === "TRANSPORT" ? "Front gate" : "");
    // Fresh learner picks for this new session only (unless returning mid multi-assign).
    if (!returnTo) setSelectedLearnerIds(new Set());
    setLearnerSearch("");
    setClassFilter("");
    setModalFlash(null);
    setFieldErrors({});
    setModal({ type: "add-session", returnTo });
  };

  const openAddLearners = () => {
    const forGroup = sessions.filter((s) => s.groupId === editGroupId);
    setSelectedLearnerIds(new Set());
    // Do not auto-enrol into every session. Pre-select only when the group has exactly one slot.
    setSelectedSessionIds(forGroup.length === 1 ? new Set([forGroup[0].id]) : new Set());
    setLearnerSearch("");
    setClassFilter("");
    setModalFlash(null);
    setFieldErrors({});
    setModal({ type: "add-learners" });
  };

  const openManageSessionLearners = (sessionId: string) => {
    const current = memberships.filter((m) => m.sessionId === sessionId).map((m) => m.learnerId);
    setSelectedLearnerIds(new Set(current));
    setSelectedSessionIds(new Set([sessionId]));
    setLearnerSearch("");
    setClassFilter("");
    setModalFlash(null);
    setFieldErrors({});
    setOpenMenuSessionId(null);
    setModal({ type: "manage-session-learners", sessionId });
  };

  const saveNewSession = () => {
    if (!editGroup) return;
    const returnTo = modal?.type === "add-session" ? modal.returnTo : undefined;
    const nextFieldErrors: typeof fieldErrors = {};
    const startNorm = normaliseHhMmInput(draftStart);
    const endNorm = normaliseHhMmInput(draftEnd);
    if (!startNorm) nextFieldErrors.start = "Enter start as HH:mm (08:00–16:00).";
    if (!endNorm) nextFieldErrors.end = "Enter end as HH:mm (08:00–16:00).";
    const validated = validateScheduleTimes(draftStart, draftEnd);
    if (!validated.ok) {
      if (!nextFieldErrors.start && !nextFieldErrors.end) {
        if (validated.message.toLowerCase().includes("end")) nextFieldErrors.end = validated.message;
        else if (validated.message.toLowerCase().includes("start")) nextFieldErrors.start = validated.message;
        else nextFieldErrors.end = validated.message;
      } else if (!validated.ok && startNorm && endNorm) {
        nextFieldErrors.end = validated.message;
      }
    }
    const adult =
      editGroup.kind === "TRANSPORT"
        ? editGroup.driverName || draftAdult.trim() || "Driver"
        : draftAdult.trim();
    if (editGroup.kind === "ACTIVITY" && !adult) {
      nextFieldErrors.adult = "Responsible adult is required.";
    }
    if (Object.keys(nextFieldErrors).length || !validated.ok) {
      setFieldErrors(nextFieldErrors);
      setModalFlash({ kind: "warn", text: "Fix the highlighted fields to save this session." });
      return;
    }
    const assignOnCreate = returnTo !== "add-learners" ? [...selectedLearnerIds] : [];

    const applyCreatedSession = (session: DemoSession) => {
      const nextSessions = [...sessions, session];
      setSessions(nextSessions);
      let nextMemberships = memberships;
      if (assignOnCreate.length) {
        nextMemberships = [
          ...memberships,
          ...assignOnCreate.map((learnerId) => ({ learnerId, sessionId: session.id })),
        ];
        setMemberships(nextMemberships);
      }
      if (isLive) {
        void apiGetRegisters(demoDate)
          .then((reg) => setRegisters(reg.rows))
          .catch(() => rebuildRegistersForDate(demoDate, nextMemberships, nextSessions, exceptions));
      } else {
        rebuildRegistersForDate(demoDate, nextMemberships, nextSessions, exceptions);
      }
      setSessionDayFilter("ALL");
      setManageSub("sessions");
      pushLog(
        `${isLive ? "[LIVE]" : "[DEMO]"} Added session ${session.weekday} ${session.start}–${session.end} to ${editGroup.name}` +
          (assignOnCreate.length ? ` · ${assignOnCreate.length} learner(s) on this slot only` : "")
      );
      if (returnTo === "add-learners") {
        setSelectedSessionIds((prev) => new Set([...prev, session.id]));
        setFieldErrors({});
        setModalFlash({
          kind: "ok",
          text: `Session ${session.weekday} ${session.start}–${session.end} added and selected. Confirm assign to enrol the selected learners on the chosen session(s) only.`,
        });
        setModal({ type: "add-learners" });
        return;
      }
      setSelectedLearnerIds(new Set());
      setModalFlash(null);
      setFieldErrors({});
      setModal(null);
      setFlash({
        kind: "ok",
        text: assignOnCreate.length
          ? `${isLive ? "[LIVE]" : "[DEMO]"} ${session.weekday} ${session.start}–${session.end} saved with ${assignOnCreate.length} learner(s). Add another session anytime — existing slots stay.`
          : `${isLive ? "[LIVE]" : "[DEMO]"} ${session.weekday} ${session.start}–${session.end} added to ${editGroup.name}. Use Manage learners on the row to assign this slot.`,
      });
    };

    if (isLive) {
      void (async () => {
        try {
          const session = await apiCreateSession({
            groupId: editGroup.id,
            weekday: draftWeekday,
            start: validated.start,
            end: validated.end,
            responsibleAdult: adult,
            location: draftLocation.trim() || undefined,
            learnerIds: assignOnCreate,
          });
          applyCreatedSession(session);
        } catch (e: any) {
          setModalFlash({ kind: "err", text: e?.message || "Failed to save session" });
        }
      })();
      return;
    }

    // Always append — never replace the group's existing sessions.
    const session: DemoSession = {
      id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      groupId: editGroup.id,
      weekday: draftWeekday,
      start: validated.start,
      end: validated.end,
      responsibleAdult: adult,
      location: draftLocation.trim() || undefined,
    };
    applyCreatedSession(session);
  };

  /** Replace the roster for one session only; other sessions' memberships are untouched. */
  const saveManageSessionLearners = () => {
    if (!modal || modal.type !== "manage-session-learners") return;
    const sessionId = modal.sessionId;
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const chosen = [...selectedLearnerIds];
    const applyLocal = (next: SessionMembership[]) => {
      setMemberships(next);
      if (isLive) {
        void apiGetRegisters(demoDate)
          .then((reg) => setRegisters(reg.rows))
          .catch(() => rebuildRegistersForDate(demoDate, next, sessions, exceptions));
      } else {
        rebuildRegistersForDate(demoDate, next, sessions, exceptions);
      }
      setModal(null);
      setModalFlash(null);
      setFieldErrors({});
      setSelectedLearnerIds(new Set());
      pushLog(
        `${isLive ? "[LIVE]" : "[DEMO]"} Updated learners for ${session.weekday} ${session.start}–${session.end} → ${chosen.length} (other sessions unchanged)`
      );
      setFlash({
        kind: "ok",
        text: `${isLive ? "[LIVE]" : "[DEMO]"} ${session.weekday} ${session.start}–${session.end}: ${chosen.length} learner(s). Other sessions in ${editGroup?.name || "group"} unchanged.`,
      });
    };
    if (isLive) {
      void (async () => {
        try {
          await apiSetSessionLearners(sessionId, chosen);
          applyLocal([
            ...memberships.filter((m) => m.sessionId !== sessionId),
            ...chosen.map((learnerId) => ({ learnerId, sessionId })),
          ]);
        } catch (e: any) {
          setModalFlash({ kind: "err", text: e?.message || "Failed to save session learners" });
        }
      })();
      return;
    }
    applyLocal([
      ...memberships.filter((m) => m.sessionId !== sessionId),
      ...chosen.map((learnerId) => ({ learnerId, sessionId })),
    ]);
  };

  const saveReschedule = () => {
    if (!modal || modal.type !== "reschedule") return;
    const validated = validateScheduleTimes(draftStart, draftEnd);
    if (!validated.ok) {
      setFlash({ kind: "warn", text: validated.message });
      return;
    }
    const sessionId = modal.sessionId;
    if (draftScope === "one") {
      const nextEx: DatedException[] = [
        ...exceptions,
        {
          type: "RESCHEDULE_OCCURRENCE",
          sessionId,
          date: demoDate,
          newStart: validated.start,
          newEnd: validated.end,
        },
      ];
      setExceptions(nextEx);
      // Visual: adjust occurrence times only when viewing that weekday's template for demo clarity
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId && s.weekday === weekday
            ? { ...s, start: validated.start, end: validated.end }
            : s
        )
      );
      pushLog(
        `[DEMO] Rescheduled ONE occurrence ${sessionId} on ${demoDate} → ${validated.start}–${validated.end}`
      );
      setFlash({ kind: "ok", text: "[DEMO] This occurrence rescheduled. Recurring template remains separate in production." });
    } else {
      setSessions((prev) =>
        prev.map((s) =>
          s.id === sessionId ? { ...s, start: validated.start, end: validated.end } : s
        )
      );
      pushLog(
        `[DEMO] Rescheduled FUTURE template ${sessionId} → ${validated.start}–${validated.end}`
      );
      setFlash({ kind: "ok", text: "[DEMO] Future recurring times updated (historical registers preserved in production)." });
    }
    rebuildRegistersForDate(demoDate);
    setModal(null);
    setOpenMenuSessionId(null);
  };

  const cancelSession = (sessionId: string, scope: "one" | "future") => {
    if (scope === "one") {
      const next = [...exceptions, { type: "CANCEL_OCCURRENCE" as const, sessionId, date: demoDate }];
      setExceptions(next);
      rebuildRegistersForDate(demoDate, memberships, sessions, next);
      pushLog(`[DEMO] Cancelled occurrence ${sessionId} on ${demoDate}`);
      setFlash({ kind: "warn", text: "[DEMO] This occurrence cancelled." });
    } else {
      const next = [...exceptions, { type: "CANCEL_FUTURE" as const, sessionId, fromDate: demoDate }];
      setExceptions(next);
      rebuildRegistersForDate(demoDate, memberships, sessions, next);
      pushLog(`[DEMO] Cancelled future from ${demoDate} for ${sessionId}`);
      setFlash({ kind: "warn", text: "[DEMO] This and future occurrences cancelled." });
    }
    setOpenMenuSessionId(null);
  };

  const saveGroupDetails = () => {
    if (!editGroup) return;
    const name = draftName.trim();
    if (!name) {
      setFlash({ kind: "warn", text: "Group name is required." });
      return;
    }
    setGroups((prev) =>
      prev.map((g) =>
        g.id === editGroup.id
          ? {
              ...g,
              name,
              ...(g.kind === "TRANSPORT"
                ? {
                    driverName: draftDriver.trim() || g.driverName,
                    driverContact: draftContact.trim() || g.driverContact,
                    vehicleReg: draftReg.trim() || g.vehicleReg,
                  }
                : {}),
            }
          : g
      )
    );
    setFlash({ kind: "ok", text: "[DEMO] Group details updated (in-memory)." });
    setModal(null);
  };

  const createGroup = () => {
    const name = draftName.trim();
    if (!name) {
      setFlash({ kind: "warn", text: "Enter a group name." });
      return;
    }
    const finish = (group: DemoGroup) => {
      setGroups((g) => [...g, group]);
      setEditGroupId(group.id);
      setManageSub("sessions");
      setTab("manage");
      if (group.kind === "TRANSPORT") setTransportPick(group.id);
      setDraftName("");
      setDraftDriver("");
      setDraftContact("");
      setDraftReg("");
      pushLog(
        `${isLive ? "[LIVE]" : "[DEMO]"} School created ${group.kind} group “${group.name}” (school-owned name)`
      );
      setFlash({
        kind: "ok",
        text: `${isLive ? "[LIVE]" : "[DEMO]"} Created “${group.name}”. Add sessions next.`,
      });
    };
    if (isLive) {
      void (async () => {
        try {
          const group = await apiCreateGroup({
            name,
            kind: draftKind,
            driverName: draftDriver.trim() || undefined,
            driverContact: draftContact.trim() || undefined,
            vehicleReg: draftReg.trim() || undefined,
          });
          finish(group);
        } catch (e: any) {
          setFlash({ kind: "err", text: e?.message || "Failed to create group" });
        }
      })();
      return;
    }
    const id = `g-${Date.now()}`;
    const group: DemoGroup =
      draftKind === "TRANSPORT"
        ? {
            id,
            kind: "TRANSPORT",
            name,
            driverName: draftDriver.trim() || "Driver",
            driverContact: draftContact.trim() || "",
            vehicleReg: draftReg.trim() || "",
            driverInitials: (draftDriver.trim() || "DR")
              .split(/\s+/)
              .map((p) => p[0] || "")
              .join("")
              .slice(0, 2)
              .toUpperCase() || "DR",
          }
        : { id, kind: "ACTIVITY", name };
    finish(group);
  };

  const groupSessionsForAssign = useMemo(
    () => sessions.filter((s) => s.groupId === editGroupId).sort((a, b) => {
      const order = ["Mon", "Tue", "Wed", "Thu", "Fri"];
      const d = order.indexOf(a.weekday) - order.indexOf(b.weekday);
      return d !== 0 ? d : a.start.localeCompare(b.start);
    }),
    [sessions, editGroupId]
  );

  // One selected session is enough; never require a second session
  const canConfirmAssign = selectedLearnerIds.size > 0 && selectedSessionIds.size > 0;

  // Drop stale session ids if sessions change; do not force-select (user may clear a checkbox)
  useEffect(() => {
    if (modal?.type !== "add-learners") return;
    const allowed = new Set(groupSessionsForAssign.map((s) => s.id));
    setSelectedSessionIds((prev) => {
      const pruned = new Set([...prev].filter((id) => allowed.has(id)));
      if (pruned.size === prev.size && [...pruned].every((id) => prev.has(id))) return prev;
      return pruned;
    });
  }, [modal?.type, groupSessionsForAssign]);

  const assignSelected = () => {
    const nextErrors: typeof fieldErrors = {};
    if (!selectedLearnerIds.size) {
      nextErrors.learners = "Select at least one learner.";
    }
    if (groupSessionsForAssign.length === 0) {
      nextErrors.sessions = "Add a day and time for this group before assigning learners.";
    } else if (!selectedSessionIds.size) {
      nextErrors.sessions = "Select at least one session to enrol these learners on.";
    }
    if (Object.keys(nextErrors).length) {
      setFieldErrors(nextErrors);
      setModalFlash({ kind: "warn", text: "Fix the highlighted fields to save." });
      return;
    }
    const allowed = new Set(groupSessionsForAssign.map((s) => s.id));
    const validSelected = [...selectedSessionIds].filter((id) => allowed.has(id));
    if (!validSelected.length) {
      setFieldErrors({ sessions: "Select a current session for this group." });
      setModalFlash({ kind: "warn", text: "Fix the highlighted fields to save." });
      return;
    }
    const next = [...memberships];
    let added = 0;
    let skippedDup = 0;
    for (const learnerId of selectedLearnerIds) {
      for (const sessionId of validSelected) {
        if (next.some((m) => m.learnerId === learnerId && m.sessionId === sessionId)) {
          skippedDup += 1;
          continue;
        }
        next.push({ learnerId, sessionId });
        added += 1;
      }
    }
    if (added === 0) {
      setFieldErrors({
        sessions:
          skippedDup > 0
            ? "Those learners are already assigned to the selected session(s)."
            : "No new assignments to save.",
      });
      setModalFlash({ kind: "warn", text: "Fix the highlighted fields to save." });
      return;
    }
    const commitAssign = () => {
      setMemberships(next);
      if (isLive) {
        void apiGetRegisters(demoDate)
          .then((reg) => setRegisters(reg.rows))
          .catch(() => rebuildRegistersForDate(demoDate, next, sessions, exceptions));
      } else {
        rebuildRegistersForDate(demoDate, next, sessions, exceptions);
      }
    };
    if (isLive) {
      void (async () => {
        try {
          await apiAssignLearners([...selectedLearnerIds], validSelected);
          commitAssign();
        } catch (e: any) {
          setModalFlash({ kind: "err", text: e?.message || "Failed to assign learners" });
          return;
        }
        const learnerN = selectedLearnerIds.size;
        const sessionN = validSelected.length;
        const weekdays = [
          ...new Set(
            validSelected
              .map((id) => sessions.find((s) => s.id === id)?.weekday)
              .filter(Boolean) as string[]
          ),
        ].join(", ");
        setSelectedLearnerIds(new Set());
        setSelectedSessionIds(new Set());
        setModalFlash(null);
        setFieldErrors({});
        setModal(null);
        pushLog(
          `[LIVE] Assigned ${added} membership(s) in ${editGroup?.name}` +
            (skippedDup ? ` (${skippedDup} duplicates skipped)` : "")
        );
        setFlash({
          kind: "ok",
          text: `Saved: ${learnerN} learner(s) → ${sessionN} session(s) (${weekdays}) in ${editGroup?.name || "group"}.`,
        });
      })();
      return;
    }
    commitAssign();
    const learnerN = selectedLearnerIds.size;
    const sessionN = validSelected.length;
    const weekdays = [
      ...new Set(
        validSelected
          .map((id) => sessions.find((s) => s.id === id)?.weekday)
          .filter(Boolean) as string[]
      ),
    ].join(", ");
    setSelectedLearnerIds(new Set());
    setSelectedSessionIds(new Set());
    setModalFlash(null);
    setFieldErrors({});
    setModal(null);
    pushLog(
      `[DEMO] Assigned ${added} membership(s) in ${editGroup?.name}` +
        (skippedDup ? ` (${skippedDup} duplicates skipped)` : "")
    );
    setFlash({
      kind: "ok",
      text: `Saved: ${learnerN} learner(s) → ${sessionN} session(s) (${weekdays}) in ${editGroup?.name || "group"}. Open that weekday on Today to see the register.`,
    });
  };

  const removeMembership = (learnerId: string, sessionId: string) => {
    const apply = () => {
      const next = memberships.filter((m) => !(m.learnerId === learnerId && m.sessionId === sessionId));
      setMemberships(next);
      if (isLive) {
        void apiGetRegisters(demoDate)
          .then((reg) => setRegisters(reg.rows))
          .catch(() => rebuildRegistersForDate(demoDate, next, sessions, exceptions));
      } else {
        rebuildRegistersForDate(demoDate, next, sessions, exceptions);
      }
      pushLog(
        `${isLive ? "[LIVE]" : "[DEMO]"} Removed ${displayName(learnerId)} from session ${sessionId} only`
      );
    };
    if (isLive) {
      void (async () => {
        try {
          await apiRemoveLearnerFromSession(sessionId, learnerId);
          apply();
        } catch (e: any) {
          setFlash({ kind: "err", text: e?.message || "Failed to remove learner" });
        }
      })();
      return;
    }
    apply();
  };

  /** Remove one learner from every session in the current group (overview action). */
  const removeLearnerFromGroup = (learnerId: string) => {
    if (!editGroupId) return;
    const groupSessionIds = new Set(sessions.filter((s) => s.groupId === editGroupId).map((s) => s.id));
    const next = memberships.filter((m) => !(m.learnerId === learnerId && groupSessionIds.has(m.sessionId)));
    setMemberships(next);
    rebuildRegistersForDate(demoDate, next, sessions, exceptions);
    pushLog(`[DEMO] Removed ${displayName(learnerId)} from all sessions in group ${editGroupId}`);
  };

  const applyTodayException = () => {
    if (!modal || modal.type !== "today-exception") return;
    if (modal.mode === "skip") {
      const next = [...exceptions, { type: "SKIP_TODAY" as const, learnerId: modal.learnerId, date: demoDate }];
      setExceptions(next);
      rebuildRegistersForDate(demoDate, memberships, sessions, next);
      pushLog(`[DEMO] Skip today ${displayName(modal.learnerId)}`);
      setFlash({ kind: "info", text: "[DEMO] Skip today — recurring membership unchanged." });
    } else {
      if (!exceptionSessionId) {
        setFlash({ kind: "warn", text: "Choose a session for Add today." });
        return;
      }
      const next = [
        ...exceptions,
        { type: "ADD_TODAY" as const, learnerId: modal.learnerId, sessionId: exceptionSessionId, date: demoDate },
      ];
      setExceptions(next);
      rebuildRegistersForDate(demoDate, memberships, sessions, next);
      pushLog(`[DEMO] Add today ${displayName(modal.learnerId)} → ${exceptionSessionId}`);
      setFlash({ kind: "info", text: "[DEMO] Added for today only." });
    }
    setModal(null);
  };

  const moveLearner = () => {
    if (!modal || modal.type !== "move-learner") return;
    if (!exceptionSessionId || exceptionSessionId === modal.fromSessionId) {
      setFlash({ kind: "warn", text: "Choose a different target session in this group." });
      return;
    }
    const next = memberships
      .filter((m) => !(m.learnerId === modal.learnerId && m.sessionId === modal.fromSessionId))
      .concat({ learnerId: modal.learnerId, sessionId: exceptionSessionId });
    setMemberships(next);
    rebuildRegistersForDate(demoDate, next, sessions, exceptions);
    pushLog(`[DEMO] Moved ${displayName(modal.learnerId)} → ${exceptionSessionId}`);
    setFlash({ kind: "ok", text: "[DEMO] Learner moved." });
    setModal(null);
  };

  const filteredPickerLearners = learnersCatalog.filter((l) => {
    if (classFilter && l.className !== classFilter) return false;
    const q = learnerSearch.trim().toLowerCase();
    if (!q) return true;
    return `${l.firstName} ${l.lastName}`.toLowerCase().includes(q);
  });

  const membersByLearner = useMemo(() => {
    const map = new Map<string, DemoSession[]>();
    if (!editGroupId) return map;
    for (const m of memberships) {
      const s = sessions.find((x) => x.id === m.sessionId && x.groupId === editGroupId);
      if (!s) continue;
      const list = map.get(m.learnerId) || [];
      list.push(s);
      map.set(m.learnerId, list);
    }
    return map;
  }, [memberships, sessions, editGroupId]);

  const overlapForSession = (session: DemoSession) => {
    const learnerIds = memberships.filter((m) => m.sessionId === session.id).map((m) => m.learnerId);
    const hits: string[] = [];
    for (const learnerId of learnerIds) {
      const other = memberships
        .filter((m) => m.learnerId === learnerId && m.sessionId !== session.id)
        .map((m) => sessions.find((s) => s.id === m.sessionId))
        .filter(Boolean) as DemoSession[];
      for (const o of other) {
        if (sessionsOverlap(session, o)) {
          hits.push(`${displayName(learnerId)} overlaps ${o.start}–${o.end}`);
        }
      }
    }
    return hits;
  };

  const renderDetail = () => {
    if (!activeSession || !activeGroup) {
      return <div className="hs-cg-empty">Select a session to open its register.</div>;
    }
    const calls = teacherCalls.filter((c) => c.sessionId === activeSession.id && c.date === demoDate);
    return (
      <>
        <div className="hs-cg-detail-head">
          <div>
            <h3>
              {activeGroup.name} · {activeSession.start}–{activeSession.end}
            </h3>
            <p>
              {demoDate} · {activeSession.responsibleAdult}
              {activeSession.location ? ` · ${activeSession.location}` : ""}
            </p>
          </div>
          <button
            type="button"
            className="hs-cg-btn sm"
            onClick={() => {
              setActiveSessionId(null);
              setMobileDetailOpen(false);
            }}
          >
            Close
          </button>
        </div>

        {activeGroup.kind === "TRANSPORT" && (
          <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: "#444" }}>
            Driver {activeGroup.driverName} · {activeGroup.vehicleReg} · {activeGroup.driverContact}
          </p>
        )}

        <div className="hs-cg-chips" style={{ marginBottom: 8 }}>
          <span className="hs-cg-chip">Expected {sessionCounts.expected}</span>
          <span className="hs-cg-chip wait">Waiting {sessionCounts.waiting}</span>
          <span className="hs-cg-chip ready">Ready {sessionCounts.ready}</span>
          {activeGroup.kind === "TRANSPORT" ? (
            <span className="hs-cg-chip done">Collected {sessionCounts.collected}</span>
          ) : (
            <>
              <span className="hs-cg-chip away">Away {sessionCounts.handed}</span>
              <span className="hs-cg-chip done">Returned {sessionCounts.returned}</span>
            </>
          )}
          <span className="hs-cg-chip warn">Absent {sessionCounts.absentees}</span>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {activeGroup.kind === "TRANSPORT" && (
            <button type="button" className="hs-cg-btn gold" onClick={callGroup}>
              Call group
            </button>
          )}
          {!isLive && (
            <label className="hs-cg-btn sm" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" checked={saveFailDemo} onChange={(e) => setSaveFailDemo(e.target.checked)} />
              Simulate save failure
            </label>
          )}
        </div>

        {calls.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {calls.map((c) => (
              <div key={c.classroom} className="hs-cg-learner">
                <div className="hs-cg-avatar" style={avatarStyle(40)}>
                  T
                </div>
                <div className="hs-cg-learner-meta">
                  <strong>
                    {c.teacherName} · {c.classroom}
                  </strong>
                  <span>
                    {c.status === "ACKNOWLEDGED"
                      ? `Acknowledged ${c.acknowledgedAt}`
                      : "Pending — not Ready / Collected"}
                  </span>
                </div>
                {c.status === "PENDING" ? (
                  <button type="button" className="hs-cg-btn sm" onClick={() => ackTeacher(c.classroom)}>
                    Ack [DEMO]
                  </button>
                ) : (
                  <span className="hs-cg-chip done">Acked</span>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="hs-cg-scroll">
          {sessionRows
            .filter((r) => r.attendance !== "ABSENT")
            .map((r) => {
              const learner = learnersCatalog.find((l) => l.id === r.learnerId)!;
              const blocked =
                activeGroup.kind === "TRANSPORT" &&
                (!r.collectionAuthorised || !!r.note?.includes("Parent collecting") || r.alreadyHomeDismissed);
              return (
                <div key={r.learnerId} className={`hs-cg-learner${blocked ? " is-blocked" : ""}`}>
                  <div className="hs-cg-avatar" style={avatarStyle(learner.hue)}>
                    {initials(learner.firstName, learner.lastName)}
                  </div>
                  <div className="hs-cg-learner-meta">
                    <strong>
                      {learner.firstName} {learner.lastName}
                    </strong>
                    <span>
                      {learner.className} ·{" "}
                      {r.attendance === "UNCONFIRMED" ? (
                        <em style={{ color: "#9b1c1c", fontStyle: "normal" }}>Attendance unconfirmed</em>
                      ) : (
                        r.attendance
                      )}{" "}
                      · {r.progress}
                    </span>
                    {r.note && <span>{r.note}</span>}
                  </div>
                  <div className="hs-cg-row-actions">
                    {activeGroup.kind === "TRANSPORT" && (
                      <>
                        {(r.progress === "WAITING" || r.progress === "CALLED") && (
                          <button
                            type="button"
                            className="hs-cg-btn sm"
                            onClick={() => {
                              void updateRow(
                                r.learnerId,
                                r.sessionId,
                                { progress: "READY" },
                                { logText: `${isLive ? "[LIVE]" : "[DEMO]"} ${displayName(r.learnerId)} → Ready` }
                              );
                            }}
                          >
                            Ready
                          </button>
                        )}
                        {r.progress !== "COLLECTED" && (
                          <button
                            type="button"
                            className="hs-cg-btn sm primary"
                            onClick={() => {
                              setHandoverName(activeGroup.driverName || "");
                              setModal({ type: "handover", learnerId: r.learnerId, sessionId: r.sessionId });
                            }}
                          >
                            Handover
                          </button>
                        )}
                        {r.progress === "COLLECTED" && <span className="hs-cg-chip done">Collected</span>}
                      </>
                    )}
                    {activeGroup.kind === "ACTIVITY" && (
                      <>
                        {(r.progress === "WAITING" || r.progress === "CALLED" || r.progress === "READY") && (
                          <>
                            <button
                              type="button"
                              className="hs-cg-btn sm"
                              onClick={() => {
                                void updateRow(
                                  r.learnerId,
                                  r.sessionId,
                                  { progress: "PARTICIPATING" },
                                  {
                                    logText: `${isLive ? "[LIVE]" : "[DEMO]"} ${displayName(r.learnerId)} → Participating`,
                                  }
                                );
                              }}
                            >
                              Participate
                            </button>
                            <button
                              type="button"
                              className="hs-cg-btn sm primary"
                              onClick={() => {
                                setHandoverName(activeSession.responsibleAdult);
                                setModal({ type: "handover", learnerId: r.learnerId, sessionId: r.sessionId });
                              }}
                            >
                              Hand over
                            </button>
                          </>
                        )}
                        {(r.progress === "HANDED_OVER" ||
                          r.progress === "PARTICIPATING" ||
                          r.progress === "AWAY") && (
                          <button
                            type="button"
                            className="hs-cg-btn sm gold"
                            onClick={() => {
                              void updateRow(
                                r.learnerId,
                                r.sessionId,
                                {
                                  progress: "RETURNED",
                                  note: `Returned ${nowStamp()}`,
                                },
                                {
                                  logText: `${isLive ? "[LIVE]" : "[DEMO]"} ${displayName(r.learnerId)} → Returned`,
                                  okFlash: `${isLive ? "[LIVE]" : "[DEMO]"} Returned — still NOT home-collected.`,
                                }
                              );
                            }}
                          >
                            Return
                          </button>
                        )}
                        {(r.progress === "RETURNED" || r.progress === "COMPLETED") && (
                          <span className="hs-cg-chip done">{r.progress}</span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

          <p style={{ margin: "10px 0 6px", fontSize: 11, fontWeight: 800, color: "#666" }}>
            CONFIRMED ABSENTEES
          </p>
          {sessionRows.filter((r) => r.attendance === "ABSENT").length === 0 ? (
            <div className="hs-cg-empty">None</div>
          ) : (
            sessionRows
              .filter((r) => r.attendance === "ABSENT")
              .map((r) => {
                const learner = learnersCatalog.find((l) => l.id === r.learnerId)!;
                return (
                  <div key={r.learnerId} className="hs-cg-learner">
                    <div className="hs-cg-avatar" style={avatarStyle(learner.hue)}>
                      {initials(learner.firstName, learner.lastName)}
                    </div>
                    <div className="hs-cg-learner-meta">
                      <strong>
                        {learner.firstName} {learner.lastName}
                      </strong>
                      <span>
                        {learner.className} · Confirmed absent
                      </span>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      </>
    );
  };

  return (
    <div className="hs-cg" data-hs-cg-revision={HS_CG_PROTO_REVISION}>
      <div className="hs-cg-top">
        <div className="hs-cg-tabs" role="tablist" aria-label="Collections & Groups">
          <button type="button" className={tab === "today" ? "is-active" : ""} onClick={() => setTab("today")}>
            Today
          </button>
          <button type="button" className={tab === "manage" ? "is-active" : ""} onClick={() => setTab("manage")}>
            Manage Groups
          </button>
        </div>
        <div className="hs-cg-meta">
          {!isLive && (
            <label className="hs-cg-badge" style={{ gap: 6, cursor: "pointer" }} title="Local prototype only">
              Fixture
              <select
                value={fixtureMode}
                onChange={(e) => applyFixtureMode(e.target.value as FixtureMode)}
                style={{
                  minHeight: 28,
                  padding: "2px 8px",
                  fontSize: 12,
                  fontWeight: 800,
                  border: "1px solid rgba(201,162,39,0.45)",
                  borderRadius: 999,
                  background: "#fff",
                  color: "#7a5b00",
                }}
                aria-label="Demonstration fixture"
              >
                <option value="populated">Populated demo</option>
                <option value="empty">Empty school</option>
              </select>
            </label>
          )}
          <span className="hs-cg-badge">
            {isLive ? (liveLoading ? "Loading…" : "Live — persisted") : "Demo — fictional data"}
          </span>
          <span className="hs-cg-rev" title={HS_CG_PROTO_BUILT_AT}>
            {HS_CG_PROTO_REVISION}
          </span>
        </div>
      </div>

      {flash && <div className={`hs-cg-flash ${flash.kind}`}>{flash.text}</div>}

      {tab === "today" && (
        <>
          <div className="hs-cg-weekdays" role="tablist" aria-label="Demonstration weekday">
            {DEMO_DATE_OPTIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`hs-cg-weekday${demoDate === d.value ? " is-active" : ""}`}
                onClick={() => onChangeDemoDate(d.value)}
              >
                <strong>{d.weekday}</strong>
                <span>{shortDate(d.value)}</span>
              </button>
            ))}
          </div>

          <div className="hs-cg-toolbar">
            <label>
              Arriving transport
              <select
                value={transportPick}
                onChange={(e) => setTransportPick(e.target.value)}
                disabled={transportGroups.length === 0}
              >
                {transportGroups.length === 0 ? (
                  <option value="">No transport groups yet</option>
                ) : (
                  transportGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                      {g.driverName ? ` · ${g.driverName}` : ""}
                      {g.vehicleReg ? ` · ${g.vehicleReg}` : ""}
                    </option>
                  ))
                )}
              </select>
            </label>
            <button
              type="button"
              className="hs-cg-btn primary"
              disabled={transportGroups.length === 0}
              onClick={() => {
                const sess = sessionsToday.find((s) => s.groupId === transportPick);
                if (!sess) {
                  setFlash({ kind: "warn", text: "[DEMO] No transport session on this weekday." });
                  return;
                }
                openSession(sess.id);
              }}
            >
              Open register
            </button>
            {groups.length === 0 && (
              <button
                type="button"
                className="hs-cg-btn gold"
                onClick={() => {
                  setTab("manage");
                  setFlash({
                    kind: "info",
                    text: "Create a Transport or Activity group with your school’s own name.",
                  });
                }}
              >
                Create your first group
              </button>
            )}
          </div>

          <div className={`hs-cg-layout${activeSessionId ? " split" : ""}`}>
            <div className="hs-cg-panel">
              <h2 className="hs-cg-panel-title">Agenda · {weekday || "—"}</h2>
              {sessionsToday.length === 0 ? (
                <div className="hs-cg-empty">
                  {groups.length === 0
                    ? "No sessions scheduled for this day. Create your first group to get started."
                    : "No sessions scheduled for this day"}
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table className="hs-cg-agenda">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Group</th>
                        <th>Responsible adult</th>
                        <th>Progress</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {sessionsToday.map((s) => {
                        const g = groups.find((x) => x.id === s.groupId);
                        const c = countBucket(
                          registers.filter((r) => r.sessionId === s.id && r.date === demoDate)
                        );
                        return (
                          <tr key={s.id}>
                            <td className="time">
                              {s.start}–{s.end}
                            </td>
                            <td>
                              <span className="name">{g?.name || "—"}</span>
                              <span className="sub">{g?.kind === "TRANSPORT" ? "Transport" : "Activity"}</span>
                            </td>
                            <td>{s.responsibleAdult}</td>
                            <td>
                              <div className="hs-cg-chips">
                                <span className="hs-cg-chip">Expected {c.expected}</span>
                                <span className="hs-cg-chip wait">Waiting {c.waiting}</span>
                                {g?.kind === "TRANSPORT" ? (
                                  <span className="hs-cg-chip done">Collected {c.collected}</span>
                                ) : (
                                  <span className="hs-cg-chip away">Away {c.handed}</span>
                                )}
                              </div>
                            </td>
                            <td>
                              <button type="button" className="hs-cg-btn sm primary" onClick={() => openSession(s.id)}>
                                Open register
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {activeSessionId && (
              <div className="hs-cg-panel hs-cg-detail-desktop">{renderDetail()}</div>
            )}
          </div>

          {mobileDetailOpen && activeSessionId && (
            <div className="hs-cg-mobile-sheet hs-cg-mobile-only">
              <div className="hs-cg-panel">{renderDetail()}</div>
            </div>
          )}
        </>
      )}

      {tab === "manage" && (
        <div className="hs-cg-layout manage">
          <div className="hs-cg-panel">
            <h2 className="hs-cg-panel-title">Groups</h2>
            <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#666" }}>
              Types: Transport or Activity only. Names are chosen by the school.
            </p>
            {groups.length === 0 ? (
              <div className="hs-cg-empty" style={{ marginBottom: 10 }}>
                No groups yet. Create your first group.
              </div>
            ) : (
              <div className="hs-cg-group-list">
                {groups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className={`hs-cg-group-item${editGroupId === g.id ? " is-active" : ""}`}
                    onClick={() => {
                      setEditGroupId(g.id);
                      setManageSub("sessions");
                      setOpenMenuSessionId(null);
                    }}
                  >
                    <strong>{g.name}</strong>
                    <span>
                      {g.kind === "TRANSPORT" ? "Transport" : "Activity"} · {learnerCountForGroup(g.id)} learners
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div style={{ marginTop: 10 }}>
              <div className="hs-cg-field">
                <span>Type</span>
                <select value={draftKind} onChange={(e) => setDraftKind(e.target.value as GroupKind)}>
                  <option value="ACTIVITY">Activity</option>
                  <option value="TRANSPORT">Transport</option>
                </select>
              </div>
              <div className="hs-cg-field">
                <span>Group name</span>
                <input
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  placeholder="Enter group name"
                  aria-label="Enter group name"
                />
              </div>
              {draftKind === "TRANSPORT" && (
                <>
                  <div className="hs-cg-field">
                    <span>Driver</span>
                    <input
                      value={draftDriver}
                      onChange={(e) => setDraftDriver(e.target.value)}
                      placeholder="Responsible adult / driver"
                    />
                  </div>
                  <div className="hs-cg-field">
                    <span>Contact</span>
                    <input value={draftContact} onChange={(e) => setDraftContact(e.target.value)} />
                  </div>
                  <div className="hs-cg-field">
                    <span>Vehicle reg</span>
                    <input value={draftReg} onChange={(e) => setDraftReg(e.target.value)} />
                  </div>
                </>
              )}
              <button type="button" className="hs-cg-btn primary" onClick={createGroup}>
                {groups.length === 0 ? "Create your first group" : "Create group [DEMO]"}
              </button>
            </div>
          </div>

          {!editGroup && groups.length === 0 && (
            <div className="hs-cg-panel">
              <div className="hs-cg-empty">
                New schools start with no Transport or Activity groups. Use Create your first group — choose a type
                and enter your school’s own name. Named examples like Swimming or Bus A appear only in the populated
                demo fixture.
              </div>
            </div>
          )}

          {editGroup && (
            <div className="hs-cg-panel">
              <div className="hs-cg-detail-head">
                <div>
                  <h3>{editGroup.name}</h3>
                  <p>
                    {editGroup.kind === "TRANSPORT" ? "Transport" : "Activity"}
                    {editGroup.kind === "TRANSPORT"
                      ? ` · ${editGroup.driverName} · ${editGroup.vehicleReg}`
                      : ""}
                    {` · ${sessions.filter((s) => s.groupId === editGroup.id).length} sessions · ${learnerCountForGroup(editGroup.id)} learners`}
                  </p>
                </div>
                <button
                  type="button"
                  className="hs-cg-btn sm"
                  onClick={() => {
                    setDraftName(editGroup.name);
                    setDraftDriver(editGroup.driverName || "");
                    setDraftContact(editGroup.driverContact || "");
                    setDraftReg(editGroup.vehicleReg || "");
                    setModal({ type: "edit-group" });
                  }}
                >
                  Edit details
                </button>
              </div>

              <div className="hs-cg-subtabs">
                <button
                  type="button"
                  className={manageSub === "sessions" ? "is-active" : ""}
                  onClick={() => setManageSub("sessions")}
                >
                  Sessions
                </button>
                <button
                  type="button"
                  className={manageSub === "learners" ? "is-active" : ""}
                  onClick={() => setManageSub("learners")}
                >
                  Learners
                </button>
              </div>

              {manageSub === "sessions" && (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                    {(["ALL", "Mon", "Tue", "Wed", "Thu", "Fri"] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={`hs-cg-btn sm${sessionDayFilter === d ? " primary" : ""}`}
                        onClick={() => setSessionDayFilter(d)}
                      >
                        {d === "ALL" ? "All days" : d}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <button type="button" className="hs-cg-btn primary sm" onClick={() => openAddSession()}>
                      Add session
                    </button>
                    <span style={{ fontSize: 11, fontWeight: 700, color: "#666" }}>{SCHEDULE_TIME_HINT}</span>
                  </div>
                  {sessionDayFilter !== "ALL" && (
                    <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, color: "#666" }}>
                      Showing {sessionDayFilter} only ·{" "}
                      {sessions.filter((s) => s.groupId === editGroupId && s.weekday !== sessionDayFilter).length}{" "}
                      other day(s) hidden ·{" "}
                      <button
                        type="button"
                        className="hs-cg-btn sm"
                        style={{ minHeight: 28, padding: "2px 8px" }}
                        onClick={() => setSessionDayFilter("ALL")}
                      >
                        Show all days
                      </button>
                    </p>
                  )}

                  {editSessions.length === 0 && (
                    <div className="hs-cg-empty">
                      {sessionDayFilter === "ALL" ||
                      sessions.filter((s) => s.groupId === editGroupId).length === 0 ? (
                        <>
                          <div>First, add the days and times this group meets.</div>
                          <button
                            type="button"
                            className="hs-cg-btn primary"
                            style={{ marginTop: 10 }}
                            onClick={() => openAddSession()}
                          >
                            Add session
                          </button>
                        </>
                      ) : (
                        <>
                          No sessions for {sessionDayFilter}.{" "}
                          <button type="button" className="hs-cg-btn sm" onClick={() => setSessionDayFilter("ALL")}>
                            Show all days
                          </button>{" "}
                          or{" "}
                          <button type="button" className="hs-cg-btn primary sm" onClick={() => openAddSession()}>
                            Add {sessionDayFilter} session
                          </button>
                        </>
                      )}
                    </div>
                  )}
                  {editSessions.map((s) => {
                    const count = memberships.filter((m) => m.sessionId === s.id).length;
                    const warns = overlapForSession(s);
                    return (
                      <div key={s.id} className={`hs-cg-session-row${warns.length ? " is-overlap" : ""}`}>
                        <div>
                          <strong style={{ color: "#111" }}>
                            {s.weekday} {s.start}–{s.end}
                          </strong>
                          <div style={{ fontSize: 12, color: "#555", fontWeight: 650 }}>
                            {s.responsibleAdult}
                            {s.location ? ` · ${s.location}` : ""} · {count} learners
                          </div>
                          {warns.slice(0, 2).map((w) => (
                            <div key={w} className="hs-cg-inline-warn">
                              {w}
                            </div>
                          ))}
                        </div>
                        <div className="hs-cg-row-actions">
                          <button
                            type="button"
                            className="hs-cg-btn primary sm"
                            onClick={() => openManageSessionLearners(s.id)}
                          >
                            Manage learners
                          </button>
                          <div className="hs-cg-menu">
                            <button
                              type="button"
                              className="hs-cg-btn sm"
                              onClick={() =>
                                setOpenMenuSessionId((id) => (id === s.id ? null : s.id))
                              }
                            >
                              Actions
                            </button>
                            {openMenuSessionId === s.id && (
                              <div className="hs-cg-menu-pop">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDraftStart(s.start);
                                    setDraftEnd(s.end);
                                    setDraftScope("one");
                                    setModal({ type: "reschedule", sessionId: s.id });
                                    setOpenMenuSessionId(null);
                                  }}
                                >
                                  Reschedule…
                                </button>
                                <button type="button" onClick={() => cancelSession(s.id, "one")}>
                                  Cancel this occurrence ({demoDate})
                                </button>
                                <button type="button" onClick={() => cancelSession(s.id, "future")}>
                                  Cancel this & future
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {manageSub === "learners" && (
                <>
                  <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 650, color: "#555" }}>
                    Overview of unique learners in this group ({learnerCountForGroup(editGroup.id)}). Each shows their
                    assigned days/times. Edit a single slot via Sessions → Manage learners.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                    <input
                      style={{ flex: "1 1 140px" }}
                      placeholder="Search learners"
                      value={learnerSearch}
                      onChange={(e) => setLearnerSearch(e.target.value)}
                    />
                    <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                      <option value="">All classes</option>
                      {classOptionsFromLearners(learnersCatalog).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="hs-cg-btn primary sm" onClick={openAddLearners}>
                      Assign to sessions
                    </button>
                  </div>

                  {Array.from(membersByLearner.entries()).length === 0 && (
                    <div className="hs-cg-empty">No learners assigned yet. Add a session, then Manage learners on that row.</div>
                  )}
                  {Array.from(membersByLearner.entries())
                    .filter(([learnerId]) => {
                      const l = learnersCatalog.find((x) => x.id === learnerId);
                      if (!l) return false;
                      if (classFilter && l.className !== classFilter) return false;
                      const q = learnerSearch.trim().toLowerCase();
                      if (!q) return true;
                      return `${l.firstName} ${l.lastName}`.toLowerCase().includes(q);
                    })
                    .map(([learnerId, sessList]) => {
                      const l = learnersCatalog.find((x) => x.id === learnerId)!;
                      const learnerOverlaps = overlaps.filter((o) => o.startsWith(displayName(learnerId)));
                      const ordered = sessList
                        .slice()
                        .sort((a, b) => a.weekday.localeCompare(b.weekday) || a.start.localeCompare(b.start));
                      return (
                        <div key={learnerId} className="hs-cg-member-row">
                          <div>
                            <strong style={{ color: "#111" }}>
                              {l.firstName} {l.lastName}
                            </strong>
                            <div style={{ fontSize: 12, color: "#555", fontWeight: 650 }}>{l.className}</div>
                            <div className="hs-cg-slot-chips">
                              {ordered.map((s) => (
                                <span key={s.id} className="hs-cg-slot-chip">
                                  {s.weekday} {s.start}–{s.end}
                                  <button
                                    type="button"
                                    title={`Remove from ${s.weekday} ${s.start} only`}
                                    onClick={() => removeMembership(learnerId, s.id)}
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                            </div>
                            {learnerOverlaps.map((w) => (
                              <div key={w} className="hs-cg-inline-warn">
                                {w}
                              </div>
                            ))}
                          </div>
                          <div className="hs-cg-row-actions">
                            <button
                              type="button"
                              className="hs-cg-btn sm"
                              onClick={() => {
                                setExceptionSessionId(sessList[0]?.id || "");
                                setModal({
                                  type: "move-learner",
                                  learnerId,
                                  fromSessionId: sessList[0]?.id || "",
                                });
                              }}
                            >
                              Move
                            </button>
                            <button
                              type="button"
                              className="hs-cg-btn sm"
                              onClick={() => {
                                setExceptionSessionId(sessList[0]?.id || "");
                                setModal({ type: "today-exception", learnerId, mode: "skip" });
                              }}
                            >
                              Skip today
                            </button>
                            <button
                              type="button"
                              className="hs-cg-btn sm"
                              onClick={() => {
                                setExceptionSessionId(sessList[0]?.id || "");
                                setModal({ type: "today-exception", learnerId, mode: "add" });
                              }}
                            >
                              Add today
                            </button>
                            <button
                              type="button"
                              className="hs-cg-btn sm danger"
                              onClick={() => removeLearnerFromGroup(learnerId)}
                            >
                              Remove all
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </>
              )}
            </div>
          )}
        </div>
      )}

      <details className="hs-cg-diag">
        <summary>Diagnostics & demo log (collapsed)</summary>
        <div className="hs-cg-diag-body">
          <p>
            {HS_CG_PROTO_REVISION} · built {HS_CG_PROTO_BUILT_AT}
          </p>
          <p>
            Fixture: {fixtureMode} · types Transport|Activity only · school-owned names · never auto-seed real schools
          </p>
          <p>Window {SCHEDULE_EARLIEST}–{SCHEDULE_LATEST} · Early Departure unaffected</p>
          <p>Overlaps: {overlaps.length ? overlaps.join(" | ") : "none"}</p>
          {log.length === 0 && <p>No actions yet.</p>}
          {log.map((line) => (
            <p key={line.id}>
              {line.at} {line.text}
            </p>
          ))}
        </div>
      </details>

      {modal && (
        <div
          className="hs-cg-backdrop"
          role="presentation"
          onClick={() => {
            setModal(null);
            setModalFlash(null);
          }}
        >
          <div className="hs-cg-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            {modalFlash && (
              <div className={`hs-cg-flash ${modalFlash.kind}`} style={{ marginBottom: 10 }}>
                {modalFlash.text}
              </div>
            )}
            {modal.type === "add-session" && (
              <>
                <h3>Add session · {editGroup?.name}</h3>
                <p style={{ marginTop: 0, color: "#666", fontSize: 12, fontWeight: 650 }}>
                  New recurring slot for this group only. Existing sessions and memberships stay. {SCHEDULE_TIME_HINT}
                </p>
                {modal.returnTo === "add-learners" && selectedLearnerIds.size > 0 && (
                  <p style={{ marginTop: 0, fontSize: 12, fontWeight: 700, color: "#444" }}>
                    {selectedLearnerIds.size} learner(s) stay selected — you will choose which session(s) to enrol them on
                    when you return.
                  </p>
                )}
                <div className="hs-cg-field">
                  <span>Weekday</span>
                  <select value={draftWeekday} onChange={(e) => setDraftWeekday(e.target.value as Weekday)}>
                    {(["Mon", "Tue", "Wed", "Thu", "Fri"] as Weekday[]).map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={`hs-cg-field${fieldErrors.start ? " has-error" : ""}`}>
                  <span>Start (HH:mm)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="08:00"
                    value={draftStart}
                    onChange={(e) => {
                      setDraftStart(e.target.value);
                      setFieldErrors((f) => ({ ...f, start: undefined }));
                    }}
                    onBlur={() => {
                      const n = normaliseHhMmInput(draftStart);
                      if (n) setDraftStart(n);
                    }}
                  />
                  {fieldErrors.start && <p className="hs-cg-field-error">{fieldErrors.start}</p>}
                </div>
                <div className={`hs-cg-field${fieldErrors.end ? " has-error" : ""}`}>
                  <span>End (HH:mm)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="16:00"
                    value={draftEnd}
                    onChange={(e) => {
                      setDraftEnd(e.target.value);
                      setFieldErrors((f) => ({ ...f, end: undefined }));
                    }}
                    onBlur={() => {
                      const n = normaliseHhMmInput(draftEnd);
                      if (n) setDraftEnd(n);
                    }}
                  />
                  {fieldErrors.end && <p className="hs-cg-field-error">{fieldErrors.end}</p>}
                </div>
                {editGroup?.kind === "ACTIVITY" && (
                  <div className={`hs-cg-field${fieldErrors.adult ? " has-error" : ""}`}>
                    <span>Responsible adult</span>
                    <input
                      value={draftAdult}
                      onChange={(e) => {
                        setDraftAdult(e.target.value);
                        setFieldErrors((f) => ({ ...f, adult: undefined }));
                      }}
                    />
                    {fieldErrors.adult && <p className="hs-cg-field-error">{fieldErrors.adult}</p>}
                  </div>
                )}
                {editGroup?.kind === "TRANSPORT" && (
                  <p style={{ fontSize: 12, color: "#555", fontWeight: 650 }}>
                    Pickup adult defaults to driver {editGroup.driverName || "—"}.
                  </p>
                )}
                <div className="hs-cg-field">
                  <span>Location (optional)</span>
                  <input value={draftLocation} onChange={(e) => setDraftLocation(e.target.value)} />
                </div>
                {!modal.returnTo && (
                  <div className="hs-cg-field">
                    <span>Learners for this session (optional)</span>
                    <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 650, color: "#666" }}>
                      Selected learners enrol on this new slot only — not on other days/times in the group.
                    </p>
                    <div className="hs-cg-field" style={{ marginBottom: 6 }}>
                      <input
                        placeholder="Search learners"
                        value={learnerSearch}
                        onChange={(e) => setLearnerSearch(e.target.value)}
                      />
                    </div>
                    <div className="hs-cg-check-list">
                      {filteredPickerLearners.map((l) => (
                        <label key={l.id}>
                          <input
                            type="checkbox"
                            checked={selectedLearnerIds.has(l.id)}
                            onChange={() => {
                              setSelectedLearnerIds((prev) => {
                                const n = new Set(prev);
                                if (n.has(l.id)) n.delete(l.id);
                                else n.add(l.id);
                                return n;
                              });
                            }}
                          />
                          {l.firstName} {l.lastName} · {l.className}
                        </label>
                      ))}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 11, fontWeight: 700, color: "#555" }}>
                      {selectedLearnerIds.size} selected for this slot
                    </p>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="hs-cg-btn"
                    onClick={() => {
                      setModalFlash(null);
                      setFieldErrors({});
                      if (modal.returnTo === "add-learners") setModal({ type: "add-learners" });
                      else setModal(null);
                    }}
                  >
                    {modal.returnTo === "add-learners" ? "Back" : "Cancel"}
                  </button>
                  <button type="button" className="hs-cg-btn primary" onClick={saveNewSession}>
                    Save session
                  </button>
                </div>
              </>
            )}

            {modal.type === "reschedule" && (
              <>
                <h3>Reschedule session</h3>
                <p style={{ marginTop: 0, color: "#666", fontSize: 12, fontWeight: 650 }}>{SCHEDULE_TIME_HINT}</p>
                <div className="hs-cg-field">
                  <span>Scope</span>
                  <select value={draftScope} onChange={(e) => setDraftScope(e.target.value as "one" | "future")}>
                    <option value="one">This occurrence only ({demoDate})</option>
                    <option value="future">This and future recurring times</option>
                  </select>
                </div>
                <div className="hs-cg-field">
                  <span>Start (HH:mm)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draftStart}
                    onChange={(e) => setDraftStart(e.target.value)}
                    onBlur={() => {
                      const n = normaliseHhMmInput(draftStart);
                      if (n) setDraftStart(n);
                    }}
                  />
                </div>
                <div className="hs-cg-field">
                  <span>End (HH:mm)</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draftEnd}
                    onChange={(e) => setDraftEnd(e.target.value)}
                    onBlur={() => {
                      const n = normaliseHhMmInput(draftEnd);
                      if (n) setDraftEnd(n);
                    }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="hs-cg-btn" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button type="button" className="hs-cg-btn primary" onClick={saveReschedule}>
                    Apply [DEMO]
                  </button>
                </div>
              </>
            )}

            {modal.type === "edit-group" && editGroup && (
              <>
                <h3>Edit group details</h3>
                <div className="hs-cg-field">
                  <span>Group name</span>
                  <input
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder="Enter group name"
                  />
                </div>
                {editGroup.kind === "TRANSPORT" && (
                  <>
                    <div className="hs-cg-field">
                      <span>Driver</span>
                      <input value={draftDriver} onChange={(e) => setDraftDriver(e.target.value)} />
                    </div>
                    <div className="hs-cg-field">
                      <span>Contact</span>
                      <input value={draftContact} onChange={(e) => setDraftContact(e.target.value)} />
                    </div>
                    <div className="hs-cg-field">
                      <span>Vehicle reg</span>
                      <input value={draftReg} onChange={(e) => setDraftReg(e.target.value)} />
                    </div>
                  </>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="hs-cg-btn" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button type="button" className="hs-cg-btn primary" onClick={saveGroupDetails}>
                    Save [DEMO]
                  </button>
                </div>
              </>
            )}

            {modal.type === "manage-session-learners" && (() => {
              const session = sessions.find((s) => s.id === modal.sessionId);
              if (!session) return null;
              return (
                <>
                  <h3>
                    Manage learners · {session.weekday} {session.start}–{session.end}
                  </h3>
                  <p style={{ margin: "0 0 8px", fontSize: 12, color: "#555", fontWeight: 650 }}>
                    {editGroup?.name} — changes apply to this time slot only. Other sessions keep their own rosters.
                  </p>
                  <div className="hs-cg-field">
                    <span>Search</span>
                    <input value={learnerSearch} onChange={(e) => setLearnerSearch(e.target.value)} />
                  </div>
                  <div className="hs-cg-field">
                    <span>Class</span>
                    <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                      <option value="">All classes</option>
                      {classOptionsFromLearners(learnersCatalog).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="hs-cg-field">
                    <span>Learners on this session</span>
                    <div className="hs-cg-check-list">
                      {filteredPickerLearners.map((l) => (
                        <label key={l.id}>
                          <input
                            type="checkbox"
                            checked={selectedLearnerIds.has(l.id)}
                            onChange={() => {
                              setSelectedLearnerIds((prev) => {
                                const n = new Set(prev);
                                if (n.has(l.id)) n.delete(l.id);
                                else n.add(l.id);
                                return n;
                              });
                            }}
                          />
                          {l.firstName} {l.lastName} · {l.className}
                        </label>
                      ))}
                    </div>
                    <p style={{ margin: "6px 0 0", fontSize: 11, fontWeight: 700, color: "#555" }}>
                      {selectedLearnerIds.size} on this session
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="hs-cg-btn"
                      onClick={() => {
                        setModal(null);
                        setModalFlash(null);
                        setFieldErrors({});
                      }}
                    >
                      Cancel
                    </button>
                    <button type="button" className="hs-cg-btn primary" onClick={saveManageSessionLearners}>
                      Save learners
                    </button>
                  </div>
                </>
              );
            })()}

            {modal.type === "add-learners" && (
              <>
                <h3>Assign learners · {editGroup?.name}</h3>
                <p style={{ margin: "0 0 8px", fontSize: 12, color: "#555", fontWeight: 650 }}>
                  Reuse one learner selection across the sessions you tick. Unticked sessions are not changed. Selected{" "}
                  {selectedLearnerIds.size} learners · {selectedSessionIds.size} sessions
                </p>
                <div className="hs-cg-field">
                  <span>Search</span>
                  <input value={learnerSearch} onChange={(e) => setLearnerSearch(e.target.value)} />
                </div>
                <div className="hs-cg-field">
                  <span>Class</span>
                  <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
                    <option value="">All classes</option>
                    {classOptionsFromLearners(learnersCatalog).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className={`hs-cg-field${fieldErrors.learners ? " has-error" : ""}`}>
                  <span>1. Select learners</span>
                  <div className="hs-cg-check-list">
                    {filteredPickerLearners.map((l) => (
                      <label key={l.id}>
                        <input
                          type="checkbox"
                          checked={selectedLearnerIds.has(l.id)}
                          onChange={() => {
                            setModalFlash(null);
                            setFieldErrors((f) => ({ ...f, learners: undefined }));
                            setSelectedLearnerIds((prev) => {
                              const n = new Set(prev);
                              if (n.has(l.id)) n.delete(l.id);
                              else n.add(l.id);
                              return n;
                            });
                          }}
                        />
                        {l.firstName} {l.lastName} · {l.className}
                      </label>
                    ))}
                  </div>
                  {fieldErrors.learners && <p className="hs-cg-field-error">{fieldErrors.learners}</p>}
                </div>
                <div className={`hs-cg-field${fieldErrors.sessions ? " has-error" : ""}`}>
                  <span>2. Choose which session(s) to enrol them on</span>
                  {groupSessionsForAssign.length === 0 ? (
                    <div className="hs-cg-empty" style={{ textAlign: "left", padding: 12 }}>
                      <div style={{ marginBottom: 8, fontWeight: 750, color: "#333" }}>
                        Add a day and time for this group before assigning learners.
                      </div>
                      <button
                        type="button"
                        className="hs-cg-btn primary"
                        onClick={() => openAddSession("add-learners")}
                      >
                        Add session
                      </button>
                    </div>
                  ) : (
                    <>
                      <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 700, color: "#555" }}>
                        Tick only the slots that should receive these learners. Same weekday, different times are
                        allowed. Unticked slots keep their current roster.
                      </p>
                      <div className="hs-cg-check-list">
                        {groupSessionsForAssign.map((s) => {
                          const n = memberships.filter((m) => m.sessionId === s.id).length;
                          return (
                            <label key={s.id}>
                              <input
                                type="checkbox"
                                checked={selectedSessionIds.has(s.id)}
                                onChange={() => {
                                  setModalFlash(null);
                                  setFieldErrors((f) => ({ ...f, sessions: undefined }));
                                  setSelectedSessionIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(s.id)) next.delete(s.id);
                                    else next.add(s.id);
                                    return next;
                                  });
                                }}
                              />
                              {s.weekday} {s.start}–{s.end} · {s.responsibleAdult} · {n} learners
                            </label>
                          );
                        })}
                      </div>
                    </>
                  )}
                  {fieldErrors.sessions && <p className="hs-cg-field-error">{fieldErrors.sessions}</p>}
                  {groupSessionsForAssign.length > 0 && (
                    <button
                      type="button"
                      className="hs-cg-btn sm"
                      style={{ marginTop: 8 }}
                      onClick={() => openAddSession("add-learners")}
                    >
                      Add another session
                    </button>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="hs-cg-btn"
                    onClick={() => {
                      setModal(null);
                      setModalFlash(null);
                      setFieldErrors({});
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="hs-cg-btn primary"
                    disabled={!canConfirmAssign}
                    onClick={assignSelected}
                    title={
                      canConfirmAssign
                        ? "Confirm assignment"
                        : "Select at least one learner and one session"
                    }
                  >
                    Confirm assign
                  </button>
                </div>
              </>
            )}

            {modal.type === "handover" && activeGroup && (
              <>
                <h3>{activeGroup.kind === "TRANSPORT" ? "Confirm handover" : "Hand to adult"}</h3>
                <p style={{ marginTop: 0, fontSize: 12, color: "#555" }}>
                  {displayName(modal.learnerId)}
                </p>
                <div className="hs-cg-field">
                  <span>{activeGroup.kind === "TRANSPORT" ? "Collector" : "Adult"}</span>
                  <input value={handoverName} onChange={(e) => setHandoverName(e.target.value)} />
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="hs-cg-btn" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button type="button" className="hs-cg-btn primary" onClick={confirmHandover}>
                    Confirm [DEMO]
                  </button>
                </div>
              </>
            )}

            {modal.type === "today-exception" && (
              <>
                <h3>{modal.mode === "skip" ? "Skip today" : "Add for today"}</h3>
                <p style={{ marginTop: 0, fontSize: 12, color: "#555" }}>
                  {displayName(modal.learnerId)} · {demoDate} · recurring membership unchanged
                </p>
                {modal.mode === "add" && (
                  <div className="hs-cg-field">
                    <span>Session</span>
                    <select value={exceptionSessionId} onChange={(e) => setExceptionSessionId(e.target.value)}>
                      <option value="">Select…</option>
                      {sessions
                        .filter((s) => s.groupId === editGroupId && s.weekday === weekday)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.start}–{s.end} · {s.responsibleAdult}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="hs-cg-btn" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button type="button" className="hs-cg-btn primary" onClick={applyTodayException}>
                    Apply [DEMO]
                  </button>
                </div>
              </>
            )}

            {modal.type === "move-learner" && (
              <>
                <h3>Move learner</h3>
                <p style={{ marginTop: 0, fontSize: 12, color: "#555" }}>
                  {displayName(modal.learnerId)}
                </p>
                <div className="hs-cg-field">
                  <span>Target session in this group</span>
                  <select value={exceptionSessionId} onChange={(e) => setExceptionSessionId(e.target.value)}>
                    {sessions
                      .filter((s) => s.groupId === editGroupId)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.weekday} {s.start}–{s.end}
                        </option>
                      ))}
                  </select>
                </div>
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button type="button" className="hs-cg-btn" onClick={() => setModal(null)}>
                    Cancel
                  </button>
                  <button type="button" className="hs-cg-btn primary" onClick={moveLearner}>
                    Move [DEMO]
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
