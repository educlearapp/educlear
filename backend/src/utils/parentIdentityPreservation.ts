/**
 * Parent idNumber / email write semantics.
 *
 * CREATE: blank → null is allowed (new parents may omit identity).
 * UPDATE: omitted, null, or blank incidental values must NOT clear existing
 * non-null idNumber/email. Only a non-empty trimmed string is a replacement.
 *
 * There is currently no explicit UI action to clear parent ID/email.
 */

export type ParentIdentityFields = {
  idNumber?: unknown;
  email?: unknown;
};

export type ParentIdentityCreate = {
  idNumber: string | null;
  email: string | null;
};

export type ParentIdentityUpdate = {
  idNumber?: string;
  email?: string;
};

function cleanString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Non-empty replacement value, or null when absent/blank (create path). */
export function parentIdentityForCreate(raw: ParentIdentityFields): ParentIdentityCreate {
  return {
    idNumber: cleanString(raw.idNumber) || null,
    email: cleanString(raw.email) || null,
  };
}

/**
 * Fields to include in a Prisma update.
 * - undefined / null / "" → omit (preserve existing DB value)
 * - non-empty string → include as replacement
 */
export function parentIdentityForUpdate(raw: ParentIdentityFields): ParentIdentityUpdate {
  const out: ParentIdentityUpdate = {};

  if (Object.prototype.hasOwnProperty.call(raw, "idNumber")) {
    const idNumber = cleanString(raw.idNumber);
    if (idNumber) out.idNumber = idNumber;
  }

  if (Object.prototype.hasOwnProperty.call(raw, "email")) {
    const email = cleanString(raw.email);
    if (email) out.email = email;
  }

  return out;
}

/**
 * Strip incidental null/blank identity from a full parent write object used on UPDATE.
 * Keeps create-shaped objects intact when called only for update branches.
 */
export function applyParentIdentityPreservationForUpdate<T extends Record<string, unknown>>(
  writeData: T,
  rawParent: ParentIdentityFields
): T {
  const preserved = { ...writeData } as T & { idNumber?: string | null; email?: string | null };
  const identity = parentIdentityForUpdate(rawParent);

  if (identity.idNumber !== undefined) {
    preserved.idNumber = identity.idNumber;
  } else {
    delete preserved.idNumber;
  }

  if (identity.email !== undefined) {
    preserved.email = identity.email;
  } else {
    delete preserved.email;
  }

  return preserved;
}
