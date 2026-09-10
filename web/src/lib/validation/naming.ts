/**
 * The product's own naming rules, not ours.
 *
 * Taken verbatim from Buildtime/Help/en/featureguide/appendix/naming_conventions.htm
 * and extracted into reference/naming_rules.json. We did not invent a linter -
 * these are the rules OTE itself applies, and today a violation is silently
 * dropped on import. Here it is caught and corrected with the change shown.
 *
 * Phase 6 of docs/BUILD_PLAN.md.
 */

/** Reserved regardless of case: IEC data types and ASCII control codes. */
const CASE_INSENSITIVE = new Set(
  [
    "ACK", "BEL", "BOOL", "BS", "BYTE", "CAN", "CR", "DATE", "DATE_AND_TIME",
    "DC1", "DC2", "DC3", "DC4", "DEL", "DINT", "DLE", "DWORD", "EM", "ENQ",
    "EOT", "ESC", "ETB", "ETX", "FF", "FS", "GS", "HT", "INGREDIENT", "INT",
    "LF", "LINT", "LREAL", "LWORD", "NAK", "NONE", "NUL", "REAL", "RS", "SI",
    "SINT", "SO", "SOH", "SPACE", "STRING", "STX", "SUB", "SYN", "TIME",
    "TIME_OF_DAY", "UDINT", "UINT", "ULINT", "US", "USINT", "VT", "WORD",
    "WSTRING",
  ].map((w) => w.toUpperCase()),
);

/** Reserved only in this exact casing: script language keywords. */
const CASE_SENSITIVE = new Set([
  "abstract", "base", "case", "catch", "char", "class", "decimal", "delegate",
  "double", "else", "enum", "event", "false", "float", "if", "implicit", "in",
  "interface", "internal", "is", "long", "new", "null", "object", "out",
  "override", "params", "private", "protected", "public", "ref", "sbyte",
  "sealed", "short", "sizeof", "stackalloc", "struct", "this", "true",
  "typeof", "ulong", "ushort", "virtual", "void",
]);

/**
 * Usable, but a text-mode script has to reach them as `$Global.<name>`. Worth a
 * warning rather than a correction - the name is legal, it is just awkward.
 */
const SCRIPT_KEYWORDS = new Set([
  "break", "const", "continue", "debugger", "default", "delete", "do", "export",
  "extends", "finally", "for", "function", "goto", "import", "instanceof",
  "return", "super", "switch", "throw", "try", "var", "while", "with",
]);

export type NameProblem =
  | "empty"
  | "leading-digit"
  | "illegal-characters"
  | "reserved-word"
  | "script-keyword";

export interface NameCheck {
  ok: boolean;
  problem?: NameProblem;
  message?: string;
  /** A legal name preserving as much of the original as possible. */
  suggestion?: string;
}

/**
 * Valid characters are letters, digits and underscore, and a name may not start
 * with a digit or contain spaces. (The product also allows several Unicode
 * categories for multi-byte names; we stay in the ASCII subset a PLC export
 * uses, and treat anything else as needing correction rather than silently
 * accepting it.)
 */
const LEGAL = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function checkName(name: string): NameCheck {
  if (name.length === 0) {
    return { ok: false, problem: "empty", message: "name is empty" };
  }

  if (!LEGAL.test(name)) {
    const problem: NameProblem = /^[0-9]/.test(name)
      ? "leading-digit"
      : "illegal-characters";
    return {
      ok: false,
      problem,
      message:
        problem === "leading-digit"
          ? "a name cannot start with a digit"
          : "only letters, digits and underscore are allowed",
      suggestion: suggestName(name),
    };
  }

  if (CASE_INSENSITIVE.has(name.toUpperCase())) {
    return {
      ok: false,
      problem: "reserved-word",
      message: `"${name}" is a reserved word (data type or control code)`,
      suggestion: suggestName(name),
    };
  }

  if (CASE_SENSITIVE.has(name)) {
    return {
      ok: false,
      problem: "reserved-word",
      message: `"${name}" is a reserved script keyword in this casing`,
      suggestion: suggestName(name),
    };
  }

  if (SCRIPT_KEYWORDS.has(name)) {
    return {
      ok: true,
      problem: "script-keyword",
      message: `scripts must reach "${name}" as $Global.${name}`,
    };
  }

  return { ok: true };
}

/** Smallest legal change: fix the characters, then the leading digit, then collisions. */
export function suggestName(name: string): string {
  let out = name.replace(/[^A-Za-z0-9_]/g, "_");
  if (out.length === 0 || /^[0-9]/.test(out)) out = `Tag_${out}`;
  if (
    CASE_INSENSITIVE.has(out.toUpperCase()) ||
    CASE_SENSITIVE.has(out) ||
    out.length === 0
  ) {
    out = `${out}_1`;
  }
  return out;
}

/**
 * Applies suggestions across a set of names, keeping them unique. Returns the
 * corrections rather than applying them silently - the engineer sees what was
 * changed, which is the whole difference from an import that drops bad rows.
 */
export interface Correction {
  from: string;
  to: string;
  reason: string;
}

export function normaliseNames(names: string[]): {
  names: string[];
  corrections: Correction[];
} {
  const taken = new Set<string>();
  const corrections: Correction[] = [];
  const out: string[] = [];

  for (const original of names) {
    const check = checkName(original);
    let final = check.ok ? original : (check.suggestion ?? suggestName(original));

    if (taken.has(final)) {
      let n = 2;
      while (taken.has(`${final}_${n}`)) n += 1;
      const deduped = `${final}_${n}`;
      corrections.push({
        from: original,
        to: deduped,
        reason: `duplicate of an existing name`,
      });
      final = deduped;
    } else if (final !== original) {
      corrections.push({
        from: original,
        to: final,
        reason: check.message ?? "invalid name",
      });
    }

    taken.add(final);
    out.push(final);
  }

  return { names: out, corrections };
}
