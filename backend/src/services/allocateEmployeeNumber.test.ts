/**
 * Employee-number allocator unit tests (no database writes to existing schools).
 * Run: npx tsx src/services/allocateEmployeeNumber.test.ts
 */
import {
  computeNextEmployeeNumber,
  createEmployeeAllocatingNumber,
  formatEmployeeNumber,
  isAutoAssignEmployeeNumberRequest,
  isEmployeeNumberUniqueCollision,
  parseEmployeeNumberSequence,
} from "./allocateEmployeeNumber";
import { Prisma } from "@prisma/client";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function p2002(target: unknown): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "5.0.0",
    ...(target === undefined ? {} : { meta: { target } }),
  });
}

assert(formatEmployeeNumber(1) === "EMP001", "1 → EMP001");
assert(formatEmployeeNumber(2) === "EMP002", "2 → EMP002");
assert(formatEmployeeNumber(8) === "EMP008", "8 → EMP008");
assert(formatEmployeeNumber(10) === "EMP0010", "10 → EMP0010");
assert(formatEmployeeNumber(63) === "EMP0063", "63 → EMP0063");
assert(formatEmployeeNumber(64) === "EMP0064", "64 → EMP0064");
assert(formatEmployeeNumber(100) === "EMP00100", "100 → EMP00100");

assert(parseEmployeeNumberSequence("EMP002") === 2, "parse EMP002");
assert(parseEmployeeNumberSequence("EMP008") === 8, "parse EMP008");
assert(parseEmployeeNumberSequence("EMP0010") === 10, "parse EMP0010");
assert(parseEmployeeNumberSequence("EMP0063") === 63, "parse EMP0063");
assert(parseEmployeeNumberSequence(" emp0064 ") === 64, "parse trim/case");
assert(parseEmployeeNumberSequence("MBB-STAFF-F883D366") === null, "legacy MBB ignored");
assert(parseEmployeeNumberSequence("EMPABS01") === null, "legacy EMPABS ignored");
assert(parseEmployeeNumberSequence("DEM-TCH-1") === null, "demo ignored");
assert(parseEmployeeNumberSequence("C566029") === null, "fixture ignored");
assert(parseEmployeeNumberSequence("") === null, "blank ignored");
assert(parseEmployeeNumberSequence(null) === null, "null ignored");

assert(computeNextEmployeeNumber([]) === "EMP001", "first number when empty");
assert(computeNextEmployeeNumber([null, "", "  "]) === "EMP001", "blank occupied ignored");

assert(
  computeNextEmployeeNumber(["EMP002", "EMP008", "EMP0010", "EMP0063"]) === "EMP0064",
  "Da Silva-style max 63 → EMP0064"
);
assert(
  computeNextEmployeeNumber(["EMP002", "EMP008", "EMP0010", "EMP0063", "EMP0064"]) === "EMP0065",
  "does not reuse EMP0064"
);
assert(
  computeNextEmployeeNumber(["EMP001", "EMP003", "EMP0063"]) === "EMP0064",
  "historic gaps are not filled"
);

const unchanged = ["EMP002", "EMP008", "EMP0010", "EMP0063"];
computeNextEmployeeNumber(unchanged);
assert(unchanged.join(",") === "EMP002,EMP008,EMP0010,EMP0063", "occupied input not mutated");

assert(
  computeNextEmployeeNumber(["EMP001"]) === "EMP002",
  "school-local sequence starts from existing EMP numbers only"
);

assert(
  computeNextEmployeeNumber(["MBB-STAFF-AAAA", "EMPABS01", "DEM-TCH-1"]) === "EMP001",
  "legacy non-EMP00 numbers do not crash and do not set the sequence"
);

assert(
  computeNextEmployeeNumber(["EMP0063", "MBB-STAFF-F883D366", "EMPABS B1"]) === "EMP0064",
  "legacy occupied records skipped for sequencing"
);

assert(isAutoAssignEmployeeNumberRequest({ autoAssignEmployeeNumber: true }) === true, "flag true");
assert(isAutoAssignEmployeeNumberRequest({ autoAssignEmployeeNumber: false }) === false, "flag false");
assert(isAutoAssignEmployeeNumberRequest({ autoAssignEmployeeNumber: "true" }) === false, 'flag "true" string');
assert(isAutoAssignEmployeeNumberRequest({ autoAssignEmployeeNumber: 1 }) === false, "flag 1");
assert(isAutoAssignEmployeeNumberRequest({ autoAssignEmployeeNumber: {} }) === false, "flag {}");
assert(isAutoAssignEmployeeNumberRequest({ autoAssignEmployeeNumber: "True" }) === false, 'flag "True"');
assert(isAutoAssignEmployeeNumberRequest({ autoAssignEmployeeNumber: null }) === false, "flag null");
assert(isAutoAssignEmployeeNumberRequest({ employeeNumber: "EMP0099" }) === false, "missing flag");
assert(isAutoAssignEmployeeNumberRequest(null) === false, "null body");
assert(isAutoAssignEmployeeNumberRequest(undefined) === false, "undefined body");

const employeeNumberP2002 = p2002(["schoolId", "employeeNumber"]);
assert(isEmployeeNumberUniqueCollision(employeeNumberP2002), "P2002 employeeNumber is a collision");
assert(
  isEmployeeNumberUniqueCollision(p2002("Employee_schoolId_employeeNumber_key")),
  "P2002 constraint name is a collision"
);
assert(!isEmployeeNumberUniqueCollision(p2002(["userId"])), "userId P2002 is not an employee-number collision");
assert(!isEmployeeNumberUniqueCollision(p2002(undefined)), "P2002 with missing target is not retried");
assert(!isEmployeeNumberUniqueCollision(new Error("nope")), "generic error is not a collision");

async function runAsyncTests() {
  const occupied: string[] = [];
  const createCalls: string[] = [];
  const retryDb = {
    employee: {
      findMany: async () => occupied.map((employeeNumber) => ({ employeeNumber })),
      create: async ({ data }: { data: { employeeNumber?: string | null } }) => {
        const assigned = String(data.employeeNumber || "");
        createCalls.push(assigned);
        if (createCalls.length === 1) {
          occupied.push("EMP001");
          throw employeeNumberP2002;
        }
        return { id: "created-2", employeeNumber: assigned };
      },
    },
  };

  const created = (await createEmployeeAllocatingNumber(
    "school-retry",
    { firstName: "Race", lastName: "Two", schoolId: "school-retry" },
    retryDb as never
  )) as { employeeNumber?: string };

  assert(createCalls.length === 2, "retry performs a second create");
  assert(createCalls[0] === "EMP001", "first attempt used EMP001");
  assert(createCalls[1] === "EMP002", "after P2002 re-read, second candidate is EMP002");
  assert(created.employeeNumber === "EMP002", "successful create returns EMP002");

  let userIdCreates = 0;
  const userIdP2002 = p2002(["userId"]);
  try {
    await createEmployeeAllocatingNumber(
      "school-userid",
      { firstName: "No", lastName: "Retry", schoolId: "school-userid" },
      {
        employee: {
          findMany: async () => [],
          create: async () => {
            userIdCreates += 1;
            throw userIdP2002;
          },
        },
      } as never
    );
    throw new Error("userId P2002 should have been rethrown");
  } catch (error) {
    assert(error === userIdP2002, "non-employee-number P2002 is propagated");
    assert(userIdCreates === 1, "non-employee-number P2002 is not retried");
  }

  console.log("✓ allocateEmployeeNumber unit tests passed");
}

runAsyncTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
