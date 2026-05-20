import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";

export type ParentAuthPayload = {
  parentId: string;
  schoolId: string;
  idNumber?: string;
};

export function signParentToken(payload: ParentAuthPayload) {
  return jwt.sign({ ...payload, role: "parent" }, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyParentToken(token: string): ParentAuthPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as ParentAuthPayload & { role?: string };
    if (!decoded?.parentId || !decoded?.schoolId) return null;
    return {
      parentId: decoded.parentId,
      schoolId: decoded.schoolId,
      idNumber: decoded.idNumber,
    };
  } catch {
    return null;
  }
}

export function parentAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return res.status(401).json({ success: false, error: "Parent authentication required" });
  }
  const payload = verifyParentToken(token);
  if (!payload) {
    return res.status(401).json({ success: false, error: "Invalid or expired parent session" });
  }
  (req as any).parentAuth = payload;
  next();
}
