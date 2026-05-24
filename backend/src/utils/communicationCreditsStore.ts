import fs from "fs";
import path from "path";

const DATA_FILE = path.join(process.cwd(), "data", "communication-store.json");

type SchoolStore = {
  settings: Record<string, unknown>;
  emailBalance: number;
  smsCredits: number;
  winSmsCredits: number;
  emails: unknown[];
  sms: unknown[];
};

type Store = {
  schools: Record<string, SchoolStore>;
};

function defaultSchoolStore(): SchoolStore {
  return {
    settings: {},
    emailBalance: 5000,
    smsCredits: 1200,
    winSmsCredits: 800,
    emails: [],
    sms: [],
  };
}

function ensureStore(): Store {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial: Store = { schools: {} };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), "utf8");
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return parsed && typeof parsed === "object" && parsed.schools ? parsed : { schools: {} };
  } catch {
    return { schools: {} };
  }
}

function writeStore(store: Store) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function grantSmsCreditsToSchool(
  schoolId: string,
  credits: number,
): { smsCredits: number; winSmsCredits: number } {
  if (!Number.isFinite(credits) || credits <= 0) {
    throw new Error("Credits to grant must be a positive number");
  }

  const store = ensureStore();
  if (!store.schools[schoolId]) {
    store.schools[schoolId] = defaultSchoolStore();
  }

  const schoolStore = store.schools[schoolId];
  schoolStore.smsCredits += credits;
  writeStore(store);

  return {
    smsCredits: schoolStore.smsCredits,
    winSmsCredits: schoolStore.winSmsCredits,
  };
}
