import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const router = Router();

const SCHOOL_LOGOS_DIR = path.resolve("uploads", "school-logos");

function ensureDirExists(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // best effort; multer will error if it truly can't write
  }
}

ensureDirExists(SCHOOL_LOGOS_DIR);

const storage = multer.diskStorage({
  destination: (_req: any, _file: any, cb: (error: Error | null, destination: string) => void) => cb(null, SCHOOL_LOGOS_DIR),
  filename: (_req: any, file: { originalname?: string }, cb: (error: Error | null, filename: string) => void) => {
    const ext = String(path.extname(file.originalname || "") || "").toLowerCase();
    const safeExt = [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? ext : "";
    const id = crypto.randomBytes(12).toString("hex");
    cb(null, `school-logo-${Date.now()}-${id}${safeExt}`);
  },
});

function isAllowedMime(mime: string) {
  return ["image/png", "image/jpeg", "image/webp"].includes(String(mime || "").toLowerCase());
}

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req: any, file: { mimetype?: string }, cb: (error: Error | null, acceptFile?: boolean) => void) => {
    if (!isAllowedMime(String(file.mimetype || ""))) {
      return cb(new Error("Only image files are allowed (png, jpg, jpeg, webp)."));
    }
    cb(null, true);
  },
});

router.post("/school-logo", upload.single("file"), async (req, res) => {
  try {
    const f = (req as any).file as { filename?: string } | undefined;
    if (!f?.filename) return res.status(400).json({ error: "No file uploaded" });
    return res.json({ logoUrl: `/uploads/school-logos/${f.filename}` });
  } catch (e: any) {
    return res.status(400).json({ error: e?.message || "Upload failed" });
  }
});

export default router;

