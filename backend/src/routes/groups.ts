import { Router } from "express";
import multer from "multer";
import path from "path";
import * as XLSX from "xlsx";
import { prisma } from "../prisma";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
});

type GroupRow = {
  id: string;
  schoolId: string;
  name: string;
  comments: string;
  importedMemberCount: number;
  createdAt: Date;
  updatedAt: Date;
  learnerIds?: string[];
  externalMembers?: unknown;
};

type ParsedGroup = {
  rowNumber: number;
  name: string;
  comments: string;
  status?: "ready" | "skip";
  reason?: string;
};

function jsonError(res: import("express").Response, status: number, message: string) {
  return res.status(status).json({ success: false, error: message });
}

function normalizeName(value: unknown) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function normalizeKey(value: unknown) {
  return normalizeName(value).toLowerCase();
}

function groupId() {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatGroup(row: GroupRow) {
  return {
    id: row.id,
    schoolId: row.schoolId,
    name: row.name,
    comments: row.comments || "",
    importedMemberCount: Number(row.importedMemberCount || 0),
    learnerIds: Array.isArray(row.learnerIds) ? row.learnerIds : [],
    externalMembers: Array.isArray(row.externalMembers) ? row.externalMembers : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listGroups(schoolId: string) {
  const rows = await prisma.$queryRaw<GroupRow[]>`
    SELECT
      g."id",
      g."schoolId",
      g."name",
      g."comments",
      g."importedMemberCount",
      g."createdAt",
      g."updatedAt",
      COALESCE(
        (
          SELECT array_agg(gl."learnerId" ORDER BY gl."learnerId")
          FROM "GroupLearner" gl
          WHERE gl."groupId" = g."id"
            AND gl."schoolId" = g."schoolId"
        ),
        ARRAY[]::TEXT[]
      ) AS "learnerIds",
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', gem."id",
              'name', gem."name",
              'memberType', gem."memberType",
              'sourceFile', gem."sourceFile",
              'sheetName', gem."sheetName",
              'rowNumber', gem."rowNumber"
            )
            ORDER BY lower(gem."name") ASC, gem."createdAt" ASC
          )
          FROM "GroupExternalMember" gem
          WHERE gem."groupId" = g."id"
            AND gem."schoolId" = g."schoolId"
        ),
        '[]'::jsonb
      ) AS "externalMembers"
    FROM "Group" g
    WHERE g."schoolId" = ${schoolId}
    ORDER BY lower(g."name") ASC
  `;
  return rows.map(formatGroup);
}

function parseSpreadsheet(buffer: Buffer): ParsedGroup[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const headerLabels = ["group", "group name", "name", "groups"];
  const commentLabels = ["comments", "comment", "notes", "note", "description"];
  const firstRow = Array.isArray(matrix[0]) ? matrix[0].map((cell) => normalizeName(cell).toLowerCase()) : [];
  const nameColumn = firstRow.findIndex((cell) => headerLabels.includes(cell));
  const commentsColumn = firstRow.findIndex((cell) => commentLabels.includes(cell));
  const hasHeader = nameColumn >= 0 || commentsColumn >= 0;
  const dataRows = hasHeader ? matrix.slice(1) : matrix;

  return dataRows
    .map((row, index) => {
      const cells = Array.isArray(row) ? row : [];
      const name = normalizeName(cells[hasHeader && nameColumn >= 0 ? nameColumn : 0]);
      const comments = normalizeName(cells[hasHeader && commentsColumn >= 0 ? commentsColumn : 1]);

      return {
        rowNumber: index + (hasHeader ? 2 : 1),
        name,
        comments,
      };
    })
    .filter((row) => row.name);
}

function isAcceptedGroupsFile(fileName: string) {
  return new Set([".csv", ".xls", ".xlsx"]).has(path.extname(fileName).toLowerCase());
}

async function buildPreview(schoolId: string, parsedRows: ParsedGroup[]) {
  const existingRows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT "name"
    FROM "Group"
    WHERE "schoolId" = ${schoolId}
  `;
  const existing = new Set(existingRows.map((row) => normalizeKey(row.name)));
  const seen = new Set<string>();

  const groups = parsedRows.map((row) => {
    const key = normalizeKey(row.name);
    if (existing.has(key)) {
      return { ...row, status: "skip" as const, reason: "Already exists for this school" };
    }
    if (seen.has(key)) {
      return { ...row, status: "skip" as const, reason: "Duplicate in file" };
    }
    seen.add(key);
    return { ...row, status: "ready" as const, reason: "" };
  });

  return {
    success: true,
    groups,
    readyCount: groups.filter((row) => row.status === "ready").length,
    skippedCount: groups.filter((row) => row.status === "skip").length,
  };
}

router.get("/", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    if (!schoolId) return jsonError(res, 400, "schoolId required");

    return res.json({ success: true, groups: await listGroups(schoolId) });
  } catch (error) {
    console.error("[groups] list", error);
    return jsonError(res, 500, "Failed to load groups");
  }
});

router.post("/", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const name = normalizeName(req.body?.name);
    const comments = String(req.body?.comments || "").trim();
    if (!schoolId || !name) return jsonError(res, 400, "schoolId and name required");

    const rows = await prisma.$queryRaw<GroupRow[]>`
      INSERT INTO "Group" ("id", "schoolId", "name", "comments", "importedMemberCount", "createdAt", "updatedAt")
      VALUES (${groupId()}, ${schoolId}, ${name}, ${comments}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("schoolId", "name") DO UPDATE
      SET "comments" = EXCLUDED."comments", "updatedAt" = CURRENT_TIMESTAMP
      RETURNING "id", "schoolId", "name", "comments", "importedMemberCount", "createdAt", "updatedAt"
    `;

    return res.json({ success: true, group: formatGroup(rows[0]) });
  } catch (error) {
    console.error("[groups] create", error);
    return jsonError(res, 500, "Failed to save group");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    const name = normalizeName(req.body?.name);
    const comments = String(req.body?.comments || "").trim();
    if (!id || !schoolId || !name) return jsonError(res, 400, "id, schoolId and name required");

    const rows = await prisma.$queryRaw<GroupRow[]>`
      UPDATE "Group"
      SET "name" = ${name}, "comments" = ${comments}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${id} AND "schoolId" = ${schoolId}
      RETURNING "id", "schoolId", "name", "comments", "importedMemberCount", "createdAt", "updatedAt"
    `;

    if (!rows[0]) return jsonError(res, 404, "Group not found");
    return res.json({ success: true, group: formatGroup(rows[0]) });
  } catch (error) {
    console.error("[groups] update", error);
    return jsonError(res, 500, "Failed to save group");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const schoolId = String(req.body?.schoolId || req.query.schoolId || "").trim();
    if (!id || !schoolId) return jsonError(res, 400, "id and schoolId required");

    const deleted = await prisma.$transaction(async (tx) => {
      const existing = await tx.$queryRaw<GroupRow[]>`
        SELECT "id", "schoolId", "name", "comments", "importedMemberCount", "createdAt", "updatedAt"
        FROM "Group"
        WHERE "id" = ${id} AND "schoolId" = ${schoolId}
      `;
      if (!existing[0]) return null;

      await tx.$executeRaw`
        DELETE FROM "GroupLearner"
        WHERE "groupId" = ${id} AND "schoolId" = ${schoolId}
      `;
      await tx.$executeRaw`
        DELETE FROM "GroupExternalMember"
        WHERE "groupId" = ${id} AND "schoolId" = ${schoolId}
      `;
      await tx.$executeRaw`
        DELETE FROM "Group"
        WHERE "id" = ${id} AND "schoolId" = ${schoolId}
      `;

      return formatGroup(existing[0]);
    });

    if (!deleted) return jsonError(res, 404, "Group not found");
    return res.json({ success: true, group: deleted });
  } catch (error) {
    console.error("[groups] delete", error);
    return jsonError(res, 500, "Failed to delete group");
  }
});

router.post("/preview-import", upload.single("file"), async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const file = req.file;
    if (!schoolId) return jsonError(res, 400, "schoolId required");
    if (!file) return jsonError(res, 400, "Upload a groups file (.csv, .xls, or .xlsx)");
    if (!isAcceptedGroupsFile(file.originalname)) {
      return jsonError(res, 400, "File must be .csv, .xls, or .xlsx");
    }

    const parsedRows = parseSpreadsheet(file.buffer);
    if (!parsedRows.length) return jsonError(res, 400, "No group names found in the file");

    return res.json(await buildPreview(schoolId, parsedRows));
  } catch (error) {
    console.error("[groups] preview import", error);
    return jsonError(res, 500, "Failed to preview groups import");
  }
});

router.post("/import", async (req, res) => {
  try {
    const schoolId = String(req.body?.schoolId || "").trim();
    const incomingRows = Array.isArray(req.body?.groups) ? req.body.groups : [];
    if (!schoolId) return jsonError(res, 400, "schoolId required");

    const existingRows = await prisma.$queryRaw<Array<{ name: string }>>`
      SELECT "name"
      FROM "Group"
      WHERE "schoolId" = ${schoolId}
    `;
    const existing = new Set(existingRows.map((row) => normalizeKey(row.name)));
    const seen = new Set<string>();
    let importedCount = 0;
    let skippedCount = 0;

    for (const row of incomingRows) {
      const name = normalizeName(row?.name);
      const key = normalizeKey(name);
      if (!name || existing.has(key) || seen.has(key)) {
        skippedCount += 1;
        continue;
      }

      seen.add(key);
      const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "Group" ("id", "schoolId", "name", "comments", "importedMemberCount", "createdAt", "updatedAt")
          VALUES (${groupId()}, ${schoolId}, ${name}, ${String(row?.comments || "").trim()}, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
          ON CONFLICT ("schoolId", "name") DO NOTHING
          RETURNING "id"
        `;
      existing.add(key);
      if (inserted.length > 0) {
        importedCount += 1;
      } else {
        skippedCount += 1;
      }
    }

    return res.json({
      success: true,
      importedCount,
      skippedCount,
      groups: await listGroups(schoolId),
    });
  } catch (error) {
    console.error("[groups] import", error);
    return jsonError(res, 500, "Failed to import groups");
  }
});

export default router;
