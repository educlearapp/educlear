import express from "express";
import { PrismaClient } from "@prisma/client";

const router = express.Router();
const prisma = new PrismaClient();
const prismaAny = prisma as any;

const FEES_META_PREFIX = "FEES_META:";

type FeesMeta = {
  category?: string | null;
  uiType?: string | null;
  notes?: string | null;
};

function encodeFeesMeta(meta: FeesMeta): string {
  return `${FEES_META_PREFIX}${JSON.stringify({
    category: meta.category ?? null,
    uiType: meta.uiType ?? null,
    notes: meta.notes ?? null,
  })}`;
}

function decodeFeesMeta(rawGrade: unknown): FeesMeta | null {
  const s = asTrimmedString(rawGrade);
  if (!s.startsWith(FEES_META_PREFIX)) return null;
  const json = s.slice(FEES_META_PREFIX.length);
  try {
    const parsed = JSON.parse(json) as any;
    return {
      category: parsed?.category ?? null,
      uiType: parsed?.uiType ?? null,
      notes: parsed?.notes ?? null,
    };
  } catch {
    return null;
  }
}

function mapUiTypeToLegacyFrequency(uiType: string): "MONTHLY" | "ONCE_OFF" | "YEARLY" {
  const v = asTrimmedString(uiType).toUpperCase();
  if (!v) return "MONTHLY";
  if (v === "ONCE_OFF") return "ONCE_OFF";
  if (v.startsWith("MONTHLY")) return "MONTHLY";
  // ANNUALLY / TERMLY / DAILY / YEARLY and any future values collapse to YEARLY for legacy storage
  return "YEARLY";
}

function asTrimmedString(value: unknown): string {
  return String(value ?? "").trim();
}

function getRequiredField(body: any, key: string): string {
  const value = asTrimmedString(body?.[key]);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parseAmount(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error("amount must be a number");
  return n;
}

function feeUsage(usedBillingPlansCount: number) {
  const count = Number(usedBillingPlansCount || 0);
  return {
    usedBillingPlansCount: count,
    status: count > 0 ? `Used (${count} billing plans)` : "Not used",
  };
}

function serializeFee(fee: any, usedBillingPlansCount = 0) {
  // Keep legacy fields (`name`, `frequency`) for existing billing UI.
  const meta = decodeFeesMeta(fee.grade);
  const usage = feeUsage(usedBillingPlansCount);
  return {
    id: fee.id,
    schoolId: fee.schoolId,

    // New Fees module fields
    category: meta?.category ?? null,
    type: meta?.uiType ?? fee.frequency ?? null,
    description: fee.name ?? null,
    amount: fee.amount,
    notes: meta?.notes ?? null,
    isActive: true,
    createdAt: fee.createdAt,
    updatedAt: fee.updatedAt,

    // Legacy fields (do not remove yet)
    name: fee.name,
    frequency: meta?.uiType ?? fee.frequency,
    grade: fee.grade ?? null,

    // Usage info for list page
    usedBillingPlansCount: usage.usedBillingPlansCount,
    usageStatus: usage.status,
  };
}

router.get("/", async (req, res) => {
  try {
    const schoolId = asTrimmedString(req.query.schoolId);
    const q = asTrimmedString(req.query.q);
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize || 10)));

    if (!schoolId) {
      return res.status(400).json({ success: false, message: "schoolId is required" });
    }

    const where: any = {
      schoolId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { grade: { contains: q, mode: "insensitive" } },
              { frequency: { equals: q as any } },
            ],
          }
        : {}),
    };

    const [total, fees] = await Promise.all([
      prisma.feeStructure.count({ where }),
      prisma.feeStructure.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // Billing plan linkage is not modeled yet in this backend; keep count stable.
    const usedBillingPlansCount = 0;

    return res.json({
      success: true,
      items: fees.map((f: any) => serializeFee(f, usedBillingPlansCount)),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("List fees error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch fees" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = asTrimmedString(req.params.id);
    const schoolId = asTrimmedString(req.query.schoolId);
    if (!id) return res.status(400).json({ success: false, message: "id is required" });
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const fee = await prisma.feeStructure.findFirst({ where: { id, schoolId } });
    if (!fee) return res.status(404).json({ success: false, message: "Fee not found" });

    return res.json({ success: true, fee: serializeFee(fee, 0) });
  } catch (error) {
    console.error("Get fee error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch fee" });
  }
});

router.post("/", async (req, res) => {
  try {
    const body = req.body || {};

    const schoolId = getRequiredField(body, "schoolId");

    // Accept both new and legacy request shapes (frontend currently uses legacy).
    const category = getRequiredField(body, "category");
    const uiType = asTrimmedString(body?.type || body?.frequency);
    const description = asTrimmedString(body?.description || body?.name);
    const amount = parseAmount(body?.amount);
    const notes = asTrimmedString(body?.notes);

    if (!uiType) return res.status(400).json({ success: false, message: "type is required" });
    if (!description) {
      return res.status(400).json({ success: false, message: "description is required" });
    }

    const fee = await prismaAny.feeStructure.create({
      data: {
        schoolId,
        amount,
        name: description,
        frequency: mapUiTypeToLegacyFrequency(uiType) as any,
        grade: encodeFeesMeta({
          category,
          uiType,
          notes: notes ? notes : null,
        }),
      },
    });

    return res.json({ success: true, fee: serializeFee(fee, 0) });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.endsWith("is required") || msg.includes("amount")) {
      return res.status(400).json({ success: false, message: msg });
    }
    console.error("Create fee error:", error);
    return res.status(500).json({ success: false, message: "Failed to create fee" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = asTrimmedString(req.params.id);
    const body = req.body || {};

    if (!id) return res.status(400).json({ success: false, message: "id is required" });

    const schoolId = getRequiredField(body, "schoolId");
    const category = getRequiredField(body, "category");
    const uiType = asTrimmedString(body?.type || body?.frequency);
    const description = asTrimmedString(body?.description || body?.name);
    const amount = parseAmount(body?.amount);
    const notes = asTrimmedString(body?.notes);

    if (!uiType) return res.status(400).json({ success: false, message: "type is required" });
    if (!description) {
      return res.status(400).json({ success: false, message: "description is required" });
    }

    const existing = (await prisma.feeStructure.findFirst({ where: { id, schoolId } })) as any;
    if (!existing) return res.status(404).json({ success: false, message: "Fee not found" });

    const updated = await prismaAny.feeStructure.update({
      where: { id },
      data: {
        amount,
        name: description,
        frequency: mapUiTypeToLegacyFrequency(uiType) as any,
        grade: encodeFeesMeta({
          category,
          uiType,
          notes: notes ? notes : null,
        }),
      },
    });

    return res.json({ success: true, fee: serializeFee(updated, 0) });
  } catch (error: any) {
    const msg = String(error?.message || "");
    if (msg.endsWith("is required") || msg.includes("amount")) {
      return res.status(400).json({ success: false, message: msg });
    }
    console.error("Update fee error:", error);
    return res.status(500).json({ success: false, message: "Failed to update fee" });
  }
});

router.patch("/:id/toggle-active", async (req, res) => {
  try {
    const id = asTrimmedString(req.params.id);
    const schoolId = asTrimmedString(req.body?.schoolId || req.query?.schoolId);
    if (!id) return res.status(400).json({ success: false, message: "id is required" });
    if (!schoolId) return res.status(400).json({ success: false, message: "schoolId is required" });

    const existing = (await prisma.feeStructure.findFirst({ where: { id, schoolId } })) as any;
    if (!existing) return res.status(404).json({ success: false, message: "Fee not found" });

    const updated = await prismaAny.feeStructure.update({
      where: { id },
      data: { isActive: !Boolean(existing.isActive) },
    });

    return res.json({ success: true, fee: serializeFee(updated, 0) });
  } catch (error) {
    console.error("Toggle fee active error:", error);
    return res.status(500).json({ success: false, message: "Failed to toggle fee" });
  }
});

export default router;

