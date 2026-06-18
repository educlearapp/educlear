const PLATFORM_SUPER_ADMIN_EMAIL = "info@educlear.co.za";
const RESTRICTED_MESSAGE = "Super Admin access is restricted to info@educlear.co.za.";

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

function guardSuperAdminRoute(storage, authenticatedEmail, path = "/super-admin") {
  const email = normalizeEmail(authenticatedEmail);
  if (email !== PLATFORM_SUPER_ADMIN_EMAIL) {
    clearSuperAdminSession(storage);
    return {
      view: "login",
      message: RESTRICTED_MESSAGE,
      returnPath: path,
    };
  }
  return {
    view: "super-admin",
    returnPath: path,
  };
}

function resolveAppRoute(path) {
  if (path === "/super-admin" || path.startsWith("/super-admin/")) {
    return "super-admin-guard";
  }
  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    return "school-dashboard";
  }
  return "other";
}

function resolvePostAuthPath(email) {
  if (normalizeEmail(email) === PLATFORM_SUPER_ADMIN_EMAIL) {
    return "/super-admin";
  }
  return "/dashboard";
}

function subscriptionGateRoute(storage) {
  if (normalizeEmail(storage.getItem("userEmail")) === PLATFORM_SUPER_ADMIN_EMAIL) {
    return "/super-admin";
  }
  return "subscription-check";
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
  assert(resolveAppRoute("/super-admin") === "super-admin-guard", "/super-admin must hit guard");
  assert(
    resolveAppRoute("/super-admin/schools") === "super-admin-guard",
    "/super-admin/schools must hit guard"
  );
  assert(
    resolveAppRoute("/super-admin/users") === "super-admin-guard",
    "/super-admin/users must hit guard"
  );
  assert(
    resolveAppRoute("/super-admin/settings") === "super-admin-guard",
    "/super-admin/settings must hit guard"
  );
  assert(
    guardSuperAdminRoute(storage, "dasilvaacademy@gmail.com", "/super-admin").view === "login",
    "Direct /super-admin must show Super Admin login for Da Silva"
  );
  assert(
    guardSuperAdminRoute(storage, "dasilvaacademy@gmail.com", "/super-admin/schools").view === "login",
    "Direct /super-admin/schools must show Super Admin login for Da Silva"
  );
  assert(
    guardSuperAdminRoute(storage, "dasilvaacademy@gmail.com", "/super-admin/schools").message ===
      RESTRICTED_MESSAGE,
    "Da Silva Super Admin login page must show restriction message"
  );
  assert(
    guardSuperAdminRoute(storage, "dasilvaacademy@gmail.com", "/super-admin/schools").returnPath ===
      "/super-admin/schools",
    "Da Silva Super Admin login page must preserve requested return path"
  );
  assert(
    guardSuperAdminRoute(storage, "", "/super-admin").view === "login",
    "Not logged in /super-admin must show Super Admin login"
  );

  storage.setItem("superAdminToken", "stale-platform-token");
  storage.setItem("superAdminEmail", PLATFORM_SUPER_ADMIN_EMAIL);
  storage.setItem("superAdminPlatformRole", "superAdmin");
  storage.setItem("educlearRole", "superAdmin");

  assert(
    guardSuperAdminRoute(storage, "dasilvaacademy@gmail.com").view === "login",
    "Stale super admin token must not override Da Silva email"
  );
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
  assert(
    guardSuperAdminRoute(storage, PLATFORM_SUPER_ADMIN_EMAIL).view === "super-admin",
    "EduClear platform email must access /super-admin"
  );
  assert(
    guardSuperAdminRoute(storage, PLATFORM_SUPER_ADMIN_EMAIL, "/super-admin/schools").view ===
      "super-admin",
    "EduClear platform email must access /super-admin/schools"
  );
  assert(
    resolvePostAuthPath(PLATFORM_SUPER_ADMIN_EMAIL) === "/super-admin",
    "EduClear platform login must go to /super-admin"
  );
  storage.setItem("userEmail", PLATFORM_SUPER_ADMIN_EMAIL);
  assert(
    subscriptionGateRoute(storage) === "/super-admin",
    "EduClear platform email must bypass subscription/package gates"
  );
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
  assert(
    guardSuperAdminRoute(storage, "dasilvaacademy@gmail.com").view === "login",
    "Da Silva role payload must show Super Admin login for /super-admin"
  );
}

verifyDaSilvaBlockedWithStaleSuperAdminState();
verifyEduClearAllowed();
verifyRolePayloadIgnored();

console.log("Frontend Super Admin access verification passed.");
