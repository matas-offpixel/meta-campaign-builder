/**
 * Matas's historical interest library (docs/analysis/meta-interest-targets-library.xlsx)
 * → interest_clusters rows with source 'library' (migration 183).
 *
 * Pure: the script reads the workbook and calls Meta search; this module
 * parses cells, applies the resolve rule, and builds rows. Only the
 * "… Updated" tabs are read — they are the post-deprecation prune.
 */

import { clusterEvidence, type InterestReportJson, type SeedEvidence } from "./interest-performance.ts";

export interface LibraryColumn {
  /** Tab name without " Updated", whitespace collapsed: "Festivals Venues". */
  tab: string;
  column: string;
  names: string[];
  /** "Employers: …" fragments — work_employers targeting, not interests. */
  employers: string[];
  /** A header column, or a label cell with its list in the next cell. */
  origin: "column" | "row";
}

export interface StrayCell {
  tab: string;
  cell: string;
  text: string;
}

export interface ParsedLibrary {
  columns: LibraryColumn[];
  stray: StrayCell[];
}

const UPDATED_SUFFIX = / Updated$/;

export function libraryTabName(sheetName: string): string {
  return sheetName.replace(UPDATED_SUFFIX, "").replace(/\s+/g, " ").trim();
}

function clean(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * One cell → interest names. Commas and " or " separate names; trailing
 * commas are noise. Everything from "Employers:" on is returned apart.
 */
export function splitLibraryCell(text: string): { names: string[]; employers: string[] } {
  let body = clean(text);
  let employers: string[] = [];
  const at = body.search(/employers\s*:/i);
  if (at >= 0) {
    employers = splitNames(body.slice(at).replace(/^employers\s*:/i, ""));
    body = body.slice(0, at);
  }
  return { names: splitNames(body), employers };
}

function splitNames(text: string): string[] {
  return text
    .split(/,|\s+or\s+/i)
    .map((s) => s.replace(/[\s,;.]+$/, "").trim())
    .filter(Boolean);
}

function setKey(ids: readonly string[]): string {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b)).join(",");
}

function cellRef(row: number, col: number): string {
  let n = col + 1;
  let letters = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    letters = String.fromCharCode(65 + m) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return `${letters}${row + 1}`;
}

/**
 * A header column's names are the unbroken run of cells under it. A
 * non-empty cell outside every run, without a trailing comma, whose
 * right-hand neighbour lists two or more names, is a row-labelled
 * cluster. Anything else left over is stray.
 */
export function parseLibrarySheet(sheetName: string, rows: readonly (readonly string[])[]): ParsedLibrary {
  const tab = libraryTabName(sheetName);
  const at = (r: number, c: number) => clean(String(rows[r]?.[c] ?? ""));
  const consumed = new Set<string>();
  const columns: LibraryColumn[] = [];
  const header = rows[0] ?? [];
  for (let c = 0; c < header.length; c++) {
    const column = at(0, c);
    if (!column) continue;
    consumed.add(`0:${c}`);
    const names: string[] = [];
    const employers: string[] = [];
    for (let r = 1; at(r, c); r++) {
      consumed.add(`${r}:${c}`);
      const split = splitLibraryCell(at(r, c));
      names.push(...split.names);
      employers.push(...split.employers);
    }
    columns.push({ tab, column, names, employers, origin: "column" });
  }
  const width = Math.max(0, ...rows.map((r) => r.length));
  for (let r = 1; r < rows.length; r++) {
    for (let c = 0; c + 1 < width; c++) {
      const label = at(r, c);
      const list = at(r, c + 1);
      if (!label || !list || consumed.has(`${r}:${c}`) || consumed.has(`${r}:${c + 1}`)) continue;
      if (label.endsWith(",")) continue;
      const split = splitLibraryCell(list);
      if (split.names.length < 2) continue;
      consumed.add(`${r}:${c}`);
      consumed.add(`${r}:${c + 1}`);
      columns.push({ tab, column: label, names: split.names, employers: split.employers, origin: "row" });
    }
  }
  const stray: StrayCell[] = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < width; c++) {
      const text = at(r, c);
      if (text && !consumed.has(`${r}:${c}`)) stray.push({ tab, cell: cellRef(r, c), text });
    }
  }
  return { columns, stray };
}

/** Only the "… Updated" sheets, in workbook order. */
export function parseLibraryWorkbook(sheets: readonly { name: string; rows: readonly (readonly string[])[] }[]): ParsedLibrary {
  const out: ParsedLibrary = { columns: [], stray: [] };
  for (const s of sheets) {
    if (!UPDATED_SUFFIX.test(s.name)) continue;
    const parsed = parseLibrarySheet(s.name, s.rows);
    out.columns.push(...parsed.columns);
    out.stray.push(...parsed.stray);
  }
  return out;
}

export interface SearchHit {
  id: string;
  name: string;
}

export interface Resolution {
  id: string;
  name: string;
  match: "exact" | "contains";
}

function containsWords(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "u").test(haystack);
}

/**
 * Meta search hits → one interest. Exact name match (case-insensitive)
 * anywhere in the hits; else the top hit only when its name contains the
 * query as whole words ("Graff" does not match "Graffiti"); else null.
 * Never a guess.
 */
export function resolveInterestName(query: string, hits: readonly SearchHit[]): Resolution | null {
  const q = clean(query).toLowerCase();
  if (!q) return null;
  const exact = hits.find((h) => clean(h.name).toLowerCase() === q);
  if (exact) return { id: String(exact.id), name: exact.name, match: "exact" };
  const top = hits[0];
  if (top && containsWords(clean(top.name).toLowerCase(), q)) {
    return { id: String(top.id), name: top.name, match: "contains" };
  }
  return null;
}

/** Clusters given in chat. They keep their names and replace a same-named workbook column. */
export interface LibraryChatCluster {
  name: string;
  vertical: "music" | "lifestyle";
  names: string[];
}

export interface LibrarySkip {
  tab: string | null;
  column: string;
  name?: string;
  reason: string;
  /** Names that failed to resolve, when the column had any. */
  unresolved?: string[];
}

export interface LibrarySeedRow {
  name: string;
  vertical: "music" | "lifestyle";
  interests: { id: string; name: string }[];
  evidence: SeedEvidence | null;
  /** Names Meta search did not match. */
  unresolved: string[];
  /** Where the row came from and how each name resolved. Not inserted. */
  library: {
    tab: string | null;
    column: string;
    resolved: { query: string; id: string; name: string; match: "exact" | "contains" }[];
  };
}

/**
 * Single-interest Techno, Tech house and House music: not seeded, they run
 * ~40% worse than the branded clusters on the same account (migration 182).
 */
export const NOT_SEEDED_SINGLE_INTERESTS: Readonly<Record<string, string>> = {
  "6002911345572": "Techno (music)",
  "6003075191185": "Tech house",
  "6003479860669": "House music (music)",
};

export const FREQUENT_FLYERS_COLUMN = "Frequent flyers";
export const IPHONE_COLUMN = "Latest phone users";
export const IPHONE_SEED_NAME = "Latest iPhone users";
const IPHONE_NAME = /^iphone\s*\d*\s*users$/i;

export interface BuiltLibrary {
  rows: LibrarySeedRow[];
  skipped: LibrarySkip[];
  /** Workbook columns or names folded into an existing seeded cluster. */
  mapped: { tab: string | null; column: string; name?: string; to: string }[];
}

/** Every distinct name the build will search for, in first-seen order. */
export function libraryQueries(parsed: ParsedLibrary, chat: readonly LibraryChatCluster[]): string[] {
  const out = new Map<string, string>();
  const add = (n: string) => {
    if (!IPHONE_NAME.test(n) && !out.has(n.toLowerCase())) out.set(n.toLowerCase(), n);
  };
  const chatNames = new Set(chat.map((c) => c.name.toLowerCase()));
  for (const col of parsed.columns) {
    if (col.column === FREQUENT_FLYERS_COLUMN || col.column === IPHONE_COLUMN) continue;
    if (chatNames.has(col.column.toLowerCase())) continue;
    col.names.forEach(add);
  }
  for (const c of chat) c.names.forEach(add);
  return [...out.values()];
}

/**
 * Rows for migration 183. `resolve` maps a name (as searched) to its
 * resolution or null. Evidence attaches when the row's sorted id set is a
 * report cluster key; otherwise null.
 */
export function buildLibrary(opts: {
  parsed: ParsedLibrary;
  chat: readonly LibraryChatCluster[];
  resolve: (name: string) => Resolution | null;
  report: InterestReportJson | null;
  /** Migration 182 rows: names are taken, interest sets are not repeated. */
  seeds: readonly { name: string; interestIds: readonly string[] }[];
}): BuiltLibrary {
  const rows: LibrarySeedRow[] = [];
  const skipped: LibrarySkip[] = [];
  const mapped: BuiltLibrary["mapped"] = [];
  const chatNames = new Set(opts.chat.map((c) => c.name.toLowerCase()));
  const setOwners = new Map(opts.seeds.map((s) => [setKey(s.interestIds), s.name]));

  const build = (tab: string | null, column: string, name: string, vertical: LibrarySeedRow["vertical"], names: readonly string[]) => {
    const interests: LibrarySeedRow["interests"] = [];
    const resolved: LibrarySeedRow["library"]["resolved"] = [];
    const unresolved: string[] = [];
    for (const query of names) {
      if (IPHONE_NAME.test(query)) {
        mapped.push({ tab, column, name: query, to: IPHONE_SEED_NAME });
        continue;
      }
      const hit = opts.resolve(query);
      if (!hit) {
        if (!unresolved.includes(query)) unresolved.push(query);
        continue;
      }
      resolved.push({ query, ...hit });
      if (!interests.some((i) => i.id === hit.id)) interests.push({ id: hit.id, name: hit.name });
    }
    if (!interests.length) {
      skipped.push(
        unresolved.length
          ? { tab, column, reason: "no name resolved on Meta", unresolved }
          : { tab, column, reason: "no names in the Updated tab" },
      );
      return;
    }
    const key = setKey(interests.map((i) => i.id));
    if (interests.length === 1 && NOT_SEEDED_SINGLE_INTERESTS[key]) {
      skipped.push({
        tab,
        column,
        reason: `resolves to the single-interest ${NOT_SEEDED_SINGLE_INTERESTS[key]} cluster, which is deliberately not seeded`,
        ...(unresolved.length ? { unresolved } : {}),
      });
      return;
    }
    const same = setOwners.get(key);
    if (same) {
      skipped.push({ tab, column, reason: `same interests as ${same}`, ...(unresolved.length ? { unresolved } : {}) });
      return;
    }
    setOwners.set(key, name);
    const evidence = opts.report ? (clusterEvidence(opts.report, key)?.evidence ?? null) : null;
    rows.push({ name, vertical, interests, evidence, unresolved, library: { tab, column, resolved } });
  };

  for (const col of opts.parsed.columns) {
    for (const e of col.employers) {
      skipped.push({ tab: col.tab, column: col.column, name: `Employers: ${e}`, reason: "work_employers targeting, not an interest" });
    }
    if (col.column === FREQUENT_FLYERS_COLUMN) {
      skipped.push({ tab: col.tab, column: col.column, reason: "a behaviour, not an interest" });
      continue;
    }
    if (col.column === IPHONE_COLUMN) {
      mapped.push({ tab: col.tab, column: col.column, to: IPHONE_SEED_NAME });
      continue;
    }
    if (chatNames.has(col.column.toLowerCase())) {
      skipped.push({ tab: col.tab, column: col.column, reason: "replaced by the list given in chat" });
      continue;
    }
    build(col.tab, col.column, `${col.tab} — ${col.column}`, "music", col.names);
  }
  for (const c of opts.chat) build(null, c.name, c.name, c.vertical, c.names);

  const taken = new Set(opts.seeds.map((s) => s.name.toLowerCase()));
  for (const r of rows) {
    const k = r.name.toLowerCase();
    if (taken.has(k)) throw new Error(`Library cluster name collides: ${r.name}`);
    taken.add(k);
  }
  return { rows, skipped, mapped };
}

/** Unresolved names across imported and not-imported clusters. */
export function countUnresolved(built: BuiltLibrary): number {
  return (
    built.rows.reduce((n, r) => n + r.unresolved.length, 0) +
    built.skipped.reduce((n, s) => n + (s.unresolved?.length ?? 0), 0)
  );
}

/** docs/analysis/interest-library-unresolved.md */
export function renderLibraryUnresolved(
  built: BuiltLibrary,
  stray: readonly StrayCell[],
  source: string,
  /** Meta's top hit for an unresolved name, shown for review only. */
  topHit: (name: string) => string | null = () => null,
): string {
  const out: string[] = [];
  out.push("# Interest library — unresolved and skipped");
  out.push("");
  out.push(
    `Source: \`${source}\` ("… Updated" tabs) plus the four lists given in chat. A name resolves only on an exact (case-insensitive) Meta \`adinterest\` match, or when the top result's name contains it. Nothing below was guessed.`,
  );
  out.push("");
  const groups = [
    ...built.rows.filter((r) => r.unresolved.length).map((r) => ({ label: r.name, names: r.unresolved })),
    ...built.skipped
      .filter((s) => s.unresolved?.length)
      .map((s) => ({ label: `${s.tab ? `${s.tab} — ` : ""}${s.column} (not imported)`, names: s.unresolved! })),
  ];
  out.push(`## Unresolved names (${countUnresolved(built)})`);
  out.push("");
  if (!groups.length) out.push("None.");
  else out.push("Meta's top search result is shown for review; it was not used.", "");
  for (const g of groups) {
    out.push(`- **${g.label}**`);
    for (const n of g.names) {
      const top = topHit(n);
      out.push(`  - ${n} — top result: ${top ? `"${top}"` : "no results"}`);
    }
  }
  out.push("");
  out.push("## Not imported");
  out.push("");
  if (!built.skipped.length) out.push("None.");
  for (const s of built.skipped) {
    out.push(`- ${s.tab ? `${s.tab} — ` : ""}${s.column}${s.name ? ` (${s.name})` : ""}: ${s.reason}`);
  }
  out.push("");
  out.push("## Mapped to an existing cluster");
  out.push("");
  if (!built.mapped.length) out.push("None.");
  for (const m of built.mapped) out.push(`- ${m.tab ? `${m.tab} — ` : ""}${m.column}${m.name ? ` (${m.name})` : ""} → ${m.to}`);
  out.push("");
  out.push("## Stray cells ignored");
  out.push("");
  if (!stray.length) out.push("None.");
  for (const s of stray) out.push(`- ${s.tab} ${s.cell}: "${s.text}"`);
  out.push("");
  return out.join("\n");
}
