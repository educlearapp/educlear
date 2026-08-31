import type { SchoolLifecycleStatus } from "../schoolLifecycle";

export type SchoolStatus = SchoolLifecycleStatus;

export type SchoolPackage = "Starter" | "Growth" | "Professional" | "Unlimited" | "—" | (string & {});

export type SchoolRecord = {
  id: string;
  schoolName: string;
  ownerName: string;
  email: string;
  contactPhone: string | null;
  package: SchoolPackage;
  /** Organisation lifecycle. Separate from subscription/billing status. */
  lifecycleStatus: SchoolLifecycleStatus;
  status: SchoolLifecycleStatus;
  learnerCount: number;
  parentCount: number;
  registeredAt: string | null;
  lastLoginAt: string | null;
  /** True when lifecycle is ACTIVE and the owner account is active. */
  isActive: boolean;
  /** True when the signed-in session belongs to this school (can open /dashboard). */
  canOpenDashboard: boolean;
};

export type SchoolsSummary = {
  total: number;
  active: number;
  trial: number;
  inactive: number;
  archived: number;
};

export const SCHOOL_STATUS_OPTIONS: SchoolLifecycleStatus[] = [
  "ACTIVE",
  "TRIAL",
  "INACTIVE",
  "ARCHIVED",
];

export const SCHOOL_PACKAGE_OPTIONS: SchoolPackage[] = ["—", "Starter", "Unlimited"];
