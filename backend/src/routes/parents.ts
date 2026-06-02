import { Router } from "express";
import { PrismaClient } from "@prisma/client";
import { lookupParentFeesBySaId, normalizeSaIdNumber } from "../services/parentFeeCheckService";

const router = Router();
const prisma = new PrismaClient();

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanBool(value: unknown, fallback: boolean) {
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

/** GET /api/parents/fee-check/:idNumber — cross-school guardian ID fee lookup (dashboard). */
router.get("/fee-check/:idNumber", async (req, res) => {
  try {
    const raw = cleanString(req.params?.idNumber);
    if (!normalizeSaIdNumber(raw)) {
      return res.status(400).json({
        found: false,
        error: "Enter a valid South African ID number",
        results: [],
        totalOutstanding: 0,
        status: "GREEN",
      });
    }

    const payload = await lookupParentFeesBySaId(raw);
    if (!payload.found) {
      return res.json({
        ...payload,
        school: "No record found",
        parentName: "-",
        outstandingAmount: 0,
        message: "No record found",
      });
    }

    const primary = payload.results[0];
    return res.json({
      ...payload,
      school: primary.schoolName,
      parentName: primary.parentName,
      outstandingAmount: payload.totalOutstanding,
      message: null,
    });
  } catch (error: unknown) {
    console.error("PARENT FEE CHECK ERROR:", error);
    return res.status(500).json({
      found: false,
      error: "Fee check failed",
      results: [],
      totalOutstanding: 0,
      status: "GREEN",
      school: "No record found",
      parentName: "-",
      outstandingAmount: 0,
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const schoolId = cleanString(req.body?.schoolId);
    if (!schoolId) {
      return res.status(400).json({ success: false, message: "Missing schoolId" });
    }

    const parent = await prisma.parent.create({
      data: {
        schoolId,
        familyAccountId: cleanString(req.body?.familyAccountId) || null,
        relationship: cleanString(req.body?.relationship) || null,
        title: cleanString(req.body?.title) || null,
        firstName: cleanString(req.body?.firstName) || "Parent",
        surname: cleanString(req.body?.surname) || "-",
        nickname: cleanString(req.body?.nickname) || null,
        idNumber: cleanString(req.body?.idNumber) || null,
        maritalStatus: cleanString(req.body?.maritalStatus) || null,
        notes: cleanString(req.body?.notes) || null,
        homeAddress: cleanString(req.body?.homeAddress) || null,
        homeNo: cleanString(req.body?.homeNo) || null,
        workNo: cleanString(req.body?.workNo || req.body?.work) || null,
        cellNo: cleanString(req.body?.cellNo || req.body?.cell || req.body?.phone) || "-",
        faxNo: cleanString(req.body?.faxNo) || null,
        email: cleanString(req.body?.email) || null,
        communicationAdministration: cleanBool(req.body?.communicationAdministration, true),
        communicationBilling: cleanBool(req.body?.communicationBilling, true),
        communicationByEmail: cleanBool(req.body?.communicationByEmail, true),
        communicationByPrint: cleanBool(req.body?.communicationByPrint, true),
        communicationBySMS: cleanBool(req.body?.communicationBySMS, true),
      },
    });

    return res.json({ success: true, parent });
  } catch (error: unknown) {
    console.error("CREATE PARENT ERROR:", error);
    const err = error as { message?: string; code?: string; meta?: unknown };
    return res.status(500).json({
      success: false,
      message: "Failed to create parent",
      error: String(err?.message || error),
      code: err?.code || null,
      meta: err?.meta || null,
    });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = cleanString(req.params?.id);
    if (!id) {
      return res.status(400).json({ success: false, message: "Missing parent id" });
    }

    const existing = await prisma.parent.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: "Parent not found" });
    }

    const parent = await prisma.parent.update({
      where: { id },
      data: {
        ...(req.body?.relationship !== undefined && {
          relationship: cleanString(req.body.relationship) || null,
        }),
        ...(req.body?.title !== undefined && { title: cleanString(req.body.title) || null }),
        ...(req.body?.firstName !== undefined && {
          firstName: cleanString(req.body.firstName) || existing.firstName,
        }),
        ...(req.body?.surname !== undefined && {
          surname: cleanString(req.body.surname || req.body.lastName) || existing.surname,
        }),
        ...(req.body?.idNumber !== undefined && {
          idNumber: cleanString(req.body.idNumber) || null,
        }),
        ...(req.body?.notes !== undefined && { notes: cleanString(req.body.notes) || null }),
        ...(req.body?.homeAddress !== undefined && {
          homeAddress: cleanString(req.body.homeAddress) || null,
        }),
        ...(req.body?.homeNo !== undefined && { homeNo: cleanString(req.body.homeNo) || null }),
        ...(req.body?.workNo !== undefined && {
          workNo: cleanString(req.body.workNo || req.body.work) || null,
        }),
        ...(req.body?.cellNo !== undefined && {
          cellNo: cleanString(req.body.cellNo || req.body.cell || req.body.phone) || existing.cellNo,
        }),
        ...(req.body?.email !== undefined && { email: cleanString(req.body.email) || null }),
        ...(req.body?.communicationAdministration !== undefined && {
          communicationAdministration: cleanBool(req.body.communicationAdministration, true),
        }),
        ...(req.body?.communicationBilling !== undefined && {
          communicationBilling: cleanBool(req.body.communicationBilling, true),
        }),
        ...(req.body?.communicationByEmail !== undefined && {
          communicationByEmail: cleanBool(req.body.communicationByEmail, true),
        }),
        ...(req.body?.communicationByPrint !== undefined && {
          communicationByPrint: cleanBool(req.body.communicationByPrint, true),
        }),
        ...(req.body?.communicationBySMS !== undefined && {
          communicationBySMS: cleanBool(req.body.communicationBySMS, true),
        }),
      },
    });

    return res.json({ success: true, parent });
  } catch (error: unknown) {
    console.error("UPDATE PARENT ERROR:", error);
    const err = error as { message?: string };
    return res.status(500).json({
      success: false,
      message: "Failed to update parent",
      error: String(err?.message || error),
    });
  }
});

export default router;
