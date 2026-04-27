import express from "express";

import cors from "cors";

import { PrismaClient } from "@prisma/client";

import schoolsRoutes from "./routes/schools";
import parentsRoutes from "./routes/parents";
import jwt from "jsonwebtoken";
import learnerRoutes from "./routes/learner";
import bcrypt from "bcryptjs";

import authRoutes from "./routes/auth";
import teacherPerformanceRoutes from "./routes/teacherPerformance";

import payrollRoutes from "./routes/payroll";
import feesRoutes from "./routes/fees";
type OtpRecord = {

    code: string;
  
    expiresAt: number;
  
  };
  

  export const prisma = new PrismaClient();
  const otpStore = new Map<string, OtpRecord>();
  
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

const PORT = 3000;



/*

  VERY IMPORTANT:

  Allow frontend (Vite runs on 5173)

*/
app.use(express.json({ limit: "12mb" }));
app.use(

  cors({

    origin: [



      "http://localhost:5173",
    
    
    
      "http://localhost:5175",
    
    
    
      "https://educlear-frontend.onrender.com",
    
    
    
      "https://www.educlear.co.za",
    
    
    
      "https://educlear.co.za",
    
    
    
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
app.use("/api/parents", parentsRoutes);

app.use("/api/teacher-performance", teacherPerformanceRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/fees", feesRoutes);



// Request OTP

app.post("/auth/request-otp", (req, res) => {

    const phoneRaw = req.body?.phone;
  
    const phone = normalizePhone(phoneRaw);
  
  
  
    if (!phone || !phone.startsWith("+27") || phone.length < 11) {
  
      return res.status(400).json({ error: "Phone must be in format +27XXXXXXXXX" });
  
    }
  
  
  
    const code = generateOtp();
  
    const expiresAt = Date.now() + 5 * 60 * 1000;
  
  
  
    otpStore.set(phone, { code, expiresAt });
  
  
  
    console.log(`✅ OTP for ${phone}: ${code} (expires in 5 min)`);
  
  
  
    return res.json({ ok: true });
  
  });
  
  
  
  // Verify OTP
  
  app.post("/auth/verify-otp", (req, res) => {
  
    const phone = normalizePhone(req.body?.phone);
  
    const code = String(req.body?.code || "").trim();
  
  
  
    const record = otpStore.get(phone);
  
  
  
    if (!record) {
  
      return res.status(400).json({ error: "No OTP requested for this number" });
  
    }
  
  
  
    if (Date.now() > record.expiresAt) {
  
      otpStore.delete(phone);
  
      return res.status(400).json({ error: "OTP expired" });
  
    }
  
  
  
    if (record.code !== code) {
  
      return res.status(400).json({ error: "Incorrect OTP" });
  
    }
  
  
  
    otpStore.delete(phone);
  
  
  
    const token = Buffer.from(`${phone}:${Date.now()}`).toString("base64");
  
  
  
    return res.json({ ok: true, token, phone });
  
  });


app.get("/", (req, res) => {

  res.send("EduClear API is running 🚀");

});



app.get("/health", (req, res) => {

  res.json({

    status: "ok",

    app: "EduClear",

    time: new Date().toISOString(),

  });

});


app.get("/dashboard", authMiddleware, (req, res) => {

    res.json({
  
      message: "Welcome to EduClear Dashboard 🚀",
  
      user: (req as any).user
  
    });
  
  });
  app.get("/health", (req, res) => {

    res.json({ status: "OK" });
  
  });
  app.get("/api/dashboard", async (_req, res) => {

    try {
  
      const [schools, parents, learners, feeSettings, letters] = await Promise.all([
  
        prisma.school.count(),
  
        prisma.parent.count(),
  
        prisma.learner.count(),
  
        prisma.schoolFeeSetting.count(),
  
        prisma.letter.count(),
  
      ]);
  
  
  
      res.json({
  
        success: true,
  
        stats: {
  
          schools,
  
          parents,
  
          learners,
  
          feeSettings,
  
          letters,
  
        },
  
      });
  
    } catch (error) {
  
      console.error("Dashboard error:", error);
  
      res.status(500).json({
  
        success: false,
  
        message: "Failed to load dashboard data",
  
      });
  
    }
  
  });
  
  app.post("/api/parents", async (req, res) => {

    try {
  
      const { fullName, mobile, email, idNumber, schoolId } = req.body;



      if (!fullName || !mobile || !schoolId || !idNumber) {
      
        return res.status(400).json({
      
          success: false,
      
          message: "fullName, mobile, schoolId and idNumber are required",
      
        });
      
      }
      
      
      
     
  
  
  
      // 🔍 CHECK EXISTING BY SA ID
  
      const existingParent = await prisma.parent.findFirst({
  
        where: { idNumber },
  
      });
  
      if (existingParent) {

        return res.status(400).json({
      
          success: false,
      
          message: "Parent with this ID number already exists",
      
        });
      
      }
      
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school) {
        return res.status(400).json({
          success: false,
          message: "School not found",
        });
      }

      const parent = await prisma.parent.create({
  
        data: {
  
          relationship: "Parent",
  
          title: null,
  
          firstName: fullName,
  
          surname: "",
  
          nickname: null,
  
          idNumber,
  
          maritalStatus: null,
  
          notes: null,
  
          homeNo: null,
  
          workNo: null,
  
          cellNo: mobile,
  
          faxNo: null,
  
          email: email || null,
  
          communicationByEmail: true,
  
          communicationByPrint: true,
  
          communicationBySMS: true,
  
          status: "GREEN",
  
          schoolId,
  
        },
  
      });
  
  
  
      return res.status(201).json({
  
        success: true,
  
        parent,
  
      });
  
  
  
    } catch (error) {
  
      console.error(error);
  
      return res.status(500).json({
  
        success: false,
  
        message: "Server error",
  
      });
  
    }
  
  });

  app.get("/api/parents", async (_req, res) => {

    try {
      const schoolId =
        typeof (_req as any).query?.schoolId === "string" ? String((_req as any).query.schoolId) : "";
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
  app.post("/api/learners", async (req, res) => {
    try {
      const body = req.body ?? {};

      const schoolId = typeof body.schoolId === "string" ? body.schoolId : "";
      const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
      const lastName = typeof body.lastName === "string" ? body.lastName.trim() : "";
      const grade = typeof body.grade === "string" ? body.grade.trim() : "";
      const className =
        typeof body.className === "string" && body.className.trim() ? body.className.trim() : null;
      const admissionNo =
        typeof body.admissionNo === "string" && body.admissionNo.trim() ? body.admissionNo.trim() : null;

      const idNumber =
        typeof body.idNumber === "string" && body.idNumber.trim() ? body.idNumber.trim() : null;
      const gender =
        typeof body.gender === "string" && body.gender.trim() ? body.gender.trim() : null;
      const birthDate = body.birthDate ? new Date(String(body.birthDate)) : null;
      const birthDateValue =
        birthDate && !Number.isNaN(birthDate.getTime()) ? birthDate : null;

      const parent = (body.parent ?? null) as
        | {
            firstName?: unknown;
            surname?: unknown;
            email?: unknown;
            phone?: unknown;
            idNumber?: unknown;
          }
        | null;

      const siblings = Array.isArray(body.siblings) ? (body.siblings as any[]) : [];

      if (!schoolId || !firstName || !lastName || !grade) {
        return res.status(400).json({
          success: false,
          message: "schoolId, firstName, lastName and grade are required",
        });
      }

      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school) {
        return res.status(400).json({ success: false, message: "School not found", schoolId });
      }

      const surnameParts = lastName
        .trim()
        .toUpperCase()
        .split(/\s+/)
        .filter(Boolean);
      const lastWord = surnameParts[surnameParts.length - 1] || "FAM";
      const prefix = lastWord.replace(/[^A-Z]/g, "").slice(0, 3).padEnd(3, "X");
      const existingFamilies = await prisma.familyAccount.count({
        where: {
          schoolId,
          accountRef: {
            startsWith: prefix,
          },
        },
      });
      const nextNumber = String(existingFamilies + 1).padStart(3, "0");
      const familyReference = `${prefix}${nextNumber}`;

      const familyAccount = await prisma.familyAccount.create({
        data: {
          schoolId,
          accountRef: familyReference,
          familyName: lastName,
        },
      });

      const learner = await prisma.learner.create({
        data: {
          schoolId,
          familyAccountId: familyAccount.id,
          firstName,
          lastName,
          grade,
          className,
          admissionNo: admissionNo || familyReference,
          idNumber,
          gender,
          birthDate: birthDateValue,
        },
      });

      let parentRecord: any = null;
      if (parent && typeof parent === "object") {
        const pFirstName = typeof parent.firstName === "string" ? parent.firstName.trim() : "";
        const pSurname = typeof parent.surname === "string" ? parent.surname.trim() : "";
        const pEmail =
          typeof parent.email === "string" && parent.email.trim() ? parent.email.trim() : null;
        const pPhone = typeof parent.phone === "string" ? parent.phone.trim() : "";
        const pIdNumber =
          typeof parent.idNumber === "string" && parent.idNumber.trim() ? parent.idNumber.trim() : null;

        if (pFirstName && pSurname && pPhone) {
          const existingParent = pIdNumber
            ? await prisma.parent.findFirst({ where: { schoolId, idNumber: pIdNumber } })
            : pEmail
              ? await prisma.parent.findFirst({ where: { schoolId, email: pEmail } })
              : null;

          parentRecord = existingParent
            ? await prisma.parent.update({
                where: { id: existingParent.id },
                data: {
                  firstName: pFirstName,
                  surname: pSurname,
                  email: pEmail,
                  cellNo: pPhone,
                  familyAccountId: familyAccount.id,
                  ...(pIdNumber ? { idNumber: pIdNumber } : {}),
                },
              })
            : await prisma.parent.create({
                data: {
                  schoolId,
                  familyAccountId: familyAccount.id,
                  firstName: pFirstName,
                  surname: pSurname,
                  email: pEmail,
                  cellNo: pPhone,
                  idNumber: pIdNumber,
                },
              });

          await prisma.parentLearnerLink.create({
            data: {
              schoolId,
              parentId: parentRecord.id,
              learnerId: learner.id,
              isPrimary: true,
            },
          });
        }
      }

      const siblingLearners: any[] = [];
      for (const s of siblings) {
        const sFirstName = typeof s?.firstName === "string" ? s.firstName.trim() : "";
        const sLastName = typeof s?.lastName === "string" ? s.lastName.trim() : "";
        const sGrade = typeof s?.grade === "string" ? s.grade.trim() : "";
        if (!sFirstName || !sLastName || !sGrade) continue;

        const sClassName =
          typeof s?.className === "string" && s.className.trim() ? s.className.trim() : null;
        const sAdmissionNo =
          typeof s?.admissionNo === "string" && s.admissionNo.trim() ? s.admissionNo.trim() : null;
        const sIdNumber =
          typeof s?.idNumber === "string" && s.idNumber.trim() ? s.idNumber.trim() : null;
        const sGender = typeof s?.gender === "string" && s.gender.trim() ? s.gender.trim() : null;
        const sBirthDate = s?.birthDate ? new Date(String(s.birthDate)) : null;
        const sBirthDateValue =
          sBirthDate && !Number.isNaN(sBirthDate.getTime()) ? sBirthDate : null;

        const createdSibling = await prisma.learner.create({
          data: {
            schoolId,
            familyAccountId: familyAccount.id,
            firstName: sFirstName,
            lastName: sLastName,
            grade: sGrade,
            className: sClassName,
            admissionNo: sAdmissionNo,
            idNumber: sIdNumber,
            gender: sGender,
            birthDate: sBirthDateValue,
          },
        });
        siblingLearners.push(createdSibling);

        if (parentRecord) {
          await prisma.parentLearnerLink.create({
            data: {
              schoolId,
              parentId: parentRecord.id,
              learnerId: createdSibling.id,
              isPrimary: false,
            },
          });
        }
      }

      return res.status(201).json({
        success: true,
        learner,
        parent: parentRecord,
        siblings: siblingLearners,
        familyAccountId: familyAccount.id,
      });
    } catch (error) {
      console.error("Create learner error:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to create learner",
      });
    }
  });
  
  
  
  app.get("/api/learners", async (_req, res) => {
  
    try {
      const schoolId =
        typeof (_req as any).query?.schoolId === "string" ? String((_req as any).query.schoolId) : "";
      const learners = await prisma.learner.findMany({
        where: schoolId ? { schoolId } : undefined,
        orderBy: { createdAt: "desc" },
      });
  
  
  
      return res.json({
  
        success: true,
  
        learners,
  
      });
  
    } catch (error) {
  
      console.error("Get learners error:", error);
  
      return res.status(500).json({
  
        success: false,
  
        message: "Failed to fetch learners",
  
      });
  
    }
  
  });
  app.post("/api/schools/create", async (req, res) => {

    try {
  
      const { name, email } = req.body;
  
  
  
      if (!name) {
  
        return res.status(400).json({
  
          success: false,
  
          message: "School name is required",
  
        });
  
      }
  
  
  
      const school = await prisma.school.create({
  
        data: {
  
          name,
  
          email,
  
        },
  
      });
  
  
  
      res.status(201).json({
  
        success: true,
  
        school,
  
      });
  
    } catch (error) {
  
      console.error("Create school error:", error);
  
      res.status(500).json({
  
        success: false,
  
        message: "Failed to create school",
  
      });
  
    }
  
  });
  app.get("/api/schools", async (_req, res) => {

    try {
  
      const schools = await prisma.school.findMany({

        include: {
          parents: true,
          learners: true,
      
        },
      
        orderBy: { createdAt: "desc" },
      
      });
  
  
  
      res.json({
  
        success: true,
  
        schools,
  
      });
  
    } catch (error) {
  
      console.error("Get schools error:", error);
  
      res.status(500).json({
  
        success: false,
  
        message: "Failed to fetch schools",
  
      });
  
    }
  
  });
  
  // Fees routes are mounted at /api/fees
  app.get("/api/fees-status/:idNumber", async (req, res) => {

    try {
  
      const { idNumber } = req.params;
  
  
  
      const parents = await prisma.parent.findMany({
  
        where: {
  
          idNumber,
  
        },
  
        include: {
  
          school: true,
  
          Letter: true,
  
        },
  
      });
  
  
  
      if (parents.length === 0) {
  
        return res.json({
  
          found: false,
  
          status: "GREEN",
  
          outstandingAmount: 0,
  
          school: "No record found",
  
          schools: [],
  
          parentName: "",
  
        });
  
      }
  
  
  
      let totalOutstandingCents = 0;
  
      const schoolNames = new Set<string>();
  
      let parentName = "";
  
  
  
      for (const parent of parents) {
  
        if (!parentName) {
  
          parentName = `${parent.firstName} ${parent.surname}`;
  
        }
  
  
  
        if (parent.school?.name) {
  
          schoolNames.add(parent.school.name);
  
        }
  
  
  
        const parentLetterTotal = parent.Letter.reduce((sum, letter) => {
  
          if (letter.status === "DRAFT") return sum;
  
          return sum + (letter.amountCents || 0);
  
        }, 0);
  
  
  
        totalOutstandingCents += parentLetterTotal;
  
      }
  
  
  
      const totalOutstanding = totalOutstandingCents / 100;
  
  
  
      let status = "GREEN";
  
  
  
      if (totalOutstanding > 10000) {
  
        status = "RED";
  
      } else if (totalOutstanding > 0) {
  
        status = "AMBER";
  
      }
  
  
  
      return res.json({
  
        found: true,
  
        status,
  
        outstandingAmount: totalOutstanding,
  
        school: Array.from(schoolNames).join(", "),
  
        schools: Array.from(schoolNames),
  
        parentName,
  
      });
  
    } catch (error) {
  
      console.error("Fee status check error:", error);
  
      return res.status(500).json({
  
        found: false,
  
        status: "GREEN",
  
        outstandingAmount: 0,
  
        school: "Server error",
  
        schools: [],
  
        parentName: "",
  
      });
  
    }
  
  });

app.listen(PORT, () => {

  console.log(`Server running on http://localhost:${PORT}`);

});
