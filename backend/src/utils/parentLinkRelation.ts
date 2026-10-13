import type { PrismaClient } from "@prisma/client";

type Db = { parentLearnerLink: Pick<PrismaClient["parentLearnerLink"], "updateMany"> };

/**
 * Imports and repair tools may only fill a missing relationship on an existing
 * ParentLearnerLink — never overwrite a value (staff edits such as Mother / Father).
 */
export async function fillBlankLinkRelation(
  db: Db,
  parentId: string,
  learnerId: string,
  relation: string | null | undefined
): Promise<number> {
  const value = typeof relation === "string" ? relation.trim() : "";
  if (!value) return 0;
  const res = await db.parentLearnerLink.updateMany({
    where: { parentId, learnerId, OR: [{ relation: null }, { relation: "" }] },
    data: { relation: value },
  });
  return res.count;
}

/** Same rule for Parent.relationship: only an empty existing value may be filled. */
export function relationshipFillForParent(
  incoming: string | null | undefined,
  existing: string | null | undefined
): string | undefined {
  const inc = String(incoming ?? "").trim();
  if (!inc) return undefined;
  return String(existing ?? "").trim() ? undefined : inc;
}
