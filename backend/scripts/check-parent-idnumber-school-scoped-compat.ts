/**
 * READ-ONLY pre-migration compatibility check for school-scoped Parent.idNumber uniqueness.
 *
 * Proves whether existing data is compatible with @@unique([schoolId, idNumber]).
 * Does NOT modify data. Does NOT auto-merge or delete.
 *
 * Run locally only:
 *   npx ts-node --transpile-only scripts/check-parent-idnumber-school-scoped-compat.ts
 *
 * Exit 0 = compatible. Exit 1 = same-school duplicate non-null idNumbers found (STOP).
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Parent (schoolId, idNumber) uniqueness compatibility check ===");
  console.log("READ-ONLY — no data modifications\n");

  const parents = await prisma.parent.findMany({
    where: { idNumber: { not: null } },
    select: {
      id: true,
      schoolId: true,
      idNumber: true,
      firstName: true,
      surname: true,
    },
    orderBy: [{ schoolId: "asc" }, { idNumber: "asc" }],
  });

  console.log(`Parents with non-null idNumber: ${parents.length}`);

  const bySchoolAndId = new Map<string, typeof parents>();
  for (const p of parents) {
    const id = String(p.idNumber || "").trim();
    if (!id) continue;
    const key = `${p.schoolId}::${id}`;
    const list = bySchoolAndId.get(key) || [];
    list.push(p);
    bySchoolAndId.set(key, list);
  }

  const conflicts = [...bySchoolAndId.entries()].filter(([, rows]) => rows.length > 1);

  if (conflicts.length === 0) {
    console.log("PASS: No duplicate (schoolId, idNumber) pairs. Safe to apply school-scoped unique.");
    process.exitCode = 0;
    return;
  }

  console.error("FAIL: Same-school duplicate Parent idNumber values found. STOP — do not migrate.");
  for (const [key, rows] of conflicts) {
    console.error(`\nConflict key: ${key}`);
    for (const row of rows) {
      console.error(
        `  parentId=${row.id} schoolId=${row.schoolId} idNumber=${row.idNumber} name=${row.firstName} ${row.surname}`
      );
    }
  }
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
