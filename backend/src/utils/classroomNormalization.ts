/**
 * School-agnostic classroom name normalization for migrations and cross-module consistency.
 * Preserves naming style where possible (Grade vs Class vs Year); dedupes via matchKey.
 */

export type ClassroomNormalizationOptions = {
  /** When true, "Reception" normalizes to "Grade R". Default false until school config exists. */
  mapReceptionToGradeR?: boolean;
};

export type NormalizedClassroom = {
  /** Normalized display name (no academic year). */
  classroomName: string;
  /** @deprecated Use classroomName — kept for existing callers. */
  canonicalName: string;
  gradeLabel: string;
  /** Class letter or stream group (e.g. "A", "8A"). */
  classLetter: string;
  /** @deprecated Use classLetter — kept for existing callers. */
  stream: string;
  importYear: number | null;
  matchKey: string;
  raw: string;
  needsConfirmation: boolean;
  warnings: string[];
};

const CONFIRMATION_MSG = "Classroom name needs confirmation.";

function clean(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[–—]/g, "-");
}

function titleCaseWord(word: string): string {
  if (!word) return "";
  if (/^r$/i.test(word)) return "R";
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function formatGradeLabel(gradeNum: string): string {
  return `Grade ${gradeNum}`;
}

function extractImportYear(text: string): { remainder: string; importYear: number | null } {
  const t = clean(text);
  const trailing = t.match(/\s+(20\d{2}|19\d{2})\s*$/);
  if (trailing && trailing.index != null) {
    return {
      remainder: t.slice(0, trailing.index).trim(),
      importYear: parseInt(trailing[1], 10),
    };
  }
  return { remainder: t, importYear: null };
}

function gradeNumberFromText(text: string): string | null {
  const t = clean(text);
  if (!t) return null;
  const gradeWord = t.match(/grade\s*(\d{1,2})\b/i);
  if (gradeWord) return gradeWord[1];
  const yearWord = t.match(/year\s*(\d{1,2})\b/i);
  if (yearWord) return yearWord[1];
  const classWord = t.match(/class\s*(\d{1,2})\b/i);
  if (classWord) return classWord[1];
  const leading = t.match(/^(\d{1,2})\b/);
  if (leading) return leading[1];
  const any = t.match(/(\d{1,2})/);
  return any ? any[1] : null;
}

function normalizeStreamToken(token: string, gradeNum: string | null): string {
  const t = clean(token).replace(/\s+/g, "");
  if (!t) return "";
  const compact = t.match(/^(\d{1,2})([A-Za-z].*)$/);
  if (compact) {
    const g = compact[1];
    const rest = compact[2].toUpperCase();
    if (!gradeNum || gradeNum === g) return `${g}${rest}`;
  }
  if (/^[A-Za-z]+$/.test(t)) return t.toUpperCase();
  return t.toUpperCase();
}

function singleLetterFromStream(stream: string, gradeNum: string): string {
  const s = stream.trim().toUpperCase();
  if (!s) return "";
  if (s.length === 1 && /[A-Z]/.test(s)) return s;
  const compact = s.match(new RegExp(`^${gradeNum}([A-Z])$`));
  if (compact) return compact[1];
  if (/^[A-Z]$/.test(s)) return s;
  return s;
}

function buildMatchKey(gradeKey: string, streamKey: string): string {
  const g = gradeKey.trim().toLowerCase();
  const s = streamKey.trim().toLowerCase();
  if (g && s) return `${g}|${s}`;
  if (g) return `${g}|`;
  if (s) return `|${s}`;
  return "";
}

function finish(
  partial: Omit<
    NormalizedClassroom,
    "canonicalName" | "stream" | "classroomName"
  > & { classroomName: string }
): NormalizedClassroom {
  const classroomName = partial.classroomName;
  return {
    ...partial,
    classroomName,
    canonicalName: classroomName,
    stream: partial.classLetter,
  };
}

function preschoolResult(
  raw: string,
  classroomName: string,
  gradeLabel: string,
  matchKey: string,
  importYear: number | null,
  warnings: string[],
  needsConfirmation = false
): NormalizedClassroom {
  return finish({
    classroomName,
    gradeLabel,
    classLetter: "",
    importYear,
    matchKey,
    raw,
    needsConfirmation,
    warnings,
  });
}

function numericClassResult(opts: {
  raw: string;
  classroomName: string;
  gradeNum: string;
  classLetter: string;
  importYear: number | null;
  warnings: string[];
  needsConfirmation?: boolean;
  stylePrefix?: "Grade" | "Class" | "Year";
}): NormalizedClassroom {
  const gradeLabel =
    opts.stylePrefix === "Year"
      ? `Year ${opts.gradeNum}`
      : opts.stylePrefix === "Class"
        ? `Class ${opts.gradeNum}`
        : formatGradeLabel(opts.gradeNum);
  const streamKey =
    opts.classLetter.length > 1
      ? opts.classLetter.toLowerCase()
      : opts.classLetter.toLowerCase();
  const matchKey = buildMatchKey(opts.gradeNum, streamKey);
  return finish({
    classroomName: opts.classroomName,
    gradeLabel,
    classLetter: opts.classLetter,
    importYear: opts.importYear,
    matchKey,
    raw: opts.raw,
    needsConfirmation: opts.needsConfirmation ?? false,
    warnings: opts.warnings,
  });
}

function slashFormatResult(
  raw: string,
  gradeNum: string,
  streamPart: string,
  importYear: number | null,
  warnings: string[]
): NormalizedClassroom {
  const stream = normalizeStreamToken(streamPart, gradeNum);
  const classroomName = `${formatGradeLabel(gradeNum)} / ${stream}`;
  const matchKey = buildMatchKey(gradeNum, stream.toLowerCase());
  return finish({
    classroomName,
    gradeLabel: formatGradeLabel(gradeNum),
    classLetter: stream,
    importYear,
    matchKey,
    raw,
    needsConfirmation: false,
    warnings,
  });
}

function tryPreschool(
  text: string,
  raw: string,
  importYear: number | null,
  warnings: string[],
  options: ClassroomNormalizationOptions
): NormalizedClassroom | null {
  const t = clean(text);
  if (/^pre[-\s]?grade\s*r$/i.test(t)) {
    return preschoolResult(raw, "Pre-Grade R", "Pre-Grade R", "ps|pre-grade-r", importYear, warnings);
  }
  if (/^(creche|cr[eè]che)$/i.test(t)) {
    return preschoolResult(raw, "Creche", "Creche", "ps|creche", importYear, warnings);
  }
  if (/^(gr\.?\s*r|grade\s*r)$/i.test(t)) {
    return preschoolResult(raw, "Grade R", "Grade R", "ps|grade-r", importYear, warnings);
  }
  if (/^reception$/i.test(t)) {
    if (options.mapReceptionToGradeR) {
      warnings.push('Mapped "Reception" to Grade R (school rule).');
      return preschoolResult(raw, "Grade R", "Grade R", "ps|grade-r", importYear, warnings);
    }
    return preschoolResult(
      raw,
      "Reception",
      "Reception",
      "ps|reception",
      importYear,
      [...warnings, CONFIRMATION_MSG],
      true
    );
  }
  return null;
}

/** Normalize a classroom/class label to a display name, dedupe key, and parsed metadata. */
export function normalizeClassroomInput(
  rawClassName: string,
  gradeHint?: string,
  options: ClassroomNormalizationOptions = {}
): NormalizedClassroom {
  const raw = clean(rawClassName);
  const warnings: string[] = [];
  const gradeFromHint = gradeNumberFromText(String(gradeHint || ""));

  if (!raw) {
    return finish({
      classroomName: "",
      gradeLabel: gradeFromHint ? formatGradeLabel(gradeFromHint) : "",
      classLetter: "",
      importYear: null,
      matchKey: "",
      raw,
      needsConfirmation: false,
      warnings,
    });
  }

  const { remainder, importYear } = extractImportYear(raw);
  if (importYear != null) {
    warnings.push(`Academic year ${importYear} detected — stored separately, not in classroom name.`);
  }

  const text = clean(remainder);
  const preschool = tryPreschool(text, raw, importYear, warnings, options);
  if (preschool) return preschool;

  const slashPatterns = [
    /^grade\s*(\d{1,2})\s*[/\-]\s*(.+)$/i,
    /^(\d{1,2})\s*[/\-]\s*(.+)$/i,
  ];
  for (const pattern of slashPatterns) {
    const m = text.match(pattern);
    if (m) {
      return slashFormatResult(raw, m[1], m[2], importYear, warnings);
    }
  }

  const gradeLetterSpaced = text.match(/^grade\s*(\d{1,2})\s+([a-z])\s*$/i);
  if (gradeLetterSpaced) {
    const gradeNum = gradeLetterSpaced[1];
    const letter = gradeLetterSpaced[2].toUpperCase();
    return numericClassResult({
      raw,
      classroomName: `${formatGradeLabel(gradeNum)}${letter}`,
      gradeNum,
      classLetter: letter,
      importYear,
      warnings,
      stylePrefix: "Grade",
    });
  }

  const gradeLetterGlued = text.match(/^grade\s*(\d{1,2})([a-z])\s*$/i);
  if (gradeLetterGlued) {
    const gradeNum = gradeLetterGlued[1];
    const letter = gradeLetterGlued[2].toUpperCase();
    return numericClassResult({
      raw,
      classroomName: `${formatGradeLabel(gradeNum)}${letter}`,
      gradeNum,
      classLetter: letter,
      importYear,
      warnings,
      stylePrefix: "Grade",
    });
  }

  const classPattern = text.match(/^class\s*(\d{1,2})\s*([a-z])?\s*$/i);
  if (classPattern) {
    const gradeNum = classPattern[1];
    const letter = (classPattern[2] || "").toUpperCase();
    const classroomName = letter
      ? `Class ${gradeNum}${letter}`
      : `Class ${gradeNum}`;
    return numericClassResult({
      raw,
      classroomName,
      gradeNum,
      classLetter: letter,
      importYear,
      warnings,
      stylePrefix: "Class",
    });
  }

  const yearPattern = text.match(/^year\s*(\d{1,2})\s*$/i);
  if (yearPattern) {
    const gradeNum = yearPattern[1];
    return numericClassResult({
      raw,
      classroomName: `Year ${gradeNum}`,
      gradeNum,
      classLetter: "",
      importYear,
      warnings,
      stylePrefix: "Year",
    });
  }

  const compactOnly = text.match(/^(\d{1,2})([a-z].*)$/i);
  if (compactOnly) {
    const gradeNum = compactOnly[1];
    const suffix = compactOnly[2].toUpperCase();
    const letter =
      suffix.length === 1 ? suffix : singleLetterFromStream(`${gradeNum}${suffix}`, gradeNum);
    const classroomName = `${formatGradeLabel(gradeNum)}${letter || suffix}`;
    return numericClassResult({
      raw,
      classroomName,
      gradeNum,
      classLetter: letter || suffix,
      importYear,
      warnings,
      stylePrefix: "Grade",
    });
  }

  const gradeOnly = text.match(/^grade\s*(\d{1,2})\s*$/i);
  if (gradeOnly) {
    return numericClassResult({
      raw,
      classroomName: formatGradeLabel(gradeOnly[1]),
      gradeNum: gradeOnly[1],
      classLetter: "",
      importYear,
      warnings,
      stylePrefix: "Grade",
    });
  }

  const gradeNum = gradeFromHint || gradeNumberFromText(text);
  if (gradeNum && !/^(grade|class|year)\b/i.test(text)) {
    const stream = normalizeStreamToken(text, gradeNum);
    const letter = singleLetterFromStream(stream, gradeNum);
    if (letter) {
      return numericClassResult({
        raw,
        classroomName: `${formatGradeLabel(gradeNum)}${letter}`,
        gradeNum,
        classLetter: letter,
        importYear,
        warnings: [...warnings, CONFIRMATION_MSG],
        needsConfirmation: true,
        stylePrefix: "Grade",
      });
    }
  }

  const titleCased = text
    .split(/\s+/)
    .map((w) => titleCaseWord(w))
    .join(" ");

  return finish({
    classroomName: titleCased,
    gradeLabel: "",
    classLetter: "",
    importYear,
    matchKey: buildMatchKey("", titleCased.toLowerCase()),
    raw,
    needsConfirmation: true,
    warnings: [...warnings, CONFIRMATION_MSG],
  });
}

/** All normalized variants that should match the same classroom (for teacher portal filters). */
export function classroomNameVariants(normalized: NormalizedClassroom): string[] {
  const variants = new Set<string>();
  const { classroomName, canonicalName, gradeLabel, classLetter, stream, raw, importYear } =
    normalized;
  const name = classroomName || canonicalName;
  if (name) variants.add(name);
  if (raw) variants.add(raw);
  if (importYear != null && name) {
    variants.add(`${name} ${importYear}`);
  }
  const letter = classLetter || stream;
  if (letter) {
    variants.add(letter);
    const g = gradeNumberFromText(gradeLabel);
    if (g) {
      variants.add(`${g}${letter}`);
      variants.add(`${formatGradeLabel(g)}${letter}`);
      variants.add(`${formatGradeLabel(g)} ${letter}`);
      variants.add(`${formatGradeLabel(g)} / ${letter}`);
      variants.add(`${formatGradeLabel(g)}/${letter}`);
      variants.add(`${formatGradeLabel(g)}-${letter}`);
      variants.add(`${g} / ${letter}`);
      variants.add(`${g}/${letter}`);
      variants.add(`${g}-${letter}`);
    }
  }
  return [...variants].filter(Boolean);
}

export function groupClassroomsByMatchKey<T extends { raw: string; gradeHint?: string }>(
  items: T[],
  options?: ClassroomNormalizationOptions
): Map<
  string,
  {
    key: string;
    canonical: NormalizedClassroom;
    items: T[];
    rawLabels: string[];
    needsConfirmation: boolean;
    warnings: string[];
  }
> {
  const groups = new Map<
    string,
    {
      key: string;
      canonical: NormalizedClassroom;
      items: T[];
      rawLabels: string[];
      needsConfirmation: boolean;
      warnings: string[];
    }
  >();
  for (const item of items) {
    const normalized = normalizeClassroomInput(item.raw, item.gradeHint, options);
    const key =
      normalized.matchKey ||
      normalized.classroomName.toLowerCase() ||
      normalized.raw.toLowerCase();
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      if (item.raw && !existing.rawLabels.includes(item.raw)) {
        existing.rawLabels.push(item.raw);
      }
      existing.needsConfirmation =
        existing.needsConfirmation || normalized.needsConfirmation;
      for (const w of normalized.warnings) {
        if (!existing.warnings.includes(w)) existing.warnings.push(w);
      }
    } else {
      groups.set(key, {
        key,
        canonical: normalized,
        items: [item],
        rawLabels: item.raw ? [item.raw] : [],
        needsConfirmation: normalized.needsConfirmation,
        warnings: [...normalized.warnings],
      });
    }
  }
  return groups;
}
