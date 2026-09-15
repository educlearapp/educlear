import type { SchoolLifecycleStatus } from "../schoolLifecycle";

export type SchoolStatus = SchoolLifecycleStatus;

export type SchoolPackage =
  | "Core"
  | "Accounting"
  | "Payroll"
  | "Business"
  | "Accounting + Payroll"
  | "Core + Accounting"
  | "Core + Payroll"
  | "Full"
  | "Full ≤100"
  | "Full Unlimited"
  | "Starter"
  | "Unlimited"
  | "—"
  | (string & {});

/** Product module licenses — authoritative commercial package source. */
export type SchoolModuleEntitlements = {
  CORE: boolean;
  ACCOUNTING: boolean;
  PAYROLL: boolean;
};

export const DEFAULT_SCHOOL_MODULE_ENTITLEMENTS: SchoolModuleEntitlements = {
  CORE: true,
  ACCOUNTING: true,
  PAYROLL: true,
};

export type SchoolRecord = {
  id: string;
  schoolName: string;
  ownerName: string;
  email: string;
  contactPhone: string | null;
  /** Commercial modular package label (from entitlements + Full capacity). */
  package: SchoolPackage;
  /** Commercial SKU code (CORE, FULL_100, FULL_UNLIMITED, …). */
  commercialPackageCode?: string | null;
  /** Commercial SKU full name. */
  commercialPackageName?: string | null;
  /** Learner capacity for the commercial SKU (null = unlimited). */
  learnerLimit?: number | null;
  /** Human-readable learner capacity. */
  learnerCapacityLabel?: string | null;
  /** Legacy STARTER/UNLIMITED capacity label when present. */
  legacyCapacityPackage?: string | null;
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
  /** Commercial module entitlements (CORE / ACCOUNTING / PAYROLL — independently toggleable). */
  moduleEntitlements: SchoolModuleEntitlements;
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

/** New-sale / filter labels — modular packages. Legacy Starter/Unlimited kept for historical filter only. */
export const SCHOOL_PACKAGE_OPTIONS: SchoolPackage[] = [
  "—",
  "Core",
  "Accounting",
  "Payroll",
  "Business",
  "Core + Accounting",
  "Core + Payroll",
  "Full ≤100",
  "Full Unlimited",
  "Full",
  "Starter",
  "Unlimited",
];
