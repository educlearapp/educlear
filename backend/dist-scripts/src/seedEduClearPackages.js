"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const prisma_1 = require("./prisma");
const ensureEduClearPackages_1 = require("./services/ensureEduClearPackages");
async function run() {
    const codes = await (0, ensureEduClearPackages_1.ensureEduClearPackages)();
    console.log(`EduClear packages ensured: ${codes.join(", ")}`);
}
run()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma_1.prisma.$disconnect();
});
