/**
 * The draft report's "Every crop and arrangement tried" section (O65 / H65):
 * one heading per draft, and under it one line per crop × arrangement with
 * both face figures (the top / claim share and the longest run) and what
 * happened next. Each heading is a real heading with a blank line before its
 * list, so no Markdown viewer folds the list into it (#1174 fix round 1).
 */

export const TRIED_HEADING = "## Every crop and arrangement tried (O65)";

export type TriedEntry = { heading: string; lines: readonly string[] };

/** The section's lines. A draft with nothing tried (a format too small to draw) gets no heading. */
export function triedSection(entries: readonly TriedEntry[]): string[] {
  const out = [TRIED_HEADING, ""];
  for (const e of entries) {
    if (!e.lines.length) continue;
    out.push(`### ${e.heading}`, "", ...e.lines.map((l) => `- ${l}`), "");
  }
  return out;
}

/**
 * The headings in a report's tried section with no line under them, in
 * either the "### heading" or the older "**heading**" form. Empty when the
 * section is whole; the draft scripts refuse to write a report otherwise.
 */
export function emptyTriedHeadings(markdown: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === TRIED_HEADING);
  if (start < 0) return [];
  const empty: string[] = [];
  let current: string | null = null;
  let count = 0;
  const close = () => {
    if (current != null && count === 0) empty.push(current);
  };
  for (let i = start + 1; i < lines.length; i += 1) {
    const l = lines[i]!.trim();
    if (/^##\s/.test(l)) break;
    const h = /^###\s+(.+)$/.exec(l) ?? /^\*\*(.+)\*\*$/.exec(l);
    if (h) {
      close();
      current = h[1]!;
      count = 0;
    } else if (/^- \S/.test(l) && current != null) count += 1;
  }
  close();
  return empty;
}
