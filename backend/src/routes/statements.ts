import { Router } from "express";

import { prisma } from "../prisma";



const router = Router();



// GET /api/statements/accounts?schoolId=...



router.get("/accounts", async (req, res) => {



  try {



    const { schoolId } = req.query;



    if (!schoolId) {



      return res.status(400).json({ error: "Missing schoolId" });



    }



    const learners = await prisma.learner.findMany({



      where: { schoolId: String(schoolId) },



      include: {



        familyAccount: true,



      },



    });



    const accounts = learners.map((l: any, index: number) => {



      const familyRef =



        l.familyAccount?.accountRef ||



        l.admissionNo ||



        l.admissionNumber ||



        `ACC${String(index + 1).padStart(3, "0")}`;



      const balance = Number(l.totalFee || l.balance || 0);



      const lastInvoiceAmount = Number(l.lastInvoiceAmount || 0);



      const lastPaymentAmount = Number(l.lastPaymentAmount || 0);



      let status = "Up To Date";



      if (balance > 10000) status = "Bad Debt";



      else if (balance > 0) status = "Recently Owing";



      else if (balance < 0) status = "Over Paid";



      return {



        accountNo: familyRef,



        name: l.firstName || "-",



        surname: l.lastName || "-",



        balance,



        lastInvoice: lastInvoiceAmount,



        lastPayment: lastPaymentAmount,



        status,



      };



    });



    res.json({ success: true, accounts });



  } catch (error) {



    console.error("Statements error:", error);



    res.status(500).json({ error: "Server error" });



  }



});



export default router;