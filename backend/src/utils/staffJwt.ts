import jwt from "jsonwebtoken";

export const STAFF_JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

export type StaffJwtPayload = {
  userId: string;
  schoolId: string;
  email: string;
  role: string;
};

export function verifyStaffJwt(authHeader: string | undefined): StaffJwtPayload | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    return jwt.verify(authHeader.slice(7), STAFF_JWT_SECRET) as StaffJwtPayload;
  } catch {
    return null;
  }
}

export function normalizeStaffEmail(email: string) {
  return String(email || "").trim().toLowerCase();
}
