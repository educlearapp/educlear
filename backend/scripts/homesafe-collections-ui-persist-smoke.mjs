/**
 * Live-mode Collections persistence smoke (same APIs as AdminHomeSafePage live UI).
 * Verifies bootstrap survives "page refresh" (re-fetch) and backend restart.
 *
 * Env:
 *   DATABASE_URL → educlear_hs_cg_local
 *   BACKEND_URL (default http://127.0.0.1:3000)
 *   RESTART_CMD optional — if set, script runs it between checks (caller usually restarts externally)
 */
import { PrismaClient } from "@prisma/client";

const BACKEND_URL = String(process.env.BACKEND_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const EMAIL = "demo@educlear.co.za";
const PASS = "Admin123";
const MARKER = `UI Persist ${Date.now()}`;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function api(path, { method = "GET", token, body } = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

/** Mirrors frontend fetchCollectionsBootstrap membership/session assembly. */
async function bootstrap(token) {
  const groupsRes = await api("/api/homesafe/collections/groups", { token });
  assert(groupsRes.status === 200, `groups ${groupsRes.status}`);
  const sessions = [];
  const memberships = [];
  for (const g of groupsRes.json.groups || []) {
    for (const s of g.sessions || []) {
      sessions.push(s);
    }
    const detail = await api(`/api/homesafe/collections/groups/${g.id}/sessions`, { token });
    for (const s of detail.json.sessions || []) {
      const roster = await api(`/api/homesafe/collections/sessions/${s.id}/learners`, { token });
      for (const learnerId of roster.json.learnerIds || []) {
        memberships.push({ learnerId, sessionId: s.id });
      }
    }
  }
  return {
    groups: groupsRes.json.groups || [],
    sessions,
    memberships,
  };
}

async function waitHealthy(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "x", password: "y" }),
      });
      // any HTTP response means server is up
      if (res.status > 0) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("backend did not become healthy");
}

async function main() {
  const prisma = new PrismaClient();
  const db = (await prisma.$queryRaw`SELECT current_database() AS db`)[0].db;
  assert(db === "educlear_hs_cg_local", `REFUSE wrong db ${db}`);

  const login = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASS } });
  assert(login.status === 200 && login.json?.token, "login");
  const token = login.json.token;
  const schoolId = login.json.user.schoolId;

  const learners = await prisma.learner.findMany({
    where: { schoolId, enrollmentStatus: "ACTIVE" },
    take: 3,
    orderBy: { lastName: "asc" },
    select: { id: true },
  });
  assert(learners.length >= 2, "learners");

  const created = await api("/api/homesafe/collections/groups", {
    method: "POST",
    token,
    body: { name: MARKER, kind: "ACTIVITY" },
  });
  assert(created.status === 201, "create group via live API");
  const groupId = created.json.group.id;

  const tue = await api(`/api/homesafe/collections/groups/${groupId}/sessions`, {
    method: "POST",
    token,
    body: {
      weekday: "Tue",
      startTime: "11:00",
      endTime: "11:30",
      responsibleAdult: "UI Persist Coach",
      learnerIds: [learners[0].id, learners[1].id],
    },
  });
  assert(tue.status === 201, "create session");
  const tueId = tue.json.session.id;

  // Page refresh simulation
  const afterRefresh = await bootstrap(token);
  const g = afterRefresh.groups.find((x) => x.id === groupId);
  assert(!!g, "group survives refresh bootstrap");
  assert(afterRefresh.sessions.some((s) => s.id === tueId), "session survives refresh");
  assert(
    afterRefresh.memberships.filter((m) => m.sessionId === tueId).length === 2,
    "memberships survive refresh"
  );

  // Persist proof in DB before restart
  assert(
    (await prisma.homeSafeCollectionMembership.count({ where: { sessionId: tueId } })) === 2,
    "db memberships before restart"
  );

  console.log(
    JSON.stringify(
      {
        phase: "pre_restart",
        ok: true,
        db,
        groupId,
        tueId,
        groups: afterRefresh.groups.length,
        sessions: afterRefresh.sessions.length,
        memberships: afterRefresh.memberships.length,
        marker: MARKER,
      },
      null,
      2
    )
  );

  if (process.env.EXPECT_RESTART === "1") {
    console.log("WAITING_FOR_BACKEND_RESTART");
    // Caller kills/restarts backend; we poll until login works again then re-bootstrap
    await new Promise((r) => setTimeout(r, 1500));
    await waitHealthy(45000);
    const login2 = await api("/api/auth/login", { method: "POST", body: { email: EMAIL, password: PASS } });
    assert(login2.status === 200 && login2.json?.token, "re-login after restart");
    const boot2 = await bootstrap(login2.json.token);
    assert(boot2.groups.some((x) => x.id === groupId), "group survives backend restart");
    assert(boot2.sessions.some((s) => s.id === tueId), "session survives backend restart");
    assert(
      boot2.memberships.filter((m) => m.sessionId === tueId).length === 2,
      "memberships survive backend restart"
    );
    console.log(
      JSON.stringify(
        {
          phase: "post_restart",
          ok: true,
          groupId,
          tueId,
          membershipsForTue: boot2.memberships.filter((m) => m.sessionId === tueId).length,
        },
        null,
        2
      )
    );
  }

  console.log("homesafe-collections-ui-persist-smoke: OK");
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
