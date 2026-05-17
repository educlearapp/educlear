export const AUDIT_TRAIL_STORAGE_PREFIX = "educlearAccountingAuditTrail:";
export const LOCKED_PERIODS_STORAGE_PREFIX = "educlearAccountingLockedPeriods:";
export const SUPPORTING_DOCS_STORAGE_PREFIX = "educlearAccountingSupportingDocs:";
export const AUDIT_PACK_STORAGE_PREFIX = "educlearAccountingAuditPack:";

export const ACCOUNTING_AUDIT_COMPLIANCE_UPDATED_EVENT = "educlear-accounting-audit-compliance-updated";

export type ComplianceAuditAction =
  | "Created journal"
  | "Posted journal"
  | "Reversed journal"
  | "Edited journal"
  | "Approved expense"
  | "Added supplier"
  | "Added asset"
  | "Locked period"
  | "Reopened period";

export type ComplianceAuditModule =
  | "Journals"
  | "Expenses"
  | "Suppliers"
  | "Assets"
  | "Period Locks"
  | "Audit & Compliance";

export type ComplianceAuditEntry = {
  id: string;
  timestamp: string;
  user: string;
  module: ComplianceAuditModule;
  action: string;
  reference: string;
  details: string;
  sourceKey?: string;
};

export type LockedPeriodType = "month" | "doe" | "sars";

export type LockedPeriodRecord = {
  id: string;
  periodType: LockedPeriodType;
  periodKey: string;
  label: string;
  status: "locked" | "reopened";
  lockedBy: string;
  lockedAt: string;
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
};

export type SupportingDocumentType =
  | "Invoice"
  | "Receipt"
  | "Proof of Payment"
  | "Contract"
  | "Bank Statement"
  | "SARS Document"
  | "Audit Evidence"
  | "Other";

export type SupportingDocument = {
  id: string;
  title: string;
  documentType: SupportingDocumentType;
  linkedModule: string;
  notes: string;
  uploadedDate: string;
  createdAt: string;
};

export type AuditPackItemId =
  | "financial-statements"
  | "general-ledger"
  | "trial-balance"
  | "debtors-ageing"
  | "creditors-ageing"
  | "asset-register"
  | "depreciation-schedule"
  | "journal-listing"
  | "bank-reconciliation"
  | "supplier-listing";

export type AuditPackStore = {
  items: Partial<
    Record<
      AuditPackItemId,
      {
        prepared: boolean;
        preparedAt?: string;
        preparedBy?: string;
      }
    >
  >;
  updatedAt: string;
};

export const AUDIT_PACK_ITEMS: { id: AuditPackItemId; label: string }[] = [
  { id: "financial-statements", label: "Financial Statements" },
  { id: "general-ledger", label: "General Ledger" },
  { id: "trial-balance", label: "Trial Balance" },
  { id: "debtors-ageing", label: "Debtors Ageing" },
  { id: "creditors-ageing", label: "Creditors Ageing" },
  { id: "asset-register", label: "Asset Register" },
  { id: "depreciation-schedule", label: "Depreciation Schedule" },
  { id: "journal-listing", label: "Journal Listing" },
  { id: "bank-reconciliation", label: "Bank Reconciliation" },
  { id: "supplier-listing", label: "Supplier Listing" },
];

export const SUPPORTING_DOC_TYPES: SupportingDocumentType[] = [
  "Invoice",
  "Receipt",
  "Proof of Payment",
  "Contract",
  "Bank Statement",
  "SARS Document",
  "Audit Evidence",
  "Other",
];

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function auditTrailKey(schoolId: string) {
  return `${AUDIT_TRAIL_STORAGE_PREFIX}${schoolId}`;
}

function lockedPeriodsKey(schoolId: string) {
  return `${LOCKED_PERIODS_STORAGE_PREFIX}${schoolId}`;
}

function supportingDocsKey(schoolId: string) {
  return `${SUPPORTING_DOCS_STORAGE_PREFIX}${schoolId}`;
}

function auditPackKey(schoolId: string) {
  return `${AUDIT_PACK_STORAGE_PREFIX}${schoolId}`;
}

export function dispatchAuditComplianceUpdated(schoolId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ACCOUNTING_AUDIT_COMPLIANCE_UPDATED_EVENT, {
      detail: { schoolId: String(schoolId || "").trim() },
    })
  );
}

export function loadAuditTrail(schoolId: string): ComplianceAuditEntry[] {
  if (!schoolId) return [];
  try {
    const raw = localStorage.getItem(auditTrailKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveAuditTrail(schoolId: string, entries: ComplianceAuditEntry[]) {
  if (!schoolId) return;
  localStorage.setItem(auditTrailKey(schoolId), JSON.stringify(entries));
  dispatchAuditComplianceUpdated(schoolId);
}

export function appendAuditTrailEntry(
  schoolId: string,
  entry: Omit<ComplianceAuditEntry, "id" | "timestamp"> & { id?: string; timestamp?: string }
) {
  const rows = loadAuditTrail(schoolId);
  const next: ComplianceAuditEntry = {
    id: entry.id || uid("aud"),
    timestamp: entry.timestamp || new Date().toISOString(),
    user: entry.user || "Finance User",
    module: entry.module,
    action: entry.action,
    reference: entry.reference,
    details: entry.details,
    sourceKey: entry.sourceKey,
  };
  saveAuditTrail(schoolId, [next, ...rows]);
  return next;
}

export function loadLockedPeriods(schoolId: string): LockedPeriodRecord[] {
  if (!schoolId) return [];
  try {
    const raw = localStorage.getItem(lockedPeriodsKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLockedPeriods(schoolId: string, rows: LockedPeriodRecord[]) {
  if (!schoolId) return;
  localStorage.setItem(lockedPeriodsKey(schoolId), JSON.stringify(rows));
  dispatchAuditComplianceUpdated(schoolId);
}

export function loadSupportingDocuments(schoolId: string): SupportingDocument[] {
  if (!schoolId) return [];
  try {
    const raw = localStorage.getItem(supportingDocsKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSupportingDocuments(schoolId: string, rows: SupportingDocument[]) {
  if (!schoolId) return;
  localStorage.setItem(supportingDocsKey(schoolId), JSON.stringify(rows));
  dispatchAuditComplianceUpdated(schoolId);
}

export function emptyAuditPackStore(): AuditPackStore {
  return { items: {}, updatedAt: new Date().toISOString() };
}

export function loadAuditPackStore(schoolId: string): AuditPackStore {
  if (!schoolId) return emptyAuditPackStore();
  try {
    const raw = localStorage.getItem(auditPackKey(schoolId));
    if (!raw) return emptyAuditPackStore();
    const parsed = JSON.parse(raw);
    return {
      items: parsed?.items && typeof parsed.items === "object" ? parsed.items : {},
      updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
    };
  } catch {
    return emptyAuditPackStore();
  }
}

export function saveAuditPackStore(schoolId: string, store: AuditPackStore) {
  if (!schoolId) return;
  localStorage.setItem(
    auditPackKey(schoolId),
    JSON.stringify({ ...store, updatedAt: new Date().toISOString() })
  );
  dispatchAuditComplianceUpdated(schoolId);
}

export function markAuditPackItemPrepared(
  schoolId: string,
  itemId: AuditPackItemId,
  preparedBy: string
) {
  const store = loadAuditPackStore(schoolId);
  store.items[itemId] = {
    prepared: true,
    preparedAt: new Date().toISOString(),
    preparedBy,
  };
  saveAuditPackStore(schoolId, store);
}

export function markAllAuditPackPrepared(schoolId: string, preparedBy: string) {
  const store = loadAuditPackStore(schoolId);
  for (const item of AUDIT_PACK_ITEMS) {
    store.items[item.id] = {
      prepared: true,
      preparedAt: new Date().toISOString(),
      preparedBy,
    };
  }
  saveAuditPackStore(schoolId, store);
}
