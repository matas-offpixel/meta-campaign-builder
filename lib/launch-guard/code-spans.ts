/**
 * Some values in a launch check never break across lines (design, #1361 at
 * 393); the line wraps before them instead:
 * - an event code: "NX27-GLITTERBOX", never "NX27-" / "GLITTERBOX". Capitals
 *   and digits joined by hyphens or underscores, with a digit and a letter;
 * - a pixel ending: "(…2763)", never "(…" / "2763)";
 * - a domain: "paulvandyk-newcastle.com", never "paulvandyk-" /
 *   "newcastle.com". The domain only: a link's path may still break, so a
 *   long link can't push the card wider than the screen.
 * This splits the text into those values and the words around them, so the
 * panel can set each one nowrap.
 */
const PIXEL = String.raw`\(?…\d+\)?`;
const DOMAIN = String.raw`(?<![\w.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?![\w-])`;
const CODE = String.raw`[A-Z0-9]+(?:[-_][A-Z0-9]+)+`;
const WHOLE = new RegExp(`(${PIXEL})|(${DOMAIN})|(${CODE})`, "gi");

export interface CodeSpan {
  text: string;
  /** Kept on one line (nowrap). */
  whole: boolean;
}

function keepsWhole(match: RegExpMatchArray): boolean {
  if (match[1] || match[2]) return true;
  const value = match[3] ?? "";
  // Codes are capitals only; the regex is case-insensitive for domains.
  return value === value.toUpperCase() && /\d/.test(value) && /[A-Z]/.test(value);
}

export function codeSpans(text: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let last = 0;
  for (const match of text.matchAll(WHOLE)) {
    if (!keepsWhole(match)) continue;
    const value = match[0];
    const at = match.index;
    if (at > last) spans.push({ text: text.slice(last, at), whole: false });
    spans.push({ text: value, whole: true });
    last = at + value.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), whole: false });
  return spans;
}
