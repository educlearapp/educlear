export const ASSETS_STORAGE_PREFIX = "educlearAccountingAssets:";
export const ACCOUNTING_ASSETS_UPDATED_EVENT = "educlear-accounting-assets-updated";

export type AssetStatus = "Active" | "Under Maintenance" | "Disposed";
export type DepreciationMethod = "Straight Line" | "None";

export type AssetRecord = {
  id: string;
  name: string;
  category: string;
  assetNumber: string;
  serialNumber: string;
  purchaseDate: string;
  purchaseCost: number;
  depreciationMethod: DepreciationMethod;
  usefulLifeYears: number;
  currentBookValue: number;
  location: string;
  assignedTo: string;
  supplier: string;
  warrantyExpiry: string;
  notes: string;
  status: AssetStatus;
  disposalDate: string;
  disposalAmount: number;
  disposalReason: string;
  disposalNotes: string;
  depreciationYearsApplied: number[];
  createdAt: string;
  updatedAt: string;
};

export type DepreciationView = {
  annualDepreciation: number;
  accumulatedDepreciation: number;
  bookValue: number;
  depreciationThisYear: number;
};

export type AssetTotals = {
  activeCount: number;
  totalCount: number;
  disposedCount: number;
  purchaseCostActive: number;
  purchaseCostAll: number;
};

export type BookValueTotals = {
  grossPurchaseCost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
};

export type DepreciationTotals = {
  expenseForYear: number;
  depreciationThisYearActive: number;
  accumulatedActive: number;
};

export type AssetCategorySummaryRow = {
  category: string;
  assetCount: number;
  purchaseCost: number;
  accumulatedDepreciation: number;
  netBookValue: number;
};

function assetsStorageKey(schoolId: string) {
  return ASSETS_STORAGE_PREFIX + schoolId;
}

function uid(prefix = "ast") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseIsoDate(value: string) {
  const d = new Date(`${String(value || "").slice(0, 10)}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function clampNonNegative(value: number) {
  const n = Number.isFinite(value) ? value : 0;
  return Math.max(0, n);
}

export function normalizeAsset(row: Record<string, unknown>): AssetRecord {
  return {
    id: String(row?.id || uid()),
    name: String(row?.name || "").trim(),
    category: String(row?.category || "Other").trim() || "Other",
    assetNumber: String(row?.assetNumber || "").trim(),
    serialNumber: String(row?.serialNumber || "").trim(),
    purchaseDate: String(row?.purchaseDate || "").slice(0, 10),
    purchaseCost: clampNonNegative(Number(row?.purchaseCost) || 0),
    depreciationMethod: row?.depreciationMethod === "None" ? "None" : "Straight Line",
    usefulLifeYears: clampNonNegative(Number(row?.usefulLifeYears) || 0),
    currentBookValue: clampNonNegative(Number(row?.currentBookValue) || 0),
    location: String(row?.location || "").trim(),
    assignedTo: String(row?.assignedTo || "").trim(),
    supplier: String(row?.supplier || "").trim(),
    warrantyExpiry: String(row?.warrantyExpiry || "").slice(0, 10),
    notes: String(row?.notes || "").trim(),
    status:
      row?.status === "Disposed"
        ? "Disposed"
        : row?.status === "Under Maintenance"
          ? "Under Maintenance"
          : "Active",
    disposalDate: String(row?.disposalDate || "").slice(0, 10),
    disposalAmount: clampNonNegative(Number(row?.disposalAmount) || 0),
    disposalReason: String(row?.disposalReason || "").trim(),
    disposalNotes: String(row?.disposalNotes || "").trim(),
    depreciationYearsApplied: Array.isArray(row?.depreciationYearsApplied)
      ? (row.depreciationYearsApplied as unknown[]).map((y) => Number(y)).filter((y) => Number.isFinite(y))
      : [],
    createdAt: String(row?.createdAt || new Date().toISOString()),
    updatedAt: String(row?.updatedAt || new Date().toISOString()),
  };
}

export function loadAssets(schoolId: string): AssetRecord[] {
  try {
    const raw = localStorage.getItem(assetsStorageKey(schoolId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((row: Record<string, unknown>) => normalizeAsset(row));
  } catch {
    return [];
  }
}

export function saveAssets(schoolId: string, rows: AssetRecord[]) {
  try {
    localStorage.setItem(assetsStorageKey(schoolId), JSON.stringify(rows));
  } catch {
    /* quota */
  }
}

export function notifyAssetsUpdated(schoolId: string) {
  window.dispatchEvent(
    new CustomEvent(ACCOUNTING_ASSETS_UPDATED_EVENT, { detail: { schoolId } })
  );
}

export function persistAssets(schoolId: string, rows: AssetRecord[]) {
  saveAssets(schoolId, rows);
  notifyAssetsUpdated(schoolId);
}

export function computeAssetDepreciation(asset: AssetRecord, asOf = new Date()): DepreciationView {
  const cost = clampNonNegative(Number(asset.purchaseCost) || 0);
  const method = asset.depreciationMethod || "None";
  const usefulLife = clampNonNegative(Number(asset.usefulLifeYears) || 0);

  if (method === "None" || !usefulLife || !cost) {
    const book = clampNonNegative(Math.min(cost, Number(asset.currentBookValue) || cost));
    return {
      annualDepreciation: 0,
      accumulatedDepreciation: clampNonNegative(cost - book),
      bookValue: book,
      depreciationThisYear: 0,
    };
  }

  const annualDepreciation = cost / usefulLife;
  const purchase = parseIsoDate(asset.purchaseDate);
  const asOfDate = asOf;
  let yearsFromPurchase = 0;
  if (purchase) {
    const ms = asOfDate.getTime() - purchase.getTime();
    yearsFromPurchase = Math.max(0, ms / (365.25 * 24 * 60 * 60 * 1000));
  }

  const timeBasedAccumulated = Math.min(cost, annualDepreciation * yearsFromPurchase);
  const runAccumulated = Math.min(
    cost,
    annualDepreciation * (asset.depreciationYearsApplied || []).length
  );
  const accumulatedDepreciation = clampNonNegative(Math.min(cost, Math.max(timeBasedAccumulated, runAccumulated)));
  const bookValue = clampNonNegative(cost - accumulatedDepreciation);

  const depreciationThisYear =
    asset.status !== "Disposed" && bookValue > 0 ? Math.min(annualDepreciation, bookValue) : 0;

  return {
    annualDepreciation,
    accumulatedDepreciation,
    bookValue,
    depreciationThisYear,
  };
}

export function isActiveAsset(asset: AssetRecord) {
  return asset.status !== "Disposed";
}

export function calculateAssetTotals(assets: AssetRecord[]): AssetTotals {
  const active = assets.filter(isActiveAsset);
  return {
    activeCount: active.length,
    totalCount: assets.length,
    disposedCount: assets.filter((a) => a.status === "Disposed").length,
    purchaseCostActive: active.reduce((s, a) => s + clampNonNegative(a.purchaseCost), 0),
    purchaseCostAll: assets.reduce((s, a) => s + clampNonNegative(a.purchaseCost), 0),
  };
}

export function calculateBookValueTotals(assets: AssetRecord[]): BookValueTotals {
  const active = assets.filter(isActiveAsset);
  let grossPurchaseCost = 0;
  let accumulatedDepreciation = 0;
  let netBookValue = 0;

  for (const asset of active) {
    const dep = computeAssetDepreciation(asset);
    grossPurchaseCost += clampNonNegative(asset.purchaseCost);
    accumulatedDepreciation += dep.accumulatedDepreciation;
    netBookValue += dep.bookValue;
  }

  return {
    grossPurchaseCost: clampNonNegative(grossPurchaseCost),
    accumulatedDepreciation: clampNonNegative(accumulatedDepreciation),
    netBookValue: clampNonNegative(netBookValue),
  };
}

export function calculateDepreciationTotals(assets: AssetRecord[], year?: number): DepreciationTotals {
  const targetYear = year ?? new Date().getFullYear();
  const currentYear = new Date().getFullYear();
  let expenseForYear = 0;
  let depreciationThisYearActive = 0;
  let accumulatedActive = 0;

  for (const asset of assets) {
    if (!isActiveAsset(asset)) continue;
    const dep = computeAssetDepreciation(asset);
    accumulatedActive += dep.accumulatedDepreciation;
    depreciationThisYearActive += dep.depreciationThisYear;

    const applied = asset.depreciationYearsApplied || [];
    if (applied.includes(targetYear)) {
      expenseForYear += clampNonNegative(Math.min(dep.annualDepreciation, asset.purchaseCost));
    } else if (targetYear === currentYear && asset.depreciationMethod !== "None") {
      expenseForYear += dep.depreciationThisYear;
    }
  }

  return {
    expenseForYear: clampNonNegative(expenseForYear),
    depreciationThisYearActive: clampNonNegative(depreciationThisYearActive),
    accumulatedActive: clampNonNegative(accumulatedActive),
  };
}

export function buildAssetCategorySummary(assets: AssetRecord[]): AssetCategorySummaryRow[] {
  const map = new Map<string, AssetCategorySummaryRow>();

  for (const asset of assets) {
    if (!isActiveAsset(asset)) continue;
    const category = String(asset.category || "Other").trim() || "Other";
    const dep = computeAssetDepreciation(asset);
    const existing = map.get(category) || {
      category,
      assetCount: 0,
      purchaseCost: 0,
      accumulatedDepreciation: 0,
      netBookValue: 0,
    };
    existing.assetCount += 1;
    existing.purchaseCost += clampNonNegative(asset.purchaseCost);
    existing.accumulatedDepreciation += dep.accumulatedDepreciation;
    existing.netBookValue += dep.bookValue;
    map.set(category, existing);
  }

  return Array.from(map.values()).sort((a, b) => b.netBookValue - a.netBookValue);
}

export function largestAssetCategory(assets: AssetRecord[]): string {
  const rows = buildAssetCategorySummary(assets);
  return rows.length ? rows[0].category : "—";
}

export function listDisposedAssets(assets: AssetRecord[]) {
  return assets.filter((a) => a.status === "Disposed");
}

export function annualDepreciationFromRuns(assets: AssetRecord[]) {
  const active = assets.filter(isActiveAsset);
  return active.reduce((sum, asset) => {
    const dep = computeAssetDepreciation(asset);
    if (asset.depreciationMethod === "None") return sum;
    return sum + dep.annualDepreciation;
  }, 0);
}
