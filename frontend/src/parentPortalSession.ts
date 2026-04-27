export type ParentPortalSession = {
  parentId: string;
  schoolId: string;
  parentUserId: string;
  parentEmail: string;
  schoolName?: string;
  schoolLogoUrl?: string | null;
};

const KEY = "parentPortalSession";

export function getParentPortalSession(): ParentPortalSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ParentPortalSession>;
    if (!parsed?.parentId || !parsed?.schoolId || !parsed?.parentUserId || !parsed?.parentEmail) return null;
    return parsed as ParentPortalSession;
  } catch {
    return null;
  }
}

export function setParentPortalSession(session: ParentPortalSession) {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearParentPortalSession() {
  localStorage.removeItem(KEY);
}

