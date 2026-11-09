/**
 * FINAL Email → All Parents verification contract.
 * Source locks + mocked Load Contacts → Compose → Confirm Send.
 * Does NOT send live email. Does NOT deploy.
 *
 * Run: npx tsx src/communication/emailAllParentsVerification.contract.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  areAllSelected,
  filterEligibleParentsByClasses,
  pruneSelectedIds,
  selectAllClassNames,
  toggleClassSelection,
  uniqueSelectedEmailRecipients,
} from "./emailAllParentsSelection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (name: string) => fs.readFileSync(path.join(__dirname, name), "utf8");

type Contact = {
  id: string;
  contactName: string;
  email: string;
  classNames: string[];
};

const ACTIVE_CLASSES = ["Grade R A", "Grade 1 B", "Grade 2 C", "Grade 3 D"];

const LOADED_CONTACTS: Contact[] = [
  { id: "c1", contactName: "Shared Parent", email: "shared@family.test", classNames: ["Grade R A", "Grade 1 B"] },
  { id: "c2", contactName: "R Only", email: "r-only@family.test", classNames: ["Grade R A"] },
  { id: "c3", contactName: "One Only", email: "one-only@family.test", classNames: ["Grade 1 B"] },
  { id: "c4", contactName: "Two Only", email: "two-only@family.test", classNames: ["Grade 2 C"] },
  { id: "c5", contactName: "Missing Email", email: "", classNames: ["Grade R A"] },
  { id: "c6", contactName: "Bad Email", email: "not-valid", classNames: ["Grade 3 D"] },
  { id: "c7", contactName: "Three Only", email: "three-only@family.test", classNames: ["Grade 3 D"] },
];

/** Mirrors Email.tsx applySelectedClasses */
function applySelectedClasses(
  contacts: Contact[],
  nextClasses: string[],
  selectedIds: string[],
  selectAllParents: boolean
) {
  const eligible = filterEligibleParentsByClasses(contacts, nextClasses);
  const eligibleIds = eligible.map((c) => c.id);
  const nextSelected = selectAllParents ? eligibleIds : pruneSelectedIds(selectedIds, eligibleIds);
  return { selectedClassNames: nextClasses, selectedContactIds: nextSelected, eligible };
}

/** Mirrors Email.tsx finalRecipients for all_parents + handleSend payloadContacts */
function outgoingRecipients(contacts: Contact[], selectedClassNames: string[], selectedContactIds: string[]) {
  const eligible = filterEligibleParentsByClasses(contacts, selectedClassNames);
  return uniqueSelectedEmailRecipients(eligible, selectedContactIds);
}

function assertSourceLocks() {
  const emailUi = read("Email.tsx");
  const helpers = read("emailAllParentsSelection.ts");
  const api = read("communicationApi.ts");
  const audience = read("communicationAudience.ts");

  assert.match(emailUi, /from "\.\/emailAllParentsSelection"/, "Email imports selection helpers");
  assert.match(emailUi, /Select All Classes/, "Select All Classes UI present");
  assert.match(emailUi, /Select All Parents/, "Select All Parents UI present");
  assert.match(emailUi, /selectAllClassNames\(classFilters\)/, "Select All Classes uses full classFilters");
  assert.match(emailUi, /applySelectedClasses\(next, allEligibleParentsSelected\)/, "Class toggle updates parents");
  assert.match(emailUi, /uniqueSelectedEmailRecipients\(/, "finalRecipients uses uniqueSelectedEmailRecipients");
  assert.match(emailUi, /const payloadContacts = finalRecipients/, "Send payload uses finalRecipients");
  assert.match(emailUi, /contacts: payloadContacts/, "Create/update email saves finalRecipients only");
  assert.match(emailUi, /sendEmail\(schoolId, saved\.id, audiencePayload\)/, "Existing sendEmail path retained");
  assert.match(emailUi, /isSchoolAdmin \? <option value="all_parents">All Parents<\/option>/, "All Parents admin-gated");
  assert.match(
    emailUi,
    /Teachers may only message parents of their assigned classrooms/,
    "Teacher all_parents blocked client-side"
  );
  assert.equal(/sendEmail\([\s\S]*finalRecipients/.test(emailUi) || /payloadContacts = finalRecipients/.test(emailUi), true);

  assert.match(helpers, /Select All Classes always uses the full active class list/, "Helper documents full-list Select All");
  assert.match(helpers, /isEligibleParentEmail/, "Invalid emails excluded");
  assert.match(api, /staffAuthHeaders\(\)/, "communication API authenticated");
  assert.match(audience, /isCommunicationSchoolAdmin/, "Admin gate helper present");
  assert.equal(/deploy|production|Da Silva/i.test(emailUi), false, "No production deploy hooks in Email.tsx");
}

function testSelectAllClassesAndParents() {
  const allClasses = selectAllClassNames(ACTIVE_CLASSES);
  assert.equal(allClasses.length, 4, "Select All Classes includes every active class");
  assert.deepEqual(allClasses, ACTIVE_CLASSES);

  const afterClasses = applySelectedClasses(LOADED_CONTACTS, allClasses, [], false);
  assert.equal(afterClasses.eligible.length, 5, "Eligible excludes invalid/missing emails");

  const afterParents = applySelectedClasses(LOADED_CONTACTS, allClasses, [], true);
  assert.equal(areAllSelected(afterParents.selectedContactIds, afterParents.eligible.map((c) => c.id)), true);
  const outgoing = outgoingRecipients(LOADED_CONTACTS, afterParents.selectedClassNames, afterParents.selectedContactIds);
  assert.equal(outgoing.length, 5, "Select All Parents → 5 unique emails");
  assert.deepEqual(
    outgoing.map((c) => c.email).sort(),
    [
      "one-only@family.test",
      "r-only@family.test",
      "shared@family.test",
      "three-only@family.test",
      "two-only@family.test",
    ]
  );
}

function testIndividualClassAndParentToggles() {
  let selectedClasses: string[] = [];
  let selectedIds: string[] = [];

  selectedClasses = toggleClassSelection(selectedClasses, "Grade R A", true);
  ({ selectedClassNames: selectedClasses, selectedContactIds: selectedIds } = applySelectedClasses(
    LOADED_CONTACTS,
    selectedClasses,
    selectedIds,
    false
  ));
  assert.deepEqual(
    filterEligibleParentsByClasses(LOADED_CONTACTS, selectedClasses).map((c) => c.id),
    ["c1", "c2"]
  );

  selectedIds = ["c2"];
  let outgoing = outgoingRecipients(LOADED_CONTACTS, selectedClasses, selectedIds);
  assert.equal(outgoing.length, 1);
  assert.equal(outgoing[0].email, "r-only@family.test");

  selectedClasses = toggleClassSelection(selectedClasses, "Grade 1 B", true);
  ({ selectedClassNames: selectedClasses, selectedContactIds: selectedIds } = applySelectedClasses(
    LOADED_CONTACTS,
    selectedClasses,
    selectedIds,
    false
  ));
  assert.deepEqual(selectedIds, ["c2"], "Adding a class does not auto-select new parents");
  assert.deepEqual(
    filterEligibleParentsByClasses(LOADED_CONTACTS, selectedClasses).map((c) => c.id),
    ["c1", "c2", "c3"]
  );

  selectedIds = ["c1", "c2", "c3"];
  outgoing = outgoingRecipients(LOADED_CONTACTS, selectedClasses, selectedIds);
  assert.equal(outgoing.length, 3, "Shared parent still one unique email");

  selectedClasses = toggleClassSelection(selectedClasses, "Grade R A", false);
  ({ selectedClassNames: selectedClasses, selectedContactIds: selectedIds } = applySelectedClasses(
    LOADED_CONTACTS,
    selectedClasses,
    selectedIds,
    false
  ));
  assert.deepEqual(selectedClasses, ["Grade 1 B"]);
  assert.deepEqual(selectedIds.sort(), ["c1", "c3"], "Deselect class removes R-only parent from selection");
  outgoing = outgoingRecipients(LOADED_CONTACTS, selectedClasses, selectedIds);
  assert.equal(outgoing.length, 2);
  assert.equal(
    outgoing.some((c) => c.email === "r-only@family.test"),
    false,
    "Excluded class parent not in outgoing list"
  );
}

function testClassChangePrunesOutgoingList() {
  const allClasses = selectAllClassNames(ACTIVE_CLASSES);
  let state = applySelectedClasses(LOADED_CONTACTS, allClasses, [], true);
  assert.equal(outgoingRecipients(LOADED_CONTACTS, state.selectedClassNames, state.selectedContactIds).length, 5);

  const withoutGrade2 = allClasses.filter((name) => name !== "Grade 2 C");
  state = applySelectedClasses(LOADED_CONTACTS, withoutGrade2, state.selectedContactIds, true);
  const outgoing = outgoingRecipients(LOADED_CONTACTS, state.selectedClassNames, state.selectedContactIds);
  assert.equal(outgoing.some((c) => c.email === "two-only@family.test"), false);
  assert.equal(outgoing.length, 4, "Recipient count updates immediately after class deselect");
}

async function testMockedLoadComposeConfirmSend() {
  let liveSendCalls = 0;
  const mockCreateEmail = async (payload: { schoolId: string; contacts: Contact[] }) => {
    assert.equal(payload.schoolId, "school-test-a");
    return { email: { id: "email-draft-1", contacts: payload.contacts } };
  };
  const mockSendEmail = async (schoolId: string, id: string, _audience: unknown, contactsOnRecord: Contact[]) => {
    liveSendCalls += 1;
    assert.equal(schoolId, "school-test-a");
    assert.equal(id, "email-draft-1");
    // Mocked send: capture recipients, do not deliver
    return { success: true, emailBalance: 99, capturedContacts: contactsOnRecord, simulated: true as const };
  };

  // Load Contacts (all_parents): select all classes + all eligible parents
  const loaded = LOADED_CONTACTS;
  const activeClasses = selectAllClassNames(ACTIVE_CLASSES);
  let selectedClassNames = activeClasses;
  let selectedContactIds = filterEligibleParentsByClasses(loaded, activeClasses).map((c) => c.id);

  // Deselect Grade 3 D and one individual parent before compose send
  selectedClassNames = toggleClassSelection(selectedClassNames, "Grade 3 D", false);
  ({ selectedClassNames, selectedContactIds } = applySelectedClasses(
    loaded,
    selectedClassNames,
    selectedContactIds,
    false
  ));
  selectedContactIds = selectedContactIds.filter((id) => id !== "c2");

  const finalRecipients = outgoingRecipients(loaded, selectedClassNames, selectedContactIds);
  assert.equal(finalRecipients.length, 3);
  assert.deepEqual(
    finalRecipients.map((c) => c.email).sort(),
    ["one-only@family.test", "shared@family.test", "two-only@family.test"]
  );

  // Compose → Confirm Send (mocked)
  const saved = await mockCreateEmail({ schoolId: "school-test-a", contacts: finalRecipients });
  assert.equal(saved.email.contacts.length, finalRecipients.length, "Saved draft contact count matches UI count");
  assert.deepEqual(
    saved.email.contacts.map((c) => c.email.toLowerCase()).sort(),
    finalRecipients.map((c) => c.email.toLowerCase()).sort(),
    "Saved contacts are exactly the unique outgoing set"
  );

  const sendResult = await mockSendEmail("school-test-a", saved.email.id, { audience: "all_parents" }, saved.email.contacts);
  assert.equal(sendResult.simulated, true);
  assert.equal(sendResult.capturedContacts.length, 3);
  assert.equal(liveSendCalls, 1, "Mock send invoked once");
  assert.equal(
    sendResult.capturedContacts.length,
    finalRecipients.length,
    "Recipient count matches emails passed to send process"
  );
}

function testTenantIsolationGuardsPresent() {
  const emailUi = read("Email.tsx");
  const api = read("communicationApi.ts");
  assert.match(api, /schoolId=\$\{encodeURIComponent\(schoolId\)\}/, "Email list scoped by schoolId");
  assert.match(api, /body: JSON\.stringify\(\{ schoolId/, "Send body includes schoolId");
  assert.match(emailUi, /fetchCommunicationContacts\(\{[\s\S]*schoolId,/, "Contacts load passes schoolId");
  assert.match(emailUi, /audience: "all_parents"|audience: audienceMode/, "Audience mode sent to API");
}

async function main() {
  assertSourceLocks();
  testSelectAllClassesAndParents();
  testIndividualClassAndParentToggles();
  testClassChangePrunesOutgoingList();
  await testMockedLoadComposeConfirmSend();
  testTenantIsolationGuardsPresent();
  console.log("emailAllParentsVerification.contract.test.ts: PASS (no live email sent)");
}

void main();
