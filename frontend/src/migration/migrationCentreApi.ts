import { staffApiFetch, staffFormPost } from "../staffApi";
import type {
  MigrationBillingPlansApplyResult,
  MigrationBillingPlansPreview,
  MigrationLearnerRepairApplyResult,
  MigrationLearnerRepairPreview,
} from "./types/migrationCentre";

export function formatMigrationMoney(amount: number): string {
  return `R ${Number(amount || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export async function previewMigrationBillingPlans(opts: {
  schoolId: string;
  file: File;
}): Promise<MigrationBillingPlansPreview> {
  const form = new FormData();
  form.append("schoolId", opts.schoolId);
  form.append("file", opts.file, opts.file.name);
  return (await staffFormPost("/api/migration/billing-plans/preview", form)) as MigrationBillingPlansPreview;
}

export async function applyMigrationBillingPlans(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<MigrationBillingPlansApplyResult> {
  return (await staffApiFetch("/api/migration/billing-plans/apply", {
    method: "POST",
    body: JSON.stringify(opts),
  })) as MigrationBillingPlansApplyResult;
}

const LEARNER_GENDER_REPAIR_BASE = "/api/super-admin/migration/learner-repair";

export async function previewMigrationLearnerRepair(opts: {
  schoolId: string;
  files: File[];
}): Promise<MigrationLearnerRepairPreview> {
  const form = new FormData();
  form.append("schoolId", opts.schoolId);
  for (const file of opts.files) {
    form.append("files", file, file.name);
  }
  return (await staffFormPost(
    `${LEARNER_GENDER_REPAIR_BASE}/preview`,
    form
  )) as MigrationLearnerRepairPreview;
}

export async function applyMigrationLearnerRepair(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<MigrationLearnerRepairApplyResult> {
  return (await staffApiFetch(`${LEARNER_GENDER_REPAIR_BASE}/apply`, {
    method: "POST",
    body: JSON.stringify(opts),
  })) as MigrationLearnerRepairApplyResult;
}
