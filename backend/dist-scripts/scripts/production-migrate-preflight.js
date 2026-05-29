"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Production migration preflight — resolve failed rows, then migrate deploy.
 *
 * Usage (on Render / production host):
 *   cd backend && npx tsx scripts/production-migrate-preflight.ts
 *
 * Flow:
 *   1. List failed rows in _prisma_migrations
 *   2. prisma migrate resolve --rolled-back for each
 *   3. npx prisma migrate deploy
 *   4. On failure: print migration name + SQL object and exit 1
 */
require("dotenv/config");
const child_process_1 = require("child_process");
const path_1 = __importDefault(require("path"));
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const backendRoot = path_1.default.resolve(__dirname, "..");
function runCommand(command, options = {}) {
    try {
        const stdout = (0, child_process_1.execSync)(command, {
            cwd: backendRoot,
            encoding: "utf-8",
            env: process.env,
            stdio: ["pipe", "pipe", "pipe"],
        });
        return { stdout: stdout.trim(), stderr: "" };
    }
    catch (error) {
        const err = error;
        const result = {
            stdout: String(err.stdout || "").trim(),
            stderr: String(err.stderr || err.message || "").trim(),
        };
        if (options.throwOnError) {
            throw new Error(`${result.stderr}\n${result.stdout}`.trim());
        }
        return result;
    }
}
function logsIndicateFailedMigration(logs) {
    if (logs == null || logs.trim() === "") {
        return true;
    }
    const lower = logs.toLowerCase();
    return (lower.includes("error") ||
        lower.includes("failed") ||
        lower.includes("exception") ||
        lower.includes("migrate failed") ||
        lower.includes("p3018"));
}
function isUnresolvedFailedMigration(row) {
    if (row.finished_at != null)
        return false;
    if (row.rolled_back_at != null)
        return false;
    return logsIndicateFailedMigration(row.logs);
}
async function findFailedMigrations() {
    const rows = await prisma.$queryRaw `
    SELECT migration_name, finished_at, rolled_back_at, logs
    FROM "_prisma_migrations"
    WHERE finished_at IS NULL
      AND rolled_back_at IS NULL
    ORDER BY migration_name
  `;
    return rows.filter(isUnresolvedFailedMigration);
}
function resolveRolledBack(migrationName) {
    console.log(`[preflight] resolve --rolled-back ${migrationName}`);
    const { stdout, stderr } = runCommand(`npx prisma migrate resolve --rolled-back ${migrationName}`);
    if (stdout)
        console.log(stdout);
    if (stderr)
        console.log(stderr);
}
function parseDeployFailure(output) {
    const migrationMatch = output.match(/Migration `([^`]+)` failed/i);
    const migrationName = migrationMatch?.[1] ?? null;
    const dbErrorBlock = output.match(/Database error[^\n]*\n([\s\S]*?)(?:\n\n|\nDbError|$)/i);
    const dbError = dbErrorBlock?.[1]?.trim() ?? output;
    let sqlObject = null;
    const objectPatterns = [
        /relation "([^"]+)" already exists/i,
        /relation "([^"]+)" does not exist/i,
        /column "([^"]+)" of relation "([^"]+)" already exists/i,
        /column "([^"]+)" of relation "([^"]+)" does not exist/i,
        /type "([^"]+)" already exists/i,
        /type "([^"]+)" does not exist/i,
        /constraint "([^"]+)" .*already exists/i,
        /index "([^"]+)" already exists/i,
        /duplicate key value violates unique constraint "([^"]+)"/i,
    ];
    for (const pattern of objectPatterns) {
        const match = dbError.match(pattern);
        if (match) {
            sqlObject = match.slice(1).filter(Boolean).join(".");
            break;
        }
    }
    if (!sqlObject) {
        const codeMatch = dbError.match(/ERROR:\s*(.+)/i);
        if (codeMatch)
            sqlObject = codeMatch[1].trim();
    }
    return {
        migrationName,
        sqlObject,
        message: dbError,
    };
}
function runMigrateDeploy() {
    console.log("[preflight] Running npx prisma migrate deploy...");
    const result = runCommand("npx prisma migrate deploy", { throwOnError: true });
    if (result.stdout)
        console.log(result.stdout);
    console.log("[preflight] prisma migrate deploy completed");
}
async function main() {
    if (!process.env.DATABASE_URL) {
        console.error("[preflight] DATABASE_URL is required");
        process.exit(1);
    }
    const failed = await findFailedMigrations();
    if (failed.length === 0) {
        console.log("[preflight] No failed migrations in _prisma_migrations");
    }
    else {
        console.log(`[preflight] Found ${failed.length} failed migration(s): ${failed.map((r) => r.migration_name).join(", ")}`);
        for (const row of failed) {
            resolveRolledBack(row.migration_name);
        }
    }
    try {
        runMigrateDeploy();
        console.log("PRODUCTION MIGRATION CHAIN CLEAN");
        process.exit(0);
    }
    catch (error) {
        const err = error;
        const combined = `${err.message || ""}\n${err.stdout || ""}\n${err.stderr || ""}`.trim();
        const parsed = parseDeployFailure(combined);
        console.error("[preflight] prisma migrate deploy FAILED");
        if (parsed.migrationName) {
            console.error(`[preflight] failing migration: ${parsed.migrationName}`);
        }
        if (parsed.sqlObject) {
            console.error(`[preflight] SQL object: ${parsed.sqlObject}`);
        }
        console.error(parsed.message || combined);
        process.exit(1);
    }
    finally {
        await prisma.$disconnect();
    }
}
main().catch(async (error) => {
    console.error("[preflight] unexpected error:", error);
    await prisma.$disconnect();
    process.exit(1);
});
