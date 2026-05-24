import "dotenv/config";

import { prisma } from "./prisma";
import { ensureEduClearPackages } from "./services/ensureEduClearPackages";

async function run() {
  const codes = await ensureEduClearPackages();
  console.log(`EduClear packages ensured: ${codes.join(", ")}`);
}

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
