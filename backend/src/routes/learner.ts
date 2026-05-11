import { Router } from "express";

import { PrismaClient } from "@prisma/client";



const router = Router();

const prisma = new PrismaClient();

router.get("/", async (req, res) => {



  try {



    const { schoolId } = req.query;



    if (!schoolId) {



      return res.status(400).json({ error: "Missing schoolId" });



    }



    const learners = await prisma.learner.findMany({



      where: {
    
    
    
        schoolId: String(schoolId),
    
    
    
      },
    
    
    
      include: {
    
    
    
        links: {
    
    
    
          include: {
    
    
    
            parent: true,
    
    
    
          },
    
    
    
        },
    
    
    
      },
    
    
    
      orderBy: {
    
    
    
        createdAt: "desc",
    
    
    
      },
    
    
    
    });
    
    
    
    const learnersWithParents = learners.map((learner) => {



      const parents =
    
    
    
        learner.links?.map((link: any) => {
    
    
    
          const parent = link.parent;
    
    
    
          if (!parent) return null;
    
    
    
          return {
    
    
    
            id: parent.id,
    
    
    
            firstName: parent.firstName || "",
    
    
    
            lastName: parent.lastName || "",
    
    
    
            email: parent.email || "",
    
    
    
            cellNo: parent.cellNo || "",
    
    
    
            relationship: link.relation || "",
    
    
    
            isPrimary: link.isPrimary || false,
    
    
    
            outstandingAmount: parent.outstandingAmount || 0,
    
    
    
            status: parent.status || "GREEN",
    
    
    
          };
    
    
    
        }).filter(Boolean) || [];
    
    
    
      return {
    
    
    
        id: learner.id,
    
    
    
        schoolId: learner.schoolId,
    
    
    
        familyAccountId: learner.familyAccountId,
    
    
    
        firstName: learner.firstName,
    
    
    
        lastName: learner.lastName,
    
    
    
        birthDate: learner.birthDate,
    
    
    
        gender: learner.gender,
    
    
    
        idNumber: learner.idNumber,
    
    
    
        grade: learner.grade,
    
    
    
        className: learner.className,
    
    
    
        admissionNo: learner.admissionNo,
    
    
    
        tuitionFee: learner.tuitionFee || 0,
    
    
    
        transportFee: learner.transportFee || 0,
    
    
    
        otherFee: learner.otherFee || 0,
    
    
    
        totalFee: learner.totalFee || 0,
    
    
    
        createdAt: learner.createdAt,
    
    
    
        parents,
    
    
    
      };
    
    
    
    });



    return res.status(200).json({



      success: true,
    
    
    
      TEST_PARENT_FIX: true,
    
    
    
      learners: learners.map((learner) => ({
    
    
    
        ...learner,
    
    
    
        parents: learner.links?.map((link) => ({
    
    
    
          firstName: link.parent.firstName,
    
    
    
          surname: link.parent.surname,
    
    
    
          idNumber: link.parent.idNumber,
    
    
    
          cell: link.parent.cellNo,
    
    
    
          email: link.parent.email,
    
    
    
          relationship: link.parent?.relationship || link.relation || "",
    
    
    
        })) || [],
    
    
    
      })),
    
    
    
    });



  } catch (error) {



    console.error("GET LEARNERS ERROR:", error);



    return res.status(500).json({



      success: false,



      error: "Failed to fetch learners",



    });



  }



});

router.post("/", async (req, res) => {

  try {

    const { learner } = req.body;



    let school = await prisma.school.findFirst({
    
      orderBy: { createdAt: "asc" },
    
    });
    
    
    
    if (!school) {
    
      school = await prisma.school.create({
    
        data: {
    
          name: "Da Silva Academy",
    
          email: "director@dasilvaacademy.com",
    
        },
    
      });
    
    }
    
    
    
    const surnameParts = learner.surname
    
      .trim()
    
      .toUpperCase()
    
      .split(/\s+/)
    
      .filter(Boolean);
    
    
    
    const lastWord = surnameParts[surnameParts.length - 1] || "";
    
    const prefix = lastWord.replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "X");
    
    
    
    const existingFamilies = await prisma.familyAccount.count({
    
      where: {
    
        schoolId: school.id,
    
        accountRef: {
    
          startsWith: prefix,
    
        },
    
      },
    
    });
    
    
    
    const nextNumber = String(existingFamilies + 1).padStart(3, "0");
    
    const familyReference = `${prefix}${nextNumber}`;
    
    
    
    const familyAccount = await prisma.familyAccount.create({
    
      data: {
    
        schoolId: school.id,
    
        accountRef: familyReference,
    
        familyName: learner.surname,
    
      },
    
    });
    
    
    
    const newLearner = await prisma.learner.create({
    
      data: {
    
        schoolId: school.id,
    
        familyAccountId: familyAccount.id,
    
        firstName: learner.firstName,
    
        lastName: learner.surname,
    
        grade: learner.grade || "",
    
        admissionNo: familyReference,
    
        tuitionFee: 0,
    
        transportFee: 0,
    
        otherFee: 0,
    
        totalFee: 0,
    
      },
    
    });
    
    
    
    return res.status(200).json({
    
      success: true,
    
      familyReference,
    
      familyAccountId: familyAccount.id,
    
      learnerId: newLearner.id,
    
    });


    

  } catch (error) {

    console.error("SAVE LEARNER ERROR:", error);

    return res.status(500).json({

      success: false,

      error: "Failed to save learner",

    });

  }

});



export default router;