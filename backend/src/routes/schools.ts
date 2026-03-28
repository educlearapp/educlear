import { Router } from "express";

import { PrismaClient } from "@prisma/client";



const prisma = new PrismaClient();

const router = Router();



router.get("/", async (req, res) => {

  try {

    const schools = await prisma.school.findMany({

      include: {
    
        learners: true,
    
      },
    
      orderBy: {
    
        createdAt: "desc",
    
      },
    
    }); 

    res.json(schools);

  } catch (error) {

    console.error("Error fetching schools:", error);

    res.status(500).json({ error: "Failed to fetch schools" });

  }

});



export default router;