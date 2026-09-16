import "dotenv/config";
import express from "express";

import cors from "cors";

import fs from "fs";
import path from "path";
import multer from "multer";
import {
  isCorsOriginAllowed,
  resolveCorsAllowedOrigins,
} from "./utils/outboundSafety"; 
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
import invoiceRunsRoutes from "./routes/invoiceRuns";
import billingDocumentsRoutes from "./routes/billingDocuments";
import billingPenaltiesRoutes from "./routes/billingPenalties";
import daSilvaLatePenaltiesRoutes from "./routes/daSilvaLatePenalties";
import billingReportsRoutes from "./routes/billingReports";
import outstandingAccountsRoutes from "./routes/outstandingAccounts";
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
import educlockRoutes from "./routes/educlock";
import geofencesRoutes from "./routes/geofences";
import feesRoutes from "./routes/fees";
import registrationsRoutes from "./routes/registrations";
import listsRegistersRoutes from "./routes/listsRegisters";
import emailRoutes from "./routes/emails";
import schoolEmailSettingsRoutes from "./routes/schoolEmailSettings";
import schoolSubjectsRoutes from "./routes/schoolSubjects";
import schoolSmsSettingsRoutes from "./routes/schoolSmsSettings";
import parentPortalRoutes from "./routes/parentPortal";
import classroomsRoutes from "./routes/classrooms";
import groupsRoutes from "./routes/groups";
import classesRoutes from "./routes/classes";
import attendanceRoutes from "./routes/attendance";
import teacherInboxRoutes from "./routes/teacherInbox";
import teacherAppRoutes, { teacherAppUploadErrorHandler } from "./routes/teacherApp";
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
import mbbDirectImportRoutes from "./routes/mbbDirectImport";
import subscriptionsRoutes from "./routes/subscriptions";
import payfastRoutes from "./routes/payfast";
import creditsRoutes from "./routes/credits";
import { requireMigrationAccess } from "./middleware/requireMigrationAccess";
import { requireSuperAdmin } from "./middleware/requireSuperAdmin";
import { requireSchoolModule } from "./middleware/requireSchoolModule";
import { lookupParentPortalBySchool } from "./services/parentPortalLookup";
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
  const persistentSchoolLogoDir = path.join(process.cwd(), "data", "school-logos");
  const legacySchoolLogoDir = path.join(process.cwd(), "uploads", "school-logos");
  const storage = multer.diskStorage({



    destination: function (
  
  
  
      req: express.Request,
  
  
  
      file: Express.Multer.File,
  
  
  
      cb: (error: Error | null, destination: string) => void
  
  
  
    ) {
      fs.mkdirSync(persistentSchoolLogoDir, { recursive: true });
      cb(null, persistentSchoolLogoDir);
  
  
  
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
app.use("/uploads/school-logos", express.static(persistentSchoolLogoDir));
app.use("/uploads/school-logos", express.static(legacySchoolLogoDir));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = resolveCorsAllowedOrigins();
    if (isCorsOriginAllowed(origin, allowedOrigins)) {
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
    "Idempotency-Key",
  ],
  credentials: true,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
  


// ===== AUTH =====
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/learner", requireSchoolModule("CORE"), learnerRoutes);
app.use("/api/schools", schoolsRoutes);
app.use("/api/emails", requireSchoolModule("CORE"), emailRoutes);
app.use("/api/school-email-settings", requireSchoolModule("CORE"), schoolEmailSettingsRoutes);
app.use("/api/school-sms-settings", requireSchoolModule("CORE"), schoolSmsSettingsRoutes);
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
app.use("/api/parents", requireSchoolModule("CORE"), parentsRoutes);
app.use("/api/invoices", requireSchoolModule("CORE"), invoicesRoutes);
app.use("/api/invoice-runs", requireSchoolModule("CORE"), invoiceRunsRoutes);
app.use("/api/statements", requireSchoolModule("CORE"), statementsRoutes);
app.use("/api/family-accounts", requireSchoolModule("CORE"), familyAccountsRoutes);
app.use("/api/payments", requireSchoolModule("CORE"), paymentsRoutes);
app.use("/api/payment-allocations", requireSchoolModule("CORE"), paymentAllocationsRoutes);
app.use("/api/billing-transactions", requireSchoolModule("CORE"), billingTransactionsRoutes);
app.use("/api/billing-documents", requireSchoolModule("CORE"), billingDocumentsRoutes);
app.use("/api/legal-billing-documents", requireSchoolModule("CORE"), legalBillingDocumentsRoutes);
app.use("/api/communication", requireSchoolModule("CORE"), communicationRoutes);
app.use("/api/communication-engine", requireSchoolModule("CORE"), communicationEngineRoutes);
app.use("/api/billing-settings", requireSchoolModule("CORE"), billingSettingsRoutes);
app.use("/api/deposits", requireSchoolModule("CORE"), depositsRoutes);
app.use("/api/banking", bankingRoutes);
// ACCOUNTING entitlement — bookkeeping/GL/suppliers only. Billing stays CORE (gated above).
app.use("/api/accounting", requireSchoolModule("ACCOUNTING"), accountingRoutes);
app.use("/api/billing/late-penalties", requireSchoolModule("CORE"), billingPenaltiesRoutes);
app.use("/api/billing/da-silva-late-penalties", requireSchoolModule("CORE"), daSilvaLatePenaltiesRoutes);
app.use("/api/billing/reports", requireSchoolModule("CORE"), billingReportsRoutes);
app.use("/api/outstanding-accounts", requireSchoolModule("CORE"), outstandingAccountsRoutes);
app.use("/api/teacher-performance", requireSchoolModule("CORE"), teacherPerformanceRoutes);
app.use("/api/payroll", payrollRoutes);
app.use("/api/educlock", requireSchoolModule("CORE"), educlockRoutes);
app.use("/api/geofences", requireSchoolModule("CORE"), geofencesRoutes);
app.use("/api/fees", requireSchoolModule("CORE"), feesRoutes);
app.use("/api/learners", requireSchoolModule("CORE"), learnerRoutes);
app.use("/api/registrations", requireSchoolModule("CORE"), registrationsRoutes);
app.use("/api/lists-registers", requireSchoolModule("CORE"), listsRegistersRoutes);
app.use("/api/parent-portal", parentPortalRoutes);
app.use("/api/classrooms", requireSchoolModule("CORE"), classroomsRoutes);
app.use("/api/groups", requireSchoolModule("CORE"), groupsRoutes);
app.use("/api/classes", requireSchoolModule("CORE"), classesRoutes);
app.use("/api/attendance", requireSchoolModule("CORE"), attendanceRoutes);
app.use("/api/school-subjects", requireSchoolModule("CORE"), schoolSubjectsRoutes);
app.use("/api/teacher-inbox", requireSchoolModule("CORE"), teacherInboxRoutes);
app.use("/api/teacher-app", requireSchoolModule("CORE"), teacherAppRoutes, teacherAppUploadErrorHandler);
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
app.use(
  "/api/super-admin/mbb-direct-import",
  requireMigrationAccess,
  mbbDirectImportRoutes
);
app.use("/api/subscriptions", subscriptionsRoutes);
app.use("/api/credits", creditsRoutes);
app.use("/api/payfast", payfastRoutes);

app.get("/api/parent-portal/lookup", async (req, res) => {
  try {
    const result = await lookupParentPortalBySchool({
      schoolId: String(req.query.schoolId || "").trim(),
      cellNo: String(req.query.cellNo || "").trim(),
      idNumber: String(req.query.idNumber || "").trim(),
    });
    if (!result.ok) {
      return res.status(result.status).json({
        success: false,
        error: result.error,
        ...(result.code ? { code: result.code } : {}),
        ...(result.module ? { module: result.module } : {}),
      });
    }
    return res.json({
      success: true,
      parent: result.parent,
      learners: result.learners,
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
