import { PrismaClient } from "@prisma/client";

// Central Prisma singleton to avoid circular imports (routes <-> index).
export const prisma = new PrismaClient();

