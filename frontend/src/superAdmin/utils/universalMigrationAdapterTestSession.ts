import type { MigrationAdapterTestResult } from "./universalMigrationAdapterTest";

type SessionEntry = {
  result: MigrationAdapterTestResult;
  updatedAt: number;
};

const sessionBySystemId = new Map<string, SessionEntry>();

const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function setMigrationAdapterTestResult(
  systemId: string,
  result: MigrationAdapterTestResult
): void {
  const id = String(systemId || "").trim();
  if (!id) return;
  sessionBySystemId.set(id, { result, updatedAt: Date.now() });
  notifyListeners();
}

export function getMigrationAdapterTestResult(
  systemId: string
): MigrationAdapterTestResult | null {
  const id = String(systemId || "").trim();
  if (!id) return null;
  return sessionBySystemId.get(id)?.result ?? null;
}

export function clearMigrationAdapterTestSession(): void {
  sessionBySystemId.clear();
  notifyListeners();
}

export function subscribeMigrationAdapterTestSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
