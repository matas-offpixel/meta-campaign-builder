import "server-only";

import * as XLSX from "xlsx";

import { extractOpponentName } from "@/lib/db/event-opponent-extraction";

/**
 * lib/dashboard/master-allocations-parser.ts
 *
 * Pure parser for the 4thefans MASTER Allocations xlsx. Extracted from
 * the import route so it stays testable without spinning up a request
 * cycle. The parser walks each venue tab and yields rows shaped for
 * the upsert paths in `lib/db/tier-channels.ts`.
 *
 * The xlsx is split into a left (allocation) half and a right (sold)
 * half per event. Halves are detected by walking the header row and
 * looking for the second occurrence of the literal column "Price".
 * Each half then contains:
 *   - a price column (col 1 / col 9)
 *   - a "Budget Allocation" total (skipped — same as Total)
 *   - one column per channel (Venue / SeeTickets / CP / DS / 4TF / …)
 *   - a Total column (skipped at parse time)
 *   - on the sold half: a Total Remaining column (skipped)
 *
 * Brighton-specific quirk: the right-side header reads "CP Sold" but
 * the xlsx tracks SeeTickets and CP allocations separately on the
 * left. Per the import contract agreed with the operator the sold
 * column on Brighton is dropped — operators enter both SeeTickets and
 * CP sales manually after the import. The `skipSoldHalf` set captures
 * any other tabs that need the same treatment.
 */

export interface ParsedAllocationRow {
  tabName: string;
  venueKeyword: string;
  /** Lower-case opponent name as extracted from the event title row. */
  opponent: string;
  tierName: string;
  price: number | null;
  /** Map<channelName, allocationCount>. Empty when no channel had a non-null cell. */
  allocationsByChannel: Record<string, number>;
  /** Map<channelName, ticketsSold>. Empty when sold half is skipped or empty. */
  soldByChannel: Record<string, number>;
  /** Captured for downstream provenance / audit. */
  rowIndex: number;
}

export interface ParsedTab {
  tabName: string;
  venueKeyword: string;
  /** Channel names seen in the allocation half. */
  channelsSeen: Set<string>;
  rows: ParsedAllocationRow[];
}

/**
 * Tabs whose right-side "Sold" headers don't cleanly map back to the
 * allocation channels — these import allocations only, sold values
 * are entered manually.
 */
const SKIP_SOLD_HALF = new Set<string>(["Central Park (Brighton)"]);

/**
 * Maps a worksheet name to a free-text "venueKeyword" used downstream
 * to match against `events.venue_name` / `events.venue_city`. We keep
 * this stable across imports so the matcher's behaviour is auditable
 * (vs. a regex hidden in the import route).
 */
const TAB_TO_VENUE_KEYWORD: Record<string, string> = {
  "O2 Institute (Birmingham) - All": "Birmingham",
  "O2 Academy Glasgow - Allocation": "O2 Academy Glasgow",
  "Central Park (Brighton)": "Brighton",
  "Drill Shed (Margate)": "Margate",
  "Depot (Manchester)": "Manchester",
  "Shepherds Bush (London) - Alloc": "Shepherds Bush",
  "Prospect (Bristol) - Allocation": "Bristol",
  "SWG3 (Glasgow) - Allocations": "SWG3",
  "O2 (Bournemouth) - Allocations": "Bournemouth",
  "Kentish Town (London) - Allocat": "Kentish Town",
  "O2 (Leeds) - Allocations": "Leeds",
  "O2 (Newcastle) - Allocations": "Newcastle",
};

const EVENT_TITLE_RE = /\b([A-Z][\w'’\- ]*?)\s+v\s+([A-Z][\w'’\- ]*?)(?:\s|\(|$)/i;
const TOTAL_LABEL_RE = /\bTotals?\b/i;

interface HeaderColumn {
  index: number;
  /** Normalised channel name when this is a channel column; null when it's a price/total/budget/remaining cell. */
  channelName: string | null;
  /** True when this is the price column. */
  isPrice: boolean;
}

interface ParsedHeader {
  /** Channel columns + price col on the allocation (left) half. */
  allocation: { priceCol: number; channels: HeaderColumn[] };
  /** Channel columns + price col on the sold (right) half. May be null when the half is skipped. */
  sold: { priceCol: number; channels: HeaderColumn[] } | null;
}

/**
 * Parse a header row into allocation + sold halves. The two halves are
 * separated by the second occurrence of "Price" in the row.
 */
function parseHeaderRow(
  row: unknown[],
  tabName: string,
): ParsedHeader | null {
  const priceIndices: number[] = [];
  for (let i = 0; i < row.length; i++) {
    const cell = row[i];
    if (typeof cell === "string" && /\bPrice\b/i.test(cell.trim())) {
      priceIndices.push(i);
    }
  }
  if (priceIndices.length === 0) return null;
  const allocationStart = priceIndices[0];
  const soldStart = priceIndices[1] ?? null;
  const allocationEnd = soldStart ?? row.length;

  const allocationChannels = parseChannelColumns(
    row,
    allocationStart + 1,
    allocationEnd,
    /allocation/i,
  );
  const soldChannels = soldStart != null
    ? parseChannelColumns(row, soldStart + 1, row.length, /(sold|allocation)/i)
    : null;
  if (!allocationChannels) return null;

  const skipSold = SKIP_SOLD_HALF.has(tabName);

  return {
    allocation: {
      priceCol: allocationStart,
      channels: allocationChannels,
    },
    sold:
      skipSold || !soldChannels || soldStart == null
        ? null
        : {
            priceCol: soldStart,
            channels: soldChannels,
          },
  };
}

function parseChannelColumns(
  row: unknown[],
  start: number,
  end: number,
  suffixRegex: RegExp,
): HeaderColumn[] | null {
  const cols: HeaderColumn[] = [];
  for (let i = start; i < end; i++) {
    const raw = row[i];
    if (typeof raw !== "string") continue;
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (/Total|Remaining/i.test(cleaned)) continue;
    if (/^Budget\b/i.test(cleaned)) continue;
    // Strip the trailing role marker so the channel name is the
    // remaining literal — supports "Venue\nAllocation",
    // "Venue Allocation", "Venue Sold", "DS Sold", "CP\nSold",
    // "SeeTickets" (no suffix), "4TF\nAllocation", etc.
    const channelName = cleaned
      .replace(suffixRegex, "")
      .replace(/\bAllocation\b/i, "")
      .replace(/\bSold\b/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!channelName) continue;
    cols.push({ index: i, channelName, isPrice: false });
  }
  return cols.length > 0 ? cols : null;
}

interface EventSection {
  opponent: string;
  headerRowIndex: number;
  /** Inclusive index of the first tier row. */
  startRow: number;
  /** Exclusive index of the last tier row. */
  endRow: number;
}

/**
 * Walk a tab's rows top-to-bottom and produce one EventSection per
 * "Country v Country" header. Each section spans from the row after
 * the header until the next event title or the end of the tab.
 */
function locateEventSections(rows: unknown[][]): EventSection[] {
  const titles: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const c0 = rows[i]?.[0];
    if (typeof c0 !== "string") continue;
    if (EVENT_TITLE_RE.test(c0)) titles.push(i);
  }
  const sections: EventSection[] = [];
  for (let t = 0; t < titles.length; t++) {
    const titleRowIndex = titles[t];
    const titleCell = rows[titleRowIndex]?.[0];
    if (typeof titleCell !== "string") continue;
    const opponent = extractOpponentName(titleCell);
    if (!opponent) continue;
    let headerRowIndex = -1;
    const nextTitleIndex = titles[t + 1] ?? rows.length;
    for (let i = titleRowIndex + 1; i < nextTitleIndex; i++) {
      const row = rows[i] ?? [];
      const hasPrice = row.some(
        (cell) => typeof cell === "string" && /\bPrice\b/i.test(cell.trim()),
      );
      if (hasPrice) {
        headerRowIndex = i;
        break;
      }
    }
    if (headerRowIndex < 0) continue;
    sections.push({
      opponent,
      headerRowIndex,
      startRow: headerRowIndex + 1,
      endRow: nextTitleIndex,
    });
  }
  return sections;
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed.replace(/[,£$€]/g, ""));
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

export function parseTab(workbook: XLSX.WorkBook, tabName: string): ParsedTab | null {
  const ws = workbook.Sheets[tabName];
  if (!ws) return null;
  const venueKeyword = TAB_TO_VENUE_KEYWORD[tabName] ?? tabName;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });

  const sections = locateEventSections(rows);
  const channelsSeen = new Set<string>();
  const out: ParsedAllocationRow[] = [];

  for (const section of sections) {
    const headerRow = rows[section.headerRowIndex];
    if (!headerRow) continue;
    const header = parseHeaderRow(headerRow, tabName);
    if (!header) continue;

    for (const channel of header.allocation.channels) {
      channelsSeen.add(channel.channelName ?? "");
    }
    if (header.sold) {
      for (const channel of header.sold.channels) {
        channelsSeen.add(channel.channelName ?? "");
      }
    }

    for (let r = section.startRow; r < section.endRow; r++) {
      const row = rows[r];
      if (!row) continue;
      const label = row[0];
      if (typeof label !== "string") continue;
      const trimmedLabel = label.replace(/\s+/g, " ").trim();
      if (!trimmedLabel) continue;
      if (TOTAL_LABEL_RE.test(trimmedLabel)) continue;

      const allocationsByChannel: Record<string, number> = {};
      for (const channel of header.allocation.channels) {
        if (!channel.channelName) continue;
        const value = asNumber(row[channel.index]);
        if (value == null || value <= 0) continue;
        allocationsByChannel[channel.channelName] = Math.round(value);
      }
      const soldByChannel: Record<string, number> = {};
      if (header.sold) {
        for (const channel of header.sold.channels) {
          if (!channel.channelName) continue;
          const value = asNumber(row[channel.index]);
          if (value == null || value <= 0) continue;
          soldByChannel[channel.channelName] = Math.round(value);
        }
      }

      const price =
        asNumber(row[header.allocation.priceCol]) ??
        (header.sold ? asNumber(row[header.sold.priceCol]) : null);

      // Skip rows that contributed no allocation AND no sold values.
      // Those are typically blank padding rows — keeping them out
      // keeps the import idempotent and the audit log shorter.
      if (
        Object.keys(allocationsByChannel).length === 0 &&
        Object.keys(soldByChannel).length === 0
      ) {
        continue;
      }

      out.push({
        tabName,
        venueKeyword,
        opponent: section.opponent,
        tierName: trimmedLabel,
        price,
        allocationsByChannel,
        soldByChannel,
        rowIndex: r,
      });
    }
  }

  return {
    tabName,
    venueKeyword,
    channelsSeen,
    rows: out,
  };
}

export function parseWorkbook(workbook: XLSX.WorkBook): ParsedTab[] {
  const out: ParsedTab[] = [];
  for (const name of workbook.SheetNames) {
    const parsed = parseTab(workbook, name);
    if (parsed) out.push(parsed);
  }
  return out;
}
