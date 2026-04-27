import { Router } from "express";

import { PrismaClient } from "@prisma/client";



const router = Router();

const prisma = new PrismaClient();



router.post("/", async (req, res) => {

  try {

    // Accept both legacy shape ({ learner: {...} }) and current frontend shape ({...})
    const payload = (req.body && typeof req.body === "object" && "learner" in req.body ? (req.body as any).learner : req.body) as any;

    const schoolId = typeof payload?.schoolId === "string" ? payload.schoolId.trim() : "";
    const firstName = typeof payload?.firstName === "string" ? payload.firstName.trim() : "";
    const lastName = (typeof payload?.lastName === "string" ? payload.lastName.trim() : "") || (typeof payload?.surname === "string" ? payload.surname.trim() : "");

    const parent = payload?.parent;
    const parentFirstName = typeof parent?.firstName === "string" ? parent.firstName.trim() : "";
    const parentSurname = typeof parent?.surname === "string" ? parent.surname.trim() : "";

    const missing: string[] = [];
    if (!schoolId) missing.push("schoolId");
    if (!firstName) missing.push("firstName (learner)");
    if (!lastName) missing.push("lastName/surname (learner)");
    if (!parent || typeof parent !== "object") missing.push("parent");
    if (!parentFirstName) missing.push("parent.firstName");
    if (!parentSurname) missing.push("parent.surname");

    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required field(s): ${missing.join(", ")}`,
      });
    }

    const siblingsInput = Array.isArray(payload?.siblings) ? payload.siblings : [];

    const result = await prisma.$transaction(async (tx) => {
      const parentIdNumber = typeof parent?.idNumber === "string" ? parent.idNumber.trim() : "";

      let parentRecord =
        parentIdNumber.length > 0
          ? await tx.parent.findUnique({
              where: { idNumber: parentIdNumber },
            })
          : null;

      if (!parentRecord) {
        parentRecord = await tx.parent.create({
          data: {
            schoolId,
            firstName: parentFirstName,
            surname: parentSurname,
            email: typeof parent?.email === "string" ? parent.email.trim() || null : parent?.email ?? null,
            cellNo: typeof parent?.phone === "string" ? parent.phone.trim() : String(parent?.phone ?? "").trim(),
            idNumber: parentIdNumber || null,
          },
        });
      }

      const learnerRecord = await tx.learner.create({
        data: {
          schoolId,
          firstName,
          lastName,
          grade: typeof payload?.grade === "string" ? payload.grade.trim() : String(payload?.grade ?? "").trim(),
          className: typeof payload?.className === "string" ? payload.className.trim() || null : payload?.className ?? null,
          admissionNo: typeof payload?.admissionNo === "string" ? payload.admissionNo.trim() || null : payload?.admissionNo ?? null,
          idNumber: typeof payload?.idNumber === "string" ? payload.idNumber.trim() || null : payload?.idNumber ?? null,
          birthDate: payload?.birthDate ? new Date(payload.birthDate) : null,
          gender: typeof payload?.gender === "string" ? payload.gender : payload?.gender ?? null,
        },
      });

      await tx.parentLearnerLink.create({
        data: {
          schoolId,
          parentId: parentRecord.id,
          learnerId: learnerRecord.id,
          isPrimary: true,
        },
      });

      if (siblingsInput.length > 0) {
        for (const s of siblingsInput) {
          if (!s || typeof s !== "object") continue;
          const sFirstName = typeof (s as any).firstName === "string" ? (s as any).firstName.trim() : "";
          const sLastName =
            (typeof (s as any).lastName === "string" ? (s as any).lastName.trim() : "") ||
            (typeof (s as any).surname === "string" ? (s as any).surname.trim() : "");
          const sGrade = typeof (s as any).grade === "string" ? (s as any).grade.trim() : "";

          // Only create siblings that have the minimum required learner info.
          if (!sFirstName || !sLastName || !sGrade) continue;

          const siblingLearner = await tx.learner.create({
            data: {
              schoolId,
              firstName: sFirstName,
              lastName: sLastName,
              grade: sGrade,
              className: typeof (s as any).className === "string" ? (s as any).className.trim() || null : (s as any).className ?? null,
              admissionNo:
                typeof (s as any).admissionNo === "string" ? (s as any).admissionNo.trim() || null : (s as any).admissionNo ?? null,
              idNumber: typeof (s as any).idNumber === "string" ? (s as any).idNumber.trim() || null : (s as any).idNumber ?? null,
              birthDate: (s as any).birthDate ? new Date((s as any).birthDate) : null,
              gender: typeof (s as any).gender === "string" ? (s as any).gender : (s as any).gender ?? null,
            },
          });

          await tx.parentLearnerLink.create({
            data: {
              schoolId,
              parentId: parentRecord.id,
              learnerId: siblingLearner.id,
              isPrimary: false,
            },
          });
        }
      }

      return { learner: learnerRecord, parent: parentRecord };
    });

    return res.status(200).json({
      success: true,
      learner: result.learner,
      parent: result.parent,
    });

  } catch (error) {

    console.error("Create learner error:", error);

    return res.status(500).json({

      success: false,

      error: "Failed to save learner",

    });

  }

});



export default router;