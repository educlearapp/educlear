/**
 * HomeSafe Collections V2 — focused unit tests (no DB, no production).
 * Run: npx tsc -p tsconfig.json --pretty false && node dist/services/homesafeCollections.unit.test.js
 * (or: npx tsx src/services/homesafeCollections.unit.test.ts)
 */
import {
  HsCgDomainError,
  validateCollectionScheduleTimes,
  weekdayForIsoDate,
} from "./homesafeCollectionsDomain";
import {
  HomeSafeCollectionsService,
  createEmptyCollectionsStore,
} from "./homesafeCollectionsService";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertThrows(fn: () => void, code: string, message: string) {
  try {
    fn();
    throw new Error(`${message}: expected throw`);
  } catch (e) {
    if (e instanceof HsCgDomainError) {
      assert(e.code === code, `${message}: expected ${code} got ${e.code}`);
      return;
    }
    throw e;
  }
}

function main() {
  // --- Schedule / weekday rules ---
  assert(validateCollectionScheduleTimes("10:00", "10:30").ok === true, "valid window");
  assert(validateCollectionScheduleTimes("07:59", "08:30").ok === false, "before 08:00 rejected");
  assert(validateCollectionScheduleTimes("15:00", "16:01").ok === false, "after 16:00 rejected");
  assert(validateCollectionScheduleTimes("10:30", "10:00").ok === false, "end before start rejected");
  assert(weekdayForIsoDate("2026-11-03") === "Tue", "Tue ISO");
  assert(weekdayForIsoDate("2026-11-05") === "Thu", "Thu ISO");
  assert(weekdayForIsoDate("2026-11-07") === null, "weekend null");

  const schoolA = "school-a";
  const schoolB = "school-b";
  const svc = new HomeSafeCollectionsService(createEmptyCollectionsStore());

  // --- Create group + multiple sessions (same weekday allowed) ---
  const group = svc.createGroup({ schoolId: schoolA, name: "Dance Mouse", kind: "ACTIVITY" });
  const mon = svc.createSession({
    schoolId: schoolA,
    groupId: group.id,
    weekday: "Mon",
    startTime: "09:00",
    endTime: "09:30",
    responsibleAdult: "Coach Maya",
    learnerIds: ["emma", "liam", "thabo", "aisha"],
  });
  const tue = svc.createSession({
    schoolId: schoolA,
    groupId: group.id,
    weekday: "Tue",
    startTime: "10:00",
    endTime: "10:30",
    responsibleAdult: "Coach Maya",
    learnerIds: ["noah", "maya", "leo"],
  });
  const thuAm = svc.createSession({
    schoolId: schoolA,
    groupId: group.id,
    weekday: "Thu",
    startTime: "11:00",
    endTime: "11:30",
    responsibleAdult: "Coach Maya",
    learnerIds: ["noah", "maya", "leo"],
  });
  const thuPm = svc.createSession({
    schoolId: schoolA,
    groupId: group.id,
    weekday: "Thu",
    startTime: "14:00",
    endTime: "14:30",
    responsibleAdult: "Coach Maya",
    learnerIds: ["zara", "kai"],
  });

  const sessions = svc.listSessionsForGroup(schoolA, group.id);
  assert(sessions.length === 4, "four sessions coexist in same group");
  assert(sessions.filter((s) => s.weekday === "Thu").length === 2, "two Thursday slots");
  assert(sessions.find((s) => s.id === mon.session.id)?.learnerCount === 4, "Mon count 4");
  assert(sessions.find((s) => s.id === tue.session.id)?.learnerCount === 3, "Tue count 3");
  assert(sessions.find((s) => s.id === thuPm.session.id)?.learnerCount === 2, "Thu PM count 2");

  // --- Add Monday learner to Thursday AM only ---
  svc.assignLearnersToSessions({
    schoolId: schoolA,
    learnerIds: ["emma"],
    sessionIds: [thuAm.session.id],
  });
  assert(
    svc.getSessionLearnerIds(schoolA, thuAm.session.id).sort().join() === "emma,leo,maya,noah",
    "Thu AM has Tue learners + emma"
  );
  assert(
    svc.getSessionLearnerIds(schoolA, mon.session.id).sort().join() === "aisha,emma,liam,thabo",
    "Mon roster unchanged after assign to Thu"
  );

  // --- Mixed frequency: Emma+Liam on Tue+Thu; add Noah to existing Tue only ---
  const mixed = svc.createGroup({ schoolId: schoolA, name: "Mixed Frequency", kind: "ACTIVITY" });
  const mTue = svc.createSession({
    schoolId: schoolA,
    groupId: mixed.id,
    weekday: "Tue",
    startTime: "10:00",
    endTime: "10:30",
    responsibleAdult: "Coach Maya",
    learnerIds: ["emma", "liam"],
  });
  const mThu = svc.createSession({
    schoolId: schoolA,
    groupId: mixed.id,
    weekday: "Thu",
    startTime: "10:00",
    endTime: "10:30",
    responsibleAdult: "Coach Maya",
    learnerIds: ["emma", "liam"],
  });
  // Existing Tuesday only — no new Tuesday session
  svc.setSessionLearners({
    schoolId: schoolA,
    sessionId: mTue.session.id,
    learnerIds: ["emma", "liam", "noah"],
  });
  assert(svc.listSessionsForGroup(schoolA, mixed.id).length === 2, "still two sessions");
  assert(
    svc.getSessionLearnerIds(schoolA, mTue.session.id).sort().join() === "emma,liam,noah",
    "Tue has emma liam noah"
  );
  assert(
    svc.getSessionLearnerIds(schoolA, mThu.session.id).sort().join() === "emma,liam",
    "Thu unchanged emma liam"
  );

  // --- Registers + day switching ---
  const tueReg = svc.getRegistersForDate(schoolA, "2026-11-03");
  assert(tueReg.weekday === "Tue", "Tue weekday");
  const tueMixed = tueReg.rows.filter((r) => r.sessionId === mTue.session.id).map((r) => r.learnerId).sort();
  assert(tueMixed.join() === "emma,liam,noah", "Tue register three learners");

  const thuReg = svc.getRegistersForDate(schoolA, "2026-11-05");
  const thuMixed = thuReg.rows.filter((r) => r.sessionId === mThu.session.id).map((r) => r.learnerId).sort();
  assert(thuMixed.join() === "emma,liam", "Thu register two learners");

  // Switch back to Tue — memberships preserved (not re-seeded empty)
  const tueAgain = svc.getRegistersForDate(schoolA, "2026-11-03");
  assert(
    tueAgain.rows
      .filter((r) => r.sessionId === mTue.session.id)
      .map((r) => r.learnerId)
      .sort()
      .join() === "emma,liam,noah",
    "day switch preserves memberships"
  );

  // --- Safe removal from one session ---
  svc.removeLearnerFromSession({
    schoolId: schoolA,
    sessionId: mTue.session.id,
    learnerId: "noah",
  });
  assert(
    svc.getSessionLearnerIds(schoolA, mTue.session.id).sort().join() === "emma,liam",
    "Noah removed from Tue"
  );
  assert(
    svc.getSessionLearnerIds(schoolA, mThu.session.id).sort().join() === "emma,liam",
    "Thu still emma+liam after Tue remove"
  );

  // --- Tenant isolation ---
  assertThrows(
    () => svc.getGroup(schoolB, group.id),
    "SCHOOL_MISMATCH",
    "cross-tenant group access"
  );
  assertThrows(
    () =>
      svc.createSession({
        schoolId: schoolB,
        groupId: group.id,
        weekday: "Wed",
        startTime: "10:00",
        endTime: "10:30",
        responsibleAdult: "X",
      }),
    "SCHOOL_MISMATCH",
    "cross-tenant session create"
  );
  assertThrows(
    () =>
      svc.setSessionLearners({
        schoolId: schoolB,
        sessionId: mTue.session.id,
        learnerIds: ["hacker"],
      }),
    "SCHOOL_MISMATCH",
    "cross-tenant roster write"
  );

  // --- Existing Lists Groups compatibility: Collections store does not reference GroupLearner ---
  const snap = svc.snapshot();
  assert(
    !("groupLearner" in (snap as object)),
    "collections store has no GroupLearner coupling"
  );
  assert(snap.groups.every((g) => g.schoolId === schoolA), "only school A groups in this svc");

  // --- Reject invalid schedule on create ---
  assertThrows(
    () =>
      svc.createSession({
        schoolId: schoolA,
        groupId: group.id,
        weekday: "Mon",
        startTime: "07:00",
        endTime: "07:30",
        responsibleAdult: "Coach",
      }),
    "VALIDATION",
    "out of window rejected"
  );

  console.log("homesafeCollections.unit.test.ts: OK");
}

main();
