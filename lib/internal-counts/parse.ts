/**
 * lib/internal-counts/parse.ts
 *
 * Deterministic parser for Electric's "Internal Counts" PDF (D8, HD1).
 * No LLM. It reads positioned text items (pdf-text.ts), never `-layout`
 * text, because the column spacing differs between pages: each block takes
 * its own column x-positions from its own header row.
 *
 * A block, top to bottom:
 *   header       show name · tier names… · TOTAL · SINCE LAST COUNT
 *   price row    £ per tier ("-£1.00" = unused tier)
 *   outlet rows  SKIDDLE · UNIVERSE · FATSOMA · DICE · SEE · GIGANTIC · RA · FIXR
 *   totals row   per-tier column totals, TOTAL, SINCE LAST COUNT
 *   TIER TOTALS  £ per tier, £ total, count date
 *
 * A blank cell is "no sales in that outlet" and parses as null; a printed 0
 * is a real 0. Tier names repeat ("Final" twice), so a tier's key is its
 * column position plus its name. This module only reads the layout; the
 * arithmetic checks live in checks.ts.
 */

import { COMP_TIER_NAME } from "../event-config/allocation.ts";
import type { PdfTextItem } from "./pdf-text.ts";

export const OUTLETS = ["SKIDDLE", "UNIVERSE", "FATSOMA", "DICE", "SEE", "GIGANTIC", "RA", "FIXR"] as const;

export interface ParsedTier {
  /** 1-based column position inside the block. */
  position: number;
  /** As printed in the header; "" for a column with no header text. */
  name: string;
  /** `${position}:${name}` — unique within a block. */
  key: string;
  /** Price in pence as printed; null when the price cell is blank. */
  pricePence: number | null;
  /** Price printed as "-£1.00": the tier isn't in use. */
  unused: boolean;
  /** Guest list or comps, by name. Never counts as sold. */
  comp: boolean;
}

export interface ParsedRow {
  /** One entry per tier, in tier order. */
  cells: Array<number | null>;
  total: number | null;
  sinceLast: number | null;
}

export interface ParsedOutletRow extends ParsedRow {
  outlet: string;
}

export interface ParsedBlock {
  index: number;
  page: number;
  showName: string;
  tiers: ParsedTier[];
  outlets: ParsedOutletRow[];
  totals: ParsedRow | null;
  /** £ per tier in pence, in tier order. */
  tierRevenuePence: Array<number | null>;
  totalRevenuePence: number | null;
  /** As printed, e.g. "12/11/26" or "12/11/2026". */
  countDateText: string | null;
  /** ISO yyyy-mm-dd, or null when it doesn't parse. */
  countDate: string | null;
  /** Layout problems. Any problem sends the block to review. */
  problems: string[];
}

export interface ParsedSheet {
  blocks: ParsedBlock[];
  /** Problems outside any block (e.g. no header found). */
  problems: string[];
}

const ROW_Y_TOLERANCE = 1.5;
const SHOW_NAME_Y_TOLERANCE = 4;
/** A value further than this from every header column starts a new column. */
const NEW_COLUMN_DISTANCE = 18;

interface Cell {
  x: number;
  width: number;
  str: string;
  get center(): number;
}

interface Row {
  page: number;
  y: number;
  cells: Cell[];
}

/** Guest list, comps and free tiers: the one regex, shared with #1218 (lib/event-config/allocation.ts). */
export function isCompTierName(name: string): boolean {
  return COMP_TIER_NAME.test(name);
}

export function parseMoneyPence(s: string): number | null {
  const m = s.replace(/\s+/g, "").match(/^(-)?£(-)?([\d,]+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const pounds = Number(m[3].replace(/,/g, ""));
  const pence = m[4] ? Number(m[4].padEnd(2, "0")) : 0;
  const sign = m[1] || m[2] ? -1 : 1;
  return sign * (pounds * 100 + pence);
}

export function parseCount(s: string): number | null {
  if (!/^-?\d{1,3}(,\d{3})*$|^-?\d+$/.test(s)) return null;
  return Number(s.replace(/,/g, ""));
}

/** "12/11/26" or "12/11/2026" → "2026-11-12". */
export function parseSheetDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function isValueText(s: string): boolean {
  return parseMoneyPence(s) !== null || parseCount(s) !== null || parseSheetDate(s) !== null;
}

function makeCell(x: number, width: number, str: string): Cell {
  return {
    x,
    width,
    str,
    get center() {
      return this.x + this.width / 2;
    },
  };
}

/** Group items into rows per page, top to bottom, merging split words. */
export function groupRows(items: PdfTextItem[]): Row[] {
  const pages = [...new Set(items.map((i) => i.page))].sort((a, b) => a - b);
  const rows: Row[] = [];
  for (const page of pages) {
    const onPage = items.filter((i) => i.page === page).sort((a, b) => b.y - a.y || a.x - b.x);
    let current: { y: number; items: PdfTextItem[] } | null = null;
    for (const item of onPage) {
      if (!current || Math.abs(current.y - item.y) > ROW_Y_TOLERANCE) {
        current = { y: item.y, items: [] };
        rows.push({ page, y: item.y, cells: [] });
      }
      current.items.push(item);
      rows[rows.length - 1].cells = mergeWords(current.items);
    }
  }
  return rows;
}

function mergeWords(items: PdfTextItem[]): Cell[] {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  const out: Cell[] = [];
  for (const it of sorted) {
    const prev = out[out.length - 1];
    const gap = prev ? it.x - (prev.x + prev.width) : Infinity;
    if (prev && gap < 4 && !isValueText(prev.str) && !isValueText(it.str)) {
      prev.str = `${prev.str} ${it.str}`;
      prev.width = it.x + it.width - prev.x;
    } else {
      out.push(makeCell(it.x, it.width, it.str));
    }
  }
  return out;
}

function isHeaderRow(row: Row): boolean {
  return (
    row.cells.some((c) => /^TOTAL$/i.test(c.str)) && row.cells.some((c) => /^SINCE\s+LAST/i.test(c.str))
  );
}

export function parseInternalCountsItems(items: PdfTextItem[]): ParsedSheet {
  const rows = groupRows(items);
  const headerIdx = rows.flatMap((r, i) => (isHeaderRow(r) ? [i] : []));
  if (headerIdx.length === 0) {
    return { blocks: [], problems: ["No block header (TOTAL · SINCE LAST COUNT) found in the PDF."] };
  }
  const blocks = headerIdx.map((start, n) => {
    const end = n + 1 < headerIdx.length ? headerIdx[n + 1] : rows.length;
    return parseBlock(n, rows, start, end);
  });
  return { blocks, problems: [] };
}

interface Column {
  name: string;
  center: number;
  kind: "tier" | "total" | "since";
}

function parseBlock(index: number, rows: Row[], start: number, end: number): ParsedBlock {
  const header = rows[start];
  const body = rows.slice(start + 1, end);
  const problems: string[] = [];

  const dataLeft = Math.min(
    ...body.flatMap((r) => r.cells.filter((c) => isValueText(c.str)).map((c) => c.x)),
  );
  const totalCell = header.cells.find((c) => /^TOTAL$/i.test(c.str))!;
  const sinceCell = header.cells.find((c) => /^SINCE\s+LAST/i.test(c.str))!;

  const showName = findShowName(rows, start, end, dataLeft);
  const columns: Column[] = [
    ...header.cells
      .filter((c) => c.x + c.width >= dataLeft && c.center < totalCell.x)
      .map((c): Column => ({ name: c.str, center: c.center, kind: "tier" })),
    { name: "TOTAL", center: totalCell.center, kind: "total" },
    { name: "SINCE LAST COUNT", center: sinceCell.center, kind: "since" },
  ];
  addUnnamedColumns(columns, body, totalCell.x);
  const tierCols = columns.filter((c) => c.kind === "tier").sort((a, b) => a.center - b.center);

  const block: ParsedBlock = {
    index,
    page: header.page,
    showName,
    tiers: tierCols.map((c, i) => ({
      position: i + 1,
      name: c.name,
      key: `${i + 1}:${c.name}`,
      pricePence: null,
      unused: false,
      comp: isCompTierName(c.name),
    })),
    outlets: [],
    totals: null,
    tierRevenuePence: tierCols.map(() => null),
    totalRevenuePence: null,
    countDateText: null,
    countDate: null,
    problems,
  };
  readBody(block, body, dataLeft, tierCols, columns);
  if (!showName) problems.push("The block has no show name.");
  return block;
}

function findShowName(rows: Row[], start: number, end: number, dataLeft: number): string {
  const header = rows[start];
  const parts: Cell[] = [];
  for (let i = Math.max(0, start - 1); i < Math.min(end, start + 2); i++) {
    const r = rows[i];
    if (r.page !== header.page || Math.abs(r.y - header.y) > SHOW_NAME_Y_TOLERANCE) continue;
    parts.push(...r.cells.filter((c) => c.x + c.width < dataLeft && !isValueText(c.str)));
  }
  return parts
    .sort((a, b) => a.x - b.x)
    .map((c) => c.str)
    .join(" ")
    .trim();
}

/** Values that sit away from every header column form their own (unnamed) tier columns. */
function addUnnamedColumns(columns: Column[], body: Row[], totalLeft: number): void {
  const strays: number[] = [];
  for (const r of body) {
    for (const c of r.cells) {
      if (!isValueText(c.str) || c.center >= totalLeft) continue;
      const nearest = Math.min(...columns.map((col) => Math.abs(col.center - c.center)));
      if (nearest > NEW_COLUMN_DISTANCE) strays.push(c.center);
    }
  }
  strays.sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const x of strays) {
    const last = clusters[clusters.length - 1];
    if (last && x - last[last.length - 1] < 12) last.push(x);
    else clusters.push([x]);
  }
  for (const cl of clusters) {
    columns.push({ name: "", center: cl.reduce((a, b) => a + b, 0) / cl.length, kind: "tier" });
  }
}

function nearestColumn(columns: Column[], center: number): Column {
  let best = columns[0];
  for (const col of columns) {
    if (Math.abs(col.center - center) < Math.abs(best.center - center)) best = col;
  }
  return best;
}

function rowLabel(row: Row, dataLeft: number): string {
  return row.cells
    .filter((c) => c.x + c.width < dataLeft && !isValueText(c.str))
    .map((c) => c.str)
    .join(" ")
    .trim();
}

interface Placed {
  tier: Array<string | null>;
  total: string | null;
  since: string | null;
}

function placeValues(row: Row, dataLeft: number, tierCols: Column[], columns: Column[], problems: string[]): Placed {
  const placed: Placed = { tier: tierCols.map(() => null), total: null, since: null };
  for (const c of row.cells) {
    if (c.x + c.width < dataLeft && !isValueText(c.str)) continue;
    const col = nearestColumn(columns, c.center);
    const slot = col.kind === "tier" ? tierCols.indexOf(col) : -1;
    const prior = col.kind === "total" ? placed.total : col.kind === "since" ? placed.since : placed.tier[slot];
    if (prior !== null) problems.push(`Two values fall in one column (${col.name || "unnamed"}): ${prior} and ${c.str}.`);
    if (col.kind === "total") placed.total = c.str;
    else if (col.kind === "since") placed.since = c.str;
    else placed.tier[slot] = c.str;
  }
  return placed;
}

function countsOf(placed: Placed, problems: string[], what: string): ParsedRow {
  const toCount = (s: string | null): number | null => {
    if (s === null) return null;
    const n = parseCount(s);
    if (n === null) problems.push(`${what}: "${s}" isn't a count.`);
    return n;
  };
  return { cells: placed.tier.map(toCount), total: toCount(placed.total), sinceLast: toCount(placed.since) };
}

function readBody(block: ParsedBlock, body: Row[], dataLeft: number, tierCols: Column[], columns: Column[]): void {
  const { problems } = block;
  let sawPrice = false;
  let expectTierTotals = false;
  let done = false;
  for (const row of body) {
    if (done) break;
    const label = rowLabel(row, dataLeft);
    const hasValues = row.cells.some((c) => isValueText(c.str) && c.x + c.width >= dataLeft);
    if (/^TIER TOTALS$/i.test(label)) {
      expectTierTotals = true;
      if (!hasValues) continue;
    }
    if (!hasValues) {
      if (label && label !== block.showName) problems.push(`Unexpected row "${label}".`);
      continue;
    }
    const placed = placeValues(row, dataLeft, tierCols, columns, problems);
    if (expectTierTotals) {
      readTierTotals(block, placed);
      done = true;
    } else if (label) {
      const outlet = label.toUpperCase();
      if (!(OUTLETS as readonly string[]).includes(outlet)) problems.push(`Unknown outlet "${label}".`);
      block.outlets.push({ outlet, ...countsOf(placed, problems, outlet) });
    } else if (!sawPrice && block.outlets.length === 0) {
      sawPrice = true;
      placed.tier.forEach((s, i) => {
        const pence = s === null ? null : parseMoneyPence(s);
        if (s !== null && pence === null) problems.push(`Price "${s}" doesn't parse.`);
        block.tiers[i].pricePence = pence;
        block.tiers[i].unused = pence !== null && pence < 0;
      });
    } else if (block.totals === null && block.outlets.length > 0) {
      block.totals = countsOf(placed, problems, "Totals row");
    } else {
      problems.push("A row of values sits where no row is expected.");
    }
  }
  if (!sawPrice) problems.push("No price row.");
  if (block.outlets.length === 0) problems.push("No outlet rows.");
  if (block.totals === null) problems.push("No column totals row.");
  if (!done) problems.push("No TIER TOTALS row.");
}

function readTierTotals(block: ParsedBlock, placed: Placed): void {
  const { problems } = block;
  block.tierRevenuePence = placed.tier.map((s) => {
    if (s === null) return null;
    const p = parseMoneyPence(s);
    if (p === null) problems.push(`Tier total "${s}" doesn't parse.`);
    return p;
  });
  if (placed.total !== null) {
    block.totalRevenuePence = parseMoneyPence(placed.total);
    if (block.totalRevenuePence === null) problems.push(`£ total "${placed.total}" doesn't parse.`);
  }
  block.countDateText = placed.since;
  block.countDate = placed.since ? parseSheetDate(placed.since) : null;
  if (!block.countDate) problems.push(`Count date "${placed.since ?? ""}" doesn't parse.`);
}
