// One-shot: make all prisma migration.sql files production-idempotent.
// Run: npx tsx scripts/apply-migration-idempotency.ts
import fs from "fs";
import path from "path";

const migrationsDir = path.resolve(__dirname, "../prisma/migrations");

function isPlaceholderOnly(sql: string): boolean {
  const stripped = sql
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length === 0;
}

function wrapCreateType(sql: string): string {
  return sql.replace(
    /^CREATE TYPE "([^"]+)" AS ENUM \(([\s\S]*?)\);$/gm,
    (_match, typeName: string, enumValues: string) => `DO $$ BEGIN
  CREATE TYPE "${typeName}" AS ENUM (${enumValues});
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;`
  );
}

function wrapAddConstraint(sql: string): string {
  return sql.replace(
    /^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" ((?:FOREIGN KEY|PRIMARY KEY|UNIQUE)[\s\S]*?);$/gm,
    (_match, table: string, constraint: string, rest: string) => `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${constraint}') THEN
    ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}" ${rest};
  END IF;
END $$;`
  );
}

function makeIdempotent(sql: string): string {
  if (isPlaceholderOnly(sql)) {
    return sql;
  }

  let out = sql;

  out = out.replace(
    /CREATE TABLE (?!IF NOT EXISTS)("[^"]+")/g,
    "CREATE TABLE IF NOT EXISTS $1"
  );

  out = out.replace(
    /CREATE UNIQUE INDEX (?!IF NOT EXISTS)/g,
    "CREATE UNIQUE INDEX IF NOT EXISTS "
  );

  out = out.replace(
    /CREATE INDEX (?!IF NOT EXISTS)/g,
    "CREATE INDEX IF NOT EXISTS "
  );

  out = out.replace(/ADD COLUMN(?! IF NOT EXISTS)(\s+)/g, "ADD COLUMN IF NOT EXISTS$1");

  out = wrapCreateType(out);
  out = wrapAddConstraint(out);

  return out;
}

function main(): void {
  const dirs = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  let changed = 0;
  for (const dir of dirs) {
    const file = path.join(migrationsDir, dir, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const original = fs.readFileSync(file, "utf-8");
    const updated = makeIdempotent(original);
    if (updated !== original) {
      fs.writeFileSync(file, updated);
      changed += 1;
      console.log(`updated: ${dir}`);
    }
  }
  console.log(`Done. ${changed} migration(s) updated.`);
}

main();
