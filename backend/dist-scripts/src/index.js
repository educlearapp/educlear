"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const multer_1 = __importDefault(require("multer"));
const schools_1 = __importDefault(require("./routes/schools"));
const parents_1 = __importDefault(require("./routes/parents"));
const learner_1 = __importDefault(require("./routes/learner"));
const statements_1 = __importDefault(require("./routes/statements"));
const familyAccounts_1 = __importDefault(require("./routes/familyAccounts"));
const payments_1 = __importDefault(require("./routes/payments"));
const invoices_1 = __importDefault(require("./routes/invoices"));
const billingDocuments_1 = __importDefault(require("./routes/billingDocuments"));
const billingPenalties_1 = __importDefault(require("./routes/billingPenalties"));
const legalBillingDocuments_1 = __importDefault(require("./routes/legalBillingDocuments"));
const communication_1 = __importDefault(require("./routes/communication"));
const communicationEngine_1 = __importDefault(require("./routes/communicationEngine"));
const billingSettings_1 = __importDefault(require("./routes/billingSettings"));
const deposits_1 = __importDefault(require("./routes/deposits"));
const banking_1 = __importDefault(require("./routes/banking"));
const accounting_1 = __importDefault(require("./routes/accounting"));
const users_1 = __importDefault(require("./routes/users"));
const auth_1 = __importDefault(require("./routes/auth"));
const teacherPerformance_1 = __importDefault(require("./routes/teacherPerformance"));
const payroll_1 = __importDefault(require("./routes/payroll"));
const fees_1 = __importDefault(require("./routes/fees"));
const registrations_1 = __importDefault(require("./routes/registrations"));
const emails_1 = __importDefault(require("./routes/emails"));
const schoolEmailSettings_1 = __importDefault(require("./routes/schoolEmailSettings"));
const parentPortal_1 = __importDefault(require("./routes/parentPortal"));
const classrooms_1 = __importDefault(require("./routes/classrooms"));
const teacherInbox_1 = __importDefault(require("./routes/teacherInbox"));
const teacherApp_1 = __importDefault(require("./routes/teacherApp"));
const migration_1 = __importStar(require("./routes/migration"));
const migrationKidESysReadiness_1 = require("./routes/migrationKidESysReadiness");
const daSilvaMigration_1 = __importDefault(require("./routes/daSilvaMigration"));
const kideesysMigration_1 = __importStar(require("./routes/kideesysMigration"));
const subscriptions_1 = __importDefault(require("./routes/subscriptions"));
const payfast_1 = __importDefault(require("./routes/payfast"));
const credits_1 = __importDefault(require("./routes/credits"));
const requireMigrationAccess_1 = require("./middleware/requireMigrationAccess");
const requireSuperAdmin_1 = require("./middleware/requireSuperAdmin");
const prisma_1 = require("./prisma");
const devTestSchoolEmail_1 = require("./dev/devTestSchoolEmail");
const ensureSuperAdmin_1 = require("./services/ensureSuperAdmin");
const productionStartup_1 = require("./services/productionStartup");
const otpStore = new Map();
const storage = multer_1.default.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path_1.default.join(process.cwd(), "uploads/school-logos"));
    },
    filename: function (req, file, cb) {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
        cb(null, "school-logo-" + unique + path_1.default.extname(file.originalname));
    },
});
const upload = (0, multer_1.default)({ storage });
function authMiddleware(req, res, next) {
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
        req.user = decoded;
        next();
    }
    catch {
        return res.status(401).json({ error: "Invalid token" });
    }
}
function normalizePhone(phone) {
    // Keep + and digits only
    const cleaned = String(phone || "").trim().replace(/[^\d+]/g, "");
    return cleaned;
}
function generateOtp() {
    return Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit
}
const app = (0, express_1.default)();
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
app.use(express_1.default.json({ limit: "12mb" }));
app.use("/uploads", express_1.default.static(path_1.default.join(process.cwd(), "uploads")));
const corsOptions = {
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
        }
        else {
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
app.use((0, cors_1.default)(corsOptions));
app.options(/.*/, (0, cors_1.default)(corsOptions));
// ===== AUTH =====
app.use("/auth", auth_1.default);
app.use("/api/auth", auth_1.default);
app.use("/learner", learner_1.default);
app.use("/api/schools", schools_1.default);
app.use("/api/emails", emails_1.default);
app.use("/api/school-email-settings", schoolEmailSettings_1.default);
app.use("/api/users", users_1.default);
app.post("/api/upload-logo", upload.single("logo"), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false });
    }
    const relativeUrl = `/uploads/school-logos/${req.file.filename}`;
    const base = process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
        `${req.protocol}://${req.get("host")}`;
    const absoluteUrl = `${base}${relativeUrl}`;
    res.json({
        success: true,
        url: relativeUrl,
        absoluteUrl,
    });
});
app.use("/api/parents", parents_1.default);
app.use("/api/invoices", invoices_1.default);
app.use("/api/statements", statements_1.default);
app.use("/api/family-accounts", familyAccounts_1.default);
app.use("/api/payments", payments_1.default);
app.use("/api/billing-documents", billingDocuments_1.default);
app.use("/api/legal-billing-documents", legalBillingDocuments_1.default);
app.use("/api/communication", communication_1.default);
app.use("/api/communication-engine", communicationEngine_1.default);
app.use("/api/billing-settings", billingSettings_1.default);
app.use("/api/deposits", deposits_1.default);
app.use("/api/banking", banking_1.default);
app.use("/api/accounting", accounting_1.default);
app.use("/api/billing/late-penalties", billingPenalties_1.default);
app.use("/api/teacher-performance", teacherPerformance_1.default);
app.use("/api/payroll", payroll_1.default);
app.use("/api/fees", fees_1.default);
app.use("/api/learners", learner_1.default);
app.use("/api/registrations", registrations_1.default);
app.use("/api/parent-portal", parentPortal_1.default);
app.use("/api/classrooms", classrooms_1.default);
app.use("/api/teacher-inbox", teacherInbox_1.default);
app.use("/api/teacher-app", teacherApp_1.default);
app.post(`/api/migration${migrationKidESysReadiness_1.KIDESYS_ADAPTER_READINESS_PATH}`, requireSuperAdmin_1.requireSuperAdmin, migrationKidESysReadiness_1.handleKidESysMigrationReadiness);
app.use("/api/migration", requireMigrationAccess_1.requireMigrationAccess, migration_1.migrationUploadRouter, migration_1.migrationUploadErrorHandler);
app.use("/api/super-admin/migration", requireMigrationAccess_1.requireMigrationAccess, migration_1.default, migration_1.migrationErrorHandler);
app.use("/api/super-admin/migration/da-silva", requireMigrationAccess_1.requireMigrationAccess, daSilvaMigration_1.default);
app.use("/api/super-admin/migration/kideesys", requireMigrationAccess_1.requireMigrationAccess, kideesysMigration_1.default, kideesysMigration_1.kideesysMigrationErrorHandler);
app.use("/api/subscriptions", subscriptions_1.default);
app.use("/api/credits", credits_1.default);
app.use("/api/payfast", payfast_1.default);
app.get("/api/parents", async (_req, res) => {
    try {
        const schoolId = typeof _req.query?.schoolId === "string"
            ? String(_req.query.schoolId)
            : "";
        const parents = await prisma_1.prisma.parent.findMany({
            where: schoolId ? { schoolId } : undefined,
            orderBy: { createdAt: "desc" },
        });
        res.json({
            success: true,
            parents,
        });
    }
    catch (error) {
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
        let parent = await prisma_1.prisma.parent.findFirst({
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
            parent = await prisma_1.prisma.parent.findFirst({
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
        const school = await prisma_1.prisma.school.findUnique({
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
                ? parent.links.map((link) => ({
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
    }
    catch (error) {
        console.error("Parent portal lookup error:", error);
        return res.status(500).json({
            success: false,
            error: "Failed to lookup parent portal account",
        });
    }
});
async function startServer() {
    await (0, productionStartup_1.runProductionStartup)();
    await (0, ensureSuperAdmin_1.ensureSuperAdminOnStartup)();
    await (0, devTestSchoolEmail_1.bootstrapDevTestSchoolEmail)();
    const server = app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
    // Allow large Kid-e-Sys multipart uploads (21 class lists + 6 export groups).
    server.timeout = 15 * 60 * 1000;
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.on("error", (err) => {
        console.error("HTTP server error:", err.message);
        if (err.code === "EADDRINUSE") {
            console.error(`Port ${PORT} is already in use. Stop the other process using http://localhost:${PORT} before starting this server (a stale backend causes missing routes / 404s).`);
            process.exit(1);
        }
    });
}
void startServer().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
});
