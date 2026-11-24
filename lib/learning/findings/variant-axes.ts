/**
 * E2's fixed vocabulary: the axes two ad names can differ on, from their names
 * alone (axis_source 'name'; the tagger's tags and the Lab's render metadata
 * come later as 'tag' / 'lab').
 *
 *   date    "date" / "with date"   vs absent
 *   text    "no text"              vs "text" / absent
 *   cta     "cta"                  vs "no cta"
 *   format  "static"               vs "video" / "vid" / "motion"
 *   ab      "[AB-A]"               vs "[AB-B]"
 *
 * Names are compared lower-cased, with whitespace collapsed (live names carry
 * double spaces: "NX Loves  - Static") and a trailing " – Copy" / " - Copy 2"
 * stripped: a copy is the same creative. Two names are siblings on an axis when
 * they're equal once that one axis's tokens are taken out, and their values on
 * it differ. Pure.
 */

export type Axis = "date" | "text" | "cta" | "format" | "ab";

export const AXES: readonly Axis[] = ["date", "text", "cta", "format", "ab"];

/** Each axis's two sides, in arm order (a, b): the first is the one the ratio is read for. */
export const AXIS_SIDES: Readonly<Record<Axis, readonly [string, string]>> = {
  date: ["with_date", "no_date"],
  text: ["no_text", "with_text"],
  cta: ["cta", "no_cta"],
  format: ["static", "video"],
  ab: ["ab_a", "ab_b"],
};

type Token = { re: RegExp; side: string };

const word = (w: string) => new RegExp(`(^|[^a-z0-9])${w}(?=$|[^a-z0-9])`, "g");

/** Longest first, so "with date" is one token and "no text" never also reads as "text". */
const TOKENS: Readonly<Record<Axis, readonly Token[]>> = {
  date: [
    { re: word("with date"), side: "with_date" },
    { re: word("date"), side: "with_date" },
  ],
  text: [
    { re: word("no text"), side: "no_text" },
    { re: word("text"), side: "with_text" },
  ],
  cta: [
    { re: word("no cta"), side: "no_cta" },
    { re: word("cta"), side: "cta" },
  ],
  format: [
    { re: word("static"), side: "static" },
    { re: word("video"), side: "video" },
    { re: word("vid"), side: "video" },
    { re: word("motion"), side: "video" },
  ],
  ab: [
    { re: /\[ab-a\]/g, side: "ab_a" },
    { re: /\[ab-b\]/g, side: "ab_b" },
  ],
};

/** The side an absent token reads as, where the vocabulary gives one. */
const ABSENT: Readonly<Partial<Record<Axis, string>>> = { date: "no_date", text: "with_text" };

/** Lower case, whitespace collapsed, a trailing copy marker stripped. */
export function normaliseName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[–—-]\s*copy(\s+\d+)?$/i, "")
    .trim();
}

/** Separators left dangling once a token is gone: "glitterbox - static -" → "glitterbox - static". */
function tidy(name: string): string {
  return name
    .replace(/\s*([–—-])\s*/g, " $1 ")
    .replace(/(\s[–—-]\s)(?:[–—-]\s)+/g, "$1")
    .replace(/^\s*[–—-]\s*|\s*[–—-]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type AxisRead = { side: string | null; rest: string };

/**
 * One axis read off a normalised name: its side (null when the name carries
 * none and the axis has no absent side, or carries both sides), and the name
 * with that axis's tokens taken out.
 */
export function readAxis(name: string, axis: Axis): AxisRead {
  let rest = normaliseName(name);
  const sides = new Set<string>();
  for (const token of TOKENS[axis]) {
    token.re.lastIndex = 0;
    if (token.re.test(rest)) {
      sides.add(token.side);
      token.re.lastIndex = 0;
      rest = rest.replace(token.re, "$1 ");
    }
  }
  const side = sides.size === 1 ? [...sides][0]! : sides.size === 0 ? (ABSENT[axis] ?? null) : null;
  return { side, rest: tidy(rest) };
}

/** The one axis two names differ on, with each name's side, or null when they aren't siblings. */
export function siblingAxis(a: string, b: string): { axis: Axis; sideA: string; sideB: string } | null {
  if (normaliseName(a) === normaliseName(b)) return null;
  for (const axis of AXES) {
    const ra = readAxis(a, axis);
    const rb = readAxis(b, axis);
    if (ra.side && rb.side && ra.side !== rb.side && ra.rest === rb.rest) return { axis, sideA: ra.side, sideB: rb.side };
  }
  return null;
}
