import { Router } from "express";



const router = Router();



router.get("/", async (req, res) => {



  const { schoolId } = req.query;



  if (!schoolId) {



    return res.status(400).json({



      success: false,



      message: "Missing schoolId",



    });



  }



  // TEMP so frontend stops breaking



  return res.json({



    success: true,



    invoices: [],



  });



});



export default router;