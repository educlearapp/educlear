/**
 * Deterministic EduClock correction resolution for payroll.
 * Owner-created corrections are treated as immediately approved.
 * Does not mutate EduClockEvent rows.
 */
import type { EduClockEvent, EduClockEventType } from "@prisma/client";

export type CorrectionMetaSnapshot = {
  originalEventId: string | null;
  effectiveEventId: string;
  action: string | null;
  reason: string | null;
  createdByUserId: string;
  createdAt: string;
  approvalPolicy: "OWNER_IMMEDIATE_APPROVAL";
  approvedByUserId: string;
  approvedAt: string;
  chainEventIds: string[];
};

export type EffectiveClockEvent = {
  /** Payable event (terminal correction or original). */
  effective: EduClockEvent;
  /** Proven correction metadata, or null when uncorrected. */
  correctionMeta: CorrectionMetaSnapshot | null;
  /** Root / original event id when corrected. */
  rootEventId: string;
};

export type CorrectionResolutionIssue = {
  code:
    | "CORRECTION_CYCLE"
    | "CORRECTION_CROSS_EMPLOYEE"
    | "CORRECTION_CROSS_SCHOOL"
    | "CORRECTION_INCOMPATIBLE_TYPE"
    | "CORRECTION_AMBIGUOUS_TERMINAL"
    | "CORRECTION_MISSING_ANCESTOR"
    | "CORRECTION_ACTOR_UNPROVEN";
  eventId: string;
  detail: string;
};

export type CorrectionResolutionResult = {
  effectiveByEmployee: Map<string, EffectiveClockEvent[]>;
  /** Event ids excluded from pairing (superseded originals + blocked chains). */
  excludedEventIds: Set<string>;
  issues: CorrectionResolutionIssue[];
};

function metaString(meta: unknown, key: string): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const v = (meta as Record<string, unknown>)[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function parseReasonFromNote(note: string | null | undefined): string | null {
  const n = String(note || "").trim();
  if (!n) return null;
  const parts = n.split(" — ");
  return parts[0]?.trim() || n;
}

/**
 * Resolve which EduClock events are effective for payroll pairing.
 * Ambiguous or unsafe chains are blocked (not paid).
 */
export function resolveEffectiveClockEvents(
  events: EduClockEvent[],
  schoolId: string
): CorrectionResolutionResult {
  const byId = new Map(events.map((e) => [e.id, e]));
  const issues: CorrectionResolutionIssue[] = [];
  const excludedEventIds = new Set<string>();
  const blockedRoots = new Set<string>();

  // Index corrections that point at a given original.
  const childrenByParent = new Map<string, EduClockEvent[]>();
  for (const e of events) {
    if (e.correctedFromEventId) {
      const list = childrenByParent.get(e.correctedFromEventId) || [];
      list.push(e);
      childrenByParent.set(e.correctedFromEventId, list);
    }
  }

  function walkToRoot(start: EduClockEvent): {
    root: EduClockEvent | null;
    chain: EduClockEvent[];
    issue?: CorrectionResolutionIssue;
  } {
    const chain: EduClockEvent[] = [start];
    const seen = new Set<string>([start.id]);
    let cur = start;
    while (cur.correctedFromEventId) {
      if (seen.has(cur.correctedFromEventId)) {
        return {
          root: null,
          chain,
          issue: {
            code: "CORRECTION_CYCLE",
            eventId: start.id,
            detail: `Circular correctedFromEventId involving ${cur.id}`,
          },
        };
      }
      const parent = byId.get(cur.correctedFromEventId);
      if (!parent) {
        return {
          root: null,
          chain,
          issue: {
            code: "CORRECTION_MISSING_ANCESTOR",
            eventId: start.id,
            detail: `Missing ancestor ${cur.correctedFromEventId}`,
          },
        };
      }
      if (parent.schoolId !== schoolId || parent.schoolId !== start.schoolId) {
        return {
          root: null,
          chain,
          issue: {
            code: "CORRECTION_CROSS_SCHOOL",
            eventId: start.id,
            detail: `Correction chain crosses school boundary at ${parent.id}`,
          },
        };
      }
      if (parent.employeeId !== start.employeeId) {
        return {
          root: null,
          chain,
          issue: {
            code: "CORRECTION_CROSS_EMPLOYEE",
            eventId: start.id,
            detail: `Correction chain crosses employee at ${parent.id}`,
          },
        };
      }
      if (parent.eventType !== start.eventType && start.isManualCorrection) {
        // CORRECT_TIME must preserve type; ADD_* may reference a different pair member — only flag when both claim same role chain with type mismatch on CORRECT_TIME.
        const action = metaString(start.metadata, "action");
        if (action === "CORRECT_TIME" && parent.eventType !== start.eventType) {
          return {
            root: null,
            chain,
            issue: {
              code: "CORRECTION_INCOMPATIBLE_TYPE",
              eventId: start.id,
              detail: `CORRECT_TIME type mismatch ${parent.eventType} → ${start.eventType}`,
            },
          };
        }
      }
      chain.push(parent);
      seen.add(parent.id);
      cur = parent;
    }
    return { root: cur, chain };
  }

  // Find terminal corrections per root (events that are corrections and have no child correction of same type that continues the chain).
  const terminalsByRoot = new Map<string, EduClockEvent[]>();
  const rawEvents = events.filter((e) => e.schoolId === schoolId);

  for (const e of rawEvents) {
    if (e.schoolId !== schoolId) {
      issues.push({
        code: "CORRECTION_CROSS_SCHOOL",
        eventId: e.id,
        detail: "Event schoolId does not match import school",
      });
      excludedEventIds.add(e.id);
      continue;
    }

    if (!e.isManualCorrection && !e.correctedFromEventId) {
      continue; // plain originals handled later
    }

    if (e.isManualCorrection && !String(e.createdByUserId || "").trim()) {
      issues.push({
        code: "CORRECTION_ACTOR_UNPROVEN",
        eventId: e.id,
        detail: "Correction missing createdByUserId",
      });
      excludedEventIds.add(e.id);
      continue;
    }

    const walked = walkToRoot(e);
    if (walked.issue) {
      issues.push(walked.issue);
      for (const c of walked.chain) excludedEventIds.add(c.id);
      if (walked.chain.length) blockedRoots.add(walked.chain[walked.chain.length - 1]!.id);
      continue;
    }
    const root = walked.root!;
    // A terminal is a correction that is not itself correctedFrom by another loaded event
    // OR is a leaf in childrenByParent.
    const children = childrenByParent.get(e.id) || [];
    const continuing = children.filter((c) => c.schoolId === schoolId);
    if (continuing.length === 0 && e.isManualCorrection) {
      const list = terminalsByRoot.get(root.id) || [];
      list.push(e);
      terminalsByRoot.set(root.id, list);
    } else if (!e.isManualCorrection && e.correctedFromEventId) {
      // Non-manual with correctedFrom is unexpected — exclude
      excludedEventIds.add(e.id);
    }
  }

  for (const [rootId, terminals] of terminalsByRoot) {
    // Prefer latest createdAt then id for determinism check — but multiple terminals = ambiguous
    if (terminals.length > 1) {
      // Same id shouldn't happen; distinct terminals for one root = ambiguous
      const unique = [...new Map(terminals.map((t) => [t.id, t])).values()];
      if (unique.length > 1) {
        issues.push({
          code: "CORRECTION_AMBIGUOUS_TERMINAL",
          eventId: rootId,
          detail: `Multiple terminal corrections for root ${rootId}: ${unique.map((t) => t.id).join(",")}`,
        });
        blockedRoots.add(rootId);
        excludedEventIds.add(rootId);
        for (const t of unique) excludedEventIds.add(t.id);
        // Exclude entire chain members pointing at this root
        for (const e of rawEvents) {
          const w = walkToRoot(e);
          if (w.root?.id === rootId) {
            for (const c of w.chain) excludedEventIds.add(c.id);
          }
        }
      }
    }
  }

  const effectiveByEmployee = new Map<string, EffectiveClockEvent[]>();

  function addEffective(item: EffectiveClockEvent) {
    const list = effectiveByEmployee.get(item.effective.employeeId) || [];
    list.push(item);
    effectiveByEmployee.set(item.effective.employeeId, list);
  }

  const consumedRoots = new Set<string>();

  for (const [rootId, terminals] of terminalsByRoot) {
    if (blockedRoots.has(rootId)) continue;
    const unique = [...new Map(terminals.map((t) => [t.id, t])).values()];
    if (unique.length !== 1) continue;
    const terminal = unique[0]!;
    if (excludedEventIds.has(terminal.id)) continue;

    const walked = walkToRoot(terminal);
    if (walked.issue || !walked.root) continue;

    const chainIds = [...walked.chain].reverse().map((e) => e.id); // root → terminal
    // Exclude all non-terminal members of the chain from pairing
    for (const c of walked.chain) {
      if (c.id !== terminal.id) excludedEventIds.add(c.id);
    }
    consumedRoots.add(rootId);

    const action = metaString(terminal.metadata, "action");
    const reason =
      metaString(terminal.metadata, "reason") || parseReasonFromNote(terminal.note);

    addEffective({
      effective: terminal,
      rootEventId: rootId,
      correctionMeta: {
        originalEventId: rootId === terminal.id ? null : rootId,
        effectiveEventId: terminal.id,
        action,
        reason,
        createdByUserId: terminal.createdByUserId,
        createdAt: terminal.createdAt.toISOString(),
        approvalPolicy: "OWNER_IMMEDIATE_APPROVAL",
        approvedByUserId: terminal.createdByUserId,
        approvedAt: terminal.createdAt.toISOString(),
        chainEventIds: chainIds,
      },
    });
  }

  // Uncorrected originals not superseded
  for (const e of rawEvents) {
    if (excludedEventIds.has(e.id)) continue;
    if (e.isManualCorrection) continue;
    if (e.correctedFromEventId) continue;
    if (consumedRoots.has(e.id)) continue;
    if (childrenByParent.has(e.id)) {
      // Has corrections — if they were blocked, root already excluded; if terminal consumed, skip
      if (terminalsByRoot.has(e.id) && !blockedRoots.has(e.id)) {
        continue; // replaced by terminal
      }
      if (blockedRoots.has(e.id)) {
        excludedEventIds.add(e.id);
        continue;
      }
    }
    addEffective({
      effective: e,
      rootEventId: e.id,
      correctionMeta: null,
    });
  }

  // Sort each employee list deterministically
  for (const [empId, list] of effectiveByEmployee) {
    list.sort((a, b) => {
      const t = a.effective.occurredAtUtc.getTime() - b.effective.occurredAtUtc.getTime();
      if (t !== 0) return t;
      return a.effective.id.localeCompare(b.effective.id);
    });
    effectiveByEmployee.set(empId, list);
  }

  return { effectiveByEmployee, excludedEventIds, issues };
}

export type { EduClockEventType };
