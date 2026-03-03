import { Router } from "express";

import bcrypt from "bcryptjs";

import jwt from "jsonwebtoken";



const router = Router();



// ✅ Temporary admin user (we can move to DB later)

const ADMIN_EMAIL = "admin@educlear.co.za";

const ADMIN_PASSWORD_HASH = bcrypt.hashSync("Admin@1234", 10);



// ✅ Secret (later move to .env)

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_change_me";



router.post("/login", async (req, res) => {

  const { email, password } = req.body || {};



  if (!email || !password) {

    return res.status(400).json({ error: "Email and password required" });

  }



  if (email !== ADMIN_EMAIL) {

    return res.status(401).json({ error: "Invalid credentials" });

  }



  const ok = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

  if (!ok) {

    return res.status(401).json({ error: "Invalid credentials" });

  }



  const token = jwt.sign({ email, role: "admin" }, JWT_SECRET, {

    expiresIn: "7d",

  });



  return res.json({ token });

});



export default router;