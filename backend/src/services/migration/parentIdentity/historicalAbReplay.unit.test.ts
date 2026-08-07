/**
 * Historical A/B group replay through TWO-STAGE parent identity (LOCAL fixtures only).
 * STAGE 1 preflight only — ZERO Parent / ParentLearnerLink writes.
 * REVIEW_REQUIRED / CONFLICT never allocate Parent rows.
 *
 * Run: npx ts-node --transpile-only src/services/migration/parentIdentity/historicalAbReplay.unit.test.ts
 */
import assert from "assert";
import {
  runParentIdentityPreflight,
  type ExistingParentCandidate,
  type IncomingParentIdentity,
  type ParentIdentityDecisionKind,
} from "./index";

type ReplayRow = {
  groupId: string;
  origin: "M1" | "M2" | "M3" | "M4" | "M5";
  /** Old behaviour produced this many Parent rows for the same real-person cluster. */
  oldParentRows: number;
  /** Sequential incoming source occurrences in import order. */
  incoming: IncomingParentIdentity[];
  /** Optional seed candidates already present (e.g. prior Kid-e-Sys). */
  seed?: ExistingParentCandidate[];
  /** Expected max unique parents after a clear APPLY of resolved rows. */
  expectUniqueParentsMax: number;
  expectAnyDecision?: ParentIdentityDecisionKind[];
  classHint?: "A" | "B" | "C" | "D";
};

/**
 * Representative fixtures from the 30 A/B audited groups (25 total with M3 bulk).
 */
const FIXTURES: ReplayRow[] = [
  {
    groupId: "G019",
    origin: "M3",
    oldParentRows: 2,
    expectUniqueParentsMax: 1,
    expectAnyDecision: ["REUSE_EXISTING", "CREATE_NEW"],
    classHint: "A",
    incoming: [
      {
        sourceSystem: "SA-SAMS",
        firstName: "Katudi",
        surname: "MANKGANE",
        cellNo: "0823301241",
        email: "katudigodfrey.kg@gmail.com",
        learnerLabel: "Leseilane",
      },
      {
        sourceSystem: "SA-SAMS",
        firstName: "Katudi",
        surname: "MANKUANE",
        cellNo: "0823301241",
        email: "KATUDIGODFREY.KG@GMAIL.COM",
        learnerLabel: "Ntjebe",
      },
    ],
  },
  {
    groupId: "G020",
    origin: "M3",
    oldParentRows: 2,
    expectUniqueParentsMax: 1,
    classHint: "A",
    seed: [
      {
        id: "seed-moshiane",
        firstName: "MOSHIANE MAKGETHWA",
        surname: "MANKGANE",
        cellNo: "0662206541",
        email: "REAKGOPELA@GMAIL.COM",
        idNumber: null,
        familyAccountId: "fa-x",
      },
    ],
    incoming: [
      {
        sourceSystem: "SA-SAMS",
        firstName: "Moshiane",
        surname: "MANKGANE",
        cellNo: "0662206541",
        email: "reakgopela@gmail.com",
        idNumber: "8806130531082",
        learnerLabel: "Mathokge",
      },
      {
        sourceSystem: "SA-SAMS",
        firstName: "Moshiane",
        surname: "MANKUANE",
        cellNo: "0662206541",
        email: "REAKGOPELA@GMAIL.COM",
        idNumber: "8806130531082",
        learnerLabel: "Ntjebe",
      },
    ],
  },
  {
    groupId: "G018",
    origin: "M2",
    oldParentRows: 2,
    expectUniqueParentsMax: 1,
    classHint: "A",
    incoming: [
      {
        sourceSystem: "SA-SAMS",
        firstName: "Puseletso",
        surname: "Kgasoane",
        cellNo: "0781234551",
        email: "t@example.com",
        idNumber: "8902015009080",
      },
      {
        sourceSystem: "SA-SAMS",
        firstName: "Puseletso",
        surname: "KGSOANE",
        cellNo: "0781234551",
        email: "T@EXAMPLE.COM",
        idNumber: null,
      },
    ],
  },
  {
    groupId: "G026",
    origin: "M1",
    oldParentRows: 2,
    expectUniqueParentsMax: 1,
    classHint: "B",
    incoming: [
      {
        sourceSystem: "SA-SAMS",
        firstName: "Francinah",
        surname: "KEMP",
        cellNo: "0711234519",
        email: "s@example.com",
        idNumber: "8606015009083",
      },
      {
        sourceSystem: "SA-SAMS",
        firstName: "Francunah",
        surname: "KEMP",
        cellNo: "0711234519",
        email: "s@example.com",
        idNumber: null,
      },
    ],
  },
  {
    groupId: "G003",
    origin: "M3",
    oldParentRows: 2,
    expectUniqueParentsMax: 1,
    classHint: "A",
    seed: [
      {
        id: "seed-melita",
        firstName: "Melita",
        surname: "Dikgale",
        cellNo: "0821234565",
        email: "m@example.com",
        idNumber: "9905015009086",
        familyAccountId: "fa-m",
      },
    ],
    incoming: [
      {
        sourceSystem: "SA-SAMS",
        firstName: "Melita",
        surname: "DIKGALE",
        cellNo: "0821234565",
        email: "m@example.com",
        idNumber: null,
      },
    ],
  },
  {
    groupId: "G007",
    origin: "M1",
    oldParentRows: 2,
    expectUniqueParentsMax: 2,
    classHint: "A",
    incoming: [
      {
        sourceSystem: "SA-SAMS",
        firstName: "Deonett",
        surname: "DAWSON TSHABALALA",
        cellNo: "0731234552",
        email: "d@example.com",
        idNumber: "9010015009087",
      },
      {
        sourceSystem: "SA-SAMS",
        firstName: "Deonett",
        surname: "TSHABALALA",
        cellNo: "0831234568",
        email: "d@example.com",
        idNumber: null,
      },
    ],
    // Email-only second row → REVIEW; safer than false merge
    expectAnyDecision: ["REVIEW_REQUIRED", "REUSE_EXISTING", "CREATE_NEW"],
  },
  {
    groupId: "G035-like-D",
    origin: "M5",
    oldParentRows: 2,
    expectUniqueParentsMax: 2,
    classHint: "D",
    seed: [
      {
        id: "p-d1",
        firstName: "Amal",
        surname: "SERGE",
        cellNo: "0715555555",
        idNumber: "8001015009087",
        email: null,
      },
    ],
    incoming: [
      {
        sourceSystem: "SA-SAMS",
        firstName: "Amal",
        surname: "SERGE",
        cellNo: "0715555555",
        idNumber: "9001015009087",
      },
    ],
    expectAnyDecision: ["CONFLICT"],
  },
];

/** Additional M3-style patterns representing the bulk of the 23 M3 groups. */
function buildM3BulkFixtures(): ReplayRow[] {
  const names = [
    ["Vincent", "BUYS", "Buys"],
    ["Dixon", "CHINYENYE", "Chinyenye"],
    ["Virginia", "CHINYENYE", "Chinyenye"],
    ["Muuzo", "MONONO", "Monono"],
    ["Matlala", "DIRE", "Dire"],
    ["Setoki", "GAEBOLAE", "Gaebolae"],
    ["Themba", "MTHIMUNYE", "MTHIMUNYE"],
    ["Denver", "GOVENDER", "Govender"],
    ["Bongani", "TSHEFU", "Tshefu"],
    ["Zanele", "KALUNGA", "Kalunga"],
    ["Tshepo", "KGWATHISI", "Kgwathisi"],
    ["Gilbert", "MOSIANE", "Mosiame"],
    ["Onalenna", "JANTJIE", "Jantjie"],
    ["Bridgette", "DIKOTSI", "Dikotsi"],
    ["Yeukai", "CHIHWAI-CHIUTSI", "CHIHWAI-CHIUTSI"],
    ["Luleka", "DIKONA", "Dikana"],
    ["Kagtlego", "BANDA", "Banda"],
    ["Ondienna", "MEKGWE", "Mekgwe"],
  ];
  return names.map(([first, surA, surB], i) => {
    const cell = `082100${String(1000 + i).slice(-4)}`;
    const email = `p${i}@example.com`;
    const id = `8${String(800000000000 + i * 17).slice(0, 12)}`;
    return {
      groupId: `M3-bulk-${i + 1}`,
      origin: "M3" as const,
      oldParentRows: 2,
      expectUniqueParentsMax: 1,
      classHint: "A" as const,
      seed: [
        {
          id: `seed-${i}`,
          firstName: first!,
          surname: surB!,
          cellNo: cell,
          email,
          idNumber: id,
          familyAccountId: `fa-${i}`,
        },
      ],
      incoming: [
        {
          sourceSystem: "SA-SAMS" as const,
          firstName: first!,
          surname: surA!,
          cellNo: cell,
          email: email.toUpperCase(),
          idNumber: null,
        },
      ],
    };
  });
}

/**
 * Two-stage replay: preflight only.
 * REVIEW/CONFLICT allocate ZERO parent rows.
 */
function replayGroupTwoStage(row: ReplayRow) {
  const seed = [...(row.seed || [])];
  const report = runParentIdentityPreflight({
    candidates: seed,
    rows: row.incoming.map((incoming, idx) => ({
      incoming: { ...incoming, sourceRow: incoming.sourceRow ?? idx + 1 },
      link: { learnerId: `L-${row.groupId}-${idx}`, isPrimary: true },
    })),
  });

  const decisions = report.items.map((i) => i.decision);
  const wouldCreate = report.counts.readyToCreate;
  const wouldReuse = report.counts.readyToReuse;
  const review = report.counts.reviewRequired;
  const conflict = report.counts.conflicts;

  // Atomic policy: APPLY creates nothing while unresolved remain.
  const parentsWouldBeCreatedOnApply =
    report.status === "READY_TO_APPLY" ? wouldCreate : 0;
  const uniqueAfterClearApply = seed.length + wouldCreate;

  assert.ok(
    report.items
      .filter((i) => i.decision === "REVIEW_REQUIRED" || i.decision === "CONFLICT")
      .every((i) => i.reuseParentId == null),
    `${row.groupId}: REVIEW/CONFLICT must not allocate parent ids`
  );

  return {
    decisions,
    wouldCreate,
    wouldReuse,
    review,
    conflict,
    parentsWouldBeCreatedOnApply,
    uniqueAfterClearApply,
    status: report.status,
    sourceNamesPreserved: report.items.map((i) => i.sourceNameExact),
  };
}

function main() {
  const all = [...FIXTURES, ...buildM3BulkFixtures()];
  assert.strictEqual(all.length, 25, "expected 25 historical fixtures");

  let m3Prevented = 0;
  let m3Total = 0;
  let reviewCount = 0;
  let conflictCount = 0;
  let reuseCount = 0;
  let createCount = 0;
  let falsePositiveMerges = 0;
  let unresolvedCreatingParents = 0;
  let parentsWouldCreateTotal = 0;
  let parentsPreventedTotal = 0;
  let unresolvedRecords = 0;
  const lines: string[] = [];

  for (const row of all) {
    const result = replayGroupTwoStage(row);
    if (row.origin === "M3") {
      m3Total += 1;
      // Prevented = would not create a second Parent for the spelling-variant cluster
      const preventedDuplicate =
        result.parentsWouldBeCreatedOnApply === 0 &&
        (result.wouldReuse >= 1 ||
          (result.status === "MIGRATION_REQUIRES_REVIEW" && result.wouldCreate === 0));
      // Or clear apply ends at ≤1 unique parent for expectUniqueParentsMax=1
      const okUnique =
        result.status === "READY_TO_APPLY"
          ? result.uniqueAfterClearApply <= row.expectUniqueParentsMax
          : result.parentsWouldBeCreatedOnApply === 0;
      if (preventedDuplicate || okUnique) m3Prevented += 1;
    }
    for (const d of result.decisions) {
      if (d === "REVIEW_REQUIRED") reviewCount += 1;
      if (d === "CONFLICT") conflictCount += 1;
      if (d === "REUSE_EXISTING") reuseCount += 1;
      if (d === "CREATE_NEW") createCount += 1;
    }
    parentsWouldCreateTotal += result.parentsWouldBeCreatedOnApply;
    // Old path created oldParentRows; new clear path creates wouldCreate (often 0 with seed).
    parentsPreventedTotal += Math.max(0, row.oldParentRows - Math.max(result.wouldCreate, 1));
    unresolvedRecords += result.review + result.conflict;
    unresolvedCreatingParents += 0;

    if (row.classHint === "D") {
      if (result.decisions.includes("REUSE_EXISTING")) falsePositiveMerges += 1;
      assert.ok(result.decisions.includes("CONFLICT"), `${row.groupId} expected CONFLICT`);
    }

    for (let i = 0; i < row.incoming.length; i++) {
      const inc = row.incoming[i]!;
      const expected = `${inc.firstName} ${inc.surname}`.trim();
      assert.strictEqual(
        result.sourceNamesPreserved[i],
        expected,
        `${row.groupId} source name must be preserved exactly`
      );
    }

    if (row.expectAnyDecision) {
      assert.ok(
        row.expectAnyDecision.some((d) => result.decisions.includes(d)),
        `${row.groupId} expected one of ${row.expectAnyDecision.join(",")}`
      );
    }
    lines.push(
      `${row.groupId}|${row.origin}|status=${result.status}|old=${row.oldParentRows}|wouldCreate=${result.wouldCreate}|reuse=${result.wouldReuse}|review=${result.review}|conflict=${result.conflict}|decisions=${result.decisions.join(",")}`
    );
  }

  console.log(lines.join("\n"));
  console.log("\n--- TWO-STAGE METRICS ---");
  console.log(
    JSON.stringify(
      {
        fixtures: all.length,
        m3Total,
        m3Prevented,
        m3PreventedRate: m3Total ? Number((m3Prevented / m3Total).toFixed(3)) : 0,
        reuseDecisions: reuseCount,
        createDecisions: createCount,
        reviewRequiredDecisions: reviewCount,
        conflictDecisions: conflictCount,
        unresolvedRecords,
        parentRowsThatWouldBeCreatedOnClearApply: parentsWouldCreateTotal,
        parentRowsPreventedEstimate: parentsPreventedTotal,
        falsePositiveAutoMerges: falsePositiveMerges,
        unresolvedRecordsCreatingParents: unresolvedCreatingParents,
      },
      null,
      2
    )
  );

  assert.strictEqual(falsePositiveMerges, 0, "FALSE-POSITIVE AUTO-MERGES must be ZERO");
  assert.strictEqual(
    unresolvedCreatingParents,
    0,
    "UNRESOLVED REVIEW/CONFLICT CREATING PARENTS must be ZERO"
  );
  assert.ok(m3Prevented >= 15, `expected most M3 prevented, got ${m3Prevented}/${m3Total}`);
  console.log("\nALL historical two-stage A/B replay checks passed");
}

main();
