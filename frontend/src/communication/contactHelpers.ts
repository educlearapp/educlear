import { newContactId, type EmailContact, type SmsContact } from "./communicationApi";

export function collectParentEmailContacts(learners: any[], parents: any[]): EmailContact[] {
  const seen = new Set<string>();
  const out: EmailContact[] = [];

  const push = (name: string, relationship: string, email: string) => {
    const key = email.toLowerCase();
    if (!email || seen.has(key)) return;
    seen.add(key);
    out.push({
      id: newContactId(),
      contactName: name || "Parent/Guardian",
      relationship: relationship || "Parent",
      email,
      attachments: [],
      status: "Ready",
    });
  };

  for (const parent of parents || []) {
    const email = String(parent?.email || "").trim();
    if (!email) continue;
    const name = `${parent?.firstName || ""} ${parent?.surname || ""}`.trim();
    push(name, String(parent?.relationship || "Parent"), email);
  }

  for (const learner of learners || []) {
    const embedded = Array.isArray(learner?.parents) ? learner.parents : [];
    for (const p of embedded) {
      const email = String(p?.email || "").trim();
      if (!email) continue;
      const name = `${p?.firstName || p?.name || ""} ${p?.surname || p?.lastName || ""}`.trim();
      push(name, String(p?.relationship || "Parent"), email);
    }
    const links = Array.isArray(learner?.links) ? learner.links : [];
    for (const link of links) {
      const p = link?.parent;
      if (!p) continue;
      const email = String(p?.email || "").trim();
      if (!email) continue;
      const name = `${p?.firstName || ""} ${p?.surname || ""}`.trim();
      push(name, String(link?.relation || link?.relationship || "Parent"), email);
    }
  }

  return out;
}

export function collectParentSmsContacts(learners: any[], parents: any[]): SmsContact[] {
  const seen = new Set<string>();
  const out: SmsContact[] = [];

  const push = (name: string, relationship: string, cellNo: string) => {
    const digits = cellNo.replace(/\D/g, "");
    if (!digits || seen.has(digits)) return;
    seen.add(digits);
    out.push({
      id: newContactId(),
      contactName: name || "Parent/Guardian",
      relationship: relationship || "Parent",
      cellNo,
      status: "Ready",
    });
  };

  for (const parent of parents || []) {
    const cell = String(parent?.cellNo || parent?.phone || "").trim();
    if (!cell) continue;
    const name = `${parent?.firstName || ""} ${parent?.surname || ""}`.trim();
    push(name, String(parent?.relationship || "Parent"), cell);
  }

  for (const learner of learners || []) {
    const embedded = Array.isArray(learner?.parents) ? learner.parents : [];
    for (const p of embedded) {
      const cell = String(p?.cellNo || p?.phone || "").trim();
      if (!cell) continue;
      const name = `${p?.firstName || p?.name || ""} ${p?.surname || p?.lastName || ""}`.trim();
      push(name, String(p?.relationship || "Parent"), cell);
    }
  }

  return out;
}
