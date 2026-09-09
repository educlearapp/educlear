/**
 * Lists & Registers Phase 1 — product-meaning builders.
 * Run: npx --yes tsx src/listsRegisters/buildListRegisterReport.test.ts
 */
import assert from "assert";
import {
  PHASE1_LIST_REGISTER_DEFS,
  UNIMPLEMENTED_LIST_REGISTER_LABELS,
  getListRegisterDefByLabel,
} from "./listRegisterCatalog";
import {
  buildListRegisterCsv,
  buildListRegisterRows,
  flattenListRegisterViewRows,
  type ListRegisterControls,
  type ListRegisterLearnerInput,
} from "./buildListRegisterReport";
import {
  listRankedDisplayParentsForLearner,
  rankDisplayParentsForLearner,
  scoreDisplayContact,
} from "./displayContactRanking";

const baseControls: ListRegisterControls = {
  classroom: "all",
  grade: "all",
  month: "all",
  hasAddress: "all",
  sort: "surname",
};

const learners: ListRegisterLearnerInput[] = [
  {
    id: "l1",
    firstName: "Ada",
    surname: "Zephyr",
    grade: "Grade 5",
    classroom: "Grade 5A",
    status: "Enrolled",
    enrollmentStatus: "ACTIVE",
    admissionNo: "ADM-Z1",
    accountRef: "ZEP001",
    eduClearAccountNo: null,
    birthDate: "2014-03-15",
    parents: [
      {
        id: "p1",
        firstName: "Pat",
        surname: "Zephyr",
        cellNo: "082111",
        workNo: "011222",
        homeNo: "",
        email: "pat@example.com",
        homeAddress: "1 Main Rd",
        isPrimary: true,
        isPayingPerson: false,
        communicationBilling: true,
        relation: "Mother",
      },
    ],
  },
  {
    id: "l2",
    firstName: "Ben",
    surname: "Able",
    grade: "Grade 3",
    classroom: "Grade 3B",
    status: "Enrolled",
    enrollmentStatus: "ACTIVE",
    admissionNo: "ADM-A2",
    accountRef: "ABL001",
    eduClearAccountNo: "ABA001",
    birthDate: "2016-11-02",
    parents: [
      {
        id: "p2a",
        firstName: "Pay",
        surname: "Able",
        cellNo: "083333",
        workNo: "",
        homeNo: "044555",
        email: "",
        homeAddress: "2 Oak St",
        isPrimary: false,
        isPayingPerson: true,
        communicationBilling: true,
        relation: "Father",
      },
      {
        id: "p2b",
        firstName: "Primary",
        surname: "Able",
        cellNo: "086666",
        workNo: "077888",
        homeNo: "",
        email: "primary@example.com",
        homeAddress: "9 Oak St",
        isPrimary: true,
        isPayingPerson: false,
        communicationBilling: true,
        relation: "Mother",
      },
      {
        id: "p2c",
        firstName: "Sue",
        surname: "Jones",
        cellNo: "084444",
        workNo: "",
        homeNo: "",
        email: "",
        homeAddress: "9 Oak St", // identical to mother — dedupe on Address List
        isPrimary: false,
        isPayingPerson: false,
        communicationBilling: true,
        relation: "Guardian",
      },
    ],
  },
  {
    id: "l3",
    firstName: "Cara",
    surname: "Able",
    grade: "Grade 3",
    classroom: "Grade 3B",
    status: "Enrolled",
    enrollmentStatus: "ACTIVE",
    admissionNo: "ADM-A3",
    accountRef: "ABL001",
    birthDate: "2015-03-01",
    parents: [],
  },
  {
    id: "l-hist",
    firstName: "Old",
    surname: "History",
    grade: "Grade 1",
    classroom: "Grade 1A",
    status: "Historical",
    enrollmentStatus: "HISTORICAL",
    childStatus: "Historical",
    birthDate: "2010-01-01",
    parents: [
      {
        id: "ph",
        firstName: "Hist",
        surname: "Parent",
        cellNo: "080000",
        relation: "Mother",
        isPrimary: true,
        homeAddress: "Ghost Rd",
      },
    ],
  },
];

assert.equal(PHASE1_LIST_REGISTER_DEFS.length, 6);
assert.ok(PHASE1_LIST_REGISTER_DEFS.every((d) => d.implemented));
assert.ok(UNIMPLEMENTED_LIST_REGISTER_LABELS.length >= 10);
assert.equal(getListRegisterDefByLabel("Child List")?.id, "child-list");
assert.equal(getListRegisterDefByLabel("Allergies List")?.implemented, false);
console.log("✓ catalogue IDs and unimplemented stubs");

assert.equal(scoreDisplayContact({ isPrimary: true, isPayingPerson: true, communicationBilling: true }), 18);
{
  const all = listRankedDisplayParentsForLearner(learners[1].parents as any[]);
  assert.equal(all.length, 3);
  assert.equal(all[0].id, "p2b"); // primary first
  assert.equal(all[1].id, "p2a"); // paying second
  const single = rankDisplayParentsForLearner(learners[1].parents as any[]);
  assert.equal(single?.id, "p2b"); // OA-style single pick still primary only
  assert.notEqual(all.length, 1);
}
console.log("✓ ranking: all contacts vs single OA pick");

function csvDataRows(csv: string, defLabel: string): string[] {
  return csv
    .split("\n")
    .filter((line) => line && !line.startsWith('"Report"') && !line.startsWith('"School"') && !line.includes("Count:") && !line.includes(`"${defLabel}"` === "x"));
}

function reconcileViewAndCsv(defLabel: string, controls: ListRegisterControls = baseControls) {
  const def = getListRegisterDefByLabel(defLabel)!;
  const { sections } = buildListRegisterRows(learners, def, {
    ...controls,
    sort: (def.sorts.includes(controls.sort) ? controls.sort : def.sorts[0]) as any,
  });
  const viewRows = flattenListRegisterViewRows(sections);
  const csv = buildListRegisterCsv(def, sections, "Test School");
  for (const row of viewRows) {
    for (const col of def.columns) {
      const cell = String(row[col] ?? "");
      // Escaped CSV contains the cell value
      assert.ok(
        csv.includes(cell.replace(/"/g, '""')) || cell === "",
        `${defLabel}: CSV missing cell ${col}=${cell}`
      );
    }
  }
  assert.equal(
    sections.reduce((n, s) => n + s.count, 0),
    viewRows.length,
    `${defLabel}: section counts must equal rows`
  );
  return { def, sections, viewRows, csv };
}

{
  const def = getListRegisterDefByLabel("Child List")!;
  const { rows } = buildListRegisterRows(learners, def, { ...baseControls, sort: "surname" });
  assert.equal(rows.length, 3, "ACTIVE only — historical excluded");
  assert.ok(!rows.some((r) => r.learnerId === "l-hist"));
  assert.deepEqual(def.columns, [
    "surname",
    "name",
    "grade",
    "classroom",
    "admissionNo",
    "accountNo",
    "status",
  ]);
  assert.equal(def.groupBy, "none");
  assert.equal(rows[0].surname, "Able");
  assert.equal(rows.find((r) => r.learnerId === "l2")?.accountNo, "ABA001");
  assert.equal(rows.find((r) => r.learnerId === "l2")?.admissionNo, "ADM-A2");
  const byName = buildListRegisterRows(learners, def, { ...baseControls, sort: "name" }).rows;
  assert.equal(byName[0].name, "Ada");
  const filtered = buildListRegisterRows(learners, def, {
    ...baseControls,
    classroom: "Grade 3B",
  }).rows;
  assert.equal(filtered.length, 2);
  const byGrade = buildListRegisterRows(learners, def, { ...baseControls, grade: "Grade 5" }).rows;
  assert.equal(byGrade.length, 1);
  reconcileViewAndCsv("Child List");
  console.log("✓ Child List ACTIVE roster / admission / account / filters / CSV");
}

{
  const def = getListRegisterDefByLabel("Class List")!;
  const { sections, rows } = buildListRegisterRows(learners, def, baseControls);
  assert.ok(sections.length >= 2);
  assert.ok(sections.every((s) => s.count === s.rows.length));
  const g3 = sections.find((s) => s.key === "Grade 3B")!;
  assert.equal(g3.count, 2);
  assert.equal(g3.rows.length, 2);
  assert.ok(g3.label.includes("Grade 3"));
  assert.equal(g3.rows[0].surname <= g3.rows[1].surname || g3.rows[0].name <= g3.rows[1].name, true);
  // alphabetical within class: Able Cara before Able Ben? Able Able — Cara before Ben by name when surname same
  assert.equal(g3.rows[0].surname, "Able");
  assert.equal(g3.rows[0].name, "Ben"); // Ben before Cara? B before C — wait Ben then Cara
  assert.equal(g3.rows[1].name, "Cara");
  const one = buildListRegisterRows(learners, def, { ...baseControls, classroom: "Grade 5A" });
  assert.equal(one.rows.length, 1);
  assert.equal(one.sections.length, 1);
  assert.equal(one.sections[0].key, "Grade 5A");
  assert.equal(one.sections[0].count, 1);
  assert.ok(!rows.some((r) => r.learnerId === "l-hist"));
  const { csv } = reconcileViewAndCsv("Class List");
  assert.ok(csv.includes("Grade 3B"));
  assert.ok(csv.includes("Count: 2"));
  console.log("✓ Class List grouping / counts / alpha / class filter / CSV sections");
}

{
  const def = getListRegisterDefByLabel("Contact List")!;
  assert.equal(def.groupBy, "classroom");
  assert.equal(def.rowGrain, "learner-contact");
  const { rows, sections } = buildListRegisterRows(learners, def, {
    ...baseControls,
    sort: "surname",
  });
  const ableContacts = rows.filter((r) => r.learnerId === "l2");
  assert.equal(ableContacts.length, 3, "mother + father + guardian all retained");
  assert.equal(ableContacts[0].guardian, "Primary Able");
  assert.equal(ableContacts[0].relationship, "Mother");
  assert.equal(ableContacts[0].primary, "Yes");
  assert.equal(ableContacts[1].guardian, "Pay Able");
  assert.equal(ableContacts[1].relationship, "Father");
  assert.equal(ableContacts[1].paying, "Yes");
  assert.equal(ableContacts[2].guardian, "Sue Jones");
  assert.equal(ableContacts[2].relationship, "Guardian");
  assert.equal(ableContacts[2].cellphone, "084444");
  assert.equal(ableContacts[0].email, "primary@example.com");
  assert.equal(ableContacts[1].email, "—");
  // Not OA single-contact selection
  assert.notEqual(ableContacts.length, 1);
  const oaPick = rankDisplayParentsForLearner(learners[1].parents as any[]);
  assert.equal(oaPick?.id, "p2b");
  assert.ok(ableContacts.some((r) => r.parentId === "p2a"));
  assert.ok(ableContacts.some((r) => r.parentId === "p2c"));

  // Deduped parent ids — no duplicate learner+parent pairs
  const pairs = ableContacts.map((r) => `${r.learnerId}:${r.parentId}`);
  assert.equal(new Set(pairs).size, pairs.length);

  // Classroom grouping
  assert.ok(sections.every((s) => s.key !== "all" || sections.length === 1));
  const sec3 = sections.find((s) => s.key === "Grade 3B")!;
  assert.ok(sec3);
  assert.equal(sec3.count, sec3.rows.length);
  assert.ok(sec3.rows.some((r) => r.learnerId === "l2"));
  assert.ok(sec3.rows.some((r) => r.learnerId === "l3"));

  const filtered = buildListRegisterRows(learners, def, {
    ...baseControls,
    classroom: "Grade 5A",
  });
  assert.equal(filtered.rows.length, 1);
  assert.equal(filtered.rows[0].learnerId, "l1");
  assert.equal(filtered.sections[0].key, "Grade 5A");

  const { csv } = reconcileViewAndCsv("Contact List");
  assert.ok(csv.includes("Primary Able"));
  assert.ok(csv.includes("Pay Able"));
  assert.ok(csv.includes("Sue Jones"));
  assert.ok(csv.includes("Guardian"));
  assert.ok(csv.includes("Relationship"));
  console.log("✓ Contact List all linked contacts / class group / primary order / CSV");
}

{
  const def = getListRegisterDefByLabel("Address List")!;
  const { rows } = buildListRegisterRows(learners, def, baseControls);
  const l2 = rows.filter((r) => r.learnerId === "l2");
  assert.equal(l2.length, 2, "two distinct addresses retained; identical 9 Oak St deduped");
  assert.ok(l2.some((r) => r.address === "2 Oak St"));
  assert.ok(l2.some((r) => r.address === "9 Oak St"));
  assert.equal(rows.find((r) => r.learnerId === "l3")?.address, "—");
  assert.equal(rows.find((r) => r.learnerId === "l1")?.address, "1 Main Rd");

  const has = buildListRegisterRows(learners, def, { ...baseControls, hasAddress: "yes" }).rows;
  assert.ok(has.every((r) => r.address !== "—"));
  assert.ok(!has.some((r) => r.learnerId === "l3"));

  const missing = buildListRegisterRows(learners, def, { ...baseControls, hasAddress: "no" }).rows;
  assert.ok(missing.every((r) => r.address === "—"));
  assert.ok(missing.some((r) => r.learnerId === "l3"));

  const classFiltered = buildListRegisterRows(learners, def, {
    ...baseControls,
    classroom: "Grade 5A",
  }).rows;
  assert.equal(classFiltered.length, 1);
  assert.equal(classFiltered[0].address, "1 Main Rd");

  reconcileViewAndCsv("Address List");
  console.log("✓ Address List multi-address / dedupe / missing / filters / CSV");
}

{
  const def = getListRegisterDefByLabel("Age List")!;
  const { rows } = buildListRegisterRows(learners, def, { ...baseControls, sort: "dob" });
  assert.ok(def.columns.includes("dob") && def.columns.includes("age"));
  assert.equal(rows[0]._dobIso <= rows[1]._dobIso, true);
  assert.ok(rows.every((r) => r.dob !== "—" ? r.age !== "—" : true));
  const noDob = buildListRegisterRows(
    [{ ...learners[0], birthDate: null, dateOfBirth: null, dob: null, age: "99 years" }],
    def,
    baseControls
  ).rows[0];
  assert.equal(noDob.dob, "—");
  assert.equal(noDob.age, "—", "do not invent age from stale field");

  const byAge = buildListRegisterRows(learners, def, { ...baseControls, sort: "age" }).rows;
  // Older first: Ada (2014) before Cara (2015) before Ben (2016)
  assert.equal(byAge[0].learnerId, "l1");
  assert.equal(byAge[1].learnerId, "l3");
  assert.equal(byAge[2].learnerId, "l2");

  const gradeF = buildListRegisterRows(learners, def, { ...baseControls, grade: "Grade 3" }).rows;
  assert.equal(gradeF.length, 2);
  const classF = buildListRegisterRows(learners, def, { ...baseControls, classroom: "Grade 5A" }).rows;
  assert.equal(classF.length, 1);
  reconcileViewAndCsv("Age List", { ...baseControls, sort: "age" });
  console.log("✓ Age List DOB/age / missing / numeric age sort / filters / CSV");
}

{
  const def = getListRegisterDefByLabel("Birthday Child List")!;
  const march = buildListRegisterRows(learners, def, { ...baseControls, month: "3", sort: "birthday" });
  assert.equal(march.rows.length, 2);
  assert.equal(march.rows[0]._birthdayKey <= march.rows[1]._birthdayKey, true);
  // day ascending: Cara 01 Mar before Ada 15 Mar
  assert.equal(march.rows[0].learnerId, "l3");
  assert.equal(march.rows[1].learnerId, "l1");

  const all = buildListRegisterRows(learners, def, { ...baseControls, sort: "birthday" });
  assert.ok(all.sections.length >= 2);
  assert.ok(all.sections.some((s) => s.label === "March"));
  assert.ok(all.sections.some((s) => s.label === "November"));
  assert.ok(all.rows.every((r) => r.classroom && r.classroom !== ""));

  const ageOrder = buildListRegisterRows(learners, getListRegisterDefByLabel("Age List")!, {
    ...baseControls,
    sort: "age",
  }).rows.map((r) => r.learnerId);
  const bdayOrder = all.rows.map((r) => r.learnerId);
  assert.notDeepEqual(ageOrder, bdayOrder);

  reconcileViewAndCsv("Birthday Child List", { ...baseControls, sort: "birthday" });
  console.log("✓ Birthday month filter / day order / month grouping ≠ age / CSV");
}

{
  // Distinct report purposes
  const child = flattenListRegisterViewRows(
    buildListRegisterRows(learners, getListRegisterDefByLabel("Child List")!, baseControls).sections
  );
  const contact = flattenListRegisterViewRows(
    buildListRegisterRows(learners, getListRegisterDefByLabel("Contact List")!, baseControls).sections
  );
  const address = flattenListRegisterViewRows(
    buildListRegisterRows(learners, getListRegisterDefByLabel("Address List")!, baseControls).sections
  );
  assert.notEqual(child.length, contact.length);
  assert.notEqual(contact.length, address.length);
  assert.ok(contact.length > child.length);
  console.log("✓ Child ≠ Contact ≠ Address row grains");
}

// silence unused
void csvDataRows;

console.log("\nAll buildListRegisterReport tests passed.");
