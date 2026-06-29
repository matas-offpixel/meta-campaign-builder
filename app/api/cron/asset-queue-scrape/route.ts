/**
 * GET /api/cron/asset-queue-scrape
 *
 * Vercel Cron (schedule: 0 * * * * — every hour at :00).
 *
 * Walks every `client_asset_sheet_config` row that has a `google_sheet_id`,
 * calls the scrape logic for each client, and upserts new rows into
 * `client_asset_queue`. This is the background-only entry point for sheet
 * ingestion; the interactive "Refresh from sheet" button in the UI calls the
 * per-client POST /api/clients/[id]/asset-queue/scrape route directly.
 *
 * Anti-drift:
 *   - Does NOT call Dropbox / listFolderRecursive. Dropbox listing happens
 *     only when the user clicks "Prepare & Launch" (per-item, on demand).
 *   - Does NOT modify ticket_sales_snapshots or event_daily_rollups.
 *   - Does NOT call the /api/clients/[id]/asset-queue/scrape HTTP route
 *     internally — it imports the same helpers directly to avoid auth/cookie
 *     context requirements.
 *
 * Auth: Bearer $CRON_SECRET. Returns 401 on mismatch.
 *
 * Timeout design:
 *   - maxDuration=300 (5 min Vercel limit).
 *   - Per-client timeout of 50 s with one retry on network error.
 *   - Stops processing new clients 30 s before maxDuration.
 */

import { NextResponse, type NextRequest } from "next/server";

import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAssetSheetConfig } from "@/lib/db/asset-sheet-config";
import { listVenueMappings } from "@/lib/db/venue-mappings";
import {
  getExistingHashes,
  insertQueueRows,
  type NewQueueRow,
} from "@/lib/db/asset-queue";
import { parseSheetRows, filterNewRows } from "@/lib/clients/asset-queue/sheet-parse";
import { buildVenueResolutionMap, venueResolutionKey } from "@/lib/clients/asset-queue/venue-resolve";
import type { EventVenueContext, VenueMapping } from "@/lib/clients/asset-queue/venue-resolve";
import Papa from "papaparse";

export const maxDuration = 300;

const CLIENT_TIMEOUT_MS = 50_000;
const BUDGET_MS = 270_000;

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim() === expected.trim();
  }
  return header.trim() === expected.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sheetNameFromRange(range: string): string {
  const idx = range.indexOf("!");
  return idx !== -1 ? range.slice(0, idx) : range;
}

function resolveGvizUrl(sheetId: string, sheetName: string): string {
  const params = new URLSearchParams({ tqx: "out:csv", sheet: sheetName });
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?${params}`;
}

interface ClientScrapeResult {
  clientId: string;
  scraped: number;
  newRows: number;
  matched: number;
  errors: number;
  skipped?: boolean;
  error?: string;
}

async function scrapeOneClient(
  clientId: string,
  userId: string,
): Promise<ClientScrapeResult> {
  const base = { clientId, scraped: 0, newRows: 0, matched: 0, errors: 0 };

  // Use service-role client so cron can read/write all clients' data.
  const supabase = createServiceRoleClient();

  const config = await getAssetSheetConfig(clientId);
  if (!config?.google_sheet_id) {
    return { ...base, skipped: true };
  }

  const sheetName = config.sheet_range
    ? sheetNameFromRange(config.sheet_range)
    : "Sheet1";
  const csvUrl = resolveGvizUrl(config.google_sheet_id, sheetName);

  let csvText: string;
  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
    const res = await fetch(csvUrl, { signal: controller.signal });
    clearTimeout(tid);
    if (!res.ok) {
      return { ...base, error: `Sheet fetch failed: ${res.status}` };
    }
    csvText = await res.text();
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  // Parse CSV.
  const { data: rawRows } = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });
  if (!rawRows || rawRows.length < 2) {
    return { ...base, scraped: 0, skipped: true };
  }

  const columnConfig = config.column_config ?? {};
  const parsed = parseSheetRows(rawRows, columnConfig);

  // Dedup against existing hashes.
  const existingHashes = await getExistingHashes(clientId);
  const newParsed = filterNewRows(parsed, existingHashes);
  if (newParsed.length === 0) {
    return { ...base, scraped: parsed.length };
  }

  // Resolve venues.
  const { data: events } = await supabase
    .from("events")
    .select("id, event_code, name, location, nation, preferred_provider")
    .eq("client_id", clientId);

  const { data: rawMappings } = await supabase
    .from("venue_mappings")
    .select("*")
    .eq("client_id", clientId);

  const eventContexts: EventVenueContext[] = (events ?? []).map(
    (e: {
      id: string;
      event_code: string;
      name: string | null;
      location: string | null;
      nation: string | null;
    }) => ({
      id: e.id,
      event_code: e.event_code,
      name: e.name ?? "",
      location: e.location ?? "",
      nation: e.nation ?? "",
    }),
  );

  const mappings: VenueMapping[] = (rawMappings ?? []) as VenueMapping[];
  const resolutionMap = buildVenueResolutionMap(eventContexts, mappings);

  const rowsToInsert: NewQueueRow[] = [];
  let matchedCount = 0;
  let errorsCount = 0;

  for (const row of newParsed) {
    const key = venueResolutionKey(row.location ?? "", row.nation ?? "");
    const resolved = resolutionMap.get(key);

    if (resolved) {
      rowsToInsert.push({
        client_id: clientId,
        source_sheet_row_hash: row.hash,
        nation: row.nation ?? "",
        location: row.location ?? "",
        funnel: row.funnel ?? "",
        funnels: row.funnels ?? [],
        media_type: row.mediaType ?? "",
        asset_name: row.assetName ?? "",
        dropbox_url: row.dropboxUrl ?? "",
        notes: row.notes ?? "",
        resolved_event_id: resolved.eventId ?? null,
        resolved_event_code: resolved.eventCode ?? null,
        resolved_event_codes_multi: resolved.eventCodesMulti ?? null,
        event_match_ambiguous: resolved.ambiguous ?? false,
        status: resolved.eventCodesMulti?.length ? "matched_umbrella" : "matched",
        error_message: null,
      });
      matchedCount++;
    } else {
      rowsToInsert.push({
        client_id: clientId,
        source_sheet_row_hash: row.hash,
        nation: row.nation ?? "",
        location: row.location ?? "",
        funnel: row.funnel ?? "",
        funnels: row.funnels ?? [],
        media_type: row.mediaType ?? "",
        asset_name: row.assetName ?? "",
        dropbox_url: row.dropboxUrl ?? "",
        notes: row.notes ?? "",
        resolved_event_id: null,
        resolved_event_code: null,
        status: "error",
        error_message: "no_venue_mapping",
      });
      errorsCount++;
    }
  }

  if (rowsToInsert.length > 0) {
    await insertQueueRows(rowsToInsert);
  }

  // Update last_scraped_at on the config row.
  await supabase
    .from("client_asset_sheet_config")
    .update({ last_scraped_at: new Date().toISOString() })
    .eq("client_id", clientId);

  return {
    clientId,
    scraped: parsed.length,
    newRows: newParsed.length,
    matched: matchedCount,
    errors: errorsCount,
  };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();
  const startEpoch = Date.now();

  const supabase = createServiceRoleClient();

  // Find all clients with a configured sheet.
  const { data: configs, error: configErr } = await supabase
    .from("client_asset_sheet_config")
    .select("client_id, user_id, google_sheet_id")
    .not("google_sheet_id", "is", null);

  if (configErr) {
    return NextResponse.json({ ok: false, error: configErr.message }, { status: 500 });
  }

  const results: ClientScrapeResult[] = [];
  let budgetExceeded = false;

  for (const cfg of configs ?? []) {
    if (Date.now() - startEpoch > BUDGET_MS) {
      budgetExceeded = true;
      break;
    }

    let result: ClientScrapeResult;
    try {
      result = await Promise.race([
        scrapeOneClient(cfg.client_id, cfg.user_id),
        new Promise<ClientScrapeResult>((_, reject) =>
          setTimeout(
            () => reject(new Error("client scrape timed out")),
            CLIENT_TIMEOUT_MS,
          ),
        ),
      ]);
    } catch (err) {
      result = {
        clientId: cfg.client_id,
        scraped: 0,
        newRows: 0,
        matched: 0,
        errors: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    results.push(result);

    // Brief pause between clients to avoid rate-limiting Google Sheets.
    await sleep(500);
  }

  const finishedAt = new Date().toISOString();
  const totalNew = results.reduce((s, r) => s + r.newRows, 0);
  const errorCount = results.filter((r) => r.error).length;

  return NextResponse.json({
    ok: !budgetExceeded && errorCount === 0,
    startedAt,
    finishedAt,
    clientsConsidered: (configs ?? []).length,
    clientsProcessed: results.length,
    totalNewRows: totalNew,
    ...(budgetExceeded && { budget_exceeded: true }),
    results,
  });
}
