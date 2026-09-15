/**
 * Staging-only outbound safety diagnostic.
 * Run: npx tsx src/routes/stagingSafety.unit.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";

import { requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { prisma } from "../prisma";
import { isStagingRuntime } from "../services/runtime";
import { STAFF_JWT_SECRET } from "../utils/staffJwt";
import stagingSafetyRoutes, {
  buildStagingOutboundStatusResponse,
  requireStagingRuntime,
} from "./stagingSafety";

function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    previous[key] = process.env[key];
    const next = vars[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(vars)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

async function requestJson(
  app: express.Express,
  method: string,
  pathName: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${pathName}`, {
      method,
      headers,
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

function mountDiagnosticApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/staging-safety", requireStagingRuntime, requireSuperAdmin, stagingSafetyRoutes);
  return app;
}

async function testIsStagingRuntimePositiveAndFailClosed() {
  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: undefined,
      RENDER_SERVICE_NAME: undefined,
      RENDER_EXTERNAL_URL: undefined,
      EDU_CLEAR_RUNTIME: undefined,
    },
    () => {
      assert.strictEqual(isStagingRuntime(), false, "unknown runtime is fail-closed");
    }
  );

  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: "educlear-backend.onrender.com",
      RENDER_SERVICE_NAME: "educlear-backend-staging",
      EDU_CLEAR_RUNTIME: "staging",
    },
    () => {
      assert.strictEqual(
        isStagingRuntime(),
        false,
        "production hostname hard-rejects even with staging hints"
      );
    }
  );

  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: undefined,
      RENDER_SERVICE_NAME: "educlear-backend",
      RENDER_EXTERNAL_URL: undefined,
      EDU_CLEAR_RUNTIME: "staging",
    },
    () => {
      assert.strictEqual(
        isStagingRuntime(),
        false,
        "production service name hard-rejects explicit staging flag"
      );
    }
  );

  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: "educlear-backend-staging.onrender.com",
      RENDER_SERVICE_NAME: undefined,
      RENDER_EXTERNAL_URL: undefined,
      EDU_CLEAR_RUNTIME: undefined,
    },
    () => {
      assert.strictEqual(isStagingRuntime(), true, "staging hostname is positive allow");
    }
  );

  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: undefined,
      RENDER_SERVICE_NAME: "educlear-backend-staging",
      RENDER_EXTERNAL_URL: undefined,
      EDU_CLEAR_RUNTIME: undefined,
    },
    () => {
      assert.strictEqual(isStagingRuntime(), true, "staging service name is positive allow");
    }
  );

  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: undefined,
      RENDER_SERVICE_NAME: undefined,
      RENDER_EXTERNAL_URL: "https://educlear-backend-staging.onrender.com",
      EDU_CLEAR_RUNTIME: undefined,
    },
    () => {
      assert.strictEqual(isStagingRuntime(), true, "staging external URL is positive allow");
    }
  );

  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: undefined,
      RENDER_SERVICE_NAME: undefined,
      RENDER_EXTERNAL_URL: undefined,
      EDU_CLEAR_RUNTIME: "staging",
    },
    () => {
      assert.strictEqual(isStagingRuntime(), true, "EDU_CLEAR_RUNTIME=staging for tests");
    }
  );

  console.log("✓ isStagingRuntime positive allowlist + production fail-closed");
}

async function testPayloadBooleansOnlyNoSecrets() {
  await withEnv(
    {
      DISABLE_OUTBOUND_SMS: "true",
      DISABLE_OUTBOUND_EMAIL: "false",
      DATABASE_URL: "postgresql://user:secret@db.example/educlear",
      PAYFAST_MERCHANT_KEY: "should-never-appear",
      WINSMS_API_KEY: "should-never-appear",
    },
    () => {
      const payload = buildStagingOutboundStatusResponse();
      assert.deepStrictEqual(Object.keys(payload).sort(), [
        "outboundEmailDisabled",
        "outboundSmsDisabled",
      ]);
      assert.strictEqual(payload.outboundSmsDisabled, true);
      assert.strictEqual(payload.outboundEmailDisabled, false);
      const serialized = JSON.stringify(payload);
      assert.ok(!serialized.includes("postgresql"));
      assert.ok(!serialized.includes("secret"));
      assert.ok(!serialized.includes("PAYFAST"));
      assert.ok(!serialized.includes("WINSMS"));
      assert.ok(!serialized.includes("DISABLE_OUTBOUND"));
      assert.ok(!serialized.includes("educlear-backend"));
    }
  );
  console.log("✓ outbound status payload is boolean-only (no secrets/config)");
}

async function testProductionRuntimeCannotAccess() {
  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: "educlear-backend.onrender.com",
      RENDER_SERVICE_NAME: "educlear-backend",
      NODE_ENV: "production",
      RENDER: "true",
      EDU_CLEAR_RUNTIME: undefined,
      DISABLE_OUTBOUND_SMS: "true",
      DISABLE_OUTBOUND_EMAIL: "true",
    },
    async () => {
      const app = mountDiagnosticApp();
      const res = await requestJson(app, "GET", "/api/staging-safety/outbound-status");
      assert.strictEqual(res.status, 404, "production must not expose diagnostic");
      assert.strictEqual(res.body.error, "Not found");
      assert.strictEqual("outboundSmsDisabled" in res.body, false);
    }
  );
  console.log("✓ production runtime cannot access staging-safety diagnostic");
}

async function testStagingAuthorizedCanReadBooleans() {
  const originalFindUnique = prisma.user.findUnique;
  prisma.user.findUnique = (async () => ({
    id: "sa-user-1",
    schoolId: "sa-school-1",
    email: "info@educlear.co.za",
    role: "SCHOOL_ADMIN",
    isActive: true,
  })) as typeof prisma.user.findUnique;

  try {
    await withEnv(
      {
        RENDER_EXTERNAL_HOSTNAME: "educlear-backend-staging.onrender.com",
        RENDER_SERVICE_NAME: "educlear-backend-staging",
        EDU_CLEAR_RUNTIME: undefined,
        DISABLE_OUTBOUND_SMS: "true",
        DISABLE_OUTBOUND_EMAIL: "true",
        DATABASE_URL: "postgresql://user:hunter2@db.example/educlear",
      },
      async () => {
        const app = mountDiagnosticApp();
        const token = jwt.sign(
          { userId: "sa-user-1", schoolId: "sa-school-1", email: "info@educlear.co.za" },
          STAFF_JWT_SECRET
        );
        const res = await requestJson(app, "GET", "/api/staging-safety/outbound-status", {
          Authorization: `Bearer ${token}`,
        });
        assert.strictEqual(res.status, 200);
        assert.deepStrictEqual(res.body, {
          outboundSmsDisabled: true,
          outboundEmailDisabled: true,
        });
        const serialized = JSON.stringify(res.body);
        assert.ok(!serialized.includes("hunter2"));
        assert.ok(!serialized.includes("postgresql"));
        assert.ok(!/DISABLE_OUTBOUND/i.test(serialized));
      }
    );
  } finally {
    prisma.user.findUnique = originalFindUnique;
  }
  console.log("✓ staging + Super Admin can read outboundSmsDisabled / outboundEmailDisabled");
}

async function testStagingUnauthorizedRejected() {
  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: "educlear-backend-staging.onrender.com",
      DISABLE_OUTBOUND_SMS: "true",
      DISABLE_OUTBOUND_EMAIL: "true",
    },
    async () => {
      const app = mountDiagnosticApp();
      const res = await requestJson(app, "GET", "/api/staging-safety/outbound-status");
      assert.strictEqual(res.status, 401);
      assert.strictEqual("outboundSmsDisabled" in res.body, false);
    }
  );
  console.log("✓ staging without Super Admin JWT is rejected");
}

async function testGetOnlyNoWriteMethodsOnRouter() {
  await withEnv(
    {
      RENDER_EXTERNAL_HOSTNAME: "educlear-backend-staging.onrender.com",
      DISABLE_OUTBOUND_SMS: "true",
      DISABLE_OUTBOUND_EMAIL: "true",
    },
    async () => {
      const originalFindUnique = prisma.user.findUnique;
      prisma.user.findUnique = (async () => ({
        id: "sa-user-1",
        schoolId: "sa-school-1",
        email: "info@educlear.co.za",
        role: "SCHOOL_ADMIN",
        isActive: true,
      })) as typeof prisma.user.findUnique;
      try {
        const app = mountDiagnosticApp();
        const token = jwt.sign(
          { userId: "sa-user-1", schoolId: "sa-school-1", email: "info@educlear.co.za" },
          STAFF_JWT_SECRET
        );
        for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
          const res = await requestJson(app, method, "/api/staging-safety/outbound-status", {
            Authorization: `Bearer ${token}`,
          });
          assert.ok(
            res.status === 404 || res.status === 405,
            `${method} must not mutate/succeed (got ${res.status})`
          );
        }
      } finally {
        prisma.user.findUnique = originalFindUnique;
      }
    }
  );
  console.log("✓ diagnostic route is read-only (non-GET methods rejected)");
}

async function main() {
  await testIsStagingRuntimePositiveAndFailClosed();
  await testPayloadBooleansOnlyNoSecrets();
  await testProductionRuntimeCannotAccess();
  await testStagingAuthorizedCanReadBooleans();
  await testStagingUnauthorizedRejected();
  await testGetOnlyNoWriteMethodsOnRouter();
  console.log("\nAll stagingSafety unit tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
