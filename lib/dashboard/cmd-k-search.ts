export interface CmdKClientResult {
  kind: "client";
  id: string;
  name: string;
  slug: string | null;
  type: string | null;
  href: string;
}

export interface CmdKEventResult {
  kind: "event";
  id: string;
  name: string;
  slug: string | null;
  event_code: string | null;
  venue_name: string | null;
  venue_city: string | null;
  client_id: string | null;
  client_name: string | null;
  event_date: string | null;
  status: string | null;
  href: string;
}

export interface CmdKSearchIndex {
  clients: CmdKClientResult[];
  events: CmdKEventResult[];
}

export type CmdKSearchResult = CmdKClientResult | CmdKEventResult;

export interface RankedCmdKSearchResult {
  item: CmdKSearchResult;
  score: number;
}

export function searchCmdKIndex(
  index: CmdKSearchIndex,
  query: string,
  limit = 10,
): RankedCmdKSearchResult[] {
  const q = normalise(query);
  const clients = [...index.clients].sort((a, b) => a.name.localeCompare(b.name));
  const events = [...index.events].sort((a, b) => {
    const dateCmp = (b.event_date ?? "").localeCompare(a.event_date ?? "");
    return dateCmp || a.name.localeCompare(b.name);
  });

  if (!q) {
    return [...clients, ...events].slice(0, limit).map((item, idx) => ({
      item,
      score: 1_000 - idx,
    }));
  }

  const ranked: RankedCmdKSearchResult[] = [];
  for (const item of [...clients, ...events]) {
    const score = scoreItem(item, q);
    if (score > 0) ranked.push({ item, score });
  }
  return ranked
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}

export function highlightMatch(text: string, query: string): Array<{
  text: string;
  match: boolean;
}> {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return [{ text, match: false }];
  return [
    { text: text.slice(0, idx), match: false },
    { text: text.slice(idx, idx + q.length), match: true },
    { text: text.slice(idx + q.length), match: false },
  ].filter((part) => part.text.length > 0);
}

function scoreItem(item: CmdKSearchResult, query: string): number {
  const fields = fieldsForItem(item).map(normalise).filter(Boolean);
  const tokens = query.split(" ").filter(Boolean);
  let score = 0;
  for (const field of fields) {
    if (field === query) score = Math.max(score, 120);
    if (field.startsWith(query)) score = Math.max(score, 90);
    if (field.includes(query)) score = Math.max(score, 70);
    const tokenHits = tokens.filter((token) => field.includes(token)).length;
    if (tokenHits > 0) score = Math.max(score, 35 + tokenHits * 10);
    if (isSubsequence(query, field)) score = Math.max(score, 20);
  }
  if (item.kind === "client") score += 5;
  return score;
}

function fieldsForItem(item: CmdKSearchResult): string[] {
  if (item.kind === "client") {
    return [item.name, item.slug ?? "", item.type ?? ""];
  }
  return [
    item.name,
    item.slug ?? "",
    item.event_code ?? "",
    item.venue_name ?? "",
    item.venue_city ?? "",
    item.client_name ?? "",
  ];
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isSubsequence(needle: string, haystack: string): boolean {
  let j = 0;
  for (let i = 0; i < haystack.length && j < needle.length; i += 1) {
    if (haystack[i] === needle[j]) j += 1;
  }
  return j === needle.length;
}
