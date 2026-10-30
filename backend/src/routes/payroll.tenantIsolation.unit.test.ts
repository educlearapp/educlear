/**
 * Payroll employee cross-tenant create guard + module-gate mismatch coverage pointer.
 * SCHOOL_MISMATCH on /employees/:schoolId is covered by requireSchoolModule.unit.test.ts.
 * Run: ../frontend/node_modules/.bin/tsx src/routes/payroll.tenantIsolation.unit.test.ts
 */
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";

const SCHOOL_A = "school-a-tenant-isolation-aaa";
const SCHOOL_B = "school-b-tenant-isolation-bbb";
const FOREIGN_EMP_ID = "clforeignxxxxxxxxxxxxxxxxx01";

async function main() {
  const employees = new Map<string, { id: string; schoolId: string }>([
    [FOREIGN_EMP_ID, { id: FOREIGN_EMP_ID, schoolId: SCHOOL_B }],
  ]);

  const app = express();
  app.use(express.json());

  // Mirrors backend/src/routes/payroll.ts POST /employee cross-tenant guard.
  app.post("/api/payroll/employee", async (req, res) => {
    const schoolId = String(req.body?.schoolId || "").trim();
    if (!schoolId) return res.status(400).json({ error: "schoolId is required" });

    const clientEmployeeId = String(req.body?.id || "").trim();
    if (clientEmployeeId.length >= 20 && !clientEmployeeId.startsWith("employee-")) {
      const foreign = [...employees.values()].find(
        (e) => e.id === clientEmployeeId && e.schoolId !== schoolId
      );
      if (foreign) {
        return res.status(403).json({
          error: "Cannot import an employee that belongs to another school",
          code: "CROSS_TENANT_EMPLOYEE",
        });
      }
    }
    return res.status(200).json({ ok: true, schoolId });
  });

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${addr.port}`;

  const cross = await fetch(`${base}/api/payroll/employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_A,
      id: FOREIGN_EMP_ID,
      firstName: "X",
      lastName: "Y",
    }),
  });
  assert.equal(cross.status, 403);
  const crossBody = (await cross.json()) as { code?: string };
  assert.equal(crossBody.code, "CROSS_TENANT_EMPLOYEE");

  const localOk = await fetch(`${base}/api/payroll/employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_A,
      id: "employee-local-1",
      firstName: "Local",
      lastName: "Draft",
    }),
  });
  assert.equal(localOk.status, 200);

  const sameSchool = await fetch(`${base}/api/payroll/employee`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      schoolId: SCHOOL_B,
      id: FOREIGN_EMP_ID,
      firstName: "Same",
      lastName: "School",
    }),
  });
  assert.equal(sameSchool.status, 200);

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );

  console.log("✓ payroll tenant isolation unit tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
