/**
 * lib/internal-counts/mentions.ts
 *
 * M3: sales mentioned only in the email. One review item per sentence that
 * names a number next to "tickets", "sold" or "total", quoting the
 * sentence. Never parsed into counts: Matas confirms one as a manual entry,
 * typing the figure himself.
 *
 * A sentence is put on a show from the sheet when it (or the sentence before
 * it in the same paragraph) names that show: "On Enzo, …" → ENZO SIRAGUSA;
 * "Grand total sold for this event is 1974." follows it, so it's Enzo too.
 *
 * Only new text is read (M1b, change 3): lines starting ">" are skipped,
 * and so is everything below "On … wrote:". A reply's quoted original
 * (an Outlook "From: / Sent: / To: / Subject:" block) is skipped too; a
 * forward's original body is read once, its header block left out. The
 * caller keeps one item per sentence per count date (`mentionKey`), so a
 * "Grand total sold…" quoted down a thread never comes back.
 */

export interface SaleMention {
  sentence: string;
  /** The sheet's show name the sentence is about, or null. */
  showName: string | null;
}

const KEYWORD = /\b(tickets?|sold|total)\b/i;
const NUMBER = /\d/;

function sentences(paragraph: string): string[] {
  return paragraph
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?])\s+(?=["'“(]?[A-Z0-9£])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The show a sentence names: every word of the sheet name is a prefix of a word in the sentence, in order of the name. */
function showNamed(sentence: string, showNames: readonly string[]): string | null {
  const sw = words(sentence);
  let best: { name: string; score: number } | null = null;
  for (const name of showNames) {
    const nw = words(name);
    if (nw.length === 0) continue;
    const first = sw.indexOf(nw[0]);
    const firstHit = first >= 0 || sw.some((w) => w.startsWith(nw[0]) && nw[0].length >= 4);
    if (!firstHit) continue;
    const rest = nw.slice(1).filter((n) => sw.some((w) => w.startsWith(n) || n.startsWith(w)));
    const score = 1 + rest.length;
    if (!best || score > best.score) best = { name, score };
  }
  return best?.name ?? null;
}

const WROTE = /^On [^\n]*(?:\n[^\n]*)?wrote:\s*$/m;
const HEADER_START = /^(?:_{5,}|-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}|From:\s)/m;
const HEADER_LINE = /^(?:From|Sent|Date|To|Cc|Subject):\s/;

/** The text an email adds: no quoted lines, nothing below "On … wrote:", and a forward's original without its header. */
export function newText(body: string, opts: { forward: boolean }): string {
  let text = body.replace(/\r\n/g, "\n");
  const wrote = text.match(WROTE);
  if (wrote?.index !== undefined) text = text.slice(0, wrote.index);
  text = text
    .split("\n")
    .filter((line) => !line.trimStart().startsWith(">"))
    .join("\n");
  const header = text.match(HEADER_START);
  if (header?.index === undefined) return text.trim();
  const own = text.slice(0, header.index);
  if (!opts.forward) return own.trim();
  // A forward: keep the original body under the header block, up to the next header (older history).
  const lines = text.slice(header.index).split("\n");
  let i = /^(?:_{5,}|-{2,})/.test(lines[0]) ? 1 : 0;
  while (i < lines.length && (HEADER_LINE.test(lines[i]) || lines[i].trim() === "")) i++;
  const rest = lines.slice(i).join("\n");
  const next = rest.match(HEADER_START);
  const original = next?.index !== undefined ? rest.slice(0, next.index) : rest;
  return `${own}\n\n${original}`.trim();
}

/** One item per sentence per count date. */
export function mentionKey(sentence: string, countDate: string | null): string {
  return `${countDate ?? ""}\u0000${sentence.replace(/\s+/g, " ").trim().toLowerCase()}`;
}

export function saleMentions(body: string, showNames: readonly string[], opts: { forward?: boolean } = {}): SaleMention[] {
  const out: SaleMention[] = [];
  for (const paragraph of newText(body, { forward: opts.forward ?? false }).split(/\n\s*\n/)) {
    let lastShow: string | null = null;
    for (const sentence of sentences(paragraph)) {
      const named = showNamed(sentence, showNames);
      if (named) lastShow = named;
      if (KEYWORD.test(sentence) && NUMBER.test(sentence)) {
        out.push({ sentence, showName: named ?? lastShow });
      }
    }
  }
  return out;
}
