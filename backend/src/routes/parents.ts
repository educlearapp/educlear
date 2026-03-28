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

export default router;