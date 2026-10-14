/**
 * EduClear Demo School — online admissions production smoke test helper.
 *
 * Targets ONLY the EduClear Demo School. Refuses Da Silva or any other school.
 *
 *   preflight (default, read-only)  readiness of the Demo School admissions config
 *   open      (write, guarded)      snapshot settings, then open admissions with a controlled contact email
 *   verify    (read-only)           smoke applications + notification audit events since `open`
 *   close     (write, guarded)      restore the exact settings captured by `open`
 *
 * Writes require CONFIRM_PRODUCTION_WRITE=true. `open` also requires SMOKE_CONTACT_EMAIL
 * (an owner-controlled mailbox). Output contains booleans, counts, statuses and codes only.
 *
 * Smoke applications are identified by learner last name containing SMOKE_SURNAME_MARKER.
 * Admission rows cannot be deleted (audit history is Restrict); decline them via the staff UI
 * with reason "EduClear smoke test — not a real applicant" (declining sends no email).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { PrismaClient } from "@prisma/client";

import { normalizeRecipientEmail } from "../src/services/admissions/admissionsSubmissionNotificationService";

const BACKEND_SERVICE_ID = "srv-d6j8jvma2pns7397bghg";
const PRODUCTION_DB_HOST = "dpg-d84smqjbc2fs73chlgcg-a.oregon-postgres.render.com";
const DEMO_SCHOOL_ID = "cmpbdigd00001vuzmxnwkbgiu";
const DA_SILVA_ID = "cmpideqeq0000108xb6ouv9zi";
const SMOKE_SURNAME_MARKER = "SMOKETEST";
const SMOKE_WINDOW_HOURS = 3;
const SNAPSHOT_DIR = path.join(os.homedir(), ".educlear-smoke");
const SNAPSHOT_FILE = path.join(SNAPSHOT_DIR, `admissions-demo-settings-${DEMO_SCHOOL_ID}.json`);

type SettingsSnapshot = {
  schoolId: string;
  capturedAt: string;
  openedAt: string | null;
  enabled: boolean;
  admissionContactEmail: string | null;
  applicationsOpenAt: string | null;
  applicationsCloseAt: string | null;
  notificationRecipientUserIds: unknown;
};

async function resolveDatabaseUrl(): Promise<string> {
  const cli = fs.readFileSync(path.join(os.homedir(), ".render", "cli.yaml"), "utf8");
  const key = (cli.match(/^\s*key:\s*(\S+)\s*$/m) || [])[1];
  if (!key) throw new Error("No Render API key");
  const res = await fetch(`https://api.render.com/v1/services/${BACKEND_SERVICE_ID}/env-vars?limit=100`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Render env-vars fetch failed: ${res.status}`);
  const rows = (await res.json()) as Array<{ envVar?: { key?: string; value?: string } }>;
  const url = rows.map((r) => r.envVar).find((e) => e?.key === "DATABASE_URL")?.value;
  if (!url || new URL(url).hostname !== PRODUCTION_DB_HOST) throw new Error("unexpected database");
  return url;
}

function requireWriteConfirmation() {
  if (process.env.CONFIRM_PRODUCTION_WRITE !== "true") {
    throw new Error("Refusing production write: set CONFIRM_PRODUCTION_WRITE=true after owner approval");
  }
}

function assertDemoSchool(schoolId: string) {
  if (schoolId !== DEMO_SCHOOL_ID || schoolId === (DA_SILVA_ID as string)) {
    throw new Error("Refusing: smoke test targets the EduClear Demo School only");
  }
}

function readSnapshot(): SettingsSnapshot | null {
  if (!fs.existsSync(SNAPSHOT_FILE)) return null;
  const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8")) as SettingsSnapshot;
  assertDemoSchool(snap.schoolId);
  return snap;
}

async function preflight(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const school = await tx.school.findUnique({ where: { id: DEMO_SCHOOL_ID }, select: { id: true, email: true } });
    const settings = await tx.schoolAdmissionsSettings.findUnique({ where: { schoolId: DEMO_SCHOOL_ID } });
    const legalDocs = await tx.schoolAdmissionsLegalDocument.findMany({
      where: { schoolId: DEMO_SCHOOL_ID, supersededAt: null },
      select: { kind: true },
    });
    const apps = await tx.admissionApplication.groupBy({
      by: ["status"],
      where: { schoolId: DEMO_SCHOOL_ID },
      _count: { _all: true },
    });
    return {
      schoolFound: Boolean(school),
      schoolEmailValid: Boolean(normalizeRecipientEmail(school?.email ?? null)),
      settingsFound: Boolean(settings),
      enabled: settings?.enabled ?? null,
      publicSlug: settings?.publicSlug ?? null,
      intakeYearSet: settings?.intakeYear != null,
      acceptedGradesCount: Array.isArray(settings?.acceptedGrades) ? settings!.acceptedGrades.length : 0,
      requiredDocumentsCount: Array.isArray(settings?.requiredDocuments) ? settings!.requiredDocuments.length : 0,
      admissionFeeRequired: settings?.admissionFeeRequired ?? null,
      admissionContactEmailValid: Boolean(normalizeRecipientEmail(settings?.admissionContactEmail ?? null)),
      notificationRecipientUserIdsCount: Array.isArray(settings?.notificationRecipientUserIds)
        ? settings!.notificationRecipientUserIds.length
        : 0,
      publishedLegalDocumentKinds: legalDocs.map((d) => d.kind).sort(),
      existingApplicationsByStatus: Object.fromEntries(apps.map((a) => [a.status, a._count._all])),
      snapshotOnDisk: fs.existsSync(SNAPSHOT_FILE),
    };
  });
}

async function open(prisma: PrismaClient) {
  requireWriteConfirmation();
  assertDemoSchool(DEMO_SCHOOL_ID);
  const contact = normalizeRecipientEmail(process.env.SMOKE_CONTACT_EMAIL ?? null);
  if (!contact) throw new Error("SMOKE_CONTACT_EMAIL must be an owner-controlled mailbox");
  if (fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error("A settings snapshot already exists — run `close` first so the original is restored");
  }
  const settings = await prisma.schoolAdmissionsSettings.findUniqueOrThrow({ where: { schoolId: DEMO_SCHOOL_ID } });
  const now = new Date();
  const snapshot: SettingsSnapshot = {
    schoolId: DEMO_SCHOOL_ID,
    capturedAt: now.toISOString(),
    openedAt: now.toISOString(),
    enabled: settings.enabled,
    admissionContactEmail: settings.admissionContactEmail,
    applicationsOpenAt: settings.applicationsOpenAt?.toISOString() ?? null,
    applicationsCloseAt: settings.applicationsCloseAt?.toISOString() ?? null,
    notificationRecipientUserIds: settings.notificationRecipientUserIds,
  };
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2), { mode: 0o600 });

  await prisma.schoolAdmissionsSettings.update({
    where: { schoolId: DEMO_SCHOOL_ID },
    data: {
      enabled: true,
      admissionContactEmail: contact,
      notificationRecipientUserIds: [],
      applicationsOpenAt: new Date(now.getTime() - 60_000),
      applicationsCloseAt: new Date(now.getTime() + SMOKE_WINDOW_HOURS * 3_600_000),
    },
  });
  return { opened: true, openedAt: snapshot.openedAt, closesInHours: SMOKE_WINDOW_HOURS, snapshotFile: SNAPSHOT_FILE };
}

async function verify(prisma: PrismaClient) {
  const snap = readSnapshot();
  const since = snap?.openedAt ? new Date(snap.openedAt) : new Date(Date.now() - 24 * 3_600_000);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const apps = await tx.admissionApplication.findMany({
      where: { schoolId: DEMO_SCHOOL_ID, createdAt: { gte: since } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        applicationNumber: true,
        status: true,
        createdAt: true,
        submittedAt: true,
        learnerCandidate: { select: { lastName: true } },
        auditEvents: { select: { eventType: true, metadataJson: true } },
      },
    });
    return {
      since: since.toISOString(),
      applications: apps.map((a) => {
        const counts: Record<string, number> = {};
        for (const e of a.auditEvents) counts[e.eventType] = (counts[e.eventType] || 0) + 1;
        return {
          applicationNumber: a.applicationNumber,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
          submittedAt: a.submittedAt?.toISOString() ?? null,
          taggedAsSmoke: String(a.learnerCandidate?.lastName ?? "").toUpperCase().includes(SMOKE_SURNAME_MARKER),
          auditCounts: counts,
          notifications: a.auditEvents
            .filter((e) => e.eventType.startsWith("ADMISSION_NOTIFICATION"))
            .map((e) => {
              const m = (e.metadataJson ?? {}) as Record<string, unknown>;
              return { type: e.eventType, recipientType: m.recipientType, errorCode: m.errorCode, reason: m.reason };
            }),
        };
      }),
    };
  });
}

async function close(prisma: PrismaClient) {
  requireWriteConfirmation();
  const snap = readSnapshot();
  if (!snap) throw new Error("No settings snapshot found — nothing to restore");
  await prisma.schoolAdmissionsSettings.update({
    where: { schoolId: DEMO_SCHOOL_ID },
    data: {
      enabled: snap.enabled,
      admissionContactEmail: snap.admissionContactEmail,
      applicationsOpenAt: snap.applicationsOpenAt ? new Date(snap.applicationsOpenAt) : null,
      applicationsCloseAt: snap.applicationsCloseAt ? new Date(snap.applicationsCloseAt) : null,
      notificationRecipientUserIds: (snap.notificationRecipientUserIds ?? []) as never,
    },
  });
  const after = await prisma.schoolAdmissionsSettings.findUniqueOrThrow({ where: { schoolId: DEMO_SCHOOL_ID } });
  const restored =
    after.enabled === snap.enabled &&
    after.admissionContactEmail === snap.admissionContactEmail &&
    (after.applicationsOpenAt?.toISOString() ?? null) === snap.applicationsOpenAt &&
    (after.applicationsCloseAt?.toISOString() ?? null) === snap.applicationsCloseAt;
  if (!restored) throw new Error("Restore mismatch — snapshot kept on disk for manual review");
  fs.renameSync(SNAPSHOT_FILE, `${SNAPSHOT_FILE}.restored-${Date.now()}`);
  return { restored: true, enabled: after.enabled };
}

async function main() {
  const mode = process.argv[2] || "preflight";
  if (!["preflight", "open", "verify", "close"].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  const prisma = new PrismaClient({ datasources: { db: { url: await resolveDatabaseUrl() } } });
  try {
    const result =
      mode === "open" ? await open(prisma)
      : mode === "verify" ? await verify(prisma)
      : mode === "close" ? await close(prisma)
      : await preflight(prisma);
    console.log(JSON.stringify({ mode, schoolId: DEMO_SCHOOL_ID, result }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
