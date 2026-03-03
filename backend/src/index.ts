import express from "express";
import cors from "cors";
import schoolsRoutes from "./routes/schools";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import authRoutes from "./routes/auth";
type OtpRecord = {

    code: string;
  
    expiresAt: number;
  
  };
  

  
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
  
  



app.use(express.json());
// ===== OTP AUTH (DEV MODE) =====
app.use ("/auth", authRoutes);
app.use("/api/schools", schoolsRoutes);


import { timeStamp } from "console";

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

app.listen(PORT, () => {

  console.log(`Server running on http://localhost:${PORT}`);

});
