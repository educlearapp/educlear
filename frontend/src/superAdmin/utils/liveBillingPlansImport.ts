import { superAdminApiFetch, superAdminApiUpload } from "../superAdminApi";
import type {
  LiveBillingPlansApplyResult,
  LiveBillingPlansPreview,
} from "../types/liveBillingPlansImport";

const BASE = "/api/migration/billing-plans";

export async function previewLiveBillingPlansUpload(opts: {
  schoolId: string;
  file: File;
  onProgress?: (percent: number) => void;
}): Promise<LiveBillingPlansPreview> {
  const form = new FormData();
  form.append("schoolId", opts.schoolId);
  form.append("file", opts.file, opts.file.name);
  return (await superAdminApiUpload(`${BASE}/preview`, form, opts.onProgress)) as LiveBillingPlansPreview;
}

export async function applyLiveBillingPlansImport(opts: {
  schoolId: string;
  sessionId: string;
}): Promise<LiveBillingPlansApplyResult> {
  return (await superAdminApiFetch(`${BASE}/apply`, {
    method: "POST",
    body: JSON.stringify(opts),
  })) as LiveBillingPlansApplyResult;
}

export function formatMoney(amount: number): string {
  return `R ${Number(amount || 0).toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
