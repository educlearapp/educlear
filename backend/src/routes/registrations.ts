import { Router } from "express";



import { PrismaClient } from "@prisma/client";



const router = Router();



const prisma = new PrismaClient();



router.get("/learners", async (req, res) => {



  try {



    const schoolId = String(req.query.schoolId || "");



    const learners = await prisma.learner.findMany({



      where: {



        schoolId,



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



    const result = learners.map((learner) => {



      const primary =



        learner.links.find((l) => l.isPrimary) ||



        learner.links[0];



      return {



        id: learner.id,



        firstName: learner.firstName,



        surname: learner.lastName,



        idNumber: learner.idNumber,



        classroom: learner.className || learner.grade,



        parents: learner.links.map((link) => ({



          id: link.parent.id,



          firstName: link.parent.firstName || "",



          surname: link.parent.surname || "",



          relationship: link.relation || "",



          idNumber: link.parent.idNumber || "",



          cellNo: link.parent.cellNo || "",



          email: link.parent.email || "",



          workNo: link.parent.workNo || "",



          isPrimary: link.isPrimary || false,



        })),



        parentName: primary



          ? `${primary.parent.firstName || ""} ${primary.parent.surname || ""}`.trim()



          : "",



        parentRelationship:



          primary?.relation || "",



        parentCell:



          primary?.parent?.cellNo || "",



        parentEmail:



          primary?.parent?.email || "",



      };



    });



    return res.status(200).json({



      success: true,



      learners: result,



    });



  } catch (error) {



    console.error(error);



    return res.status(500).json({



      success: false,



      error: "Failed to load registrations",



    });



  }



});



export default router;