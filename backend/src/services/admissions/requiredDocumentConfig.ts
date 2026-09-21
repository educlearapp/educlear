export const REQUIRED_DOCUMENT_CONDITION_NON_SOUTH_AFRICAN =
  "learner_citizenship_not_south_african" as const;

export const DEFAULT_MULTIPLE_DOCUMENT_MAX_COUNT = 10;
export const MAX_MULTIPLE_DOCUMENT_MAX_COUNT = 20;
export const MAX_REQUIRED_DOCUMENT_REQUIREMENTS = 50;

export type RequiredDocumentCondition = {
  type: typeof REQUIRED_DOCUMENT_CONDITION_NON_SOUTH_AFRICAN;
};

export type RequiredDocumentConfig = {
  key: string;
  label: string;
  required: boolean;
  allowMultiple: boolean;
  maxCount: number;
  condition: RequiredDocumentCondition | null;
};

export type CitizenshipResolution =
  | "south_african"
  | "non_south_african"
  | "unresolved";

export type RequirementApplicability = "applicable" | "not_applicable" | "unresolved";

export type RequiredDocumentCompleteness = {
  documentsComplete: boolean;
  requiredTotal: number;
  requiredUploaded: number;
  missingDocumentTypes: string[];
  unresolvedConditionTypes: string[];
};

export class RequiredDocumentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequiredDocumentConfigError";
  }
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function humanizeKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function failOrSkip(strict: boolean, message: string): null {
  if (strict) throw new RequiredDocumentConfigError(message);
  return null;
}

function parseCondition(
  value: unknown,
  strict: boolean,
  key: string
): RequiredDocumentCondition | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  const type =
    typeof value === "string"
      ? value
      : value && typeof value === "object"
        ? clean((value as { type?: unknown }).type)
        : "";
  if (type !== REQUIRED_DOCUMENT_CONDITION_NON_SOUTH_AFRICAN) {
    failOrSkip(strict, `Unsupported condition for required document "${key}"`);
    return undefined;
  }
  return { type: REQUIRED_DOCUMENT_CONDITION_NON_SOUTH_AFRICAN };
}

export function parseRequiredDocumentConfig(
  value: unknown,
  options?: { strict?: boolean }
): RequiredDocumentConfig[] {
  const strict = options?.strict === true;
  if (!Array.isArray(value)) {
    if (strict && value !== undefined && value !== null) {
      throw new RequiredDocumentConfigError("requiredDocuments must be an array");
    }
    return [];
  }
  if (value.length > MAX_REQUIRED_DOCUMENT_REQUIREMENTS) {
    throw new RequiredDocumentConfigError(
      `requiredDocuments may contain at most ${MAX_REQUIRED_DOCUMENT_REQUIREMENTS} items`
    );
  }

  const seen = new Set<string>();
  const out: RequiredDocumentConfig[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      failOrSkip(strict, "Each required document must be an object");
      continue;
    }
    const row = raw as Record<string, unknown>;
    const key = clean(row.key);
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(key)) {
      failOrSkip(strict, `Unsafe required document key "${key || "(empty)"}"`);
      continue;
    }
    if (key === "proof_of_payment") {
      failOrSkip(strict, "proof_of_payment must use the separate payment-proof flow");
      continue;
    }
    if (seen.has(key)) {
      failOrSkip(strict, `Duplicate required document key "${key}"`);
      continue;
    }

    const label = clean(row.label) || humanizeKey(key);
    if (label.length > 160) {
      failOrSkip(strict, `Label for required document "${key}" is too long`);
      continue;
    }
    const required = row.required === true;
    const allowMultiple = row.allowMultiple === true;
    const parsedMax =
      row.maxCount === undefined || row.maxCount === null || row.maxCount === ""
        ? undefined
        : Number(row.maxCount);
    if (
      parsedMax !== undefined &&
      (!Number.isInteger(parsedMax) ||
        parsedMax < 1 ||
        parsedMax > MAX_MULTIPLE_DOCUMENT_MAX_COUNT)
    ) {
      failOrSkip(
        strict,
        `maxCount for required document "${key}" must be between 1 and ${MAX_MULTIPLE_DOCUMENT_MAX_COUNT}`
      );
      continue;
    }
    if (!allowMultiple && parsedMax !== undefined && parsedMax !== 1) {
      failOrSkip(strict, `maxCount requires allowMultiple for required document "${key}"`);
      continue;
    }
    const condition = parseCondition(row.condition, strict, key);
    if (condition === undefined) continue;
    if (condition && !required) {
      failOrSkip(strict, `Conditional required document "${key}" must be marked required`);
      continue;
    }

    seen.add(key);
    out.push({
      key,
      label,
      required,
      allowMultiple,
      maxCount: allowMultiple
        ? parsedMax ?? DEFAULT_MULTIPLE_DOCUMENT_MAX_COUNT
        : 1,
      condition,
    });
  }
  return out;
}

export function normalizeCitizenship(value: unknown): string {
  return clean(value)
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function resolveCitizenship(value: unknown): CitizenshipResolution {
  const normalized = normalizeCitizenship(value);
  if (!normalized) return "unresolved";
  if (
    ["south african", "south africa", "za", "zaf", "rsa"].includes(normalized)
  ) {
    return "south_african";
  }
  return "non_south_african";
}

export function evaluateRequiredDocumentApplicability(
  requirement: Pick<RequiredDocumentConfig, "condition">,
  learnerCitizenship: unknown
): RequirementApplicability {
  if (!requirement.condition) return "applicable";
  const citizenship = resolveCitizenship(learnerCitizenship);
  if (citizenship === "unresolved") return "unresolved";
  return citizenship === "non_south_african" ? "applicable" : "not_applicable";
}

export function deriveRequiredDocumentCompleteness(input: {
  requirements: RequiredDocumentConfig[];
  activeDocumentTypes: string[];
  learnerCitizenship?: unknown;
}): RequiredDocumentCompleteness {
  const counts = new Map<string, number>();
  for (const type of input.activeDocumentTypes) {
    const key = clean(type);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }

  let requiredTotal = 0;
  let requiredUploaded = 0;
  const missingDocumentTypes: string[] = [];
  const unresolvedConditionTypes: string[] = [];
  for (const requirement of input.requirements) {
    if (!requirement.required) continue;
    const applicability = evaluateRequiredDocumentApplicability(
      requirement,
      input.learnerCitizenship
    );
    if (applicability === "not_applicable") continue;
    if (applicability === "unresolved") {
      unresolvedConditionTypes.push(requirement.key);
      continue;
    }
    requiredTotal += 1;
    if ((counts.get(requirement.key) || 0) > 0) {
      requiredUploaded += 1;
    } else {
      missingDocumentTypes.push(requirement.key);
    }
  }

  return {
    documentsComplete:
      missingDocumentTypes.length === 0 && unresolvedConditionTypes.length === 0,
    requiredTotal,
    requiredUploaded,
    missingDocumentTypes,
    unresolvedConditionTypes,
  };
}

export function findRequiredDocumentConfig(
  value: unknown,
  documentType: string
): RequiredDocumentConfig | null {
  const key = clean(documentType);
  return parseRequiredDocumentConfig(value).find((item) => item.key === key) || null;
}
