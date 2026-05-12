import { Router } from "express";



import { PrismaClient } from "@prisma/client";



const router = Router();



const prisma = new PrismaClient();



function cleanString(value: any) {



  return typeof value === "string" ? value.trim() : "";



}



function normaliseParents(body: any) {



  const directParents = Array.isArray(body.parents) ? body.parents : [];



  const learnerParents = Array.isArray(body.learner?.parents) ? body.learner.parents : [];



  return [...directParents, ...learnerParents].filter((p) => p && typeof p === "object");



}



async function saveParentLinks({



  schoolId,



  learnerId,



  familyAccountId,



  parents,



}: {



  schoolId: string;



  learnerId: string;



  familyAccountId?: string | null;



  parents: any[];



}) {



  for (const rawParent of parents) {



    const firstName = cleanString(rawParent.firstName);



    const surname = cleanString(rawParent.surname || rawParent.lastName);



    const cellNo = cleanString(rawParent.cellNo || rawParent.cell);



    const email = cleanString(rawParent.email);



    const idNumber = cleanString(rawParent.idNumber);



    const relationship = cleanString(rawParent.relationship || rawParent.relation);



    if (!firstName && !surname && !cellNo && !email && !idNumber) continue;



    let parent = null;



    if (rawParent.id) {



      parent = await prisma.parent.update({



        where: { id: rawParent.id },



        data: {



          schoolId,



          familyAccountId: familyAccountId || null,



          firstName,



          surname,



          cellNo,



          email: email || null,



          idNumber: idNumber || null,



          relationship: relationship || null,



        },



      });



    } else if (idNumber) {



      parent = await prisma.parent.upsert({



        where: { idNumber },



        update: {



          schoolId,



          familyAccountId: familyAccountId || null,



          firstName,



          surname,



          cellNo,



          email: email || null,



          relationship: relationship || null,



        },



        create: {



          schoolId,



          familyAccountId: familyAccountId || null,



          firstName,



          surname,



          cellNo,



          email: email || null,



          idNumber,



          relationship: relationship || null,



        },



      });



    } else {



      parent = await prisma.parent.create({



        data: {



          schoolId,



          familyAccountId: familyAccountId || null,



          firstName,



          surname,



          cellNo,



          email: email || null,



          relationship: relationship || null,



        },



      });



    }



    await prisma.parentLearnerLink.upsert({



      where: {



        parentId_learnerId: {



          parentId: parent.id,



          learnerId,



        },



      },



      update: {



        relation: relationship || null,



        isPrimary: rawParent.isPrimary !== undefined ? Boolean(rawParent.isPrimary) : true,



      },



      create: {



        schoolId,



        parentId: parent.id,



        learnerId,



        relation: relationship || null,



        isPrimary: rawParent.isPrimary !== undefined ? Boolean(rawParent.isPrimary) : true,



      },



    });



  }



}



router.get("/", async (req, res) => {



  try {



    const { schoolId } = req.query;



    if (!schoolId) {



      return res.status(400).json({ success: false, error: "Missing schoolId" });



    }



    const learners = await prisma.learner.findMany({



      where: { schoolId: String(schoolId) },



      include: {



        links: {



          include: {



            parent: true,



          },



        },



      },



      orderBy: { createdAt: "desc" },



    });



    const learnersWithParents = learners.map((learner) => ({



      id: learner.id,



      schoolId: learner.schoolId,



      familyAccountId: learner.familyAccountId,



      firstName: learner.firstName || "",



      lastName: learner.lastName || "",



      surname: learner.lastName || "",



      birthDate: learner.birthDate,



      gender: learner.gender || "",



      idNumber: learner.idNumber || "",



      grade: learner.grade || "",



      className: learner.className || "",



      classroom: learner.className || "",



      classroomName: learner.className || "",



      admissionNo: learner.admissionNo || "",



      tuitionFee: learner.tuitionFee || 0,



      transportFee: learner.transportFee || 0,



      otherFee: learner.otherFee || 0,



      totalFee: learner.totalFee || 0,



      createdAt: learner.createdAt,



      parents:



        learner.links?.map((link) => ({



          id: link.parent.id,



          firstName: link.parent.firstName || "",



          surname: link.parent.surname || "",



          lastName: link.parent.surname || "",



          idNumber: link.parent.idNumber || "",



          cellNo: link.parent.cellNo || "",



          cell: link.parent.cellNo || "",



          email: link.parent.email || "",



          relationship: link.relation || link.parent.relationship || "",



          isPrimary: link.isPrimary || false,



          outstandingAmount: link.parent.outstandingAmount || 0,



          status: link.parent.status || "GREEN",



        })) || [],



    }));



    return res.status(200).json({



      success: true,



      learners: learnersWithParents,



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



    if (!learner) {



      return res.status(400).json({



        success: false,



        error: "Missing learner data",



      });



    }



    let school = null;



    if (learner.schoolId) {



      school = await prisma.school.findUnique({



        where: { id: learner.schoolId },



      });



    }



    if (!school) {



      school = await prisma.school.findFirst({



        orderBy: { createdAt: "asc" },



      });



    }



    if (!school) {



      school = await prisma.school.create({



        data: {



          name: "Da Silva Academy",



          email: "director@dasilvaacademy.com",



        },



      });



    }



    const learnerSurname = cleanString(learner.surname || learner.lastName);



    const surnameParts = learnerSurname



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



        familyName: learnerSurname,



      },



    });



    const newLearner = await prisma.learner.create({



      data: {



        schoolId: school.id,



        familyAccountId: familyAccount.id,



        firstName: cleanString(learner.firstName),



        lastName: learnerSurname,



        birthDate: learner.birthDate ? new Date(learner.birthDate) : null,



        gender: cleanString(learner.gender),



        idNumber: cleanString(learner.idNumber) || null,



        grade: cleanString(learner.grade),



        className: cleanString(learner.className || learner.classroom || learner.classroomName) || null,



        admissionNo: familyReference,



        tuitionFee: Number(learner.tuitionFee) || 0,



        transportFee: Number(learner.transportFee) || 0,



        otherFee: Number(learner.otherFee) || 0,



        totalFee: Number(learner.totalFee) || 0,



      },



    });



    const parents = normaliseParents(req.body);



    await saveParentLinks({



      schoolId: school.id,



      learnerId: newLearner.id,



      familyAccountId: familyAccount.id,



      parents,



    });



    return res.status(200).json({



      success: true,



      familyReference,



      familyAccountId: familyAccount.id,



      learnerId: newLearner.id,



      learner: newLearner,



    });



  } catch (error) {



    console.error("SAVE LEARNER ERROR:", error);



    return res.status(500).json({



      success: false,



      error: "Failed to save learner",



    });



  }



});



router.put("/:id", async (req, res) => {



  try {



    const { id } = req.params;



    const {



      firstName,



      lastName,



      surname,



      birthDate,



      gender,



      idNumber,



      grade,



      className,



      classroom,



      classroomName,



      admissionNo,



      tuitionFee,



      transportFee,



      otherFee,



      totalFee,



    } = req.body;



    const existingLearner = await prisma.learner.findUnique({



      where: { id },



    });



    if (!existingLearner) {



      return res.status(404).json({



        success: false,



        error: "Learner not found",



      });



    }



    const updatedLearner = await prisma.learner.update({



      where: { id },



      data: {



        ...(firstName !== undefined && { firstName: cleanString(firstName) }),



        ...((lastName !== undefined || surname !== undefined) && {



          lastName: cleanString(lastName ?? surname),



        }),



        ...(birthDate !== undefined && {



          birthDate: birthDate ? new Date(birthDate) : null,



        }),



        ...(gender !== undefined && { gender: cleanString(gender) }),



        ...(idNumber !== undefined && { idNumber: cleanString(idNumber) || null }),



        ...(grade !== undefined && { grade: cleanString(grade) }),



        ...(className !== undefined && { className: cleanString(className) || null }),



        ...(classroom !== undefined && { className: cleanString(classroom) || null }),



        ...(classroomName !== undefined && { className: cleanString(classroomName) || null }),



        ...(admissionNo !== undefined && { admissionNo: cleanString(admissionNo) || null }),



        ...(tuitionFee !== undefined && { tuitionFee: Number(tuitionFee) || 0 }),



        ...(transportFee !== undefined && { transportFee: Number(transportFee) || 0 }),



        ...(otherFee !== undefined && { otherFee: Number(otherFee) || 0 }),



        ...(totalFee !== undefined && { totalFee: Number(totalFee) || 0 }),



      },



      include: {



        links: {



          include: {



            parent: true,



          },



        },



      },



    });



    const parents = normaliseParents(req.body);



    await saveParentLinks({



      schoolId: updatedLearner.schoolId,



      learnerId: updatedLearner.id,



      familyAccountId: updatedLearner.familyAccountId,



      parents,



    });



    const refreshedLearner = await prisma.learner.findUnique({



      where: { id },



      include: {



        links: {



          include: {



            parent: true,



          },



        },



      },



    });



    return res.json({



      success: true,



      learner: refreshedLearner,



    });



  } catch (error) {



    console.error("UPDATE LEARNER ERROR:", error);



    return res.status(500).json({



      success: false,



      error: "Failed to update learner",



    });



  }



});



export default router;