/**
 * Auth regression for users, schools, public school DTO, PayFast checkout,
 * parent-portal staff writes, and mount-level staff gates.
 * Run: npx tsx src/routes/schoolsUsersAuth.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";

import { requireSchoolModule } from "../middleware/requireSchoolModule";
import {
  allowSchool,
  allowUsersAction,
  isCrossSchoolRequest,
  type StaffSchoolGate,
} from "../middleware/staffSchoolGate";
import { isAllowedSchoolLogo } from "../utils/logoUploadPolicy";
import parentPortalRoutes from "./parentPortal";
import payfastRoutes from "./payfast";
import {
  toPublicSchoolBranding,
  toPublicSchoolListItem,
} from "./publicSchools";
import schoolsRoutes from "./schools";
import usersRoutes from "./users";

const FLY = "cmt1e8bjp0jo8lcjeketlynhl";
const OTHER = "cmpideqeq0000108xb6ouv9zi";

async function listen(routerPath: string, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use(routerPath, router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}${routerPath}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  return { status: res.status, text };
}

function json(url: string, method: string, body?: unknown) {
  return call(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function fakeRes() {
  const out: { statusCode: number; body: Record<string, unknown> | null } = {
    statusCode: 200,
    body: null,
  };
  const res = {
    status(code: number) {
      out.statusCode = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      out.body = body;
      return res;
    },
  };
  return { out, res: res as any };
}

function gate(partial: Partial<StaffSchoolGate> & Pick<StaffSchoolGate, "superAdmin">): StaffSchoolGate {
  return {
    superAdmin: partial.superAdmin,
    auth: partial.auth || {
      userId: "u1",
      authorizedSchoolId: FLY,
      appRole: "Admin",
      permissions: {},
    },
  } as StaffSchoolGate;
}

async function main() {
  const schools = await listen("/api/schools", schoolsRoutes);
  const users = await listen("/api/users", usersRoutes);
  const portal = await listen("/api/parent-portal", parentPortalRoutes);
  const payfast = await listen("/api/payfast", payfastRoutes);
  const modules = await listen(
    "/api/parents",
    (() => {
      const router = express.Router();
      router.use(requireSchoolModule("CORE"));
      router.get("/", (_req, res) => res.json({ ok: true }));
      return router;
    })()
  );
  try {
    const schoolList = await call(schools.base);
    assert.equal(schoolList.status, 401);
    assert.equal(schoolList.text.includes("AUTH_REQUIRED"), true);
    assert.equal(schoolList.text.includes("bankingDetails"), false);

    const schoolOne = await call(`${schools.base}/${FLY}`);
    assert.equal(schoolOne.status, 401);
    assert.equal(schoolOne.text.includes("bankingDetails"), false);

    const schoolPut = await json(`${schools.base}/${FLY}`, "PUT", { name: "nope" });
    assert.equal(schoolPut.status, 401);
    assert.equal(schoolPut.text.includes("AUTH_REQUIRED"), true);

    const schoolPassword = await json(`${schools.base}/${FLY}/password`, "POST", {});
    assert.equal(schoolPassword.status, 401);

    const userList = await call(`${users.base}?schoolId=${FLY}`);
    assert.equal(userList.status, 401);
    assert.equal(userList.text.includes("\"users\""), false);

    for (const [method, path, body] of [
      ["POST", "/", { schoolId: FLY, email: "a@b.co", firstName: "A" }],
      ["PUT", "/someone", { schoolId: FLY }],
      ["PATCH", "/someone/status", { isActive: false }],
      ["PATCH", "/someone/permissions", { appRole: "Admin" }],
      ["POST", "/someone/reset-password", { password: "long-enough" }],
      ["DELETE", "/someone", undefined],
    ] as const) {
      const res = await json(`${users.base}${path}`, method, body);
      assert.equal(res.status, 401, `${method} /api/users${path} -> ${res.status}`);
    }

    const fly = gate({ superAdmin: false });
    const other = fakeRes();
    assert.equal(allowSchool(fly, FLY, other.res), true);
    assert.equal(allowSchool(fly, OTHER, other.res), false);
    assert.equal(other.out.statusCode, 403);
    assert.equal(other.out.body?.code, "SCHOOL_MISMATCH");

    const superGate = gate({
      superAdmin: true,
      auth: { userId: "sa", authorizedSchoolId: "platform", appRole: "Owner", permissions: {} } as any,
    });
    const superRes = fakeRes();
    assert.equal(isCrossSchoolRequest(superGate, OTHER), false);
    assert.equal(allowSchool(superGate, OTHER, superRes.res), true);
    assert.equal(allowUsersAction(superGate, "manage", superRes.res), true);

    const admin = gate({ superAdmin: false });
    const adminRes = fakeRes();
    assert.equal(allowUsersAction(admin, "view", adminRes.res), true);
    assert.equal(allowUsersAction(admin, "create", adminRes.res), true);
    assert.equal(allowUsersAction(admin, "edit", adminRes.res), true);
    assert.equal(allowUsersAction(admin, "manage", adminRes.res), true);

    const viewer = gate({
      superAdmin: false,
      auth: { userId: "v", authorizedSchoolId: FLY, appRole: "Viewer", permissions: {} } as any,
    });
    const viewerRes = fakeRes();
    assert.equal(allowUsersAction(viewer, "view", viewerRes.res), false);
    assert.equal(viewerRes.out.statusCode, 403);
    assert.equal(viewerRes.out.body?.code, "FORBIDDEN");

    const publicList = toPublicSchoolListItem({ id: "s1", name: "Fly Eagle" });
    const branding = toPublicSchoolBranding({ id: "s1", name: "Fly Eagle", logoUrl: "/logo.png" });
    const publicJson = JSON.stringify({ publicList, branding });
    for (const forbidden of ["bankingDetails", "email", "phone", "cellNo", "address", "postalAddress"]) {
      assert.equal(publicJson.includes(forbidden), false, forbidden);
    }
    assert.deepEqual(Object.keys(publicList).sort(), ["id", "name"]);
    assert.deepEqual(Object.keys(branding).sort(), ["id", "logoUrl", "name"]);

    const parents = await call(modules.base);
    assert.equal(parents.status, 401);
    assert.equal(parents.text.includes("AUTH_REQUIRED"), true);

    const incidents = await json(`${portal.base}/staff/incidents`, "POST", {});
    assert.equal(incidents.status, 401);
    const incidentList = await call(`${portal.base}/staff/incidents`);
    assert.equal(incidentList.status, 401);
    const homework = await json(`${portal.base}/staff/homework`, "POST", {});
    assert.equal(homework.status, 401);
    const onboarding = await json(`${portal.base}/migration/onboarding`, "POST", {});
    assert.equal(onboarding.status, 401);
    const notify = await json(`${portal.base}/notify-invoice-run`, "POST", {});
    assert.equal(notify.status, 401);

    const lookup = await call(`${portal.base}/lookup-by-cell`);
    assert.notEqual(lookup.status, 200);
    assert.equal(lookup.text.includes("bankingDetails"), false);

    const checkout = await json(`${payfast.base}/create-checkout`, "POST", {
      checkoutType: "SUBSCRIPTION",
      schoolId: OTHER,
      sku: "CORE",
    });
    assert.equal(checkout.status, 401);
    assert.equal(checkout.text.includes("AUTH_REQUIRED"), true);

    const itn = await json(`${payfast.base}/notify`, "POST", {});
    assert.notEqual(itn.status, 401, "PayFast ITN must stay reachable without staff JWT");

    assert.equal(isAllowedSchoolLogo("image/png", "logo.png"), true);
    assert.equal(isAllowedSchoolLogo("image/jpeg", "logo.jpg"), true);
    assert.equal(isAllowedSchoolLogo("text/html", "logo.html"), false);
    assert.equal(isAllowedSchoolLogo("image/png", "logo.html"), false);
    assert.equal(isAllowedSchoolLogo("application/pdf", "logo.pdf"), false);

    console.log("schoolsUsersAuth.route.test: PASS");
  } finally {
    await schools.close();
    await users.close();
    await portal.close();
    await payfast.close();
    await modules.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
