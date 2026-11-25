/**
 * An event code never breaks across lines (design, #1361 at 393: "NX27-" /
 * "GLITTERBOX"): the line wraps before it instead. This splits a launch
 * check's text into the codes and the words around them, so the panel can
 * set each code nowrap. A code here is capitals and digits joined by
 * hyphens or underscores, with a digit and a letter in it ("NX27-GLITTERBOX",
 * "EBR27-GLITTERBOX", "P26-BDAY"). Links are lower case and still break.
 */
const CODE = /[A-Z0-9]+(?:[-_][A-Z0-9]+)+/g;

export interface CodeSpan {
  text: string;
  code: boolean;
}

export function codeSpans(text: string): CodeSpan[] {
  const spans: CodeSpan[] = [];
  let last = 0;
  for (const match of text.matchAll(CODE)) {
    const value = match[0];
    if (!/\d/.test(value) || !/[A-Z]/.test(value)) continue;
    const at = match.index;
    if (at > last) spans.push({ text: text.slice(last, at), code: false });
    spans.push({ text: value, code: true });
    last = at + value.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), code: false });
  return spans;
}
