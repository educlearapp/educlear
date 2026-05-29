"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const prisma_1 = require("./prisma");
const ensureSuperAdmin_1 = require("./services/ensureSuperAdmin");
async function run() {
    const email = await (0, ensureSuperAdmin_1.ensureSuperAdminUser)();
    console.log(`Super admin ensured: ${email}`);
}
run()
    .catch((e) => {
    console.error(e);
    process.exit(1);
})
    .finally(async () => {
    await prisma_1.prisma.$disconnect();
});
