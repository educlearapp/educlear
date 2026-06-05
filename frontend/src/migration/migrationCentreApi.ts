import { staffApiFetch, staffFormPost } from "../staffApi";
import { superAdminApiUpload } from "../superAdmin/superAdminApi";
import type {
  MigrationBillingPlansApplyResult,
  MigrationBillingPlansPreview,
  MigrationLearnerRepairApplyResult,
  MigrationLearnerRepairPreview,
  MigrationTopupPaymentBatchSummary,
  MigrationTopupPaymentsApplyResult,
  MigrationTopupPaymentsPreview,
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

export async function previewMigrationTopupPayments(opts: {
  schoolId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<MigrationTopupPaymentsPreview> {
  const form = new FormData();
  form.append("schoolId", opts.schoolId);
  form.append("file", opts.file, opts.file.name);
  return (await superAdminApiUpload(
    "/api/migration/topup-payments/preview",
    form,
    opts.onProgress
  )) as MigrationTopupPaymentsPreview;
}

export async function applyMigrationTopupPayments(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<MigrationTopupPaymentsApplyResult> {
  return (await staffApiFetch("/api/migration/topup-payments/apply", {
    method: "POST",
    body: JSON.stringify(opts),
  })) as MigrationTopupPaymentsApplyResult;
}

export async function listMigrationTopupPaymentBatches(opts: {
  schoolId: string;
}): Promise<{ success: boolean; batches: MigrationTopupPaymentBatchSummary[] }> {
  const qs = new URLSearchParams({ schoolId: opts.schoolId });
  return (await staffApiFetch(`/api/migration/topup-payments/batches?${qs.toString()}`)) as {
    success: boolean;
    batches: MigrationTopupPaymentBatchSummary[];
  };
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
