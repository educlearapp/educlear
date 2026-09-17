/**
 * Central staff auth repair — apiFetch Bearer injection + context isolation.
 * Run: npx tsx src/auth/centralStaffAuthRepair.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_SRC = path.join(__dirname, "..");
const TOKEN = "central-staff-auth-repair-token";
const PARENT_TOKEN = "parent-portal-token-xyz";
const SUPER_TOKEN = "super-admin-token-xyz";

function authHeader(init?: RequestInit): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return String(h.get("Authorization") || "");
  if (Array.isArray(h)) {
    const hit = h.find(([k]) => k.toLowerCase() === "authorization");
    return hit ? String(hit[1]) : "";
  }
  const rec = h as Record<string, string>;
  for (const [k, v] of Object.entries(rec)) {
    if (k.toLowerCase() === "authorization") return String(v);
  }
  return "";
}

function contentType(init?: RequestInit): string {
  const h = init?.headers;
  if (!h) return "";
  if (h instanceof Headers) return String(h.get("Content-Type") || "");
  if (Array.isArray(h)) {
    const hit = h.find(([k]) => k.toLowerCase() === "content-type");
    return hit ? String(hit[1]) : "";
  }
  const rec = h as Record<string, string>;
  for (const [k, v] of Object.entries(rec)) {
    if (k.toLowerCase() === "content-type") return String(v);
  }
  return "";
}

type Store = Map<string, string>;

async function withMockEnv(
  store: Store,
  run: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>
) {
  const prevFetch = globalThis.fetch;
  const prevLocalStorage = (globalThis as { localStorage?: Storage }).localStorage;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const g = globalThis as typeof globalThis & { window?: Window & typeof globalThis };
  const prevWindow = g.window;
  if (!g.window) {
    g.window = {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
      location: { origin: "http://localhost:5173" },
    } as Window & typeof globalThis;
  } else if (!(g.window as { location?: { origin?: string } }).location) {
    (g.window as { location: { origin: string } }).location = { origin: "http://localhost:5173" };
  }

  (globalThis as { localStorage: Storage }).localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => {
      store.set(k, String(v));
    },
    removeItem: (k) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: () => null,
    get length() {
      return store.size;
    },
  };

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return new Response(JSON.stringify({ success: true, ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await run(calls);
  } finally {
    globalThis.fetch = prevFetch;
    if (prevWindow) g.window = prevWindow;
    else delete g.window;
    if (prevLocalStorage) {
      (globalThis as { localStorage?: Storage }).localStorage = prevLocalStorage;
    } else {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    }
  }
}

async function testApiFetchInjectsStaffBearer() {
  const { apiFetch } = await import("../api.ts");
  await withMockEnv(new Map([["token", TOKEN]]), async (calls) => {
    await apiFetch("/api/learners/abc");
    assert.equal(calls.length, 1);
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
    assert.match(contentType(calls[0].init), /application\/json/i);
  });
  console.log("✓ apiFetch injects staff Bearer when token exists");
}

async function testCallerHeadersPreserved() {
  const { apiFetch } = await import("../api.ts");
  await withMockEnv(new Map([["token", TOKEN]]), async (calls) => {
    await apiFetch("/api/fees", {
      headers: { "X-Custom": "yes", "Idempotency-Key": "k1" },
    });
    const h = calls[0].init?.headers as Record<string, string>;
    assert.equal(h["X-Custom"], "yes");
    assert.equal(h["Idempotency-Key"], "k1");
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
  });
  console.log("✓ caller headers remain intact alongside Bearer");
}

async function testDoesNotOverwriteExplicitAuthorization() {
  const { apiFetch } = await import("../api.ts");
  await withMockEnv(new Map([["token", TOKEN]]), async (calls) => {
    await apiFetch("/api/other", {
      headers: { Authorization: "Bearer other-context-token" },
    });
    assert.equal(authHeader(calls[0].init), "Bearer other-context-token");
  });
  console.log("✓ explicit Authorization is not overwritten");
}

async function testFormDataSkipsContentType() {
  const { apiFetch, authenticatedFetch } = await import("../api.ts");
  await withMockEnv(new Map([["token", TOKEN]]), async (calls) => {
    const fd = new FormData();
    fd.append("logo", new Blob(["x"]), "x.png");
    await apiFetch("/api/upload-logo", { method: "POST", body: fd });
    assert.equal(contentType(calls[0].init), "");
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);

    await authenticatedFetch("/api/upload-logo", { method: "POST", body: fd });
    assert.equal(contentType(calls[1].init), "");
    assert.equal(authHeader(calls[1].init), `Bearer ${TOKEN}`);
  });
  console.log("✓ FormData omits Content-Type; still sends Bearer");
}

async function testSkipAuthAndLoggedOut() {
  const { apiFetch } = await import("../api.ts");
  await withMockEnv(new Map([["token", TOKEN]]), async (calls) => {
    await apiFetch("/auth/login", {
      method: "POST",
      skipAuth: true,
      body: JSON.stringify({ email: "a@b.c", password: "x" }),
    });
    assert.equal(authHeader(calls[0].init), "");
  });

  await withMockEnv(new Map(), async (calls) => {
    await apiFetch("/api/learners/x");
    assert.equal(authHeader(calls[0].init), "");
  });
  console.log("✓ skipAuth and logged-out requests send no staff Bearer");
}

async function testParentPortalDoesNotGetStaffJwt() {
  const { parentApiFetch, setParentSession, clearParentSession } = await import(
    "../parent/parentApi.ts"
  );
  await withMockEnv(
    new Map([
      ["token", TOKEN],
      ["parentPortalToken", PARENT_TOKEN],
    ]),
    async (calls) => {
      setParentSession(PARENT_TOKEN, { parent: { id: "p1", firstName: "A", surname: "B" } });
      await parentApiFetch("/api/parent-portal/dashboard");
      assert.equal(authHeader(calls[0].init), `Bearer ${PARENT_TOKEN}`);
      assert.notEqual(authHeader(calls[0].init), `Bearer ${TOKEN}`);
      clearParentSession();
    }
  );

  await withMockEnv(new Map([["token", TOKEN]]), async (calls) => {
    const { parentApiFetch: pFetch } = await import("../parent/parentApi.ts");
    await pFetch("/api/parent-portal/dashboard");
    assert.equal(authHeader(calls[0].init), "");
  });
  console.log("✓ Parent Portal uses parent token only (never staff JWT)");
}

async function testSuperAdminKeepsOwnToken() {
  const { SUPER_ADMIN_TOKEN_KEY } = await import("../auth/superAdminSession.ts");
  const { superAdminApiFetch } = await import("../superAdmin/superAdminApi.ts");
  await withMockEnv(
    new Map([
      ["token", TOKEN],
      [SUPER_ADMIN_TOKEN_KEY, SUPER_TOKEN],
    ]),
    async (calls) => {
      await superAdminApiFetch("/api/super-admin/schools");
      assert.equal(authHeader(calls[0].init), `Bearer ${SUPER_TOKEN}`);
      assert.notEqual(authHeader(calls[0].init), `Bearer ${TOKEN}`);
    }
  );
  console.log("✓ Super Admin keeps its own token (skipAuth + SA Bearer)");
}

async function testPublicAdmissionsHasNoStaffAuth() {
  const apiSrc = fs.readFileSync(
    path.join(FRONTEND_SRC, "publicAdmissions/publicAdmissionsApi.ts"),
    "utf8"
  );
  assert.ok(!/\bstaffAuthHeaders\s*\(/.test(apiSrc), "public admissions must not use staffAuthHeaders");
  assert.ok(!/\bapiFetch\s*\(/.test(apiSrc), "public admissions must not use apiFetch (staff default)");
  assert.ok(/X-Admissions-Access-Token|admissions/i.test(apiSrc), "uses admissions access token path");
  console.log("✓ Public Admissions stays off staff apiFetch");
}

async function testManageParentSaveAndReloadAuth() {
  const src = fs.readFileSync(path.join(FRONTEND_SRC, "learner/ManageLearner.tsx"), "utf8");
  const persistStart = src.indexOf("const persistParentsToApi");
  const persistEnd = src.indexOf("const linkExistingParentToLearner");
  assert.ok(persistStart > 0 && persistEnd > persistStart, "persistParentsToApi block found");
  const block = src.slice(persistStart, persistEnd);
  assert.ok(/apiFetch\(\s*`\/api\/learners\/\$\{learner\.id\}`/.test(block), "parent save uses apiFetch PUT");
  assert.ok(/reloadLearnerProfile/.test(block), "parent save reloads profile");

  const reloadStart = src.indexOf("const reloadLearnerProfile");
  const reloadEnd = src.indexOf("const linkedParents");
  const reload = src.slice(reloadStart, reloadEnd);
  assert.ok(
    /apiFetch\(\s*`\/api\/learners\/\$\{encodeURIComponent\(learnerId\)\}`/.test(reload),
    "reloadLearnerProfile uses apiFetch (central Bearer)"
  );
  assert.ok(!/\bfetch\s*\(/.test(reload), "reloadLearnerProfile has no raw fetch");

  await withMockEnv(new Map([["token", TOKEN]]), async (calls) => {
    const { apiFetch } = await import("../api.ts");
    await apiFetch("/api/learners/learner-1", {
      method: "PUT",
      body: JSON.stringify({ parents: [] }),
    });
    await apiFetch("/api/learners/learner-1");
    assert.equal(calls.length, 2);
    assert.equal(authHeader(calls[0].init), `Bearer ${TOKEN}`);
    assert.equal(authHeader(calls[1].init), `Bearer ${TOKEN}`);
  });
  console.log("✓ Manage Parent save + profile reload both authenticate via apiFetch");
}

async function testLoggedOutStillUnauthenticatedWire() {
  const { mergeApiHeaders } = await import("../api.ts");
  await withMockEnv(new Map(), async () => {
    const headers = mergeApiHeaders({ body: JSON.stringify({}) });
    assert.ok(!headerHasAuth(headers), "no token → no Authorization");
  });
  console.log("✓ logged-out mergeApiHeaders sends no Authorization (backend 401 correct)");
}

function headerHasAuth(headers: Record<string, string>) {
  return Object.keys(headers).some((k) => k.toLowerCase() === "authorization");
}

async function main() {
  await testApiFetchInjectsStaffBearer();
  await testCallerHeadersPreserved();
  await testDoesNotOverwriteExplicitAuthorization();
  await testFormDataSkipsContentType();
  await testSkipAuthAndLoggedOut();
  await testParentPortalDoesNotGetStaffJwt();
  await testSuperAdminKeepsOwnToken();
  await testPublicAdmissionsHasNoStaffAuth();
  await testManageParentSaveAndReloadAuth();
  await testLoggedOutStillUnauthenticatedWire();
  console.log("\nAll centralStaffAuthRepair tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
