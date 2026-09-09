/**
 * Lists & Registers V3 — product-meaning builders.
 * Run: npx --yes tsx src/listsRegisters/buildListRegisterReport.test.ts
 */
import assert from "assert";
import {
  COMPLETE_LIST_REGISTER_DEFS,
  PHASE1_LIST_REGISTER_DEFS,
  getListRegisterDefByLabel,
} from "./listRegisterCatalog";
import {
  assertEmployeeDatasetNotLearners,
  buildListRegisterCsv,
  buildListRegisterReport,
  buildListRegisterRows,
  flattenListRegisterViewRows,
  type ListRegisterControls,
  type ListRegisterEmployeeAttendanceInput,
  type ListRegisterEmployeeInput,
  type ListRegisterGroupMemberInput,
  type ListRegisterIncidentInput,
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
  group: "all",
  department: "all",
  anchorDate: "2026-03-10",
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
        homeAddress: "9 Oak St",
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

const employees: ListRegisterEmployeeInput[] = [
  {
    id: "e1",
    employeeNumber: "EMP-01",
    firstName: "Nina",
    lastName: "Adams",
    dateOfBirth: "1990-03-12",
    mobileNumber: "081111",
    email: "nina@school.test",
    physicalAddress: "10 Staff Rd",
    jobTitle: "Teacher",
    department: "Foundation",
    isActive: true,
  },
  {
    id: "e2",
    employeeNumber: "EMP-02",
    firstName: "Omar",
    lastName: "Baker",
    dateOfBirth: "1985-11-20",
    mobileNumber: "082222",
    email: "omar@school.test",
    physicalAddress: "",
    jobTitle: "Admin",
    department: "Office",
    isActive: true,
  },
  {
    id: "e-inactive",
    employeeNumber: "EMP-X",
    firstName: "Zed",
    lastName: "Gone",
    dateOfBirth: "1970-01-01",
    isActive: false,
  },
];

const groupMembers: ListRegisterGroupMemberInput[] = [
  {
    groupId: "g1",
    groupName: "Chess Club",
    learnerId: "l1",
    surname: "Zephyr",
    name: "Ada",
    grade: "Grade 5",
    classroom: "Grade 5A",
  },
  {
    groupId: "g1",
    groupName: "Chess Club",
    learnerId: "l2",
    surname: "Able",
    name: "Ben",
    grade: "Grade 3",
    classroom: "Grade 3B",
  },
  {
    groupId: "g2",
    groupName: "Choir",
    learnerId: "l3",
    surname: "Able",
    name: "Cara",
    grade: "Grade 3",
    classroom: "Grade 3B",
  },
];

const incidents: ListRegisterIncidentInput[] = [
  {
    id: "i1",
    incidentDate: "2026-02-01",
    type: "Behaviour",
    subject: "General",
    summary: "Spoke out of turn",
    createdBy: "Ms A",
    learnerId: "l2",
    learnerName: "Ben Able",
    grade: "Grade 3",
    classroom: "Grade 3B",
  },
  {
    id: "i2",
    incidentDate: "2026-03-01",
    type: "Medical",
    subject: "Injury",
    summary: "Scraped knee",
    createdBy: "Mr B",
    learnerId: "l1",
    learnerName: "Ada Zephyr",
    grade: "Grade 5",
    classroom: "Grade 5A",
  },
];

const attendanceRows: ListRegisterEmployeeAttendanceInput[] = [
  {
    employeeId: "e1",
    employeeNumber: "EMP-01",
    firstName: "Nina",
    lastName: "Adams",
    department: "Foundation",
    jobTitle: "Teacher",
    date: "2026-03-10",
    status: "Present",
    clockIn: "07:55",
    clockOut: "14:05",
  },
  {
    employeeId: "e2",
    employeeNumber: "EMP-02",
    firstName: "Omar",
    lastName: "Baker",
    department: "Office",
    jobTitle: "Admin",
    date: "2026-03-10",
    status: "Absent",
    clockIn: null,
    clockOut: null,
  },
];

assert.equal(PHASE1_LIST_REGISTER_DEFS.length, 6);
assert.ok(PHASE1_LIST_REGISTER_DEFS.every((d) => d.implemented));
assert.ok(COMPLETE_LIST_REGISTER_DEFS.length >= 24);
assert.equal(getListRegisterDefByLabel("Child List")?.id, "child-list");
assert.equal(getListRegisterDefByLabel("Allergies List")?.status, "blocked_missing_data");
assert.ok(getListRegisterDefByLabel("Allergies List")?.blockedReason);
console.log("✓ catalogue IDs and blocked stubs");

assert.equal(scoreDisplayContact({ isPrimary: true, isPayingPerson: true, communicationBilling: true }), 18);
{
  const all = listRankedDisplayParentsForLearner(learners[1].parents as any[]);
  assert.equal(all.length, 3);
  assert.equal(all[0].id, "p2b");
  assert.equal(all[1].id, "p2a");
  const single = rankDisplayParentsForLearner(learners[1].parents as any[]);
  assert.equal(single?.id, "p2b");
  assert.notEqual(all.length, 1);
}
console.log("✓ ranking: all contacts vs single OA pick");

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
  assert.equal(g3.rows[0].surname, "Able");
  assert.equal(g3.rows[0].name, "Ben");
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
  assert.notEqual(ableContacts.length, 1);
  const oaPick = rankDisplayParentsForLearner(learners[1].parents as any[]);
  assert.equal(oaPick?.id, "p2b");
  assert.ok(ableContacts.some((r) => r.parentId === "p2a"));
  assert.ok(ableContacts.some((r) => r.parentId === "p2c"));

  const pairs = ableContacts.map((r) => `${r.learnerId}:${r.parentId}`);
  assert.equal(new Set(pairs).size, pairs.length);

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
  assert.ok(rows.every((r) => (r.dob !== "—" ? r.age !== "—" : true)));
  const noDob = buildListRegisterRows(
    [{ ...learners[0], birthDate: null, dateOfBirth: null, dob: null, age: "99 years" }],
    def,
    baseControls
  ).rows[0];
  assert.equal(noDob.dob, "—");
  assert.equal(noDob.age, "—", "do not invent age from stale field");

  const byAge = buildListRegisterRows(learners, def, { ...baseControls, sort: "age" }).rows;
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

// ——— V3 ———

{
  for (const label of [
    "Allergies List",
    "Birthday Parent List",
    "Future Enrolled List",
    "Child List (6 Extra Fields)",
  ]) {
    const def = getListRegisterDefByLabel(label)!;
    assert.equal(def.status, "blocked_missing_data");
    assert.ok(def.blockedReason && def.blockedReason.length > 10);
    const built = buildListRegisterReport(def, baseControls, { learners });
    assert.equal(built.implemented, false);
    assert.equal(built.rows.length, 0);
    assert.equal(built.sections.length, 0);
    assert.equal(buildListRegisterCsv(def, built.sections, "X"), "");
  }
  console.log("✓ blocked defs return empty + no CSV");
}

{
  const def = getListRegisterDefByLabel("Birthday Employee List")!;
  assert.equal(def.entity, "employee");
  const march = buildListRegisterReport(def, { ...baseControls, month: "3", sort: "birthday" }, { employees });
  assert.equal(march.rows.length, 1);
  assert.equal(march.rows[0].employeeId, "e1");
  assert.equal(march.rows[0]._entity, "employee");
  assert.ok(!march.rows.some((r) => r._entity === "learner"));

  const all = buildListRegisterReport(def, { ...baseControls, sort: "birthday" }, { employees });
  assert.ok(all.sections.some((s) => s.label === "March"));
  assert.ok(all.sections.some((s) => s.label === "November"));
  assert.ok(!all.rows.some((r) => r.employeeId === "e-inactive"));

  assert.throws(() =>
    assertEmployeeDatasetNotLearners(def, { learners })
  );
  console.log("✓ Birthday Employee List month / grouping / rejects learner-only");
}

{
  const def = getListRegisterDefByLabel("Employee Contact List")!;
  assert.equal(def.entity, "employee");
  const { rows } = buildListRegisterReport(def, baseControls, { employees });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].surname, "Adams");
  assert.equal(rows.find((r) => r.employeeId === "e1")?.cellphone, "081111");
  assert.equal(rows.find((r) => r.employeeId === "e1")?.email, "nina@school.test");
  const office = buildListRegisterReport(def, { ...baseControls, department: "Office" }, { employees });
  assert.equal(office.rows.length, 1);
  assert.equal(office.rows[0].employeeId, "e2");
  const csv = buildListRegisterCsv(def, office.sections, "Test School");
  assert.ok(csv.includes("Omar"));
  assert.ok(!csv.includes("Ada"));
  console.log("✓ Employee Contact List / department filter / CSV");
}

{
  for (const [label, n] of [
    ["Block Sheet (5 Blocks)", 5],
    ["Block Sheet (10 Blocks)", 10],
    ["Block Sheet (20 Blocks)", 20],
  ] as const) {
    const def = getListRegisterDefByLabel(label)!;
    assert.equal(def.entity, "worksheet");
    assert.equal(def.exportCsv, false);
    assert.equal(def.blockCount, n);
    const built = buildListRegisterReport(def, baseControls, {});
    assert.equal(built.sections.length, n);
    assert.ok(built.sections.every((s) => s.rows.length === 0 && s.blockLines === 8));
    assert.equal(buildListRegisterCsv(def, built.sections, "X"), "");
  }
  console.log("✓ Block sheets exact block counts / CSV disabled");
}

{
  const def3 = getListRegisterDefByLabel("Child List (3 Extra Fields)")!;
  assert.equal(def3.status, "implemented");
  assert.equal(def3.extraFieldCount, 3);
  // Kid-e-Sys-aligned real fields — Age, Birth Date, Gender (not blank placeholders)
  assert.deepEqual(def3.columns.slice(-3), ["age", "dob", "gender"]);
  const withProfile: ListRegisterLearnerInput[] = [
    {
      ...learners[1],
      gender: "M",
    },
  ];
  const built3 = buildListRegisterRows(withProfile, def3, baseControls);
  assert.equal(built3.rows.length, 1);
  assert.ok(built3.rows[0].age && built3.rows[0].age !== "—");
  assert.equal(built3.rows[0].dob, "2016-11-02");
  assert.equal(built3.rows[0].gender, "M");
  const csv = buildListRegisterCsv(def3, built3.sections, "Test School");
  assert.ok(csv.includes("Gender"));
  assert.ok(csv.includes("Age"));
  assert.ok(csv.includes("DOB"));
  assert.ok(!csv.includes("Extra Field 1"));
  console.log("✓ Child List (3 Extra Fields) uses real Age/DOB/Gender");
}

{
  const def6 = getListRegisterDefByLabel("Child List (6 Extra Fields)")!;
  assert.equal(def6.status, "blocked_missing_data");
  assert.equal(def6.implemented, false);
  assert.ok(/enrolment date/i.test(def6.blockedReason || ""));
  assert.ok(!/schema/i.test(def6.blockedReason || ""));
  // Must not invent ID Number as a stand-in for Enrolment Date
  assert.ok(!def6.columns.includes("idNumber"));
  console.log("✓ Child List (6 Extra Fields) blocked — Enrolment Date not on learner");
}

{
  const def = getListRegisterDefByLabel("Group List")!;
  assert.equal(def.entity, "group-member");
  assert.equal(def.groupBy, "groupName");
  const { sections, rows } = buildListRegisterReport(def, baseControls, { groupMembers });
  assert.equal(rows.length, 3);
  assert.ok(sections.some((s) => s.label === "Chess Club" && s.count === 2));
  assert.ok(sections.some((s) => s.label === "Choir" && s.count === 1));
  const chess = buildListRegisterReport(def, { ...baseControls, group: "Chess Club" }, { groupMembers });
  assert.equal(chess.rows.length, 2);
  assert.ok(chess.rows.every((r) => r.groupName === "Chess Club"));
  // Group A with learners from different classrooms must both appear
  assert.equal(
    sections.find((s) => s.label === "Chess Club")!.rows.map((r) => r.classroom).sort().join(","),
    "Grade 3B,Grade 5A"
  );
  // Learner not in Choir must not appear under Choir
  const choir = sections.find((s) => s.label === "Choir")!;
  assert.equal(choir.rows.length, 1);
  assert.equal(choir.rows[0].learnerId, "l3");
  assert.ok(!choir.rows.some((r) => r.learnerId === "l1"));
  assert.ok(!choir.rows.some((r) => r.learnerId === "l2"));
  console.log("✓ Group List membership / group sections / filter");
}

{
  const def = getListRegisterDefByLabel("Incident List")!;
  assert.equal(def.entity, "incident");
  const { rows } = buildListRegisterReport(def, { ...baseControls, sort: "incidentDate" }, { incidents });
  assert.equal(rows.length, 2);
  assert.equal(rows[0]._entity, "incident");
  assert.equal(rows[0].incidentType, "Behaviour");
  assert.ok(rows.every((r) => r.summary && r.summary !== "—"));
  // Not a learner roster (no admission/account columns)
  assert.ok(!def.columns.includes("admissionNo"));
  assert.ok(!def.columns.includes("accountNo"));
  const classF = buildListRegisterReport(
    def,
    { ...baseControls, classroom: "Grade 5A" },
    { incidents }
  );
  assert.equal(classF.rows.length, 1);
  assert.equal(classF.rows[0].learnerId, "l1");
  // Learner with zero incidents must not invent an incident row
  const none = buildListRegisterReport(def, baseControls, {
    incidents: [],
    learners,
  });
  assert.equal(none.rows.length, 0);
  assert.ok(!none.rows.some((r) => r._entity === "learner"));
  console.log("✓ Incident List rows / class filter / not roster columns");
}

{
  const weekly = getListRegisterDefByLabel("Employee Attendance Register (Weekly)")!;
  const time = getListRegisterDefByLabel("Employee Attendance Time Register (Weekly)")!;
  assert.equal(weekly.entity, "employee");
  assert.equal(weekly.attendanceWindow, "weekly");
  assert.equal(weekly.includeWeekends, false);
  assert.equal(weekly.includeTimes, false);
  assert.equal(time.includeTimes, true);
  assert.ok(time.columns.includes("clockIn") && time.columns.includes("clockOut"));
  assert.ok(!weekly.columns.includes("clockIn"));

  const built = buildListRegisterReport(weekly, baseControls, { employeeAttendance: attendanceRows });
  assert.equal(built.rows.length, 2);
  assert.ok(built.rows.every((r) => r._entity === "employee"));
  assert.equal(built.rows.find((r) => r.employeeId === "e1")?.attendanceStatus, "Present");

  assert.throws(() =>
    assertEmployeeDatasetNotLearners(weekly, { learners })
  );

  const weekends = getListRegisterDefByLabel("Employee Attendance Register (Weekly) (Weekends)")!;
  assert.equal(weekends.includeWeekends, true);
  const monthly = getListRegisterDefByLabel("Employee Attendance Register (Monthly)")!;
  assert.equal(monthly.attendanceWindow, "monthly");
  console.log("✓ Employee attendance registers entity / times / reject learner-only");
}

console.log("\nAll buildListRegisterReport tests passed.");
