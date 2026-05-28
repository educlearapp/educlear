import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { MigrationSignoffPack } from "../types/MigrationSignoff";

const SIGNOFFS_DIR = path.join(process.cwd(), "storage", "migration-signoffs");

export function ensureMigrationSignoffsDir(): void {
  if (!fs.existsSync(SIGNOFFS_DIR)) {
    fs.mkdirSync(SIGNOFFS_DIR, { recursive: true });
  }
}

function sanitizeSignoffId(id: string): string | null {
  const trimmed = String(id || "").trim();
  if (!trimmed) return null;
  if (trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
  return trimmed;
}

function signoffFilePath(id: string): string {
  const safe = sanitizeSignoffId(id);
  if (!safe) throw new Error("Invalid signoff id");
  const resolved = path.resolve(SIGNOFFS_DIR, `${safe}.json`);
  if (!resolved.startsWith(path.resolve(SIGNOFFS_DIR) + path.sep)) {
    throw new Error("Invalid signoff path");
  }
  return resolved;
}

function writeSignoffFile(pack: MigrationSignoffPack): void {
  const filePath = signoffFilePath(pack.signoffId);
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(pack, null, 2), "utf8");
  fs.renameSync(tmpPath, filePath);
}

export function createSignoff(
  partial: Omit<MigrationSignoffPack, "signoffId" | "createdAt"> & {
    signoffId?: string;
    createdAt?: string;
  }
): MigrationSignoffPack {
  ensureMigrationSignoffsDir();
  const signoffId = partial.signoffId?.trim() || randomUUID();
  const safeId = sanitizeSignoffId(signoffId);
  if (!safeId) throw new Error("Invalid signoff id");

  const filePath = signoffFilePath(safeId);
  if (fs.existsSync(filePath)) {
    throw new Error("Sign-off id already exists");
  }

  const pack: MigrationSignoffPack = {
    ...partial,
    signoffId: safeId,
    createdAt: partial.createdAt ?? new Date().toISOString(),
  };

  writeSignoffFile(pack);
  return pack;
}

export function updateSignoff(
  signoffId: string,
  patch: Partial<Omit<MigrationSignoffPack, "signoffId">>
): MigrationSignoffPack {
  const existing = getSignoff(signoffId);
  if (!existing) throw new Error("Sign-off not found");
  const merged: MigrationSignoffPack = { ...existing, ...patch, signoffId: existing.signoffId };
  writeSignoffFile(merged);
  return merged;
}

export function getSignoff(signoffId: string): MigrationSignoffPack | null {
  ensureMigrationSignoffsDir();
  const safeId = sanitizeSignoffId(signoffId);
  if (!safeId) return null;
  const filePath = signoffFilePath(safeId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MigrationSignoffPack;
  } catch {
    return null;
  }
}

export function listSignoffs(): MigrationSignoffPack[] {
  ensureMigrationSignoffsDir();
  const files = fs
    .readdirSync(SIGNOFFS_DIR)
    .filter((name) => name.endsWith(".json") && !name.includes(".tmp"));

  const packs: MigrationSignoffPack[] = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, "");
    const pack = getSignoff(id);
    if (pack) packs.push(pack);
  }

  packs.sort((a, b) => {
    const ta = new Date(a.createdAt).getTime();
    const tb = new Date(b.createdAt).getTime();
    return tb - ta;
  });

  return packs;
}

export function resolveMigrationSignoffFilePath(filename: string): string | null {
  const trimmed = String(filename || "").trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    return null;
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) return null;
  ensureMigrationSignoffsDir();
  const resolved = path.resolve(SIGNOFFS_DIR, trimmed);
  if (!resolved.startsWith(path.resolve(SIGNOFFS_DIR) + path.sep)) return null;
  if (!fs.existsSync(resolved)) return null;
  return resolved;
}
