import type {
  DaSilvaBillingImportPreview,
  DaSilvaFileSlots,
  DaSilvaKideesysBillingMatchPreview,
  DaSilvaManifestDebugReport,
  DaSilvaProjectStatus,
  DaSilvaSavedFilesAuditRow,
  DaSilvaSasamsClassesLearnersPreview,
  DaSilvaSasamsParentsLinksPreview,
  DaSilvaStagedUploadStatus,
  DaSilvaUploadResponse,
  DaSilvaWizardPreviews,
} from "../types/daSilvaMigration";

async function daSilvaFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { API_URL } = await import("../../api");
  const { superAdminAuthHeaders } = await import("../superAdminApi");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...superAdminAuthHeaders(),
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const errMsg =
      data?.manifestErrors?.length > 0
        ? `${data.error || "Request failed"}: ${data.manifestErrors.join("; ")}`
        : data?.error || `Request failed (${res.status})`;
    throw new Error(errMsg);
  }
  return data as T;
}

export async function createDaSilvaProject(schoolId: string): Promise<string> {
  const data = await daSilvaFetch<{ projectId: string }>("/api/super-admin/migration/da-silva/projects", {
    method: "POST",
    body: JSON.stringify({ schoolId }),
  });
  return data.projectId;
}

export async function uploadDaSilvaStagingFiles(opts: {
  schoolId: string;
  projectId: string;
  slots: DaSilvaFileSlots;
}): Promise<DaSilvaUploadResponse> {
  const form = new FormData();
  form.append("schoolId", opts.schoolId);
  form.append("projectId", opts.projectId);
  for (const file of opts.slots.classListFiles) {
    form.append("classListFiles", file);
  }
  if (opts.slots.learnerRegister) form.append("learnerRegister", opts.slots.learnerRegister);
  if (opts.slots.parentLearnerLinks) form.append("parentLearnerLinks", opts.slots.parentLearnerLinks);
  if (opts.slots.parentRegister) form.append("parentRegister", opts.slots.parentRegister);
  if (opts.slots.billingPlan) form.append("billingPlan", opts.slots.billingPlan);
  if (opts.slots.ageAnalysis) form.append("ageAnalysis", opts.slots.ageAnalysis);
  if (opts.slots.transactions) form.append("transactions", opts.slots.transactions);
  if (opts.slots.contactList) form.append("contactList", opts.slots.contactList);
  if (opts.slots.employeeContactList) {
    form.append("employeeContactList", opts.slots.employeeContactList);
  }

  return daSilvaFetch<DaSilvaUploadResponse>("/api/super-admin/migration/da-silva/upload", {
    method: "POST",
    body: form,
  });
}

export async function fetchDaSilvaManifestDebug(
  schoolId: string,
  projectId: string
): Promise<DaSilvaManifestDebugReport> {
  return daSilvaFetch(
    `/api/super-admin/migration/da-silva/${encodeURIComponent(schoolId)}/${encodeURIComponent(projectId)}/manifest-debug`
  );
}

export async function fetchDaSilvaProjectStatus(
  schoolId: string,
  projectId: string
): Promise<DaSilvaProjectStatus> {
  return daSilvaFetch(
    `/api/super-admin/migration/da-silva/projects/${encodeURIComponent(projectId)}/status?schoolId=${encodeURIComponent(schoolId)}`
  );
}

export async function previewDaSilvaSasamsClassesLearners(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaSasamsClassesLearnersPreview> {
  return daSilvaFetch("/api/super-admin/migration/da-silva/preview/sasams-classes-learners", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function previewDaSilvaSasamsParentsLinks(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaSasamsParentsLinksPreview> {
  return daSilvaFetch("/api/super-admin/migration/da-silva/preview/sasams-parents-links", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function previewDaSilvaKideesysBillingMatch(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaKideesysBillingMatchPreview> {
  return daSilvaFetch("/api/super-admin/migration/da-silva/preview/kideesys-billing-match", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function previewDaSilvaBillingImport(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaBillingImportPreview> {
  return daSilvaFetch("/api/super-admin/migration/da-silva/preview/billing-import", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function runAllDaSilvaPreviews(opts: {
  schoolId: string;
  projectId: string;
}): Promise<DaSilvaWizardPreviews> {
  const sasamsClassesLearners = await previewDaSilvaSasamsClassesLearners(opts);
  const sasamsParentsLinks = await previewDaSilvaSasamsParentsLinks(opts);
  const kideesysBillingMatch = await previewDaSilvaKideesysBillingMatch(opts);
  const billingImport = await previewDaSilvaBillingImport(opts);
  return { sasamsClassesLearners, sasamsParentsLinks, kideesysBillingMatch, billingImport };
}

export async function importDaSilvaPhase(
  phase: "classrooms" | "learners" | "parents" | "billing-match" | "billing",
  opts: { schoolId: string; projectId: string }
) {
  const pathMap = {
    classrooms: "classrooms",
    learners: "learners",
    parents: "parents",
    "billing-match": "billing-match",
    billing: "billing",
  } as const;
  return daSilvaFetch(`/api/super-admin/migration/da-silva/import/${pathMap[phase]}`, {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

export async function rollbackDaSilvaImport(opts: { schoolId: string; projectId: string }) {
  return daSilvaFetch("/api/super-admin/migration/da-silva/rollback", {
    method: "POST",
    body: JSON.stringify(opts),
  });
}

const AUDIT_SLOT_LABELS: Record<string, string> = {
  "sasams.classLists": "SA-SAMS class lists (≥20 files)",
  "sasams.learnerRegister": "SA-SAMS learner_register.xls",
  "sasams.parentLearnerLinks": "SA-SAMS parent_learner_links.xls",
  "sasams.parentRegister": "SA-SAMS parent_register.xls",
  "kideesys.billingPlanSummary": "Kid-e-Sys billing plan summary",
  "kideesys.ageAnalysis": "Kid-e-Sys age analysis",
  "kideesys.transactionList": "Kid-e-Sys transaction list",
  "kideesys.contactList": "Kid-e-Sys contact list",
  "kideesys.employeeContactList": "Kid-e-Sys employee contact list",
};

export function buildSavedFilesAuditRows(report: DaSilvaManifestDebugReport): DaSilvaSavedFilesAuditRow[] {
  return report.slots.map((slot) => ({
    slot: slot.slot,
    label: AUDIT_SLOT_LABELS[slot.slot] || slot.slot,
    filename: slot.basename,
    path: slot.path,
    ok: slot.readable,
  }));
}

export function allDaSilvaManifestSlotsGreen(report: DaSilvaManifestDebugReport | null): boolean {
  if (!report?.manifestExists) return false;
  return report.manifestReady && report.slots.every((s) => s.readable);
}

export function allDaSilvaSlotsReady(uploads: DaSilvaStagedUploadStatus): boolean {
  return Boolean(uploads.manifestReady);
}

export function allDaSilvaPreviewsPassed(previews: DaSilvaWizardPreviews): boolean {
  return Boolean(
    previews.sasamsClassesLearners?.passed &&
      previews.sasamsParentsLinks?.passed &&
      previews.kideesysBillingMatch?.passed &&
      previews.billingImport?.passed
  );
}

export function formatDaSilvaWizardReport(previews: DaSilvaWizardPreviews): string {
  const lines: string[] = [];
  const cl = previews.sasamsClassesLearners;
  if (cl) {
    lines.push(
      "=== SA-SAMS classes & learners ===",
      cl.passed ? "✓ Passed" : "✗ Blocked",
      `Class files: ${cl.debug?.classListFilesFound ?? cl.classroomValidation.sourceFileCount} · Unique classrooms: ${cl.classroomValidation.uniqueCanonicalCount}`,
      `SA-SAMS learners: ${cl.sasamsClassListLearners ?? cl.totalLearners} (expected ${cl.expectedSasamsLearners ?? 388})`,
      `Crèche supplement (Kid-e-Sys): ${cl.crecheSupplementExpected ?? 8} → final roster ${cl.finalLearnersExpected ?? 396}`,
      `Missing ID: ${cl.missingId} · DOB: ${cl.missingDob} · Gender: ${cl.missingGender}`,
      "",
      "Learners per class:"
    );
    for (const row of cl.learnersPerClass) {
      lines.push(`  ${row.classroomName}: ${row.count}`);
    }
    if (cl.headerDetection.files.length) {
      lines.push("", "Header detection (sample):");
      for (const f of cl.headerDetection.files.slice(0, 5)) {
        lines.push(
          `  ${f.file}: row ${f.headerRow}, ${f.mappedColumns.length} mapped column(s), ${f.learnerCount} learners`
        );
      }
    }
    if (cl.classListFilesFound?.length) {
      lines.push("", "Class files:", ...cl.classListFilesFound.map((f) => `  ${f}`));
    }
    if (cl.errors.length) {
      lines.push("", "Errors:", ...cl.errors.map((e) => `  • ${e}`));
    }
    lines.push("");
  }

  const pl = previews.sasamsParentsLinks;
  if (pl) {
    lines.push(
      "=== SA-SAMS parents & links ===",
      pl.passed ? "✓ Passed" : "✗ Blocked",
      `Parent register rows: ${pl.debug?.parentRegisterRowsParsed ?? pl.parentRegisterRows} · Link file rows: ${pl.debug?.parentLinkRowsParsed ?? pl.parentLinksRows}`,
      `Matched links: ${pl.debug?.parentLinksMatched ?? pl.matchedLinks} / ${pl.expectedParentLinks}`,
      `Unmatched: ${pl.debug?.parentLinksUnmatched ?? pl.unmatchedParents} · Ambiguous: ${pl.duplicateMatches}`
    );
    if (pl.sampleUnmatched.length) {
      lines.push("", "Unmatched examples:");
      for (const u of pl.sampleUnmatched.slice(0, 8)) {
        lines.push(
          `  ${u.parentFirstName} ${u.parentSurname} → learner ${u.learnerName ?? "?"} (${u.learnerAdmissionNo ?? "no ref"}, ${u.learnerClassName ?? "no class"})`
        );
      }
    }
    if (pl.errors.length) lines.push(...pl.errors.map((e) => `  • ${e}`));
    lines.push("");
  }

  const bm = previews.kideesysBillingMatch;
  if (bm) {
    lines.push(
      "=== Kid-e-Sys billing match ===",
      bm.passed ? "✓ Passed" : "✗ Blocked",
      `Matched: ${bm.matchedAccounts} / ${bm.totalAccounts} (${(bm.matchRatio * 100).toFixed(1)}%)`,
      `Unmatched accounts: ${bm.unmatchedAccounts} (manual review, not a parser failure)`
    );
    const unmatchedSample = bm.debug?.sampleUnmatched ?? bm.sampleUnmatched;
    if (unmatchedSample.length) {
      lines.push("", "Unmatched account examples:");
      for (const u of unmatchedSample.slice(0, 8)) {
        lines.push(`  ${u.accountNo}: ${u.fullName.replace(/\n/g, " / ")}`);
      }
    }
    if (bm.errors.length) lines.push(...bm.errors.map((e) => `  • ${e}`));
    lines.push("");
  }

  const bi = previews.billingImport;
  if (bi) {
    lines.push(
      "=== Billing import preview ===",
      bi.passed ? "✓ Passed" : "✗ Blocked",
      `Billing accounts: ${bi.stagingValidation.actualBillingAccounts}`,
      `Learners on billing plan: ${bi.stagingValidation.learnersWithBillingPlan}`,
      `Age analysis outstanding: R ${bi.stagingValidation.ageAnalysisTotalOutstanding.toLocaleString("en-ZA", { minimumFractionDigits: 2 })}`,
      `Transaction rows: ${bi.transactionRowCount}`
    );
    if (bi.errors.length) lines.push(...bi.errors.map((e) => `  • ${e}`));
  }

  return lines.join("\n");
}

export function slotsSatisfyUpload(slots: DaSilvaFileSlots): boolean {
  return (
    slots.classListFiles.length >= 20 &&
    Boolean(slots.learnerRegister) &&
    Boolean(slots.parentLearnerLinks) &&
    Boolean(slots.parentRegister) &&
    Boolean(slots.billingPlan) &&
    Boolean(slots.ageAnalysis) &&
    Boolean(slots.transactions) &&
    Boolean(slots.contactList) &&
    Boolean(slots.employeeContactList)
  );
}
