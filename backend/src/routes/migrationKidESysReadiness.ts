import type { Request, Response } from "express";
import { buildKidESysMigrationReadiness } from "../services/migration/core/buildKidESysMigrationReadiness";
import type { MigrationFile } from "../services/migration/types/MigrationFile";
import type { MigrationFilePreview } from "../services/migration/types/MigrationFilePreview";
import type { MigrationFileColumnMappings } from "../services/migration/types/MigrationValidation";

/** Mounted under /api/migration — POST /api/migration/adapters/kideesys/readiness */
export const KIDESYS_ADAPTER_READINESS_PATH = "/adapters/kideesys/readiness";

function jsonError(res: Response, status: number, message: string) {
  return res.status(status).json({ error: message });
}

/** Kid-e-Sys adapter readiness + migration validation (read-only, no DB writes). */
export async function handleKidESysMigrationReadiness(req: Request, res: Response) {
  console.log("Kid-e-Sys readiness endpoint hit");
  try {
    const rawPreviews = req.body?.previews;
    const rawMappings = req.body?.mappings;
    const rawFiles = req.body?.uploadedFiles;
    const fullFileChecks = req.body?.fullFileChecks === true;
    const rawFilePaths = req.body?.filePaths;

    if (!Array.isArray(rawPreviews) || rawPreviews.length === 0) {
      return jsonError(res, 400, "previews array required");
    }

    const previews: MigrationFilePreview[] = rawPreviews.map((raw: Record<string, unknown>) => {
      const pathValue = String(raw?.path || "").trim();
      return {
        fileId: String(raw?.fileId || "").trim(),
        filename: String(raw?.filename || "").trim(),
        category: String(raw?.category || "unknown").trim(),
        columns: Array.isArray(raw?.columns)
          ? (raw.columns as unknown[]).map((c) => String(c).trim()).filter(Boolean)
          : [],
        sampleRows: Array.isArray(raw?.sampleRows)
          ? (raw.sampleRows as Record<string, unknown>[])
          : [],
        rowCount: Number(raw?.rowCount) || 0,
        warnings: Array.isArray(raw?.warnings)
          ? (raw.warnings as unknown[]).map((w) => String(w))
          : [],
        ...(pathValue ? { path: pathValue } : {}),
      };
    });

    const mappings: MigrationFileColumnMappings[] = Array.isArray(rawMappings)
      ? rawMappings.map((raw: Record<string, unknown>) => ({
          fileId: String(raw?.fileId || "").trim(),
          mappings: Array.isArray(raw?.mappings)
            ? (raw.mappings as Array<{ sourceColumn?: string; targetField?: string }>)
                .map((m) => ({
                  sourceColumn: String(m?.sourceColumn || "").trim(),
                  targetField: String(m?.targetField || "").trim(),
                }))
                .filter((m) => m.sourceColumn && m.targetField)
            : [],
        }))
      : [];

    const uploadedFiles = Array.isArray(rawFiles)
      ? rawFiles.map((raw: Record<string, unknown>) => ({
          id: String(raw?.id || "").trim(),
          filename: String(raw?.filename || "").trim(),
          mimeType: String(raw?.mimeType || "application/octet-stream"),
          size: Number(raw?.size) || 0,
          uploadedAt: new Date(),
          category: String(raw?.category || "unknown").trim() as MigrationFile["category"],
          path: String(raw?.path || "").trim(),
        }))
      : [];

    const filePaths: Record<string, string> = {};
    if (rawFilePaths && typeof rawFilePaths === "object" && !Array.isArray(rawFilePaths)) {
      for (const [key, value] of Object.entries(rawFilePaths as Record<string, unknown>)) {
        const pathStr = String(value || "").trim();
        if (key && pathStr) filePaths[key] = pathStr;
      }
    }

    const result = await buildKidESysMigrationReadiness({
      uploadedFiles,
      previews,
      mappings,
      fullFileChecks,
      filePaths,
    });

    return res.json({ success: true, result });
  } catch (e: unknown) {
    console.error("migration/adapters/kideesys/readiness", e);
    const message = e instanceof Error ? e.message : "Kid-e-Sys readiness check failed";
    return jsonError(res, 500, message);
  }
}
