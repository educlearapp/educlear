/**
 * Employee browser-cache tenant isolation + logout/switch regression.
 * Run: node --import tsx src/employeesApi.isolation.test.ts
 */
import assert from "node:assert/strict";

type Store = Map<string, string>;

function installLocalStorage(seed: Record<string, string> = {}) {
  const store: Store = new Map(Object.entries(seed));
  const ls = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as any).localStorage = ls;
  return store;
}

async function main() {
  const schoolDaSilva = "cmpideqeq0000108xb6ouv9zi";
  const schoolFlyEagle = "cmt1e8bjp0jo8lcjeketlynhl";
  const schoolEmpty = "school-empty-cccccccccccccccc";
  const userDaSilva = "user-dasilva-1";
  const userFlyEagle = "user-flyeagle-1";

  const daSilvaEmployee = {
    id: "clxxxxxxxxxxxxxxxxxxdasilva01",
    firstName: "Synth",
    surname: "DaSilva",
  };
  const flyEagleEmployee = {
    id: "clxxxxxxxxxxxxxxxxxxflyeagl01",
    firstName: "Synth",
    surname: "FlyEagle",
  };
  const localDraft = {
    id: "employee-local-draft-1",
    firstName: "Local",
    surname: "Draft",
  };

  // Seed legacy unscoped cache with foreign server rows (the confirmed leak).
  const store = installLocalStorage({
    userId: userDaSilva,
    userEmail: "owner-dasilva@example.com",
    schoolId: schoolDaSilva,
    educlearEmployees: JSON.stringify([daSilvaEmployee, localDraft]),
    educlearEmployees_backup: JSON.stringify([daSilvaEmployee]),
    selectedEmployeeForManage: JSON.stringify(daSilvaEmployee),
  });

  const api = await import("./employeesApi");

  // --- Legacy quarantine + POPIA evidence ---
  const quarantined = api.quarantineLegacyUnscopedEmployeeCaches();
  assert.deepEqual(
    quarantined.sort(),
    ["educlearEmployees", "educlearEmployees_backup", "selectedEmployeeForManage"].sort()
  );
  assert.equal(store.get("educlearEmployees"), undefined, "legacy cache removed");
  assert.ok(
    store.get("educlearEmployees_LEGACY_EVIDENCE:educlearEmployees"),
    "evidence preserved"
  );

  // --- School/user scoped caches do not cross tenants ---
  api.writeEmployeesCache(schoolDaSilva, [daSilvaEmployee, localDraft]);
  assert.equal(api.readEmployeesCache(schoolDaSilva).length, 2);

  store.set("userId", userFlyEagle);
  store.set("userEmail", "owner-flyeagle@example.com");
  store.set("schoolId", schoolFlyEagle);
  assert.deepEqual(
    api.readEmployeesCache(schoolDaSilva),
    [],
    "Fly Eagle user cannot read Da Silva scoped cache"
  );
  assert.deepEqual(api.readEmployeesCache(schoolFlyEagle), [], "Fly Eagle starts empty");

  api.writeEmployeesCache(schoolFlyEagle, [flyEagleEmployee]);
  assert.equal(api.readEmployeesCache(schoolFlyEagle).length, 1);
  assert.equal(
    String(api.readEmployeesCache(schoolFlyEagle)[0].id),
    "clxxxxxxxxxxxxxxxxxxflyeagl01"
  );

  // Switch back to Da Silva — only Da Silva scoped rows
  store.set("userId", userDaSilva);
  store.set("userEmail", "owner-dasilva@example.com");
  store.set("schoolId", schoolDaSilva);
  assert.equal(api.readEmployeesCache(schoolDaSilva).length, 2);
  assert.deepEqual(api.readEmployeesCache(schoolFlyEagle), []);

  // --- Empty backend must not resurrect other-school / legacy server rows ---
  const mergedEmpty = api.mergeEmployees([], [daSilvaEmployee, localDraft]);
  assert.equal(mergedEmpty.length, 1, "empty backend keeps only local-only draft");
  assert.equal(String(mergedEmpty[0].id), "employee-local-draft-1");

  api.writeEmployeesCache(schoolEmpty, []);
  assert.deepEqual(api.readEmployeesCache(schoolEmpty), [], "empty school cache is empty");

  // Re-seed legacy; quarantine + empty-school recoverable set must stay empty of foreign server rows
  store.set("educlearEmployees", JSON.stringify([daSilvaEmployee]));
  api.quarantineLegacyUnscopedEmployeeCaches();
  assert.equal(store.get("educlearEmployees"), undefined);
  const recoverableEmpty = api.collectRecoverableLocalEmployees(schoolEmpty);
  assert.deepEqual(recoverableEmpty, [], "empty school has no recoverable foreign rows");

  // --- Restore / Sync cannot import foreign server employees ---
  const restore = await api.restoreLocalEmployeesToBackend(schoolEmpty, [
    daSilvaEmployee,
    localDraft,
  ]);
  assert.equal(restore.skippedForeign, 1, "foreign server employee skipped");
  assert.equal(restore.failed + restore.restored, 1, "only local draft attempted");

  store.set(
    `educlearEmployees_backup:${schoolEmpty}:${userDaSilva}`,
    JSON.stringify([daSilvaEmployee, localDraft])
  );
  store.delete(`educlearEmployees:${schoolEmpty}:${userDaSilva}`);
  const fromBackup = api.restoreEmployeesFromBackupToCache(schoolEmpty);
  assert.equal(fromBackup.length, 1);
  assert.equal(String(fromBackup[0].id), "employee-local-draft-1");

  // --- Logout clears legacy exposure path ---
  store.set("educlearEmployees", JSON.stringify([daSilvaEmployee]));
  store.set("token", "tok");
  store.set("schoolId", schoolDaSilva);
  store.set("userId", userDaSilva);
  const { clearStaffAuthSession } = await import("./auth/sessionLogout");
  clearStaffAuthSession();
  assert.equal(store.get("educlearEmployees"), undefined, "logout quarantines legacy cache");
  assert.equal(store.get("token"), undefined, "logout clears token");
  assert.equal(store.get("schoolId"), undefined, "logout clears schoolId");
  assert.ok(
    store.get("educlearEmployees_LEGACY_EVIDENCE:educlearEmployees"),
    "logout preserves POPIA evidence"
  );

  console.log("✓ employeesApi isolation tests passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
