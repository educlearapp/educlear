import { prisma } from "../prisma";
import {
  DA_SILVA_ACADEMY_SCHOOL_ID,
  DA_SILVA_OWNER_EMAIL,
  getDaSilvaResolvedSchoolId,
} from "./activateDaSilvaSubscription";
import {
  compareAuthPassword,
  hashAuthPassword,
  normalizeAuthEmail,
} from "./authCredentials";
import { buildAuthDiagnostics } from "./authDiagnostics";
import { isProductionOrGoLive } from "./runtime";
import { getUserAccessMeta, setUserAccessMeta } from "../utils/userAccessStore";
import { permissionsForRole, prismaRoleForAppRole } from "../utils/userPermissions";

/** Production owner login for Da Silva Academy dashboard (startup ensure only). */
export const DA_SILVA_LOGIN_PASSWORD = "benfica4444";

const OWNER_FULL_NAME = "Da Silva Academy";
const OWNER_EMAIL = normalizeAuthEmail(DA_SILVA_OWNER_EMAIL);

export type EnsureDaSilvaLoginResult = {
  ok: boolean;
  userFound: boolean;
  userCreated: boolean;
  userId: string | null;
  schoolId: string;
  schoolLinked: boolean;
  passwordReset: boolean;
  loginReady: boolean;
};

/**
 * Idempotent Da Silva owner login repair: user row + password + school link + user-access meta.
 * Does not create schools, billing rows, registration records, or migration data.
 */
async function resolveDaSilvaLoginSchoolId(): Promise<string> {
  const canonical = await prisma.school.findUnique({
    where: { id: DA_SILVA_ACADEMY_SCHOOL_ID },
    select: { id: true },
  });
  if (canonical) return DA_SILVA_ACADEMY_SCHOOL_ID;
  return getDaSilvaResolvedSchoolId() || DA_SILVA_ACADEMY_SCHOOL_ID;
}

export async function ensureDaSilvaAcademyLogin(): Promise<EnsureDaSilvaLoginResult> {
  const schoolId = await resolveDaSilvaLoginSchoolId();
  const base: EnsureDaSilvaLoginResult = {
    ok: false,
    userFound: false,
    userCreated: false,
    userId: null,
    schoolId,
    schoolLinked: false,
    passwordReset: false,
    loginReady: false,
  };

  if (!isProductionOrGoLive()) {
    return base;
  }

  const school = await prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true },
  });
  if (!school) {
    console.error(
      `[startup] Da Silva login ensure skipped — school not found: ${schoolId}`
    );
    return base;
  }

  const passwordHash = await hashAuthPassword(DA_SILVA_LOGIN_PASSWORD);
  const ownerRole = prismaRoleForAppRole("Owner");

  const allByEmail = await prisma.user.findMany({
    where: { email: { equals: OWNER_EMAIL, mode: "insensitive" } },
    select: { id: true, schoolId: true, email: true, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  base.userFound = allByEmail.length > 0;

  for (const row of allByEmail) {
    if (row.schoolId !== schoolId && row.isActive) {
      await prisma.user.update({
        where: { id: row.id },
        data: { isActive: false },
      });
      console.log(
        `[startup] Da Silva login: deactivated duplicate user ${row.id} (schoolId=${row.schoolId})`
      );
    }
  }

  const existingOwner =
    allByEmail.find((u) => u.schoolId === schoolId) ??
    (allByEmail.length > 0 ? allByEmail[0]! : null);

  let userCreated = false;
  let schoolLinked = false;
  let owner: {
    id: string;
    schoolId: string;
    email: string;
    role: string;
    isActive: boolean;
    passwordHash: string;
  };

  if (existingOwner) {
    const needsSchoolLink = existingOwner.schoolId !== schoolId;
    owner = await prisma.user.update({
      where: { id: existingOwner.id },
      data: {
        email: OWNER_EMAIL,
        schoolId,
        fullName: OWNER_FULL_NAME,
        passwordHash,
        role: ownerRole,
        isActive: true,
      },
      select: {
        id: true,
        schoolId: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });
    schoolLinked = needsSchoolLink || owner.schoolId === schoolId;
  } else {
    owner = await prisma.user.create({
      data: {
        schoolId,
        email: OWNER_EMAIL,
        fullName: OWNER_FULL_NAME,
        passwordHash,
        role: ownerRole,
        isActive: true,
      },
      select: {
        id: true,
        schoolId: true,
        email: true,
        role: true,
        isActive: true,
        passwordHash: true,
      },
    });
    userCreated = true;
    schoolLinked = true;
    base.userFound = true;
  }

  const existingMeta = await getUserAccessMeta(owner.id);
  if (!existingMeta) {
    await setUserAccessMeta(owner.id, {
      schoolId,
      firstName: "Da Silva",
      surname: "Academy",
      appRole: "Owner",
      permissions: permissionsForRole("Owner"),
      lastLoginAt: null,
    });
  }

  const passwordOk = await compareAuthPassword(
    DA_SILVA_LOGIN_PASSWORD,
    owner.passwordHash
  );
  const diag = await buildAuthDiagnostics(OWNER_EMAIL, {
    testPassword: DA_SILVA_LOGIN_PASSWORD,
  });

  const ok = passwordOk && diag.loginReady;

  console.log(
    `[startup] Da Silva login ensure: user=${owner.id} created=${userCreated} schoolLinked=${schoolLinked} passwordReset=${passwordOk} loginReady=${diag.loginReady}`
  );
  if (diag.issues.length) {
    console.warn(`[startup] Da Silva login diagnostics: ${diag.issues.join("; ")}`);
  }

  return {
    ok,
    userFound: base.userFound || userCreated,
    userCreated,
    userId: owner.id,
    schoolId: owner.schoolId,
    schoolLinked,
    passwordReset: passwordOk,
    loginReady: diag.loginReady,
  };
}
