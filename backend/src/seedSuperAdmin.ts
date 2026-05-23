import "dotenv/config";

import { prisma } from "./prisma";
import { ensureSuperAdminUser } from "./services/ensureSuperAdmin";

async function run() {
  const email = await ensureSuperAdminUser();
  console.log(`Super admin ensured: ${email}`);
}

run()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
