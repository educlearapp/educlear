-- Trusted demo-tenant outbound safety flag (server-side only).
ALTER TABLE "School" ADD COLUMN IF NOT EXISTS "isDemoTenant" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "School_isDemoTenant_idx" ON "School"("isDemoTenant");
