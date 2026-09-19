/**
 * Unauthenticated users/schools exposure regression.
 * Run: npx tsx src/routes/schoolsUsersAuth.route.test.ts
 */
import assert from "assert";
import express from "express";
import http from "http";

import { isCrossSchoolRequest } from "../middleware/staffSchoolGate";
import {
  toPublicSchoolBranding,
  toPublicSchoolListItem,
} from "./publicSchools";
import schoolsRoutes from "./schools";
import usersRoutes from "./users";

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

async function get(url: string) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const schools = await listen("/api/schools", schoolsRoutes);
  const users = await listen("/api/users", usersRoutes);
  try {
    const list = await get(`${schools.base}`);
    assert.equal(list.status, 401, `GET /api/schools status ${list.status}`);
    assert.equal(list.text.includes("bankingDetails"), false);
    assert.equal(list.text.includes("Authentication required"), true);

    const one = await get(`${schools.base}/cmt1e8bjp0jo8lcjeketlynhl`);
    assert.equal(one.status, 401, `GET /api/schools/:id status ${one.status}`);
    assert.equal(one.text.includes("bankingDetails"), false);

    const userList = await get(`${users.base}?schoolId=cmt1e8bjp0jo8lcjeketlynhl`);
    assert.equal(userList.status, 401, `GET /api/users status ${userList.status}`);
    assert.equal(userList.text.includes("\"users\""), false);

    const flyEagle = {
      superAdmin: false,
      auth: { authorizedSchoolId: "cmt1e8bjp0jo8lcjeketlynhl" },
    };
    assert.equal(isCrossSchoolRequest(flyEagle as any, "cmt1e8bjp0jo8lcjeketlynhl"), false);
    assert.equal(isCrossSchoolRequest(flyEagle as any, "cmpideqeq0000108xb6ouv9zi"), true);
    assert.equal(
      isCrossSchoolRequest(
        { superAdmin: true, auth: { authorizedSchoolId: "platform" } } as any,
        "cmpideqeq0000108xb6ouv9zi"
      ),
      false
    );

    const publicList = toPublicSchoolListItem({ id: "s1", name: "Fly Eagle" });
    assert.deepEqual(Object.keys(publicList).sort(), ["id", "name"]);
    const branding = toPublicSchoolBranding({
      id: "s1",
      name: "Fly Eagle",
      logoUrl: "/logo.png",
    });
    assert.deepEqual(Object.keys(branding).sort(), ["id", "logoUrl", "name"]);
    assert.equal(JSON.stringify(branding).includes("bankingDetails"), false);
    assert.equal(JSON.stringify(publicList).includes("email"), false);

    console.log("schoolsUsersAuth.route.test: PASS");
  } finally {
    await schools.close();
    await users.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
