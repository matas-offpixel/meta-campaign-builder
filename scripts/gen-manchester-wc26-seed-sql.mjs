/**
 * One-off: reads MASTER Allocations.xlsx "Depot (Manchester)" tab and prints
 * tier rows for Croatia / Panama / Last 32 (same shape as master-allocations-parser).
 * Run: node scripts/gen-manchester-wc26-seed-sql.mjs /path/to/MASTER\\ Allocations.xlsx
 *
 * Used to author migration 078 seed SQL — not imported by the app.
 */

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const EVENT_TITLE_RE =
  /\b([A-Z][\w'’\- ]*?)\s+v\s+([A-Z][\w'’\- ]*?)(?:\s|\(|$)/i;
const TOTAL_LABEL_RE = /\bTotals?\b/i;
const SKIP_SOLD_HALF = new Set(["Central Park (Brighton)"]);

function normalise(name) {
  return name
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStageLabel(name) {
  if (!name) return null;
  const n = normalise(name);
  if (/\blast\s*32\b/.test(n)) return "last 32";
  if (/\blast\s*16\b/.test(n) || /\bround\s*of\s*16\b/.test(n)) {
    return "round of 16";
  }
  if (/\bquarter(?:\s*final)?\b/.test(n)) return "quarter final";
  if (/\bsemi(?:\s*final)?\b/.test(n)) return "semi final";
  if (/\bfinal\b/.test(n)) return "final";
  if (/\bknockout\b/.test(n)) return "knockout";
  return null;
}

const OPPONENT_SEPARATOR_RE = /\s+(?:vs?|x|-)\s+/i;

function extractOpponentName(eventName) {
  if (!eventName) return null;
  const raw = eventName.trim();
  if (!raw) return null;
  const stageLabel = extractStageLabel(raw);
  if (stageLabel) return stageLabel;
  const parts = raw.split(OPPONENT_SEPARATOR_RE);
  if (parts.length < 2) return null;
  const opponentCandidate = parts[parts.length - 1]?.trim();
  if (!opponentCandidate) return null;
  const opponentStageLabel = extractStageLabel(opponentCandidate);
  if (opponentStageLabel) return opponentStageLabel;
  return opponentCandidate.toLowerCase();
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

/** Match rows only — never use extractOpponentName on tier labels ("GA - …" is not a fixture). */
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

const path = process.argv[2] || "/Users/liebus/Downloads/MASTER Allocations.xlsx";
const wb = XLSX.readFile(path);
const rows = parseTab(wb, "Depot (Manchester)") ?? [];

const want = new Set(["croatia", "panama", "last 32"]);
const filtered = rows.filter((r) => want.has(r.opponent));

for (const op of ["croatia", "panama", "last 32"]) {
  const sectionRows = filtered.filter((r) => r.opponent === op);
  let venueSum = 0;
  for (const r of sectionRows) {
    venueSum += r.soldByChannel.Venue ?? 0;
  }
  console.error(`\n# ${op}: ${sectionRows.length} tier rows, Venue sold sum = ${venueSum}`);
}

console.log(JSON.stringify(filtered, null, 2));
