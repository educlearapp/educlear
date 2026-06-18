const PLATFORM_SUPER_ADMIN_EMAIL = "info@educlear.co.za";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    has(key) {
      return store.has(key);
    },
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function clearSuperAdminSession(storage) {
  storage.removeItem("superAdminToken");
  storage.removeItem("superAdminEmail");
  storage.removeItem("superAdminUserId");
  storage.removeItem("superAdminPlatformRole");
  storage.removeItem("educlearRole");
}

function getCurrentAuthenticatedEmail(storage) {
  const schoolToken = String(storage.getItem("token") || "").trim();
  if (schoolToken) {
    return normalizeEmail(storage.getItem("userEmail"));
  }
  return normalizeEmail(storage.getItem("superAdminEmail"));
}

function isSuperAdmin(storage) {
  return Boolean(
    String(storage.getItem("superAdminToken") || "").trim() &&
      getCurrentAuthenticatedEmail(storage) === PLATFORM_SUPER_ADMIN_EMAIL
  );
}

function guardSuperAdminRoute(storage) {
  const currentEmail = getCurrentAuthenticatedEmail(storage);
  if (isSuperAdmin(storage)) {
    return "allow";
  }
  if (currentEmail && currentEmail !== PLATFORM_SUPER_ADMIN_EMAIL) {
    clearSuperAdminSession(storage);
    return "dashboard";
  }
  if (storage.getItem("token") && storage.getItem("schoolId")) {
    return "dashboard";
  }
  return "super-admin-login";
}

function syncSuperAdminSessionFromLoginResponse(storage, data) {
  clearSuperAdminSession(storage);
  const token = String(data?.token || "").trim();
  const email = normalizeEmail(data?.user?.email || data?.email);
  if (!token || email !== PLATFORM_SUPER_ADMIN_EMAIL) {
    return false;
  }
  storage.setItem("superAdminToken", token);
  storage.setItem("superAdminEmail", email);
  if (data?.user?.id) storage.setItem("superAdminUserId", data.user.id);
  return true;
}

function simulateSchoolLogin(storage, email) {
  clearSuperAdminSession(storage);
  storage.setItem("token", "school-token");
  storage.setItem("schoolId", "cmpideqeq0000108xb6ouv9zi");
  storage.setItem("userEmail", normalizeEmail(email));
  storage.setItem("userRole", "SUPER_ADMIN");
}

function verifyDaSilvaBlockedWithStaleSuperAdminState() {
  const storage = createStorage();
  storage.setItem("superAdminToken", "stale-platform-token");
  storage.setItem("superAdminEmail", PLATFORM_SUPER_ADMIN_EMAIL);
  storage.setItem("superAdminPlatformRole", "superAdmin");
  storage.setItem("educlearRole", "superAdmin");

  simulateSchoolLogin(storage, "dasilvaacademy@gmail.com");

  assert(!storage.has("superAdminToken"), "Da Silva login must clear stale super admin token");
  assert(guardSuperAdminRoute(storage) === "dashboard", "Direct /super-admin must redirect Da Silva");
  assert(guardSuperAdminRoute(storage) === "dashboard", "Refresh /super-admin must redirect Da Silva");

  storage.setItem("superAdminToken", "stale-platform-token");
  storage.setItem("superAdminEmail", PLATFORM_SUPER_ADMIN_EMAIL);
  storage.setItem("superAdminPlatformRole", "superAdmin");
  storage.setItem("educlearRole", "superAdmin");

  assert(guardSuperAdminRoute(storage) === "dashboard", "Stale super admin token must not override Da Silva email");
  assert(!storage.has("superAdminToken"), "Guard must purge stale super admin token for Da Silva");
}

function verifyEduClearAllowed() {
  const storage = createStorage();
  const synced = syncSuperAdminSessionFromLoginResponse(storage, {
    token: "platform-token",
    user: {
      id: "platform-user",
      email: PLATFORM_SUPER_ADMIN_EMAIL,
      educlearRole: "superAdmin",
    },
  });

  assert(synced, "EduClear platform login must create a super admin session");
  assert(guardSuperAdminRoute(storage) === "allow", "EduClear platform email must access /super-admin");
}

function verifyRolePayloadIgnored() {
  const storage = createStorage();
  const synced = syncSuperAdminSessionFromLoginResponse(storage, {
    token: "school-token",
    educlearRole: "superAdmin",
    user: {
      id: "da-silva-user",
      email: "dasilvaacademy@gmail.com",
      role: "SUPER_ADMIN",
      educlearRole: "superAdmin",
    },
  });

  assert(!synced, "Da Silva role payload must not create a super admin session");
  assert(guardSuperAdminRoute(storage) !== "allow", "Da Silva role payload must not access /super-admin");
}

verifyDaSilvaBlockedWithStaleSuperAdminState();
verifyEduClearAllowed();
verifyRolePayloadIgnored();

console.log("Frontend Super Admin access verification passed.");
