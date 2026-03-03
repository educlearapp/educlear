import { Router } from "express";

import jwt from "jsonwebtoken";



const router = Router();



router.get("/", (req, res) => {

  const authHeader = req.headers.authorization;



  if (!authHeader) {

    return res.status(401).json({ message: "No token provided" });

  }



  const token = authHeader.split(" ")[1];



  try {

    jwt.verify(token, process.env.JWT_SECRET || "secret");

  } catch (err) {

    return res.status(403).json({ message: "Invalid token" });

  }



  res.json([

    { id: 1, name: "Da Silva Academy" },

    { id: 2, name: "Test School" }

  ]);

});



export default router;