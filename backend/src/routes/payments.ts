import { Router } from "express";



import { prisma } from "../index";



const router = Router();
const prismaAny = prisma as any;



router.post("/", async (req, res) => {



  try {



    const { parentId, amount, method } = req.body;

    const numericAmount = Number(amount);

    if (!parentId || amount === undefined || amount === null) {



      return res.status(400).json({ error: "Missing parentId or amount" });



    }



    const parent = await prismaAny.parent.findFirst({



      where: { id: parentId },
    
    
    
    });



    if (!parent) {



      return res.status(404).json({ error: "Parent not found" });



    }



    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const payment = await prismaAny.payment.create({



      data: {



        schoolId: parent.schoolId,



        parent: {



          connect: { id: parentId },



        },



        amount: numericAmount,



        method: method || null,



      },



    });
    


    const newOutstanding = Number(parent.outstandingAmount || 0) - numericAmount;



    await prismaAny.parent.update({



      where: { id: parentId },



      data: {



        outstandingAmount: newOutstanding,



      },



    });



    return res.json(payment);



  } catch (error) {



    console.error("Failed to create payment:", error);



    return res.status(500).json({ error: "Failed to create payment" });



  }



});



export default router;