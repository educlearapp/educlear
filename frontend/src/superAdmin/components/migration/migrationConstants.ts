import type { DataCategory, MigrationSource } from "../../types/migration";

export const MIGRATION_SOURCES: { id: MigrationSource; label: string }[] = [
  { id: "sasams", label: "SASAMS" },
  { id: "kideesys", label: "Kid-e-Sys" },
  { id: "excel", label: "Excel" },
  { id: "csv", label: "CSV" },
  { id: "manual", label: "Manual Data Capture" },
];

export const DATA_CATEGORIES: DataCategory[] = [
  { id: "learners", label: "Learners" },
  { id: "parents", label: "Parents" },
  { id: "parentRelationships", label: "Parent relationships" },
  { id: "classes", label: "Classes" },
  { id: "schoolFeesAccounts", label: "School fees accounts" },
  { id: "openingBalances", label: "Opening balances" },
  { id: "invoices", label: "Invoices" },
  { id: "payments", label: "Payments" },
  { id: "staff", label: "Staff" },
  { id: "subjects", label: "Subjects" },
];
