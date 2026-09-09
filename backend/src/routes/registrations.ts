import { Router } from "express";
import { calculateLearnerAge } from "../utils/learnerIdentity";
import {
  readExplicitlyEmptyBillingPlanLearnerIds,
  readSchoolBillingPlansResolved,
} from "../services/learnerBillingPlanDbStore";
import {
  buildBillingPlanLookupIndexes,
  resolveLearnerBillingPlanItems,
} from "../utils/learnerBillingPlanStore";
import { buildRegistrationStats } from "../services/registrationStatsService";
import {
  activeLearnerWhere,
  registrationEnrollmentFields,
  resolveLearnerClassroomLabel,
} from "../utils/learnerEnrollment";
import {
  requireRegistrationsLearnersAuth,
  type RegistrationsLearnersAuthRequest,
} from "../middleware/requireRegistrationsLearnersAuth";
import { resolveAuthoritativeAdmissionDateYmd } from "../utils/optionalProfileFields";

import { PrismaClient } from "@prisma/client";



const router = Router();



const prisma = new PrismaClient();



router.get("/stats", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "");
    if (!schoolId) {
      return res.status(400).json({ success: false, error: "Missing schoolId" });
    }

    const { stats } = await buildRegistrationStats(schoolId);
    return res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error("GET REGISTRATION STATS ERROR:", error);
    return res.status(500).json({ success: false, error: "Failed to load registration stats" });
  }
});



router.get("/learners", requireRegistrationsLearnersAuth, async (req: RegistrationsLearnersAuthRequest, res) => {



  try {



    const auth = req.registrationsLearnersAuth!;
    const schoolId = auth.authorizedSchoolId;
    const includeHistorical =
      String(req.query.includeHistorical || "").trim().toLowerCase() === "true";



    let billingPlansByLearner: Awaited<ReturnType<typeof readSchoolBillingPlansResolved>> = {};
    try {
      billingPlansByLearner = await readSchoolBillingPlansResolved(schoolId);
    } catch (billingErr) {
      console.error("[liveLearnerList] billingPlans read failed", billingErr);
    }

    const learners = await prisma.learner.findMany({



      where: includeHistorical ? { schoolId } : activeLearnerWhere(schoolId),



      include: {



        familyAccount: true,



        links: {



          include: { parent: true },



        },



      },



      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],



    });

    console.log(
      `[liveLearnerList] schoolId=${schoolId} includeHistorical=${includeHistorical} count=${learners.length}`
    );

    const learnerIds = new Set(learners.map((l) => l.id));
    const orphanPlanKeys = Object.keys(billingPlansByLearner).filter((id) => !learnerIds.has(id));
    const orphanLearners =
      orphanPlanKeys.length > 0
        ? await prisma.learner.findMany({
            where: { schoolId, id: { in: orphanPlanKeys } },
            select: { id: true, admissionNo: true, idNumber: true },
          })
        : [];

    const explicitlyEmptyLearnerIds = await readExplicitlyEmptyBillingPlanLearnerIds(schoolId);
    const billingPlanIndexes = buildBillingPlanLookupIndexes(billingPlansByLearner, [
      ...learners.map((l) => ({
        id: l.id,
        admissionNo: l.admissionNo,
        idNumber: l.idNumber,
      })),
      ...orphanLearners,
    ]);



    const result = learners.map((learner) => {



      const primary = learner.links.find((link) => link.isPrimary) || learner.links[0];



      const accountRef = String(learner.familyAccount?.accountRef || "").trim();
      const eduClearAccountNo = String(learner.familyAccount?.accountNo || "").trim();
      /** Legacy join/display field: ledger accountRef (unchanged for existing consumers). */
      const accountNo = accountRef;

      const classroomLabel = resolveLearnerClassroomLabel(learner);
      const enrollmentFields = registrationEnrollmentFields(learner.enrollmentStatus);



      return {



        id: learner.id,



        schoolId: learner.schoolId,



        familyAccountId: learner.familyAccountId,



        accountRef,



        eduClearAccountNo: eduClearAccountNo || null,



        accountNo,



        accountNumber: accountNo,



        admissionNo: learner.admissionNo,



        firstName: learner.firstName || "",



        name: learner.firstName || "",



        surname: learner.lastName || "",



        lastName: learner.lastName || "",



        birthDate: learner.birthDate,



        dateOfBirth: learner.birthDate,



        dob: learner.birthDate,



        age: calculateLearnerAge(learner.birthDate),



        gender: learner.gender || "",

        allergies: learner.allergies || "",
        medicalAlert: learner.medicalAlert || "",
        admissionDate: resolveAuthoritativeAdmissionDateYmd(learner),
        enrollmentDate: resolveAuthoritativeAdmissionDateYmd(learner),
        enrolmentDate: resolveAuthoritativeAdmissionDateYmd(learner),



        idNumber: learner.idNumber || "",



        grade: learner.grade || "",



        classroom: classroomLabel,



        classroomName: classroomLabel,



        className: learner.className || classroomLabel,



        ...enrollmentFields,



        parents: learner.links.map((link) => ({



          id: link.parent.id,



          firstName: link.parent.firstName || "",



          name: link.parent.firstName || "",



          surname: link.parent.surname || "",



          lastName: link.parent.surname || "",



          relationship: link.relation || link.parent.relationship || "",



          relation: link.relation || link.parent.relationship || "",



          idNumber: link.parent.idNumber || "",
          title: link.parent.title || "",
          cellNo: link.parent.cellNo || "",
          cell: link.parent.cellNo || "",
          phone: link.parent.cellNo || "",
          email: link.parent.email || "",
          workNo: link.parent.workNo || "",
          homeNo: link.parent.homeNo || "",
          homeAddress: link.parent.homeAddress || "",
          notes: link.parent.notes || "",
          birthDate: link.parent.birthDate
            ? link.parent.birthDate.toISOString().slice(0, 10)
            : null,
          dateOfBirth: link.parent.birthDate
            ? link.parent.birthDate.toISOString().slice(0, 10)
            : null,
          communicationAdministration: link.parent.communicationAdministration ?? true,
          communicationBilling: link.parent.communicationBilling ?? true,
          communicationByEmail: link.parent.communicationByEmail ?? true,
          communicationBySMS: link.parent.communicationBySMS ?? true,
          communicationByPrint: link.parent.communicationByPrint ?? true,
          isPayingPerson: link.isPayingPerson ?? false,
          billingStatement: link.billingStatement ?? true,
          billingInvoice: link.billingInvoice ?? true,
          billingReceipt: link.billingReceipt ?? true,
          isPrimary: link.isPrimary || false,



        })),



        parentName: primary



          ? `${primary.parent.firstName || ""} ${primary.parent.surname || ""}`.trim()



          : "",



        parentRelationship: primary?.relation || primary?.parent?.relationship || "",



        parentCell: primary?.parent?.cellNo || "",



        parentEmail: primary?.parent?.email || "",

        billingPlan: resolveLearnerBillingPlanItems(
          {
            id: learner.id,
            admissionNo: learner.admissionNo,
            idNumber: learner.idNumber,
          },
          billingPlansByLearner,
          billingPlanIndexes,
          explicitlyEmptyLearnerIds
        ),

        tuitionFee: learner.tuitionFee ?? 0,
        totalFee: learner.totalFee ?? 0,

      };



    });



    return res.status(200).json({



      success: true,



      learners: result,



    });



  } catch (error) {



    console.error("GET REGISTRATION LEARNERS ERROR:", error);



    return res.status(500).json({



      success: false,



      error: "Failed to load registrations",



    });



  }



});



export default router;
