import bcrypt from "bcryptjs";

import { normalizeSuperAdminEmail } from "../utils/superAdmin";

/** Rounds used by POST /auth/login, register-school, seed, and repair scripts. */
export const AUTH_BCRYPT_ROUNDS = 10;

export const normalizeAuthEmail = normalizeSuperAdminEmail;

export async function hashAuthPassword(plain: string): Promise<string> {
  return bcrypt.hash(String(plain || ""), AUTH_BCRYPT_ROUNDS);
}

export async function compareAuthPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;
  return bcrypt.compare(String(plain), String(hash));
}

export function isValidBcryptHash(hash: string | null | undefined): boolean {
  const h = String(hash || "");
  return h.length === 60 && h.startsWith("$2");
}
