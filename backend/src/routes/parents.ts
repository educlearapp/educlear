import { Router } from "express";

import { PrismaClient } from "@prisma/client";



const router = Router();

const prisma = new PrismaClient();



router.post("/", async (req, res) => {

  try {

    const {

        relationship,
      
        title,
      
        firstName,
      
        surname,
      
        nickname,
      
        idNumber,
      
        maritalStatus,
      
        notes,
      
        homeNo,
      
        workNo,
      
        cellNo,
      
        faxNo,
      
        email,
      
        communicationByEmail,
      
        communicationByPrint,
      
        communicationBySMS,
      
        schoolId
      
      } = req.body;   



    const parent = await prisma.parent.create({

        data: {

            relationship,
          
            title,
          
            firstName,
          
            surname,
          
            nickname,
          
            idNumber,
          
            maritalStatus,
          
            notes,
          
            homeNo,
          
            workNo,
          
            cellNo,
          
            faxNo,
          
            email,
          
            communicationByEmail,
          
            communicationByPrint,
          
            communicationBySMS,
          
            school: {
          
              connect: {
          
                id: schoolId
          
              }
          
            }
          
          }   
      
      });   



    res.json({

      success: true,

      parent,

    });

} catch (error: any) {

    console.error("CREATE PARENT ERROR:", error);
  
  
  
    res.status(500).json({
  
      success: false,
  
      message: "Failed to create parent",
  
      error: String(error?.message || error),
  
      code: error?.code || null,
  
      meta: error?.meta || null,
  
    });
  
  }
  });

  router.get("/fee-check/:parentId", async (req, res) => {
  try {
    const { parentId } = req.params;

    if (!parentId) {
      return res.status(400).json({ found: false, error: "Missing parentId" });
    }

    const parent = await prisma.parent.findUnique({
      where: { id: parentId },
      include: {
        school: true,
        Letter: true,
      },
    });

    if (!parent) {
      return res.status(404).json({
        found: false,
        status: "GREEN",
        outstandingAmount: 0,
        school: "No record found",
        parentName: "",
      });
    }

    const totalOutstandingCents = parent.Letter.reduce((sum, letter) => {
      if (letter.status === "DRAFT") return sum;
      return sum + (letter.amountCents || 0);
    }, 0);

    const outstandingAmount = totalOutstandingCents / 100;

    let status = "GREEN";
    if (outstandingAmount > 10000) {
      status = "RED";
    } else if (outstandingAmount > 0) {
      status = "AMBER";
    }

    return res.json({
      found: true,
      status,
      outstandingAmount,
      school: parent.school?.name || "",
      parentName: `${parent.firstName} ${parent.surname}`,
    });
  } catch (error) {
    console.error("Fee check error:", error);
    return res.status(500).json({
      found: false,
      status: "GREEN",
      outstandingAmount: 0,
      school: "Server error",
      parentName: "",
    });
  }
});

export default router;