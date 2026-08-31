/**
 * School organisation lifecycle — unit tests (no DB, no production).
 * Run: npx tsx src/services/superAdmin/schoolLifecycle.test.ts
 */
import { isPlatformSuperAdminEmail } from "../../utils/superAdmin";
import {
  LITTLE_SCIENTISTS_SCHOOL_ID,
  PROTECTED_OPERATING_SCHOOL_IDS,
  SCHOOL_LIFECYCLE_STATUSES,
  SCHOOL_LIFECYCLE_UPDATE_KEYS,
  SchoolLifecycleError,
  assertLifecycleActor,
  assertProtectedOperatingSchoolLifecycle,
  buildLifecycleConfirmation,
  buildLifecycleSchoolUpdateData,
  countSchoolsByLifecycle,
  defaultLifecycleStatus,
  filterSchoolsByLifecycle,
  isProtectedOperatingSchoolId,
  isSchoolLifecycleStatus,
  needsLifecycleConfirmation,
  parseSchoolLifecycleStatus,
  resolveLifecycleTargetSchoolId,
} from "./schoolLifecycle";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function throws(fn: () => void, statusCode?: number, snippet?: string) {
  try {
    fn();
    throw new Error("expected throw");
  } catch (error) {
    if (error instanceof Error && error.message === "expected throw") throw error;
    assert(error instanceof SchoolLifecycleError, `expected SchoolLifecycleError, got ${String(error)}`);
    if (statusCode != null) {
      assert(error.statusCode === statusCode, `status ${error.statusCode} != ${statusCode}`);
    }
    if (snippet) {
      assert(error.message.includes(snippet), `message missing ${snippet}: ${error.message}`);
    }
  }
}

const DA_SILVA = "cmpideqeq0000108xb6ouv9zi";
const MBB = "cmq4xjckq00at60gqg4eb956h";
const FLY_EAGLE = "cmt1e8bjp0jo8lcjeketlynhl";

assert(SCHOOL_LIFECYCLE_STATUSES.join(",") === "ACTIVE,TRIAL,INACTIVE,ARCHIVED", "lifecycle enum order");
assert(isSchoolLifecycleStatus("ACTIVE"), "ACTIVE valid");
assert(isSchoolLifecycleStatus("TRIAL"), "TRIAL valid");
assert(isSchoolLifecycleStatus("INACTIVE"), "INACTIVE valid");
assert(isSchoolLifecycleStatus("ARCHIVED"), "ARCHIVED valid");
assert(!isSchoolLifecycleStatus("SUSPENDED"), "subscription SUSPENDED is not lifecycle");
assert(!isSchoolLifecycleStatus("PENDING_PAYMENT"), "subscription status is not lifecycle");

assert(defaultLifecycleStatus() === "ACTIVE", "default ACTIVE");
assert(parseSchoolLifecycleStatus(null) === "ACTIVE", "null backfill ACTIVE");
assert(parseSchoolLifecycleStatus(undefined) === "ACTIVE", "undefined backfill ACTIVE");
assert(parseSchoolLifecycleStatus("") === "ACTIVE", "empty backfill ACTIVE");
assert(parseSchoolLifecycleStatus("active") === "ACTIVE", "case normalize");
throws(() => parseSchoolLifecycleStatus("NOPE"), 400, "Invalid lifecycle status");

assert(PROTECTED_OPERATING_SCHOOL_IDS.includes(DA_SILVA), "Da Silva protected");
assert(PROTECTED_OPERATING_SCHOOL_IDS.includes(MBB), "MBB protected");
assert(PROTECTED_OPERATING_SCHOOL_IDS.includes(FLY_EAGLE), "Fly Eagle protected");
assert(!isProtectedOperatingSchoolId(LITTLE_SCIENTISTS_SCHOOL_ID), "Little Scientists not hard-protected");

assertProtectedOperatingSchoolLifecycle(DA_SILVA, "ACTIVE");
assertProtectedOperatingSchoolLifecycle(LITTLE_SCIENTISTS_SCHOOL_ID, "ARCHIVED");

throws(() => assertProtectedOperatingSchoolLifecycle(DA_SILVA, "ARCHIVED"), 403);
throws(() => assertProtectedOperatingSchoolLifecycle(DA_SILVA, "INACTIVE"), 403);
throws(() => assertProtectedOperatingSchoolLifecycle(DA_SILVA, "TRIAL"), 403);
throws(() => assertProtectedOperatingSchoolLifecycle(MBB, "ARCHIVED"), 403);
throws(() => assertProtectedOperatingSchoolLifecycle(MBB, "INACTIVE"), 403);
throws(() => assertProtectedOperatingSchoolLifecycle(FLY_EAGLE, "ARCHIVED"), 403);
throws(() => assertProtectedOperatingSchoolLifecycle(FLY_EAGLE, "INACTIVE"), 403);

throws(() => assertLifecycleActor(null), 403, "Super admin");
throws(() => assertLifecycleActor({ email: "owner@school.co.za" }), 403, "Super admin");
throws(() => assertLifecycleActor({ email: "maria@example.com" }), 403, "Super admin");
assertLifecycleActor({ email: "info@educlear.co.za" });
assertLifecycleActor({ email: "  Info@EduClear.co.za  " });
assert(isPlatformSuperAdminEmail("info@educlear.co.za") === true, "super admin email allowed");
assert(isPlatformSuperAdminEmail("owner@school.co.za") === false, "unauthorized email rejected");

const target = resolveLifecycleTargetSchoolId(LITTLE_SCIENTISTS_SCHOOL_ID, undefined);
assert(target === LITTLE_SCIENTISTS_SCHOOL_ID, "params schoolId");
assert(
  resolveLifecycleTargetSchoolId(LITTLE_SCIENTISTS_SCHOOL_ID, LITTLE_SCIENTISTS_SCHOOL_ID) ===
    LITTLE_SCIENTISTS_SCHOOL_ID,
  "matching body schoolId allowed"
);
throws(
  () => resolveLifecycleTargetSchoolId(LITTLE_SCIENTISTS_SCHOOL_ID, DA_SILVA),
  400,
  "schoolId mismatch"
);
throws(() => resolveLifecycleTargetSchoolId("", DA_SILVA), 400, "Missing schoolId");

const jwtSchoolIdIgnored = resolveLifecycleTargetSchoolId(LITTLE_SCIENTISTS_SCHOOL_ID, undefined);
assert(jwtSchoolIdIgnored !== "cmpi5au4l0000139v0da3jpvc", "target is not platform tenant spoof");

const rows = [
  { id: "a", lifecycleStatus: "ACTIVE" as const, name: "A" },
  { id: "b", lifecycleStatus: "TRIAL" as const, name: "B" },
  { id: "c", lifecycleStatus: "INACTIVE" as const, name: "C" },
  { id: "d", lifecycleStatus: "ARCHIVED" as const, name: "D" },
  { id: "e", lifecycleStatus: "ACTIVE" as const, name: "E" },
];
const counts = countSchoolsByLifecycle(rows);
assert(counts.total === 5 && counts.active === 2 && counts.trial === 1, "counts");
assert(counts.inactive === 1 && counts.archived === 1, "inactive/archived counts");
assert(filterSchoolsByLifecycle(rows, "ACTIVE").map((s) => s.id).join() === "a,e", "Active filter");
assert(filterSchoolsByLifecycle(rows, "TRIAL").map((s) => s.id).join() === "b", "Trial filter");
assert(filterSchoolsByLifecycle(rows, "INACTIVE").map((s) => s.id).join() === "c", "Inactive filter");
assert(filterSchoolsByLifecycle(rows, "ARCHIVED").map((s) => s.id).join() === "d", "Archived filter");
assert(filterSchoolsByLifecycle(rows, "all").length === 5, "All filter");

assert(needsLifecycleConfirmation("ACTIVE", "TRIAL") === false, "ACTIVE→TRIAL no extra confirm");
assert(needsLifecycleConfirmation("TRIAL", "ACTIVE") === false, "TRIAL→ACTIVE no extra confirm");
assert(needsLifecycleConfirmation("ACTIVE", "INACTIVE") === false, "ACTIVE→INACTIVE no extra confirm");
assert(needsLifecycleConfirmation("ACTIVE", "ARCHIVED") === true, "ACTIVE→ARCHIVED confirm");
assert(needsLifecycleConfirmation("ARCHIVED", "ACTIVE") === true, "ARCHIVED→ACTIVE confirm");
assert(needsLifecycleConfirmation("ARCHIVED", "ARCHIVED") === false, "same status no confirm");

const archiveCopy = buildLifecycleConfirmation({
  schoolName: "Little Scientists Lab Club",
  from: "ACTIVE",
  to: "ARCHIVED",
});
assert(archiveCopy.title === "Archive Little Scientists Lab Club?", "archive title");
assert(archiveCopy.message.includes("Current status: ACTIVE"), "archive current");
assert(archiveCopy.message.includes("New status: ARCHIVED"), "archive new");
assert(archiveCopy.message.includes("records will be preserved"), "archive preserve");
assert(archiveCopy.message.includes("No learners, invoices, payments"), "archive financial");

const reactivateCopy = buildLifecycleConfirmation({
  schoolName: "Little Scientists Lab Club",
  from: "ARCHIVED",
  to: "ACTIVE",
});
assert(reactivateCopy.title === "Reactivate Little Scientists Lab Club?", "reactivate title");
assert(reactivateCopy.message.includes("Current status: ARCHIVED"), "reactivate current");
assert(reactivateCopy.message.includes("New status: ACTIVE"), "reactivate new");

const data = buildLifecycleSchoolUpdateData({
  lifecycleStatus: "ARCHIVED",
  actorUserId: "user-1",
  actorEmail: "info@educlear.co.za",
  changedAt: new Date("2026-08-31T10:00:00.000Z"),
});
assert(
  Object.keys(data).sort().join(",") === [...SCHOOL_LIFECYCLE_UPDATE_KEYS].slice().sort().join(","),
  "update keys only lifecycle fields"
);
assert(!("learners" in data) && !("invoices" in data) && !("payments" in data), "no financial keys");
assert(!("balance" in data) && !("credits" in data), "no balance/credit keys");

type Tenant = {
  lifecycleStatus: "ACTIVE" | "TRIAL" | "INACTIVE" | "ARCHIVED";
  learners: number;
  parents: number;
  users: number;
  familyAccounts: number;
  invoices: number;
  payments: number;
  ledgerRows: number;
  balanceCents: number;
  credits: number;
  attendance: number;
  payrollRows: number;
};
const preserved: Tenant = {
  lifecycleStatus: "ACTIVE",
  learners: 12,
  parents: 8,
  users: 3,
  familyAccounts: 7,
  invoices: 40,
  payments: 15,
  ledgerRows: 90,
  balanceCents: 125000,
  credits: 500,
  attendance: 200,
  payrollRows: 6,
};
const snapshot = { ...preserved };
Object.assign(preserved, buildLifecycleSchoolUpdateData({
  lifecycleStatus: "ARCHIVED",
  actorUserId: "user-1",
  actorEmail: "info@educlear.co.za",
}));
assert(preserved.lifecycleStatus === "ARCHIVED", "archived classification");
assert(preserved.learners === snapshot.learners, "learners preserved");
assert(preserved.parents === snapshot.parents, "parents preserved");
assert(preserved.users === snapshot.users, "users preserved");
assert(preserved.familyAccounts === snapshot.familyAccounts, "family accounts preserved");
assert(preserved.invoices === snapshot.invoices, "invoices preserved");
assert(preserved.payments === snapshot.payments, "payments preserved");
assert(preserved.ledgerRows === snapshot.ledgerRows, "ledger preserved");
assert(preserved.balanceCents === snapshot.balanceCents, "balances preserved");
assert(preserved.credits === snapshot.credits, "credits preserved");
assert(preserved.attendance === snapshot.attendance, "attendance preserved");
assert(preserved.payrollRows === snapshot.payrollRows, "payroll preserved");
assert(preserved.invoices - snapshot.invoices === 0, "financial records 0");
assert(preserved.balanceCents - snapshot.balanceCents === 0, "financial amount 0");

const transitions: Array<["ACTIVE" | "TRIAL" | "INACTIVE" | "ARCHIVED", "ACTIVE" | "TRIAL" | "INACTIVE" | "ARCHIVED"]> = [
  ["ACTIVE", "TRIAL"],
  ["TRIAL", "ACTIVE"],
  ["ACTIVE", "INACTIVE"],
  ["ACTIVE", "ARCHIVED"],
  ["ARCHIVED", "ACTIVE"],
];
for (const [from, to] of transitions) {
  const parsedTo = parseSchoolLifecycleStatus(to);
  assert(parsedTo === to, `transition ${from}→${to}`);
}

console.log("SCHOOL LIFECYCLE UNIT TESTS PASS");
