"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.seedMigrationSystemRegistryIfEmpty = seedMigrationSystemRegistryIfEmpty;
exports.listSystems = listSystems;
exports.listMigrationSystemsForApi = listMigrationSystemsForApi;
exports.getMigrationSystemForApi = getMigrationSystemForApi;
exports.getSystem = getSystem;
exports.saveSystem = saveSystem;
exports.deleteSystem = deleteSystem;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const MigrationSystemResearch_1 = require("../types/MigrationSystemResearch");
const adapters_1 = require("../adapters");
const migrationTemplateStore_1 = require("../templates/migrationTemplateStore");
const migrationSystemRegistrySeed_1 = require("./migrationSystemRegistrySeed");
const REGISTRY_DIR = path_1.default.join(process.cwd(), "storage", "migration-system-registry");
/** Prevents re-entrant seeding when saveSystem calls getSystem before the first file is written. */
let registrySeedInProgress = false;
function ensureRegistryDir() {
    if (!fs_1.default.existsSync(REGISTRY_DIR)) {
        fs_1.default.mkdirSync(REGISTRY_DIR, { recursive: true });
    }
}
function sanitizeSystemId(id) {
    const trimmed = String(id || "").trim();
    if (!trimmed)
        return null;
    if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\"))
        return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed))
        return null;
    return trimmed;
}
function systemFilePath(id) {
    const safe = sanitizeSystemId(id);
    if (!safe)
        throw new Error("Invalid system id");
    const resolved = path_1.default.resolve(REGISTRY_DIR, `${safe}.json`);
    if (!resolved.startsWith(path_1.default.resolve(REGISTRY_DIR) + path_1.default.sep)) {
        throw new Error("Invalid system path");
    }
    return resolved;
}
function isAdapterStatus(value) {
    return MigrationSystemResearch_1.MIGRATION_ADAPTER_STATUSES.includes(value);
}
function isExportType(value) {
    return MigrationSystemResearch_1.MIGRATION_EXPORT_TYPES.includes(value);
}
function parseSystemFile(raw, fileId) {
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object")
            return null;
        const systemId = String(parsed.systemId || fileId).trim();
        const systemName = String(parsed.systemName || "").trim();
        if (!systemId || !systemName)
            return null;
        const exportTypes = Array.isArray(parsed.exportTypes)
            ? parsed.exportTypes
                .map((t) => String(t || "").trim())
                .filter((t) => isExportType(t))
            : [];
        const adapterStatus = String(parsed.adapterStatus || "").trim();
        if (!isAdapterStatus(adapterStatus))
            return null;
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
    }
    catch {
        return null;
    }
}
function countTemplatesForSystem(systemId) {
    const key = systemId.trim().toLowerCase();
    return (0, migrationTemplateStore_1.listTemplates)().filter((t) => String(t.sourceSystem || "").trim().toLowerCase() === key)
        .length;
}
function withLiveTemplateCount(system) {
    return {
        ...system,
        templateCount: countTemplatesForSystem(system.systemId),
    };
}
/** Write seed records when the registry directory has no system JSON files yet. */
function seedMigrationSystemRegistryIfEmpty() {
    if (registrySeedInProgress)
        return 0;
    ensureRegistryDir();
    const hasSystems = fs_1.default
        .readdirSync(REGISTRY_DIR, { withFileTypes: true })
        .some((e) => e.isFile() && e.name.endsWith(".json"));
    if (hasSystems)
        return 0;
    registrySeedInProgress = true;
    try {
        let written = 0;
        for (const system of migrationSystemRegistrySeed_1.MIGRATION_SYSTEM_REGISTRY_SEED) {
            saveSystem(system);
            written += 1;
        }
        return written;
    }
    finally {
        registrySeedInProgress = false;
    }
}
function listSystems() {
    ensureRegistryDir();
    seedMigrationSystemRegistryIfEmpty();
    const entries = fs_1.default.readdirSync(REGISTRY_DIR, { withFileTypes: true });
    const systems = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
            continue;
        const fileId = entry.name.replace(/\.json$/i, "");
        try {
            const raw = fs_1.default.readFileSync(path_1.default.join(REGISTRY_DIR, entry.name), "utf8");
            const system = parseSystemFile(raw, fileId);
            if (system)
                systems.push(withLiveTemplateCount(system));
        }
        catch {
            // Skip corrupt files
        }
    }
    return systems.sort((a, b) => a.systemName.localeCompare(b.systemName));
}
/** Registry systemId when adapter `source` differs (see resolveMigrationAdapterSource). */
const ADAPTER_SOURCE_TO_SYSTEM_ID = {
    "generic-excel": "generic-excel-csv",
};
function systemIdForAdapterSource(adapterSource) {
    return ADAPTER_SOURCE_TO_SYSTEM_ID[adapterSource] ?? adapterSource;
}
function systemsFromAdapterSeedFallback() {
    const seedById = new Map(migrationSystemRegistrySeed_1.MIGRATION_SYSTEM_REGISTRY_SEED.map((s) => [s.systemId.trim().toLowerCase(), s]));
    const systems = [];
    for (const adapter of adapters_1.MIGRATION_ADAPTERS) {
        const systemId = systemIdForAdapterSource(adapter.source);
        const seed = seedById.get(systemId.toLowerCase());
        if (seed) {
            systems.push(withLiveTemplateCount({ ...seed }));
            continue;
        }
        systems.push(withLiveTemplateCount({
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
        }));
    }
    return systems.sort((a, b) => a.systemName.localeCompare(b.systemName));
}
/**
 * API-facing registry list: disk JSON first, then adapter+seed fallback when empty or unreadable.
 */
function listMigrationSystemsForApi() {
    try {
        const systems = listSystems();
        if (systems.length > 0)
            return systems;
    }
    catch (err) {
        console.warn("[migration] registry listSystems failed; using adapter fallback", err);
    }
    return systemsFromAdapterSeedFallback();
}
function getMigrationSystemForApi(systemId) {
    const fromRegistry = getSystem(systemId);
    if (fromRegistry)
        return fromRegistry;
    const safeId = sanitizeSystemId(systemId);
    if (!safeId)
        return null;
    return (systemsFromAdapterSeedFallback().find((s) => s.systemId.toLowerCase() === safeId.toLowerCase()) ??
        null);
}
function getSystem(systemId) {
    ensureRegistryDir();
    seedMigrationSystemRegistryIfEmpty();
    const safeId = sanitizeSystemId(systemId);
    if (!safeId)
        return null;
    const filePath = systemFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return null;
    try {
        const raw = fs_1.default.readFileSync(filePath, "utf8");
        const system = parseSystemFile(raw, safeId);
        return system ? withLiveTemplateCount(system) : null;
    }
    catch {
        return null;
    }
}
function saveSystem(input) {
    ensureRegistryDir();
    const systemIdRaw = String(input.systemId || "").trim();
    const systemName = String(input.systemName || "").trim();
    if (!systemName)
        throw new Error("systemName is required");
    const systemId = sanitizeSystemId(systemIdRaw);
    if (!systemId)
        throw new Error("Valid systemId is required");
    const adapterStatus = String(input.adapterStatus || "").trim();
    if (!isAdapterStatus(adapterStatus))
        throw new Error("Invalid adapterStatus");
    const exportTypes = Array.isArray(input.exportTypes)
        ? input.exportTypes
            .map((t) => String(t || "").trim())
            .filter((t) => isExportType(t))
        : [];
    const existing = getSystem(systemId);
    const templateCount = countTemplatesForSystem(systemId);
    const system = {
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
    fs_1.default.writeFileSync(tmpPath, JSON.stringify(system, null, 2), "utf8");
    fs_1.default.renameSync(tmpPath, filePath);
    return withLiveTemplateCount(system);
}
function deleteSystem(systemId) {
    ensureRegistryDir();
    const safeId = sanitizeSystemId(systemId);
    if (!safeId)
        return false;
    const filePath = systemFilePath(safeId);
    if (!fs_1.default.existsSync(filePath))
        return false;
    fs_1.default.unlinkSync(filePath);
    return true;
}
