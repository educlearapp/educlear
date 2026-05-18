export type SchoolStatus = "Active" | "Trial" | "Suspended";

export type SchoolPackage = "Starter" | "Growth" | "Professional" | "Unlimited";

export type SchoolRecord = {
  id: string;
  schoolName: string;
  ownerName: string;
  email: string;
  package: SchoolPackage;
  status: SchoolStatus;
  learnerCount: number;
  registeredAt: string | null;
  lastLoginAt: string | null;
};

export type SchoolsSummary = {
  total: number;
  active: number;
  suspended: number;
  trial: number;
};

export const SCHOOL_STATUS_OPTIONS: SchoolStatus[] = ["Active", "Trial", "Suspended"];

export const SCHOOL_PACKAGE_OPTIONS: SchoolPackage[] = [
  "Starter",
  "Growth",
  "Professional",
  "Unlimited",
];
