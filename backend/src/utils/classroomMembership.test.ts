/**
 * Classroom membership rule unit tests (no DB).
 * Run: npx ts-node --transpile-only src/utils/classroomMembership.test.ts
 */
import {
  assignLearnersToClassrooms,
  classroomMembershipKey,
  cleanClassroomLabel,
  createClassroomResolver,
  learnerBelongsToClassroom,
} from "./classroomMembership";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ok - ${name}`);
}

test("approved normalization rules: case, outer/inner whitespace", () => {
  for (const v of ["Grade RA", "Grade Ra", "GRADE RA", "grade ra", "Grade R A", " Grade RA ", "Grade\tRA"]) {
    assert(learnerBelongsToClassroom(v, "Grade RA"), `${JSON.stringify(v)} should match Grade RA`);
  }
});

test("different sections and grades never match", () => {
  assert(!learnerBelongsToClassroom("Grade RB", "Grade RA"), "RB must not match RA");
  assert(!learnerBelongsToClassroom("Grade 1A", "Grade RA"), "1A must not match RA");
  assert(!learnerBelongsToClassroom("Grade R", "Grade RA"), "grade-only label must not match RA");
  assert(!learnerBelongsToClassroom("RA", "Grade RA"), "bare RA is not auto-mapped");
});

test("empty / null class names never match", () => {
  assert(!learnerBelongsToClassroom(null, ""), "null vs empty");
  assert(!learnerBelongsToClassroom("", ""), "empty vs empty");
  assert(classroomMembershipKey(undefined) === "", "undefined key");
});

test("non-Grade-R classrooms behave the same", () => {
  assert(learnerBelongsToClassroom("grade 1a", "Grade 1A"), "1a");
  assert(learnerBelongsToClassroom("Creche", "creche"), "creche");
  assert(!learnerBelongsToClassroom("Grade 1A", "Grade 1B"), "1A vs 1B");
});

test("cleanClassroomLabel trims and collapses whitespace", () => {
  assert(cleanClassroomLabel("  Grade   RA ") === "Grade RA", "collapse");
  assert(cleanClassroomLabel(null) === "", "null");
});

test("assignLearnersToClassrooms: each learner on exactly one roster", () => {
  const t0 = new Date("2026-01-01");
  const t1 = new Date("2026-02-01");
  const classrooms = [
    { id: "ra", name: "Grade RA", createdAt: t0 },
    { id: "rb", name: "Grade RB", createdAt: t0 },
    { id: "ra-dup", name: "Grade Ra", createdAt: t1 },
    { id: "g1", name: "Grade 1A", createdAt: t0 },
  ];
  const learners = [
    { id: "a", className: "Grade RA" },
    { id: "b", className: "Grade Ra" },
    { id: "c", className: " GRADE R A " },
    { id: "d", className: "Grade RB" },
    { id: "e", className: "Grade 1A" },
    { id: "f", className: "Grade 9Z" },
    { id: "g", className: "grade 9z" },
    { id: "h", className: null },
  ];
  const { byClassroomId, unregistered } = assignLearnersToClassrooms(classrooms, learners);
  const ids = (id: string) => (byClassroomId.get(id) || []).map((l) => l.id).sort().join(",");
  assert(ids("ra") === "a,c", `exact + variant to oldest RA, got ${ids("ra")}`);
  assert(ids("ra-dup") === "b", `exact spelling wins for duplicate classroom, got ${ids("ra-dup")}`);
  assert(ids("rb") === "d", `RB roster, got ${ids("rb")}`);
  assert(ids("g1") === "e", `1A roster, got ${ids("g1")}`);
  assert(unregistered.length === 1, `one unregistered group, got ${unregistered.length}`);
  assert(unregistered[0].learners.length === 2, "9Z variants grouped");
  const total = [...byClassroomId.values()].reduce((n, l) => n + l.length, 0) + unregistered[0].learners.length;
  assert(total === 7, `no learner double counted, got ${total}`);
});

const T_OLD = new Date("2026-01-01");
const T_NEW = new Date("2026-03-01");
const RA = { id: "c-RA", name: "Grade RA" };
const Ra = { id: "c-Ra", name: "Grade Ra" };
const LABELS_D_E_F = ["Grade RA", "Grade Ra", " Grade RA "];

function owner(resolver: ReturnType<typeof createClassroomResolver>, label: string) {
  return resolver.classroomFor(label)?.id ?? null;
}

test("scenario A: only Grade RA exists — D, E, F all land on Grade RA", () => {
  const r = createClassroomResolver([{ ...RA, createdAt: T_OLD }]);
  for (const label of LABELS_D_E_F) assert(owner(r, label) === RA.id, `${JSON.stringify(label)} → RA`);
});

test("scenario B: only Grade Ra exists — D, E, F all land on Grade Ra", () => {
  const r = createClassroomResolver([{ ...Ra, createdAt: T_OLD }]);
  for (const label of LABELS_D_E_F) assert(owner(r, label) === Ra.id, `${JSON.stringify(label)} → Ra`);
});

test("scenario C (RA older): exact spellings stay put, non-exact variants go to oldest", () => {
  const r = createClassroomResolver([{ ...RA, createdAt: T_OLD }, { ...Ra, createdAt: T_NEW }]);
  assert(owner(r, "Grade RA") === RA.id, "D → RA (exact)");
  assert(owner(r, "Grade Ra") === Ra.id, "E → Ra (exact)");
  assert(owner(r, " Grade RA ") === RA.id, "F → RA (exact after trim)");
  assert(owner(r, "GRADE RA") === RA.id, "non-exact → oldest (RA)");
  assert(!r.sameClassroom("Grade RA", "Grade Ra"), "duplicates are distinct rosters");
});

test("scenario C (Ra older): exact spellings stay put, non-exact variants go to oldest", () => {
  const r = createClassroomResolver([{ ...RA, createdAt: T_NEW }, { ...Ra, createdAt: T_OLD }]);
  assert(owner(r, "Grade RA") === RA.id, "D → RA (exact)");
  assert(owner(r, "Grade Ra") === Ra.id, "E → Ra (exact)");
  assert(owner(r, " Grade RA ") === RA.id, "F → RA (exact after trim)");
  assert(owner(r, "grade ra") === Ra.id, "non-exact → oldest (Ra)");
});

test("duplicates: assignment is deterministic regardless of input order", () => {
  const rooms = [
    { ...RA, createdAt: T_OLD },
    { ...Ra, createdAt: T_NEW },
  ];
  const learners = ["Grade RA", "Grade Ra", "GRADE RA", " Grade RA ", "grade  ra"].map((className, i) => ({
    id: `l${i}`,
    className,
  }));
  const snapshot = (rs: typeof rooms, ls: typeof learners) => {
    const { byClassroomId } = assignLearnersToClassrooms(rs, ls);
    return [...byClassroomId.entries()]
      .map(([id, l]) => `${id}:${l.map((x) => x.id).sort().join(",")}`)
      .sort()
      .join("|");
  };
  const base = snapshot(rooms, learners);
  assert(base === snapshot([...rooms].reverse(), [...learners].reverse()), "order-independent");
  const sameTime = [
    { ...RA, createdAt: T_OLD },
    { ...Ra, createdAt: T_OLD },
  ];
  assert(
    snapshot(sameTime, learners) === snapshot([...sameTime].reverse(), learners),
    "createdAt tie broken by id deterministically"
  );
});

test("exact-spelling learners never change classroom versus the old exact-match rule", () => {
  const r = createClassroomResolver([{ ...RA, createdAt: T_NEW }, { ...Ra, createdAt: T_OLD }]);
  for (const room of [RA, Ra]) {
    assert(owner(r, room.name) === room.id, `${room.name} exact spelling keeps its classroom`);
  }
});

test("slash-format labels resolve to the section classroom; full-key match wins", () => {
  const r = createClassroomResolver([
    { id: "c-1A", name: "1A", createdAt: T_OLD },
    { id: "c-g1-1A", name: "Grade 1 / 1B", createdAt: T_OLD },
  ]);
  assert(owner(r, "Grade 1 / 1A") === "c-1A", "slash label → 1A");
  assert(owner(r, "Grade 1/1a") === "c-1A", "compact slash label → 1A");
  assert(owner(r, "grade 1 / 1b") === "c-g1-1A", "full key beats section alias");
  assert(owner(r, "Grade 2 / 2A") === null, "unknown section stays unregistered");
  assert(learnerBelongsToClassroom("Grade 1 / 1A", "1A"), "pairwise helper agrees");
});

test("unregistered labels compare by key only", () => {
  const r = createClassroomResolver([{ ...RA, createdAt: T_OLD }]);
  assert(r.sameClassroom("Grade 9Z", "grade 9z"), "unregistered variants are one class");
  assert(!r.sameClassroom("Grade 9Z", "Grade RA"), "unregistered vs registered differ");
  assert(r.resolve("") === null && r.resolve(null) === null, "empty labels resolve to nothing");
});

console.log(`classroomMembership: ${passed} passed`);
