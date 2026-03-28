import { Router } from "express";


import { PrismaClient } from "@prisma/client";



const router = Router();

const prisma = new PrismaClient();

  


// Calculate score

function calculateFinalScore(

  learnerResults: number,

  classroomManagement: number,

  teachingQuality: number,

  administration: number,

  professionalConduct: number

) {

    return (

        (learnerResults * 0.4 +
      
          classroomManagement * 0.2 +
      
          teachingQuality * 0.15 +
      
          administration * 0.15 +
      
          professionalConduct * 0.1) * 10
      
      );

}



// Performance level

function getPerformanceLevel(score: number) {

  if (score >= 85) return "Excellent";

  if (score >= 70) return "Acceptable";

  if (score >= 50) return "At Risk";

  return "Critical";

}



// CREATE

router.post("/", async (req, res) => {

  try {

    const data = req.body;
    console.log("POST schoolId:", data.schoolId);



const school = await prisma.school.findUnique({

  where: { id: data.schoolId },

});



console.log("FOUND SCHOOL:", school);


    const finalScore = calculateFinalScore(

      data.learnerResults,

      data.classroomManagement,

      data.teachingQuality,

      data.administration,

      data.professionalConduct

    );



    const performanceLevel = getPerformanceLevel(finalScore);



    const record = await prisma.teacherPerformance.create({

      data: {

        ...data,

        finalScore,

        performanceLevel,

      },

    });



    res.json(record);

  } catch (err) {

    console.error(err);

    res.status(500).json({ error: "Error creating record" });

  }

});



// GET ALL BY SCHOOL

router.get("/school/:schoolId", async (req, res) => {

  try {

    const records = await prisma.teacherPerformance.findMany({

      where: { schoolId: req.params.schoolId },

      orderBy: { createdAt: "desc" },

    });



    res.json(records);

  } catch (err) {

    res.status(500).json({ error: "Error fetching records" });

  }

});

router.delete("/:id", async (req, res) => {

    try {
  
      const { id } = req.params;
  
  
  
      await prisma.teacherPerformance.delete({
  
        where: { id },
  
      });
  
  
  
      res.json({ success: true });
  
    } catch (err) {
  
      console.error(err);
  
      res.status(500).json({ error: "Error deleting record" });
  
    }
  
  });

  router.put("/:id", async (req, res) => {

    try {
  
      const { id } = req.params;
  
      const data = req.body;
  
  
  
      const finalScore = calculateFinalScore(
  
        Number(data.learnerResults),
  
        Number(data.classroomManagement),
  
        Number(data.teachingQuality),
  
        Number(data.administration),
  
        Number(data.professionalConduct)
  
      );
  
  
  
      const performanceLevel = getPerformanceLevel(finalScore);
  
  
  
      const updated = await prisma.teacherPerformance.update({
  
        where: { id },
  
        data: {
  
          teacherName: data.teacherName,
  
          teacherEmail: data.teacherEmail,
  
          learnerResults: Number(data.learnerResults),
  
          classroomManagement: Number(data.classroomManagement),
  
          teachingQuality: Number(data.teachingQuality),
  
          administration: Number(data.administration),
  
          professionalConduct: Number(data.professionalConduct),
  
          notes: data.notes,
  
          month: data.month,
  
          finalScore,
  
          performanceLevel,
  
        },
  
      });
  
  
  
      res.json(updated);
  
    } catch (err) {
  
      console.error(err);
  
      res.status(500).json({ error: "Error updating record" });
  
    }
  
  });
export default router;