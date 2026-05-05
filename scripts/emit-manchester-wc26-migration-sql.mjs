/**
 * Generates tier_row VALUE tuples + tier_channel allocation/sale INSERT helpers
 * for migration 078. Run:
 *   node scripts/emit-manchester-wc26-migration-sql.mjs "/path/to/MASTER Allocations.xlsx"
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

/* ----- Duplicated parser bits (see gen-manchester-wc26-seed-sql.mjs) ----- */
const EVENT_TITLE_RE =
  /\b([A-Z][\w'’\- ]*?)\s+v\s+([A-Z][\w'’\- ]*?)(?:\s|\(|$)/i;
const TOTAL_LABEL_RE = /\bTotals?\b/i;
const SKIP_SOLD_HALF = new Set(["Central Park (Brighton)"]);

function extractOpponentName(cell) {
  if (!cell) return null;
  const raw = cell.trim();
  const parts = raw.split(/\s+(?:vs?|x|-)\s+/i);
  if (parts.length < 2) return null;
  const opponentCandidate = parts[parts.length - 1]?.trim();
  return opponentCandidate?.toLowerCase() ?? null;
}

function opponentFromManchesterTitle(cell) {
  if (typeof cell !== "string") return null;
  const flat = cell.replace(/\s+/g, " ").trim();
  if (/^Last 32\b/i.test(flat)) return "last 32";
  const m = flat.match(/England\s+v\s+([A-Za-z][\w'’\- ]+)/i);
  if (m) {
    const raw = m[1].replace(/\s*\([^)]*\)\s*$/, "").trim();
    return raw.toLowerCase();
  }
  if (EVENT_TITLE_RE.test(cell)) {
    return extractOpponentName(cell.replace(/^[^:]*:\s*/m, "").trim());
  }
  return null;
}

function parseChannelColumns(row, start, end, suffixRegex) {
  const cols = [];
  for (let i = start; i < end; i++) {
    const raw = row[i];
    if (typeof raw !== "string") continue;
    const cleaned = raw.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    if (/Total|Remaining/i.test(cleaned)) continue;
    if (/^Budget\b/i.test(cleaned)) continue;
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

function parseHeaderRow(row, tabName) {
  const priceIndices = [];
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
  const soldChannels =
    soldStart != null
      ? parseChannelColumns(
          row,
          soldStart + 1,
          row.length,
          /(sold|allocation)/i,
        )
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

function locateEventSections(rows) {
  const titles = [];
  for (let i = 0; i < rows.length; i++) {
    const c0 = rows[i]?.[0];
    if (typeof c0 !== "string") continue;
    const opponent = opponentFromManchesterTitle(c0);
    if (opponent) titles.push(i);
  }
  const sections = [];
  for (let t = 0; t < titles.length; t++) {
    const titleRowIndex = titles[t];
    const titleCell = rows[titleRowIndex]?.[0];
    if (typeof titleCell !== "string") continue;
    const opponent = opponentFromManchesterTitle(titleCell);
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

function asNumber(value) {
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

function parseTab(workbook, tabName) {
  const ws = workbook.Sheets[tabName];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  });

  const sections = locateEventSections(rows);
  const out = [];

  for (const section of sections) {
    const headerRow = rows[section.headerRowIndex];
    if (!headerRow) continue;
    const header = parseHeaderRow(headerRow, tabName);
    if (!header) continue;

    for (let r = section.startRow; r < section.endRow; r++) {
      const row = rows[r];
      if (!row) continue;
      const label = row[0];
      if (typeof label !== "string") continue;
      const trimmedLabel = label.replace(/\s+/g, " ").trim();
      if (!trimmedLabel) continue;
      if (TOTAL_LABEL_RE.test(trimmedLabel)) continue;

      const allocationsByChannel = {};
      for (const channel of header.allocation.channels) {
        if (!channel.channelName) continue;
        const value = asNumber(row[channel.index]);
        if (value == null || value <= 0) continue;
        allocationsByChannel[channel.channelName] = Math.round(value);
      }
      const soldByChannel = {};
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

      if (
        Object.keys(allocationsByChannel).length === 0 &&
        Object.keys(soldByChannel).length === 0
      ) {
        continue;
      }

      out.push({
        opponent: section.opponent,
        tierName: trimmedLabel,
        price,
        allocationsByChannel,
        soldByChannel,
      });
    }
  }

  return out;
}

function sqlStr(s) {
  return "'" + String(s).replace(/'/g, "''") + "'";
}

function sumRecord(o) {
  return Object.values(o).reduce((a, b) => a + b, 0);
}

const path = process.argv[2] || "/Users/liebus/Downloads/MASTER Allocations.xlsx";
const wb = XLSX.readFile(path);
const rows = parseTab(wb, "Depot (Manchester)") ?? [];

const croatia = rows.filter((r) => r.opponent === "croatia");
const panama = rows.filter((r) => r.opponent === "panama");
const lastPartial = rows.filter((r) => r.opponent === "last 32");

/** Full Last 32 ladder: same tier names/prices as Croatia; allocations from Croatia; sold only where sheet had rows */
const last32 = [];
for (const c of croatia) {
  const partial = lastPartial.find((p) => p.tierName === c.tierName);
  last32.push({
    opponent: "last 32",
    tierName: c.tierName,
    price: c.price,
    allocationsByChannel: { ...c.allocationsByChannel },
    soldByChannel: partial ? { ...partial.soldByChannel } : {},
  });
}

function emitTierSql(label, eventVarName, tierRows) {
  console.log(`    -- ${label}: event_ticket_tiers`);
  for (const tr of tierRows) {
    const totAlloc = sumRecord(tr.allocationsByChannel);
    const totSold = sumRecord(tr.soldByChannel);
    const tfSold = tr.soldByChannel["4TF"] ?? 0;
    const remaining =
      totAlloc > 0 ? Math.max(0, totAlloc - totSold) : Math.max(0, -totSold);
    const priceSql =
      tr.price == null ? "NULL::numeric" : String(Number(tr.price));
    console.log(
      `    INSERT INTO public.event_ticket_tiers (event_id, tier_name, price, quantity_sold, quantity_available, snapshot_at)`,
    );
    console.log(
      `      VALUES (${eventVarName}, ${sqlStr(tr.tierName)}, ${priceSql}, ${tfSold}, ${remaining}, now());`,
    );
  }
}

function emitAllocSql(eventVarName, tierRows) {
  console.log(`    -- tier_channel_allocations (${eventVarName})`);
  for (const tr of tierRows) {
    for (const [ch, cnt] of Object.entries(tr.allocationsByChannel)) {
      const chLower = ch.replace(/'/g, "''");
      console.log(
        `    INSERT INTO public.tier_channel_allocations (event_id, tier_name, channel_id, allocation_count, updated_at)`,
      );
      console.log(
        `      SELECT ${eventVarName}, ${sqlStr(tr.tierName)}, tc.id, ${cnt}, now()`,
      );
      console.log(
        `      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = '${chLower}';`,
      );
    }
  }
}

function emitVenueSalesSql(eventVarName, tierRows) {
  console.log(`    -- tier_channel_sales Venue (${eventVarName})`);
  for (const tr of tierRows) {
    const v = tr.soldByChannel["Venue"];
    if (v == null || v <= 0) continue;
    const price = tr.price ?? 0;
    console.log(
      `    INSERT INTO public.tier_channel_sales (event_id, tier_name, channel_id, tickets_sold, revenue_amount, revenue_overridden, snapshot_at)`,
    );
    console.log(
      `      SELECT ${eventVarName}, ${sqlStr(tr.tierName)}, tc.id, ${v}, (${v}::numeric * ${price}::numeric), false, now()`,
    );
    console.log(
      `      FROM public.tier_channels tc WHERE tc.client_id = cid AND tc.channel_name = 'Venue';`,
    );
  }
}

emitTierSql("Croatia", "e_croatia", croatia);
emitTierSql("Panama", "e_panama", panama);
emitTierSql("Last 32", "e_last32", last32);

emitAllocSql("e_croatia", croatia);
emitAllocSql("e_panama", panama);
emitAllocSql("e_last32", last32);

emitVenueSalesSql("e_croatia", croatia);
emitVenueSalesSql("e_panama", panama);
