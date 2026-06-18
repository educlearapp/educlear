import { isAuthenticatedSuperAdminEmail, requireSuperAdmin } from "../middleware/requireSuperAdmin";
import { canAccessMigration } from "../utils/migrationAccess";
import {
  isPlatformSuperAdminEmail,
  parseSuperAdminEmails,
  PLATFORM_SUPER_ADMIN_EMAIL,
} from "../utils/superAdmin";
import { normalizeLearnerEnrollmentStatusUpdate } from "../utils/learnerEnrollment";

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(message);
  }
}

function verifyAccessControl() {
  assert(
    isPlatformSuperAdminEmail(PLATFORM_SUPER_ADMIN_EMAIL),
    "info@educlear.co.za must be allowed"
  );
  assert(
    !isPlatformSuperAdminEmail("dasilvaacademy@gmail.com"),
    "Da Silva Academy email must not be allowed"
  );
  assert(
    !isPlatformSuperAdminEmail("owner@example-school.test"),
    "Other school user must not be allowed"
  );

  process.env.SUPER_ADMIN_EMAILS = "dasilvaacademy@gmail.com,owner@example-school.test";
  assert(
    parseSuperAdminEmails().length === 1 &&
      parseSuperAdminEmails()[0] === PLATFORM_SUPER_ADMIN_EMAIL,
    "environment allowlist must not expand Super Admin access"
  );

  assert(
    canAccessMigration({
      userId: "platform",
      schoolId: "educlear",
      email: PLATFORM_SUPER_ADMIN_EMAIL,
      role: "STAFF",
    }),
    "info@educlear.co.za must access Super Admin APIs"
  );
  assert(
    !canAccessMigration({
      userId: "da-silva",
      schoolId: "cmpideqeq0000108xb6ouv9zi",
      email: "dasilvaacademy@gmail.com",
      role: "SUPER_ADMIN",
    }),
    "Da Silva Academy must be rejected even with SUPER_ADMIN role"
  );
  assert(
    !canAccessMigration({
      userId: "other-school",
      schoolId: "school-1",
      email: "owner@example-school.test",
      role: "SUPER_ADMIN",
    }),
    "Other school user must be rejected even with SUPER_ADMIN role"
  );
}

async function verifySuperAdminApiGuard() {
  assert(
    isAuthenticatedSuperAdminEmail(PLATFORM_SUPER_ADMIN_EMAIL, true),
    "info@educlear.co.za active DB user must pass Super Admin email rule"
  );
  assert(
    !isAuthenticatedSuperAdminEmail("dasilvaacademy@gmail.com", true),
    "Da Silva DB email must fail Super Admin email rule"
  );
  assert(
    !isAuthenticatedSuperAdminEmail(PLATFORM_SUPER_ADMIN_EMAIL, false),
    "inactive info@educlear.co.za user must fail Super Admin email rule"
  );
  assert(
    !isAuthenticatedSuperAdminEmail("dasilvaacademy@gmail.com", true),
    "Da Silva DB email must fail even when JWT email says info@educlear.co.za"
  );

  async function runGuardWithoutToken() {
    let statusCode = 200;
    let body: unknown = null;
    let nextCalled = false;

    await requireSuperAdmin(
      { headers: {} } as any,
      {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: unknown) {
          body = payload;
          return this;
        },
      } as any,
      (() => {
        nextCalled = true;
      }) as any
    );

    return { statusCode, body, nextCalled };
  }

  const unauthenticated = await runGuardWithoutToken();
  assert(
    unauthenticated.statusCode === 401 && !unauthenticated.nextCalled,
    "Super Admin API guard must require authentication"
  );
}

function verifyUnenrolStatus() {
  assert(
    normalizeLearnerEnrollmentStatusUpdate("HISTORICAL") === "HISTORICAL",
    "HISTORICAL status must be accepted"
  );
  assert(
    normalizeLearnerEnrollmentStatusUpdate("unenrolled") === "HISTORICAL",
    "unenrolled alias must map to HISTORICAL"
  );
  assert(
    normalizeLearnerEnrollmentStatusUpdate("ACTIVE") === "ACTIVE",
    "ACTIVE status must be accepted"
  );
  assert(
    normalizeLearnerEnrollmentStatusUpdate("DELETE") === null,
    "invalid status must be rejected"
  );
}

async function main() {
  verifyAccessControl();
  await verifySuperAdminApiGuard();
  verifyUnenrolStatus();

  console.log("Access control and unenrol verification passed.");
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
