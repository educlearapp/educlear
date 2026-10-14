/**
 * READ-ONLY: checks whether production schools can receive admission submission notifications.
 * Prints booleans and counts only — never email addresses, names or other personal data.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { normalizeRecipientEmail } from "../src/services/admissions/admissionsSubmissionNotificationService";

const BACKEND_SERVICE_ID = "srv-d6j8jvma2pns7397bghg";
const PRODUCTION_DB_HOST = "dpg-d84smqjbc2fs73chlgcg-a.oregon-postgres.render.com";
const SCHOOLS: Record<string, string> = {
  DA_SILVA: "cmpideqeq0000108xb6ouv9zi",
  DEMO_SCHOOL: "cmpbdigd00001vuzmxnwkbgiu",
};

async function fetchEnv(): Promise<Map<string, string>> {
  const cli = fs.readFileSync(path.join(os.homedir(), ".render", "cli.yaml"), "utf8");
  const key = (cli.match(/^\s*key:\s*(\S+)\s*$/m) || [])[1];
  if (!key) throw new Error("No Render API key");
  const res = await fetch(`https://api.render.com/v1/services/${BACKEND_SERVICE_ID}/env-vars?limit=100`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Render env-vars fetch failed: ${res.status}`);
  const rows = (await res.json()) as Array<{ envVar?: { key?: string; value?: string } }>;
  const env = new Map<string, string>();
  for (const r of rows) if (r.envVar?.key) env.set(r.envVar.key, String(r.envVar.value ?? ""));
  return env;
}

async function main() {
  const env = await fetchEnv();
  const url = env.get("DATABASE_URL");
  if (!url || new URL(url).hostname !== PRODUCTION_DB_HOST) throw new Error("unexpected database");
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const schools = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      const out: Record<string, unknown> = {};
      for (const [label, id] of Object.entries(SCHOOLS)) {
        const school = await tx.school.findUnique({ where: { id }, select: { email: true } });
        const settings = await tx.schoolAdmissionsSettings.findUnique({
          where: { schoolId: id },
          select: { enabled: true, admissionContactEmail: true, notificationRecipientUserIds: true },
        });
        const ids = Array.isArray(settings?.notificationRecipientUserIds)
          ? (settings!.notificationRecipientUserIds as unknown[]).filter((v): v is string => typeof v === "string")
          : [];
        const users = ids.length
          ? await tx.user.findMany({ where: { id: { in: ids }, schoolId: id, isActive: true }, select: { email: true } })
          : [];
        const recipients = new Set<string>();
        const contact = normalizeRecipientEmail(settings?.admissionContactEmail ?? null);
        if (contact) recipients.add(contact);
        for (const u of users) {
          const e = normalizeRecipientEmail(u.email);
          if (e) recipients.add(e);
        }
        out[label] = {
          schoolFound: Boolean(school),
          schoolEmailValid: Boolean(normalizeRecipientEmail(school?.email ?? null)),
          admissionsSettingsFound: Boolean(settings),
          admissionsEnabled: settings?.enabled ?? null,
          admissionContactEmailValid: Boolean(contact),
          notificationRecipientUserIdsConfigured: ids.length,
          notificationRecipientUsersActiveSameSchool: users.length,
          distinctSchoolRecipients: recipients.size,
        };
      }
      return out;
    });
    console.log(
      JSON.stringify(
        {
          env: {
            resendApiKeyPresent: Boolean(env.get("RESEND_API_KEY")?.trim()),
            disableOutboundEmail: env.get("DISABLE_OUTBOUND_EMAIL") ?? "(unset)",
          },
          schools,
        },
        null,
        2
      )
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
