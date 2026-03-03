import "dotenv/config";

import bcrypt from "bcryptjs";

import { PrismaClient } from "@prisma/client";



const prisma = new PrismaClient();



async function run() {

  const email = process.env.SEED_EMAIL;

  const plainPassword = process.env.SEED_PASSWORD;

  const schoolId = process.env.SCHOOL_ID;



  if (!email) throw new Error("SEED_EMAIL missing in backend/.env");

  if (!plainPassword) throw new Error("SEED_PASSWORD missing in backend/.env");

  if (!schoolId) throw new Error("SCHOOL_ID missing in backend/.env");



  const hashed = await bcrypt.hash(plainPassword, 10);



  // If user already exists, stop

  const existing = await prisma.user.findUnique({

    where: {
  
      schoolId_email: {
  
        schoolId,
  
        email,
  
      },
  
    },
  
  });

  if (existing) {

    console.log("User already exists:", email);

    return;

  }



  await prisma.user.create({

    data: {

      email,

      passwordHash: hashed,   // IMPORTANT: your schema uses passwordHash (not password)

      schoolId,               // IMPORTANT: schoolId is required in your schema

      role: "SCHOOL_ADMIN",   // keep if your schema has role

    },

  });



  console.log("✅ Seeded user:", email);

}



run()

  .catch((e) => {

    console.error(e);

    process.exit(1);

  })

  .finally(async () => {

    await prisma.$disconnect();

  });
