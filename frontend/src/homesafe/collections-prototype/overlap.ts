import type { DemoSession, SessionMembership } from "./types";
import { DEMO_LEARNERS, learnerDisplayName } from "./demoData";

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function sessionsOverlap(a: DemoSession, b: DemoSession): boolean {
  if (a.weekday !== b.weekday) return false;
  if (a.id === b.id) return false;
  const a0 = toMinutes(a.start);
  const a1 = toMinutes(a.end);
  const b0 = toMinutes(b.start);
  const b1 = toMinutes(b.end);
  return a0 < b1 && b0 < a1;
}

/** Returns human-readable overlap warnings for current memberships. */
export function findOverlapWarnings(
  memberships: SessionMembership[],
  sessions: DemoSession[]
): string[] {
  const byLearner = new Map<string, string[]>();
  for (const m of memberships) {
    const list = byLearner.get(m.learnerId) || [];
    list.push(m.sessionId);
    byLearner.set(m.learnerId, list);
  }

  const warnings: string[] = [];
  for (const [learnerId, sessionIds] of byLearner) {
    const learnerSessions = sessionIds
      .map((id) => sessions.find((s) => s.id === id))
      .filter(Boolean) as DemoSession[];
    for (let i = 0; i < learnerSessions.length; i++) {
      for (let j = i + 1; j < learnerSessions.length; j++) {
        if (sessionsOverlap(learnerSessions[i], learnerSessions[j])) {
          const name = learnerDisplayName(learnerId);
          const a = learnerSessions[i];
          const b = learnerSessions[j];
          warnings.push(
            `${name}: ${a.weekday} ${a.start}–${a.end} overlaps ${b.weekday} ${b.start}–${b.end}`
          );
        }
      }
    }
  }

  // Prefer stable order by learner name
  return warnings.sort((x, y) => x.localeCompare(y));
}

export function classOptionsFromLearners(learners = DEMO_LEARNERS): string[] {
  return Array.from(new Set(learners.map((l) => l.className))).sort();
}
