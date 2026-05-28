import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { MigrationPilotRun } from "../types/MigrationPilot";

const PILOTS_DIR = path.join(process.cwd(), "storage", "migration-pilots");

export function ensureMigrationPilotsDir(): void {
  if (!fs.existsSync(PILOTS_DIR)) {
    fs.mkdirSync(PILOTS_DIR, { recursive: true });
  }
}

function sanitizePilotId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function pilotFilePath(id: string): string {
  const safe = sanitizePilotId(id);
  if (!safe) throw new Error("Invalid pilot id");
  const resolved = path.resolve(PILOTS_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(PILOTS_DIR) + path.sep)) {
    throw new Error("Invalid pilot path");
  }
  return resolved;
}

function writePilotFile(pilot: MigrationPilotRun): void {
  const filePath = pilotFilePath(pilot.pilotId);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(pilot, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function createPilot(
  partial: Omit<MigrationPilotRun, "pilotId" | "createdAt"> & {
    pilotId?: string;
    createdAt?: string;
  }
): MigrationPilotRun {
  ensureMigrationPilotsDir();
  const pilotId = partial.pilotId?.trim() || randomUUID();
  const safeId = sanitizePilotId(pilotId);
  if (!safeId) throw new Error("Invalid pilot id");

  const filePath = pilotFilePath(safeId);
  if (fs.existsSync(filePath)) {
    throw new Error("Pilot id already exists");
  }

  const pilot: MigrationPilotRun = {
    ...partial,
    pilotId: safeId,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };

  writePilotFile(pilot);
  return pilot;
}

export function updatePilot(
  pilotId: string,
  patch: Partial<Omit<MigrationPilotRun, "pilotId">>
): MigrationPilotRun {
  const existing = getPilot(pilotId);
  if (!existing) throw new Error("Pilot not found");
  const merged: MigrationPilotRun = { ...existing, ...patch, pilotId: existing.pilotId };
  writePilotFile(merged);
  return merged;
}

export function getPilot(pilotId: string): MigrationPilotRun | null {
  ensureMigrationPilotsDir();
  const safeId = sanitizePilotId(pilotId);
  if (!safeId) return null;
  const filePath = pilotFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationPilotRun;
  } catch {
    return null;
  }
}

export function listPilots(): MigrationPilotRun[] {
  ensureMigrationPilotsDir();
  const files = fs
    .readdirSync(PILOTS_DIR)
    .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));

  const pilots: MigrationPilotRun[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const pilot = getPilot(id);
    if (pilot) pilots.push(pilot);
  }

  pilots.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });

  return pilots;
}
