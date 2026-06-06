import "dotenv/config";
import express from "express";

import cors from "cors";

import fs from "fs";
import path from "path";
import multer from "multer"; 
import schoolsRoutes from "./routes/schools";
import parentsRoutes from "./routes/parents";
import jwt from "jsonwebtoken";
import learnerRoutes from "./routes/learner";
import statementsRoutes from "./routes/statements";
import familyAccountsRoutes from "./routes/familyAccounts";
import paymentsRoutes from "./routes/payments";
import paymentAllocationsRoutes from "./routes/paymentAllocations";
import billingTransactionsRoutes from "./routes/billingTransactions";
import invoicesRoutes from "./routes/invoices";
import billingDocumentsRoutes from "./routes/billingDocuments";
import billingPenaltiesRoutes from "./routes/billingPenalties";
import billingReportsRoutes from "./routes/billingReports";
import legalBillingDocumentsRoutes from "./routes/legalBillingDocuments";
import communicationRoutes from "./routes/communication";
import communicationEngineRoutes from "./routes/communicationEngine";
import billingSettingsRoutes from "./routes/billingSettings";
import depositsRoutes from "./routes/deposits";
import bankingRoutes from "./routes/banking";
import accountingRoutes from "./routes/accounting";
import usersRoutes from "./routes/users";
import bcrypt from "bcryptjs";

import authRoutes from "./routes/auth";
import teacherPerformanceRoutes from "./routes/teacherPerformance";

import payrollRoutes from "./routes/payroll";
import feesRoutes from "./routes/fees";
import registrationsRoutes from "./routes/registrations";
import emailRoutes from "./routes/emails";
import schoolEmailSettingsRoutes from "./routes/schoolEmailSettings";
import schoolSmsSettingsRoutes from "./routes/schoolSmsSettings";
import parentPortalRoutes from "./routes/parentPortal";
import classroomsRoutes from "./routes/classrooms";
import classesRoutes from "./routes/classes";
import attendanceRoutes from "./routes/attendance";
import teacherInboxRoutes from "./routes/teacherInbox";
import teacherAppRoutes from "./routes/teacherApp";
import migrationRoutes, {
  migrationErrorHandler,
  migrationUploadErrorHandler,
  migrationUploadRouter,
} from "./routes/migration";
import {
  handleKidESysMigrationReadiness,
  KIDESYS_ADAPTER_READINESS_PATH,
} from "./routes/migrationKidESysReadiness";
import daSilvaMigrationRoutes from "./routes/daSilvaMigration";
import kideesysMigrationRoutes, {
  kideesysMigrationErrorHandler,
} from "./routes/kideesysMigration";
import migrationBillingPlansRoutes from "./routes/migrationBillingPlans";
import migrationTopupPaymentsRoutes from "./routes/migrationTopupPayments";
import migrationAgeAnalysisBaselineRoutes from "./routes/migrationAgeAnalysisBaseline";
import migrationLearnerRepairRoutes from "./routes/migrationLearnerRepair";
import migrationLearnersRoutes from "./routes/migrationLearners";
import subscriptionsRoutes from "./routes/subscriptions";
import payfastRoutes from "./routes/payfast";
import creditsRoutes from "./routes/credits";
import { requireMigrationAccess } from "./middleware/requireMigrationAccess";
import { requireSuperAdmin } from "./middleware/requireSuperAdmin";
import superAdminSchoolsRoutes from "./routes/superAdminSchools";
import { prisma } from "./prisma";
import { bootstrapDevTestSchoolEmail } from "./dev/devTestSchoolEmail";
import { ensureSuperAdminOnStartup } from "./services/ensureSuperAdmin";
import { runProductionStartup } from "./services/productionStartup";

type OtpRecord = {

    code: string;
  
    expiresAt: number;
  
  };
  

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
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      "http://localhost:5173",
      "http://localhost:5174",
      "http://localhost:5175",
      "https://educlear-frontend.onrender.com",
      "https://educlear.co.za",
      "https://www.educlear.co.za",
    ];

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.log("Blocked by CORS:", origin);
      callback(null, false);
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control",
    "Pragma",
    "Expires",
  ],
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
  


// ===== AUTH =====
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/learner", learnerRoutes);
app.use("/api/schools", schoolsRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/school-email-settings", schoolEmailSettingsRoutes);
app.use("/api/school-sms-settings", schoolSmsSettingsRoutes);
app.use("/api/users", usersRoutes);
app.post("/api/upload-logo", upload.single("logo"), (req, res) => {



  if (!req.file) {



    return res.status(400).json({ success: false });



  }



  const relativeUrl = `/uploads/school-logos/${req.file.filename}`;
  const base =
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `${req.protocol}://${req.get("host")}`;
  const absoluteUrl = `${base}${relativeUrl}`;

  res.json({
    success: true,
    url: relativeUrl,
    absoluteUrl,



  });



});
app.use("/api/parents", parentsRoutes);
app.use("/api/invoices", invoicesRoutes);
app.use("/api/statements", statementsRoutes);
app.use("/api/family-accounts", familyAccountsRoutes);
app.use("/api/payments", paymentsRoutes);
app.use("/api/payment-allocations", paymentAllocationsRoutes);
app.use("/api/billing-transactions", billingTransactionsRoutes);
app.use("/api/billing-documents", billingDocumentsRoutes);
app.use("/api/legal-billing-documents", legalBillingDocumentsRoutes);
app.use("/api/communication", communicationRoutes);
app.use("/api/communication-engine", communicationEngineRoutes);
app.use("/api/billing-settings", billingSettingsRoutes);
app.use("/api/deposits", depositsRoutes);
app.use("/api/banking", bankingRoutes);
app.use("/api/accounting", accountingRoutes);
app.use("/api/billing/late-penalties", billingPenaltiesRoutes);
app.use("/api/billing/reports", billingReportsRoutes);
app.use("/api/teacher-performance", teacherPerformanceRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/fees", feesRoutes);
app.use("/api/learners", learnerRoutes);
app.use("/api/registrations", registrationsRoutes);
app.use("/api/parent-portal", parentPortalRoutes);
app.use("/api/classrooms", classroomsRoutes);
app.use("/api/classes", classesRoutes);
app.use("/api/attendance", attendanceRoutes);
app.use("/api/teacher-inbox", teacherInboxRoutes);
app.use("/api/teacher-app", teacherAppRoutes);
app.post(
  `/api/migration${KIDESYS_ADAPTER_READINESS_PATH}`,
  requireSuperAdmin,
  handleKidESysMigrationReadiness
);
app.use(
  "/api/migration",
  requireMigrationAccess,
  migrationUploadRouter,
  migrationUploadErrorHandler
);
app.use("/api/super-admin/schools", requireSuperAdmin, superAdminSchoolsRoutes);
app.use("/api/super-admin/migration", requireMigrationAccess, migrationRoutes, migrationErrorHandler);
app.use(
  "/api/super-admin/migration/da-silva",
  requireMigrationAccess,
  daSilvaMigrationRoutes
);
app.use(
  "/api/super-admin/migration/kideesys",
  requireMigrationAccess,
  kideesysMigrationRoutes,
  kideesysMigrationErrorHandler
);
app.use(
  "/api/migration/billing-plans",
  requireMigrationAccess,
  migrationBillingPlansRoutes
);
app.use(
  "/api/migration/topup-payments",
  requireMigrationAccess,
  migrationTopupPaymentsRoutes
);
app.use(
  "/api/migration/age-analysis-baseline",
  requireMigrationAccess,
  migrationAgeAnalysisBaselineRoutes
);
app.use(
  "/api/super-admin/migration/learner-repair",
  requireMigrationAccess,
  migrationLearnerRepairRoutes
);
app.use(
  "/api/migration/learners",
  requireMigrationAccess,
  migrationLearnersRoutes
);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/credits", creditsRoutes);
app.use("/api/payfast", payfastRoutes);
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
async function startServer() {
  await runProductionStartup();
  await ensureSuperAdminOnStartup();
  await bootstrapDevTestSchoolEmail();

  const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // Allow large Kid-e-Sys multipart uploads (21 class lists + 6 export groups).
  server.timeout = 15 * 60 * 1000;
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error("HTTP server error:", err.message);
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${PORT} is already in use. Stop the other process using http://localhost:${PORT} before starting this server (a stale backend causes missing routes / 404s).`
      );
      process.exit(1);
    }
  });
}

void startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exit(1);
});
