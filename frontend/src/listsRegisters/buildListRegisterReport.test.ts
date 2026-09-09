/**
 * Lists & Registers Phase 1 builders / catalogue.
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
  type ListRegisterControls,
  type ListRegisterLearnerInput,
} from "./buildListRegisterReport";
import { scoreDisplayContact } from "./displayContactRanking";

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
        homeAddress: "",
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
    ],
  },
  {
    id: "l3",
    firstName: "Cara",
    surname: "Able",
    grade: "Grade 3",
    classroom: "Grade 3B",
    status: "Enrolled",
    accountRef: "ABL001",
    birthDate: "2015-03-01",
    parents: [],
  },
];

assert.equal(PHASE1_LIST_REGISTER_DEFS.length, 6);
assert.ok(PHASE1_LIST_REGISTER_DEFS.every((d) => d.implemented));
assert.ok(UNIMPLEMENTED_LIST_REGISTER_LABELS.length >= 10);
assert.equal(getListRegisterDefByLabel("Child List")?.id, "child-list");
assert.equal(getListRegisterDefByLabel("Allergies List")?.implemented, false);
console.log("✓ catalogue IDs and unimplemented stubs");

assert.equal(scoreDisplayContact({ isPrimary: true, isPayingPerson: true, communicationBilling: true }), 18);
console.log("✓ FE contact scoring weights");

{
  const def = getListRegisterDefByLabel("Child List")!;
  const { rows } = buildListRegisterRows(learners, def, { ...baseControls, sort: "surname" });
  assert.equal(rows.length, 3);
  assert.deepEqual(def.columns, ["accountNo", "surname", "name", "grade", "classroom", "status"]);
  assert.equal(rows[0].surname, "Able");
  assert.equal(rows[0].accountNo, "ABA001"); // dedicated wins
  assert.equal(rows[2].accountNo, "ZEP001");
  const byName = buildListRegisterRows(learners, def, { ...baseControls, sort: "name" }).rows;
  assert.equal(byName[0].name, "Ada");
  const filtered = buildListRegisterRows(learners, def, {
    ...baseControls,
    classroom: "Grade 3B",
  }).rows;
  assert.equal(filtered.length, 2);
  console.log("✓ Child List columns/sort/filter");
}

{
  const def = getListRegisterDefByLabel("Class List")!;
  const { sections } = buildListRegisterRows(learners, def, baseControls);
  assert.ok(sections.length >= 2);
  assert.ok(sections.every((s) => s.count === s.rows.length));
  const one = buildListRegisterRows(learners, def, { ...baseControls, classroom: "Grade 5A" });
  assert.equal(one.rows.length, 1);
  assert.equal(one.sections.length, 1);
  console.log("✓ Class List grouping / class filter");
}

{
  const def = getListRegisterDefByLabel("Contact List")!;
  const { rows } = buildListRegisterRows(learners, def, baseControls);
  const able = rows.find((r) => r.learnerId === "l2")!;
  assert.equal(able.guardian, "Primary Able");
  assert.equal(able.cellphone, "086666");
  assert.equal(able.alternate, "077888");
  assert.equal(rows.filter((r) => r.learnerId === "l2").length, 1);
  const childCols = getListRegisterDefByLabel("Child List")!.columns.join(",");
  assert.notEqual(def.columns.join(","), childCols);
  console.log("✓ Contact List ranking / one row / distinct columns");
}

{
  const def = getListRegisterDefByLabel("Address List")!;
  const { rows } = buildListRegisterRows(learners, def, baseControls);
  assert.equal(rows.find((r) => r.learnerId === "l1")?.address, "1 Main Rd");
  assert.equal(rows.find((r) => r.learnerId === "l3")?.address, "—");
  const has = buildListRegisterRows(learners, def, { ...baseControls, hasAddress: "yes" }).rows;
  assert.ok(has.every((r) => r.address !== "—"));
  console.log("✓ Address List / has-address filter");
}

{
  const def = getListRegisterDefByLabel("Age List")!;
  const { rows } = buildListRegisterRows(learners, def, { ...baseControls, sort: "dob" });
  assert.ok(def.columns.includes("dob") && def.columns.includes("age"));
  assert.equal(rows[0]._dobIso <= rows[1]._dobIso, true);
  const noDob = buildListRegisterRows(
    [{ ...learners[0], birthDate: null, dateOfBirth: null, dob: null, age: "-" }],
    def,
    baseControls
  ).rows[0];
  assert.equal(noDob.dob, "—");
  assert.equal(noDob.age, "—");
  console.log("✓ Age List DOB sort / missing DOB");
}

{
  const def = getListRegisterDefByLabel("Birthday Child List")!;
  const march = buildListRegisterRows(learners, def, { ...baseControls, month: "3", sort: "birthday" });
  assert.equal(march.rows.length, 2);
  assert.equal(march.rows[0]._birthdayKey <= march.rows[1]._birthdayKey, true);
  const ageOrder = buildListRegisterRows(learners, getListRegisterDefByLabel("Age List")!, {
    ...baseControls,
    sort: "dob",
  }).rows.map((r) => r.learnerId);
  const bdayOrder = buildListRegisterRows(learners, def, {
    ...baseControls,
    sort: "birthday",
  }).rows.map((r) => r.learnerId);
  assert.notDeepEqual(ageOrder, bdayOrder);
  console.log("✓ Birthday month filter / month-day order ≠ age order");
}

{
  const child = getListRegisterDefByLabel("Child List")!;
  const contact = getListRegisterDefByLabel("Contact List")!;
  const { sections: childSec } = buildListRegisterRows(learners, child, baseControls);
  const { sections: contactSec } = buildListRegisterRows(learners, contact, baseControls);
  const childCsv = buildListRegisterCsv(child, childSec, "Test School");
  const contactCsv = buildListRegisterCsv(contact, contactSec, "Test School");
  assert.ok(childCsv.includes("Account No"));
  assert.ok(childCsv.includes("Surname"));
  assert.ok(contactCsv.includes("Guardian"));
  assert.ok(contactCsv.includes("Cellphone"));
  assert.ok(!childCsv.split("\n").find((l) => l.startsWith('"Guardian"')));
  console.log("✓ CSV headers match report columns");
}

console.log("\nAll buildListRegisterReport tests passed.");
