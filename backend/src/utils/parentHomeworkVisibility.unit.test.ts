/**
 * Run: npx tsx src/utils/parentHomeworkVisibility.unit.test.ts
 */
import assert from "node:assert/strict";
import { parentHomeworkVisibilityWhere } from "./parentHomeworkVisibility";
import { createClassroomResolver, type SchoolClassMembership } from "./classroomMembership";

function membershipStub(names: string[]): SchoolClassMembership {
  const classrooms = names.map((name, i) => ({ id: `c${i}`, name, createdAt: new Date(0) }));
  const resolver = createClassroomResolver(classrooms);
  const classNames = [...names];
  const spellingsFor = (label: string | null | undefined): string[] => {
    const trimmed = String(label ?? "").trim();
    if (!trimmed) return [];
    const out = new Set<string>([trimmed]);
    const target = resolver.classroomFor(trimmed);
    if (target) out.add(target.name);
    for (const cn of classNames) {
      if (resolver.sameClassroom(trimmed, cn)) out.add(cn);
    }
    return [...out];
  };
  return {
    resolver,
    classNames,
    spellingsFor,
    labelFor: (l) => String(l || "").trim(),
    classLabels: () => [...names],
  };
}

const m = membershipStub(["Grade 1A"]);
const whereOne = parentHomeworkVisibilityWhere(
  "sch1",
  [{ id: "L1", grade: "1", className: "Grade 1A" }],
  m
) as { schoolId: string; isDraft: boolean; visibility: string; OR: unknown[] };

assert.equal(whereOne.schoolId, "sch1");
assert.equal(whereOne.isDraft, false);
assert.equal(whereOne.visibility, "CLASS_TEACHERS");
assert.ok(Array.isArray(whereOne.OR) && whereOne.OR.length >= 2);

const whereMulti = parentHomeworkVisibilityWhere(
  "sch1",
  [
    { id: "L1", grade: "1", className: "Grade 1A" },
    { id: "L2", grade: "2", className: "Grade 1A" },
  ],
  m
) as { OR: unknown[] };
assert.ok(whereMulti.OR.length > whereOne.OR.length, "multi-child expands OR targets");

const whereEmpty = parentHomeworkVisibilityWhere("sch1", [], m) as { id?: string };
assert.equal(whereEmpty.id, "__no_homework_targets__");

console.log("✓ parentHomeworkVisibilityWhere multi-child OR targeting");
