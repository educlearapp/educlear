import { Router } from "express";



import { PrismaClient } from "@prisma/client";



const router = Router();
const prisma = new PrismaClient() as any;



router.get("/", async (req, res) => {
  try {
    const schoolId =
      typeof (req as any).query?.schoolId === "string" ? String((req as any).query.schoolId) : "";
    const parentId =
      typeof (req as any).query?.parentId === "string" ? String((req as any).query.parentId) : "";

    const paymentsRaw = await prisma.payment.findMany({
      where: {
        ...(schoolId ? { schoolId } : {}),
        ...(parentId ? { parentId } : {}),
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    });

    const payments = (Array.isArray(paymentsRaw) ? paymentsRaw : []).map((p: any) => ({
      id: p.id,
      parentId: p.parentId,
      amount: typeof p.amount?.toNumber === "function" ? p.amount.toNumber() : Number(p.amount),
      date: p.date ?? null,
      type: p.type ?? p.method ?? null,
      description: p.description ?? null,
      createdAt: p.createdAt ?? null,
    }));

    return res.json({ success: true, payments });
  } catch (error) {
    console.error("Failed to fetch payments:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch payments" });
  }
});

router.post("/", async (req, res) => {



  try {



    const { parentId, amount, method, type, description, date } = req.body;

    const parentIdStr = typeof parentId === "string" ? parentId.trim() : "";
    const numericAmount = Number(amount);

    if (!parentIdStr || amount === undefined || amount === null) {
      return res.status(400).json({ error: "Missing parentId or amount" });
    }



    const parent = await prisma.parent.findFirst({
      where: { id: parentIdStr },
    });



    if (!parent) {



      return res.status(404).json({ error: "Parent not found" });



    }



    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const payment = await prisma.payment.create({



      data: {



        schoolId: parent.schoolId,



        parent: {



          connect: { id: parentIdStr },



        },



        amount: numericAmount,



        // Backward compat: older clients used `method`; contract now uses `type`.
        type: type || method || null,
        method: method || type || null,
        description: typeof description === "string" ? description.trim() : description ?? null,
        date: date ? new Date(String(date)) : new Date(),



      },



    });
    


    const updatedParent = await prisma.parent.update({



      where: { id: parentIdStr },



      data: {



        outstandingAmount: { decrement: numericAmount },



      },



    });



    return res.json({
      success: true,
      payment: {
        id: payment.id,
        parentId: payment.parentId,
        amount:
          typeof (payment as any).amount?.toNumber === "function"
            ? (payment as any).amount.toNumber()
            : Number((payment as any).amount),
        date: (payment as any).date ?? null,
        type: (payment as any).type ?? (payment as any).method ?? null,
        description: (payment as any).description ?? null,
        createdAt: (payment as any).createdAt ?? null,
      },
      updatedParent: {
        id: (updatedParent as any).id,
        outstandingAmount:
          typeof (updatedParent as any).outstandingAmount?.toNumber === "function"
            ? (updatedParent as any).outstandingAmount.toNumber()
            : Number((updatedParent as any).outstandingAmount),
      },
    });



  } catch (error) {



    console.error("Failed to create payment:", error);



    return res.status(500).json({ error: "Failed to create payment" });



  }



});



export default router;