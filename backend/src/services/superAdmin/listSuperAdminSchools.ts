import {
  EduClearPackageCode,
  SchoolSubscriptionStatus,
  UserRole,
  type Prisma,
} from "@prisma/client";

import { prisma } from "../../prisma";

export type SuperAdminSchoolSummary = {
  total: number;
  active: number;
  suspended: number;
  trial: number;
};

export type SuperAdminSchoolListItem = {
  id: string;
  schoolName: string;
  ownerName: string;
  ownerEmail: string;
  contactPhone: string | null;
  package: string;
  packageCode: EduClearPackageCode | null;
  subscriptionStatus: SchoolSubscriptionStatus | null;
  status: "Active" | "Trial" | "Suspended";
  isActive: boolean;
  learnerCount: number;
  parentCount: number;
  registeredAt: string;
  lastLoginAt: string | null;
};

export type SuperAdminSchoolsListResult = {
  schools: SuperAdminSchoolListItem[];
  summary: SuperAdminSchoolSummary;
};

const PACKAGE_LABEL: Record<EduClearPackageCode, string> = {
  STARTER: "Starter",
  UNLIMITED: "Unlimited",
};

type SchoolAdminUser = {
  email: string;
  fullName: string | null;
  isActive: boolean;
  roleRef: { isOwner: boolean } | null;
  rbacMeta: {
    lastLoginAt: Date | null;
    appRole: string;
    firstName: string;
    surname: string;
  } | null;
};

function packageLabel(
  code: EduClearPackageCode | null | undefined,
  packageName: string | null | undefined
): string {
  if (packageName?.trim()) return packageName.trim();
  if (code && PACKAGE_LABEL[code]) return PACKAGE_LABEL[code];
  return "—";
}

function mapSubscriptionToUiStatus(
  subscriptionStatus: SchoolSubscriptionStatus | null | undefined
): "Active" | "Trial" | "Suspended" {
  switch (subscriptionStatus) {
    case SchoolSubscriptionStatus.ACTIVE:
      return "Active";
    case SchoolSubscriptionStatus.SUSPENDED:
    case SchoolSubscriptionStatus.CANCELLED:
      return "Suspended";
    case SchoolSubscriptionStatus.PENDING_PAYMENT:
    case SchoolSubscriptionStatus.PAST_DUE:
    default:
      return "Trial";
  }
}

function isOwnerUser(user: SchoolAdminUser): boolean {
  if (user.roleRef?.isOwner) return true;
  return String(user.rbacMeta?.appRole || "").trim() === "Owner";
}

function pickOwnerUser(users: SchoolAdminUser[]): SchoolAdminUser | null {
  if (!users.length) return null;
  const owner = users.find(isOwnerUser);
  return owner ?? users[0];
}

function ownerDisplayName(user: SchoolAdminUser | null, schoolEmail: string): string {
  if (!user) return schoolEmail || "—";
  const fromFull = user.fullName?.trim();
  if (fromFull) return fromFull;
  const meta = user.rbacMeta;
  if (meta) {
    const combined = `${meta.firstName} ${meta.surname}`.trim();
    if (combined) return combined;
  }
  return user.email || schoolEmail || "—";
}

function maxLastLogin(users: SchoolAdminUser[]): string | null {
  let latest: Date | null = null;
  for (const user of users) {
    const at = user.rbacMeta?.lastLoginAt;
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest ? latest.toISOString() : null;
}

function computeSummary(schools: SuperAdminSchoolListItem[]): SuperAdminSchoolSummary {
  return {
    total: schools.length,
    active: schools.filter((s) => s.status === "Active").length,
    suspended: schools.filter((s) => s.status === "Suspended").length,
    trial: schools.filter((s) => s.status === "Trial").length,
  };
}

function schoolContactPhone(phone: string | null | undefined, cellNo: string | null | undefined): string | null {
  const landline = String(phone || "").trim();
  const mobile = String(cellNo || "").trim();
  if (landline && mobile) return `${landline} · ${mobile}`;
  return landline || mobile || null;
}

const schoolListSelect = {
  id: true,
  name: true,
  email: true,
  phone: true,
  cellNo: true,
  createdAt: true,
  schoolSubscription: {
    select: {
      status: true,
      packageCode: true,
      package: { select: { name: true } },
    },
  },
  _count: {
    select: {
      learners: true,
      parents: true,
    },
  },
  users: {
    where: {
      OR: [
        { roleRef: { isOwner: true } },
        { rbacMeta: { appRole: "Owner" } },
        { role: UserRole.SCHOOL_ADMIN },
      ],
    },
    orderBy: { createdAt: "asc" as const },
    take: 12,
    select: {
      email: true,
      fullName: true,
      isActive: true,
      roleRef: { select: { isOwner: true } },
      rbacMeta: {
        select: {
          lastLoginAt: true,
          appRole: true,
          firstName: true,
          surname: true,
        },
      },
    },
  },
} satisfies Prisma.SchoolSelect;

type SchoolListRow = Prisma.SchoolGetPayload<{ select: typeof schoolListSelect }>;

function mapSchoolRow(row: SchoolListRow): SuperAdminSchoolListItem {
  const adminUsers = row.users as SchoolAdminUser[];
  const owner = pickOwnerUser(adminUsers);
  const subscription = row.schoolSubscription;
  const uiStatus = mapSubscriptionToUiStatus(subscription?.status);
  const ownerEmail = owner?.email || row.email || "";
  const ownerName = ownerDisplayName(owner, ownerEmail);

  return {
    id: row.id,
    schoolName: row.name,
    ownerName,
    ownerEmail,
    contactPhone: schoolContactPhone(row.phone, row.cellNo),
    package: packageLabel(subscription?.packageCode, subscription?.package?.name),
    packageCode: subscription?.packageCode ?? null,
    subscriptionStatus: subscription?.status ?? null,
    status: uiStatus,
    isActive: uiStatus === "Active" && (owner?.isActive ?? true),
    learnerCount: row._count.learners,
    parentCount: row._count.parents,
    registeredAt: row.createdAt.toISOString(),
    lastLoginAt: maxLastLogin(adminUsers),
  };
}

/** All registered schools with summary counts for platform super-admin monitoring. */
export async function listSuperAdminSchools(): Promise<SuperAdminSchoolsListResult> {
  const rows = await prisma.school.findMany({
    select: schoolListSelect,
    orderBy: { name: "asc" },
  });

  const schools = rows.map(mapSchoolRow);
  return {
    schools,
    summary: computeSummary(schools),
  };
}
