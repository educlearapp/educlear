import express from "express";

import cors from "cors";

import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import multer from "multer"; 
import schoolsRoutes from "./routes/schools";
import parentsRoutes from "./routes/parents";
import jwt from "jsonwebtoken";
import learnerRoutes from "./routes/learner";
import statementsRoutes from "./routes/statements";
import paymentsRoutes from "./routes/payments";
import invoicesRoutes from "./routes/invoices";
import billingDocumentsRoutes from "./routes/billingDocuments";
import billingPenaltiesRoutes from "./routes/billingPenalties";
import legalBillingDocumentsRoutes from "./routes/legalBillingDocuments";
import usersRoutes from "./routes/users";
import bcrypt from "bcryptjs";

import authRoutes from "./routes/auth";
import teacherPerformanceRoutes from "./routes/teacherPerformance";

import payrollRoutes from "./routes/payroll";
import feesRoutes from "./routes/fees";
import registrationsRoutes from "./routes/registrations";
import emailRoutes from "./routes/emails";
type OtpRecord = {

    code: string;
  
    expiresAt: number;
  
  };
  

  const prisma = new PrismaClient();
  const otpStore = new Map<string, OtpRecord>();
  const storage = multer.diskStorage({



    destination: function (
  
  
  
      req: express.Request,
  
  
  
      file: Express.Multer.File,
  
  
  
      cb: (error: Error | null, destination: string) => void
  
  
  
    ) {
  
  
  
      cb(null, path.join(process.cwd(), "uploads/school-logos"));
  
  
  
    },
  
  
  
    filename: function (
  
  
  
      req: express.Request,
  
  
  
      file: Express.Multer.File,
  
  
  
      cb: (error: Error | null, filename: string) => void
  
  
  
    ) {
  
  
  
      const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
  
  
  
      cb(null, "school-logo-" + unique + path.extname(file.originalname));
  
  
  
    },
  
  
  
  });
  
  
  
  const upload = multer({ storage });
  function authMiddleware(req: any, res: any, next: any) {

    const authHeader = req.headers.authorization;
  
  
  
    if (!authHeader) {
  
      return res.status(401).json({ error: "No token provided" });
  
    }
  
  
  
    const token = authHeader.split(" ")[1];
  
  
  
    if (!token) {
  
      return res.status(401).json({ error: "Invalid token format" });
  
    }
  
  
  
    try {
  
      const decoded = Buffer.from(token, "base64").toString("utf-8");
  
      (req as any).user = decoded;
  
      next();
  
    } catch {
  
      return res.status(401).json({ error: "Invalid token" });
  
    }
  }
  
  
  function normalizePhone(phone: string) {
  
    // Keep + and digits only
  
    const cleaned = String(phone || "").trim().replace(/[^\d+]/g, "");
  
    return cleaned;
  
  }
  
  
  
  function generateOtp() {
  
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
  
  }


const app = express();

app.get("/api/debug-current-server", (req, res) => {
  res.json({
    ok: true,
    source: "backend/src/index.ts",
    time: new Date().toISOString(),
  });
});

const PORT = 3000;



/*

  VERY IMPORTANT:

  Allow frontend (Vite runs on 5173)

*/
app.use(express.json({ limit: "12mb" }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
app.use(

  cors({

    origin: [

      "http://localhost:5173",

      "http://localhost:5174",
      
      "http://localhost:5175",

      "https://educlear-frontend.onrender.com",

    ],

    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],

    allowedHeaders: ["Content-Type", "Authorization"],

    credentials: true,

  })

);


  


// ===== OTP AUTH (DEV MODE) =====
app.use ("/auth", authRoutes);
app.use("/learner", learnerRoutes);
app.use("/api/schools", schoolsRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/users", usersRoutes);
app.post("/api/upload-logo", upload.single("logo"), (req, res) => {



  if (!req.file) {



    return res.status(400).json({ success: false });



  }



  const url = `http://localhost:3000/uploads/school-logos/${req.file.filename}`;



  res.json({



    success: true,



    url,



  });



});
app.use("/api", parentsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/statements", statementsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/billing-documents", billingDocumentsRoutes);
app.use("/api/legal-billing-documents", legalBillingDocumentsRoutes);
app.use("/api/billing/late-penalties", billingPenaltiesRoutes);
app.use("/api/teacher-performance", teacherPerformanceRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/fees", feesRoutes);
app.use("/api/learners", learnerRoutes);
app.use("/api/registrations", registrationsRoutes);
app.get("/api/parents", async (_req, res) => {



  try {



    const schoolId =



      typeof (_req as any).query?.schoolId === "string"



        ? String((_req as any).query.schoolId)



        : "";



    const parents = await prisma.parent.findMany({



      where: schoolId ? { schoolId } : undefined,



      orderBy: { createdAt: "desc" },



    });



    res.json({



      success: true,



      parents,



    });



  } catch (error) {



    console.error("Get parents error:", error);



    res.status(500).json({



      success: false,



      message: "Failed to fetch parents",



    });



  }



});

app.get("/api/parent-portal/lookup", async (req, res) => {



  try {



    const schoolId = String(req.query.schoolId || "").trim();



    const rawCellNo = String(req.query.cellNo || "").trim();



    const idNumber = String(req.query.idNumber || "").trim();



    if (!schoolId || !rawCellNo) {



      return res.status(400).json({



        success: false,



        error: "schoolId and cellNo are required",



      });



    }



    const digits = rawCellNo.replace(/\D/g, "");



    const localCell = digits.startsWith("27")



      ? `0${digits.slice(2)}`



      : digits;



    const internationalCell = digits.startsWith("27")



      ? `+${digits}`



      : `+27${digits.replace(/^0/, "")}`;



    const plainInternational = internationalCell.replace("+", "");



    let parent: any = await prisma.parent.findFirst({



      where: {



        schoolId,



        OR: [



          { cellNo: rawCellNo },



          { cellNo: localCell },



          { cellNo: internationalCell },



          { cellNo: plainInternational },



          ...(idNumber ? [{ idNumber }] : []),



        ],



      },



      include: {



        links: {



          include: {



            learner: true,



          },



        },



      },



    });



    if (!parent) {



      parent = await prisma.parent.findFirst({



        where: {



          OR: [



            { cellNo: rawCellNo },



            { cellNo: localCell },



            { cellNo: internationalCell },



            { cellNo: plainInternational },



            ...(idNumber ? [{ idNumber }] : []),



          ],



        },



        include: {



          links: {



            include: {



              learner: true,



            },



          },



        },



      });



    }



    if (!parent) {



      return res.status(404).json({



        success: false,



        error: "Parent not found. Check the mobile number, ID number, and selected school.",



      });



    }



    const school = await prisma.school.findUnique({



      where: { id: parent.schoolId },



      select: {



        id: true,



        name: true,



      },



    });



    return res.json({



      success: true,



      parent: {



        id: parent.id,



        firstName: parent.firstName,



        surname: parent.surname,



        cellNo: parent.cellNo,



        email: parent.email,



        school: school



          ? {



              id: school.id,



              name: school.name,



            }



          : null,



      },



      learners: Array.isArray(parent.links)



        ? parent.links.map((link: any) => ({



            linkId: link.id,



            isPrimary: link.isPrimary,



            relation: link.relation || link.relationship || "",



            learner: {



              id: link.learner.id,



              firstName: link.learner.firstName,



              lastName: link.learner.lastName,



              grade: link.learner.grade,



              className: link.learner.className,



              admissionNo: link.learner.admissionNo,



            },



          }))



        : [],



    });



  } catch (error) {



    console.error("Parent portal lookup error:", error);



    return res.status(500).json({



      success: false,



      error: "Failed to lookup parent portal account",



    });



  }



});
app.listen(PORT, () => {

  console.log(`Server running on http://localhost:${PORT}`);

});
