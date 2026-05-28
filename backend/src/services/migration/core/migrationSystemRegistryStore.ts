import fs from "fs";
import path from "path";
import type {
  MigrationAdapterStatus,
  MigrationExportType,
  MigrationSystemResearch,
} from "../types/MigrationSystemResearch";
import {
  MIGRATION_ADAPTER_STATUSES,
  MIGRATION_EXPORT_TYPES,
} from "../types/MigrationSystemResearch";
import { MIGRATION_ADAPTERS } from "../adapters";
import { listTemplates } from "../templates/migrationTemplateStore";
import { MIGRATION_SYSTEM_REGISTRY_SEED } from "./migrationSystemRegistrySeed";

const REGISTRY_DIR = path.join(process.cwd(), "storage", "migration-system-registry");

/** Prevents re-entrant seeding when saveSystem calls getSystem before the first file is written. */
let registrySeedInProgress = false;

function ensureRegistryDir(): void {
  if (!fs.existsSync(REGISTRY_DIR)) {
    fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  }
}

function sanitizeSystemId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function systemFilePath(id: string): string {
  const safe = sanitizeSystemId(id);
  if (!safe) throw new Error("Invalid system id");
  const resolved = path.resolve(REGISTRY_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(REGISTRY_DIR) + path.sep)) {
    throw new Error("Invalid system path");
  }
  return resolved;
}

function isAdapterStatus(value: string): value is MigrationAdapterStatus {
  return (MIGRATION_ADAPTER_STATUSES as string[]).includes(value);
}

function isExportType(value: string): value is MigrationExportType {
  return (MIGRATION_EXPORT_TYPES as string[]).includes(value);
}

function parseSystemFile(raw: string, fileId: string): MigrationSystemResearch | null {
  try {
    const parsed = JSON.parse(raw) as Partial<MigrationSystemResearch>;
    if (!parsed || typeof parsed !== "object") return null;

    const systemId = String(parsed.systemId || fileId).trim();
    const systemName = String(parsed.systemName || "").trim();
    if (!systemId || !systemName) return null;

    const exportTypes = Array.isArray(parsed.exportTypes)
      ? parsed.exportTypes
          .map((t) => String(t || "").trim())
          .filter((t): t is MigrationExportType => isExportType(t))
      : [];

    const adapterStatus = String(parsed.adapterStatus || "").trim();
    if (!isAdapterStatus(adapterStatus)) return null;

    return {
      systemId,
      systemName,
      vendor: String(parsed.vendor || "").trim(),
      country: String(parsed.country || "").trim(),
      website: String(parsed.website || "").trim(),
      exportTypes,
      supportsLearners: Boolean(parsed.supportsLearners),
      supportsParents: Boolean(parsed.supportsParents),
      supportsBilling: Boolean(parsed.supportsBilling),
      supportsTransactions: Boolean(parsed.supportsTransactions),
      supportsStaff: Boolean(parsed.supportsStaff),
      notes: String(parsed.notes || "").trim(),
      adapterStatus,
      templateCount: Number.isFinite(Number(parsed.templateCount))
        ? Math.max(0, Math.floor(Number(parsed.templateCount)))
        : 0,
      lastReviewedAt: String(parsed.lastReviewedAt || new Date().toISOString()),
    };
  } catch {
    return null;
  }
}

function countTemplatesForSystem(systemId: string): number {
  const key = systemId.trim().toLowerCase();
  return listTemplates().filter((t) => String(t.sourceSystem || "").trim().toLowerCase() === key)
    .length;
}

function withLiveTemplateCount(system: MigrationSystemResearch): MigrationSystemResearch {
  return {
    ...system,
    templateCount: countTemplatesForSystem(system.systemId),
  };
}

/** Write seed records when the registry directory has no system JSON files yet. */
export function seedMigrationSystemRegistryIfEmpty(): number {
  if (registrySeedInProgress) return 0;
  ensureRegistryDir();
  const hasSystems = fs
    .readdirSync(REGISTRY_DIR, { withFileTypes: true })
    .some((e) => e.isFile() && e.name.endsWith(".json"));
  if (hasSystems) return 0;

  registrySeedInProgress = true;
  try {
    let written = 0;
    for (const system of MIGRATION_SYSTEM_REGISTRY_SEED) {
      saveSystem(system);
      written += 1;
    }
    return written;
  } finally {
    registrySeedInProgress = false;
  }
}

export function listSystems(): MigrationSystemResearch[] {
  ensureRegistryDir();
  seedMigrationSystemRegistryIfEmpty();

  const entries = fs.readdirSync(REGISTRY_DIR, { withFileTypes: true });
  const systems: MigrationSystemResearch[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    const fileId = entry.name.replace(/\.json$/i, "");
    try {
      const raw = fs.readFileSync(path.join(REGISTRY_DIR, entry.name), "utf8");
      const system = parseSystemFile(raw, fileId);
      if (system) systems.push(withLiveTemplateCount(system));
    } catch {
      // Skip corrupt files
    }
  }

  return systems.sort((a, b) => a.systemName.localeCompare(b.systemName));
}

/** Registry systemId when adapter `source` differs (see resolveMigrationAdapterSource). */
const ADAPTER_SOURCE_TO_SYSTEM_ID: Record<string, string> = {
  "generic-excel": "generic-excel-csv",
};

function systemIdForAdapterSource(adapterSource: string): string {
  return ADAPTER_SOURCE_TO_SYSTEM_ID[adapterSource] ?? adapterSource;
}

function systemsFromAdapterSeedFallback(): MigrationSystemResearch[] {
  const seedById = new Map(
    MIGRATION_SYSTEM_REGISTRY_SEED.map((s) => [s.systemId.trim().toLowerCase(), s])
  );
  const systems: MigrationSystemResearch[] = [];

  for (const adapter of MIGRATION_ADAPTERS) {
    const systemId = systemIdForAdapterSource(adapter.source);
    const seed = seedById.get(systemId.toLowerCase());
    if (seed) {
      systems.push(withLiveTemplateCount({ ...seed }));
      continue;
    }
    systems.push(
      withLiveTemplateCount({
        systemId,
        systemName: systemId,
        vendor: "",
        country: "ZA",
        website: "",
        exportTypes: ["unknown"],
        supportsLearners: false,
        supportsParents: false,
        supportsBilling: false,
        supportsTransactions: false,
        supportsStaff: false,
        notes: "Listed from registered migration adapter.",
        adapterStatus: "partial",
        templateCount: 0,
        lastReviewedAt: new Date().toISOString(),
      })
    );
  }

  return systems.sort((a, b) => a.systemName.localeCompare(b.systemName));
}

/**
 * API-facing registry list: disk JSON first, then adapter+seed fallback when empty or unreadable.
 */
export function listMigrationSystemsForApi(): MigrationSystemResearch[] {
  try {
    const systems = listSystems();
    if (systems.length > 0) return systems;
  } catch (err) {
    console.warn("[migration] registry listSystems failed; using adapter fallback", err);
  }
  return systemsFromAdapterSeedFallback();
}

export function getMigrationSystemForApi(systemId: string): MigrationSystemResearch | null {
  const fromRegistry = getSystem(systemId);
  if (fromRegistry) return fromRegistry;

  const safeId = sanitizeSystemId(systemId);
  if (!safeId) return null;

  return (
    systemsFromAdapterSeedFallback().find((s) => s.systemId.toLowerCase() === safeId.toLowerCase()) ??
    null
  );
}

export function getSystem(systemId: string): MigrationSystemResearch | null {
  ensureRegistryDir();
  seedMigrationSystemRegistryIfEmpty();

  const safeId = sanitizeSystemId(systemId);
  if (!safeId) return null;
  const filePath = systemFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const system = parseSystemFile(raw, safeId);
    return system ? withLiveTemplateCount(system) : null;
  } catch {
    return null;
  }
}

export function saveSystem(input: MigrationSystemResearch): MigrationSystemResearch {
  ensureRegistryDir();

  const systemIdRaw = String(input.systemId || "").trim();
  const systemName = String(input.systemName || "").trim();
  if (!systemName) throw new Error("systemName is required");

  const systemId = sanitizeSystemId(systemIdRaw);
  if (!systemId) throw new Error("Valid systemId is required");

  const adapterStatus = String(input.adapterStatus || "").trim();
  if (!isAdapterStatus(adapterStatus)) throw new Error("Invalid adapterStatus");

  const exportTypes = Array.isArray(input.exportTypes)
    ? input.exportTypes
        .map((t) => String(t || "").trim())
        .filter((t): t is MigrationExportType => isExportType(t))
    : [];

  const existing = getSystem(systemId);
  const templateCount = countTemplatesForSystem(systemId);

  const system: MigrationSystemResearch = {
    systemId,
    systemName,
    vendor: String(input.vendor || "").trim(),
    country: String(input.country || "").trim(),
    website: String(input.website || "").trim(),
    exportTypes,
    supportsLearners: Boolean(input.supportsLearners),
    supportsParents: Boolean(input.supportsParents),
    supportsBilling: Boolean(input.supportsBilling),
    supportsTransactions: Boolean(input.supportsTransactions),
    supportsStaff: Boolean(input.supportsStaff),
    notes: String(input.notes || "").trim(),
    adapterStatus,
    templateCount,
    lastReviewedAt: String(input.lastReviewedAt || existing?.lastReviewedAt || new Date().toISOString()),
  };

  const filePath = systemFilePath(systemId);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(system, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);

  return withLiveTemplateCount(system);
}

export function deleteSystem(systemId: string): boolean {
  ensureRegistryDir();
  const safeId = sanitizeSystemId(systemId);
  if (!safeId) return false;
  const filePath = systemFilePath(safeId);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}
