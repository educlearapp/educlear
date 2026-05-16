import { Router } from "express";
import { calculateLearnerAge, resolveLearnerAccountNo } from "../utils/learnerIdentity";



import { PrismaClient } from "@prisma/client";



const router = Router();



const prisma = new PrismaClient();



router.get("/learners", async (req, res) => {



  try {



    const schoolId = String(req.query.schoolId || "");



    if (!schoolId) {



      return res.status(400).json({



        success: false,



        error: "Missing schoolId",



      });



    }



    const learners = await prisma.learner.findMany({



      where: { schoolId },



      include: {



        familyAccount: true,



        links: {



          include: { parent: true },



        },



      },



      orderBy: { createdAt: "desc" },



    });



    const result = learners.map((learner) => {



      const primary = learner.links.find((link) => link.isPrimary) || learner.links[0];



      const accountNo = resolveLearnerAccountNo(learner);



      return {



        id: learner.id,



        schoolId: learner.schoolId,



        familyAccountId: learner.familyAccountId,



        accountNo,



        accountNumber: accountNo,



        admissionNo: learner.admissionNo || accountNo,



        firstName: learner.firstName || "",



        name: learner.firstName || "",



        surname: learner.lastName || "",



        lastName: learner.lastName || "",



        birthDate: learner.birthDate,



        dateOfBirth: learner.birthDate,



        dob: learner.birthDate,



        age: calculateLearnerAge(learner.birthDate),



        gender: learner.gender || "",



        idNumber: learner.idNumber || "",



        grade: learner.grade || "",



        classroom: learner.className || learner.grade || "",



        classroomName: learner.className || learner.grade || "",



        className: learner.className || "",



        childStatus: "Enrolled",



        status: "Enrolled",



        enrolled: true,



        isEnrolled: true,



        parents: learner.links.map((link) => ({



          id: link.parent.id,



          firstName: link.parent.firstName || "",



          name: link.parent.firstName || "",



          surname: link.parent.surname || "",



          lastName: link.parent.surname || "",



          relationship: link.relation || link.parent.relationship || "",



          relation: link.relation || link.parent.relationship || "",



          idNumber: link.parent.idNumber || "",



          cellNo: link.parent.cellNo || "",



          cell: link.parent.cellNo || "",



          phone: link.parent.cellNo || "",



          email: link.parent.email || "",



          workNo: link.parent.workNo || "",



          isPrimary: link.isPrimary || false,



        })),



        parentName: primary



          ? `${primary.parent.firstName || ""} ${primary.parent.surname || ""}`.trim()



          : "",



        parentRelationship: primary?.relation || primary?.parent?.relationship || "",



        parentCell: primary?.parent?.cellNo || "",



        parentEmail: primary?.parent?.email || "",



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