/**
 * Hard gate for Da Silva historical parent create/repair tooling.
 * Does NOT change repair algorithms — only prevents accidental production execution.
 *
 * EnsureDaSilvaAcademyProduction startup is intentionally NOT gated here —
 * changing startup behaviour requires a separate owner-approved design.
 */

import { isProductionRuntime } from "../../runtime";

export const DA_SILVA_HISTORICAL_PARENT_TOOL_ENV = "CONFIRM_DA_SILVA_HISTORICAL_PARENT_TOOL";
export const CONFIRM_PRODUCTION_WRITE_ENV = "CONFIRM_PRODUCTION_WRITE";

/**
 * Call at the start of historical Da Silva tools that can create/update Parent rows.
 * Local/dev: requires CONFIRM_DA_SILVA_HISTORICAL_PARENT_TOOL=true
 * Production: also requires CONFIRM_PRODUCTION_WRITE=true
 */
export function assertDaSilvaHistoricalParentToolAllowed(toolName: string): void {
  const allowed =
    String(process.env[DA_SILVA_HISTORICAL_PARENT_TOOL_ENV] || "")
      .trim()
      .toLowerCase() === "true";
  if (!allowed) {
    throw new Error(
      `BLOCKED: ${toolName} is a historical Da Silva parent create/repair tool. ` +
        `It bypasses the Universal Migration Parent Identity Resolver. ` +
        `Set ${DA_SILVA_HISTORICAL_PARENT_TOOL_ENV}=true only for intentional local/approved repair. ` +
        `For future school migrations use POST /api/migration/apply (Universal Migration).`
    );
  }
  if (isProductionRuntime()) {
    const prodWrite =
      String(process.env[CONFIRM_PRODUCTION_WRITE_ENV] || "")
        .trim()
        .toLowerCase() === "true";
    if (!prodWrite) {
      throw new Error(
        `BLOCKED: ${toolName} refused on production without ${CONFIRM_PRODUCTION_WRITE_ENV}=true. ` +
          `Historical Da Silva parent tools must not run accidentally against LIVE.`
      );
    }
  }
}
