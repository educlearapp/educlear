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
import rbacRoutes from "./routes/rbac";
import payrollRoutes from "./routes/payroll";
type OtpRecord = {

    code: string;
  
    expiresAt: number;
  
  };
  

  const prisma = new PrismaClient();
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
app.use("/api", parentsRoutes);
app.use("/api/rbac", rbacRoutes);
app.use("/teacher-performance", teacherPerformanceRoutes);
app.use("/api/payroll", payrollRoutes);

app.get("/api/fees", async (req, res) => {
  try {
    const schoolId = String(req.query.schoolId || "").trim();
    const q = String(req.query.q || "").trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(5, Number(req.query.pageSize || 10)));

    if (!schoolId) {
      return res.status(400).json({ success: false, message: "schoolId is required" });
    }

    const where: any = {
      schoolId,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { grade: { contains: q, mode: "insensitive" } },
              { notes: { contains: q, mode: "insensitive" } },
              { category: { equals: q as any } },
              { frequency: { equals: q as any } },
            ],
          }
        : {}),
    };

    const [total, fees] = await Promise.all([
      prisma.feeStructure.count({ where }),
      prisma.feeStructure.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return res.json({
      success: true,
      items: fees.map((f) => ({
        id: f.id,
        schoolId: f.schoolId,
        name: f.name,
        amount: f.amount,
        frequency: f.frequency,
        category: (f as any).category ?? null,
        notes: (f as any).notes ?? null,
        grade: f.grade,
        createdAt: f.createdAt,
        usedBillingPlansCount: 0,
      })),
      total,
      page,
      pageSize,
    });
  } catch (error) {
    console.error("List fees error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch fees" });
  }
});

app.get("/api/fees/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const schoolId = String(req.query.schoolId || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id is required" });
    if (!schoolId) {
      return res.status(400).json({ success: false, message: "schoolId is required" });
    }

    const fee = await prisma.feeStructure.findFirst({ where: { id, schoolId } });
    if (!fee) return res.status(404).json({ success: false, message: "Fee not found" });

    return res.json({
      success: true,
      fee: {
        id: fee.id,
        schoolId: fee.schoolId,
        name: fee.name,
        amount: fee.amount,
        frequency: fee.frequency,
        category: (fee as any).category ?? null,
        notes: (fee as any).notes ?? null,
        grade: fee.grade,
        createdAt: fee.createdAt,
        usedBillingPlansCount: 0,
      },
    });
  } catch (error) {
    console.error("Get fee error:", error);
    return res.status(500).json({ success: false, message: "Failed to fetch fee" });
  }
});

app.put("/api/fees/:id", async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    const { schoolId, name, amount, frequency, category, notes, grade } = req.body || {};
    const schoolIdStr = String(schoolId || "").trim();
    if (!id) return res.status(400).json({ success: false, message: "id is required" });
    if (!schoolIdStr) {
      return res.status(400).json({ success: false, message: "schoolId is required" });
    }
    if (!String(name || "").trim()) {
      return res.status(400).json({ success: false, message: "name is required" });
    }
    if (!String(frequency || "").trim()) {
      return res.status(400).json({ success: false, message: "frequency is required" });
    }
    if (!String(category || "").trim()) {
      return res.status(400).json({ success: false, message: "category is required" });
    }

    const existing = await prisma.feeStructure.findFirst({ where: { id, schoolId: schoolIdStr } });
    if (!existing) return res.status(404).json({ success: false, message: "Fee not found" });

    const updated = await prisma.feeStructure.update({
      where: { id },
      data: {
        name: String(name).trim(),
        amount: Number(amount),
        frequency,
        category,
        notes: notes ? String(notes).trim() : null,
        grade: grade ? String(grade).trim() : null,
      },
    });

    return res.json({
      success: true,
      fee: {
        id: updated.id,
        schoolId: updated.schoolId,
        name: updated.name,
        amount: updated.amount,
        frequency: updated.frequency,
        category: (updated as any).category ?? null,
        notes: (updated as any).notes ?? null,
        grade: updated.grade,
        createdAt: updated.createdAt,
        usedBillingPlansCount: 0,
      },
    });
  } catch (error) {
    console.error("Update fee error:", error);
    return res.status(500).json({ success: false, message: "Failed to update fee" });
  }
});


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
      
      const school = await prisma.school.findFirst();



      if (!school) {
      
        return res.status(400).json({
      
          success: false,
      
          message: "No school found in database",
      
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
  
          schoolId: school.id,
  
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
  
      const parents = await prisma.parent.findMany({
  
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
  
      const { schoolId, firstName, lastName, grade, className, admissionNo } = req.body;
  
  
  
      if (!schoolId || !firstName || !lastName || !grade) {
  
        return res.status(400).json({
  
          success: false,
  
          message: "schoolId, firstName, lastName and grade are required",
  
        });
  
      }
  
      console.log("schoolId being used:", schoolId);

      console.log("request body:", req.body);
  
      const learner = await prisma.learner.create({
  
        data: {
  
          schoolId,
  
          firstName,
  
          lastName,
  
          grade,
  
          className: className || null,
  
          admissionNo: admissionNo || null,
  
        },
  
      });
  
  
  
      return res.status(201).json({
  
        success: true,
  
        learner,
  
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
  
      const learners = await prisma.learner.findMany({
  
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
  
  app.post("/api/learners", async (req, res) => {

    try {
  
      const {
  
        schoolId,
  
        firstName,
  
        lastName,
  
        grade,
  
        className,
  
        admissionNo,
  
        tuitionFee,
  
        transportFee,
  
        otherFee,
  
      } = req.body;
  
  
  
      const learner = await prisma.learner.create({
  
        data: {
  
          firstName,
  
          lastName,
  
          grade,
  
          className: className || null,
  
          admissionNo: admissionNo || null,
  
  
  
          tuitionFee: tuitionFee || 0,
  
          transportFee: transportFee || 0,
  
          otherFee: otherFee || 0,
  
          totalFee:
  
            (tuitionFee || 0) +
  
            (transportFee || 0) +
  
            (otherFee || 0),
  
  
  
          school: {
  
            connect: { id: schoolId },
  
          },
  
        },
  
      });
  
  
  
      res.json({ success: true, learner });
  
    } catch (error) {
  
      console.error("Create learner error:", error);
  
      res.status(500).json({ message: "Failed to create learner" });
  
    }
  
  });
  
  app.post("/api/fees", async (req, res) => {

    try {
  
      const {
  
        schoolId,
  
        name,
  
        amount,
  
        frequency,
  
        category,
  
        notes,
  
        grade,
  
      } = req.body;
  
      const schoolIdStr = String(schoolId || "").trim();
      if (!schoolIdStr) return res.status(400).json({ message: "schoolId is required" });
      if (!String(name || "").trim()) return res.status(400).json({ message: "name is required" });
      if (!String(frequency || "").trim()) return res.status(400).json({ message: "frequency is required" });
      if (!String(category || "").trim()) return res.status(400).json({ message: "category is required" });
      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum)) return res.status(400).json({ message: "amount must be a number" });
  
      const fee = await prisma.feeStructure.create({
  
        data: {
  
          schoolId: schoolIdStr,
  
          name: String(name).trim(),
  
          amount: amountNum,
  
          frequency,
  
          category,
  
          notes: notes ? String(notes).trim() : null,
  
          grade: grade || null,
  
        },
  
      });
  
  
  
      res.json({ success: true, fee });
  
  
  
    } catch (error) {
  
      console.error("Create fee error:", error);
  
      res.status(500).json({ message: "Failed to create fee" });
  
    }
  
  });

  app.get("/api/learners", async (_req, res) => {

    try {
  
      const learners = await prisma.learner.findMany({
  
        orderBy: { createdAt: "desc" },
  
      });
  
  
  
      res.json({
  
        success: true,
  
        learners,
  
      });
  
    } catch (error) {
  
      console.error("Get learners error:", error);
  
      res.status(500).json({
  
        success: false,
  
        message: "Failed to fetch learners",
  
      });
  
    }
  
  });

  app.get("/api/parents", async (_req, res) => {
  
    try {
  
      const parents = await prisma.parent.findMany({
  
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
