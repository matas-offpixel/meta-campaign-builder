/**
 * POST /api/clients/[id]/asset-queue/scrape
 *
 * Reads the client's Google Sheet via the public CSV export endpoint —
 * no service-account credentials required. The sheet must be set to
 * "Anyone with link can view" in Google Sheets sharing.
 *
 * CSV export URL shape:
 *   https://docs.google.com/spreadsheets/d/{sheetId}/gviz/tq?tqx=out:csv&sheet={sheetName}
 *
 * Returns:
 *   { scraped, new: newCount, matched, errors, errorDetails }
 *
 * maxDuration = 60 (Vercel Serverless)
 */

import { NextRequest, NextResponse } from "next/server";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/server";
import { getAssetSheetConfig, touchLastScrapedAt } from "@/lib/db/asset-sheet-config";
import { listVenueMappings } from "@/lib/db/venue-mappings";
import { getExistingHashes, insertQueueRows, type NewQueueRow } from "@/lib/db/asset-queue";
import { parseSheetRows, filterNewRows } from "@/lib/clients/asset-queue/sheet-parse";
import { buildVenueResolutionMap } from "@/lib/clients/asset-queue/venue-resolve";
import type { VenueMapping } from "@/lib/clients/asset-queue/venue-resolve";

export const maxDuration = 60;

/** Extract the tab name from a range string like "Assets!A:G" → "Assets". */
function sheetNameFromRange(range: string): string {
  const bang = range.indexOf("!");
  return bang >= 0 ? range.slice(0, bang) : range;
}

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params;

  // ── Auth ──────────────────────────────────────────────────────────────────
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: client } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (client.user_id !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // ── Config ────────────────────────────────────────────────────────────────
  const config = await getAssetSheetConfig(clientId);
  if (!config) {
    return NextResponse.json(
      { error: "No sheet config found. Set up the asset queue first." },
      { status: 400 },
    );
  }

  // ── Fetch CSV from Google Sheets public export ────────────────────────────
  const sheetName = sheetNameFromRange(config.sheet_range);
  const csvUrl = `https://docs.google.com/spreadsheets/d/${config.google_sheet_id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;

  let csvText: string;
  try {
    const res = await fetch(csvUrl, {
      headers: { "User-Agent": "4thefans-asset-queue/1.0" },
      redirect: "follow",
    });

    if (!res.ok) {
      console.error("[asset-queue/scrape] Google Sheets fetch returned non-200", {
        clientId,
        status: res.status,
      });
      return NextResponse.json(
        {
          error:
            "Failed to read sheet. Make sure it's set to 'Anyone with link can view' in Google Sheets sharing.",
        },
        { status: 502 },
      );
    }

    csvText = await res.text();
  } catch (err) {
    console.error("[asset-queue/scrape] Google Sheets fetch threw", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      {
        error:
          "Failed to read sheet. Make sure it's set to 'Anyone with link can view' in Google Sheets sharing.",
      },
      { status: 502 },
    );
  }

  // ── Parse CSV → row arrays ────────────────────────────────────────────────
  let rawRows: unknown[][];
  try {
    const parsed = Papa.parse<string[]>(csvText, {
      header: false,
      skipEmptyLines: true,
    });
    rawRows = parsed.data as unknown[][];
  } catch (err) {
    console.error("[asset-queue/scrape] CSV parse failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json({ error: "Failed to parse sheet CSV." }, { status: 502 });
  }

  // ── Parse + dedup ─────────────────────────────────────────────────────────
  const parsed = parseSheetRows(clientId, rawRows);
  const scraped = parsed.length;

  const knownHashes = await getExistingHashes(clientId);
  const newRows = filterNewRows(parsed, knownHashes);
  const newCount = newRows.length;

  if (newCount === 0) {
    await touchLastScrapedAt(clientId);
    return NextResponse.json({ scraped, new: 0, matched: 0, errors: 0, errorDetails: [] });
  }

  // ── Venue resolution ──────────────────────────────────────────────────────
  const dbMappings = await listVenueMappings(clientId);
  const typedMappings: VenueMapping[] = dbMappings.map((m) => ({
    id: m.id,
    clientId: m.client_id,
    sheetLabel: m.sheet_label,
    eventCode: m.event_code,
    nationLabel: m.nation_label,
  }));

  const locations = newRows.map((r) => r.location);
  const resolutionMap = buildVenueResolutionMap(locations, typedMappings);

  // Fetch resolved event IDs in one query
  const resolvedEventCodes = [...new Set(
    [...resolutionMap.values()]
      .filter(Boolean)
      .map((v) => v!.eventCode),
  )];

  const eventCodeToId = new Map<string, string>();
  if (resolvedEventCodes.length > 0) {
    const { data: events } = await supabase
      .from("events")
      .select("id, event_code")
      .in("event_code", resolvedEventCodes);
    for (const e of events ?? []) {
      eventCodeToId.set(e.event_code, e.id);
    }
  }

  // ── Build DB rows ─────────────────────────────────────────────────────────
  const toInsert: NewQueueRow[] = [];
  const errorDetails: Array<{ assetName: string; location: string; reason: string }> = [];

  for (const row of newRows) {
    const resolved = resolutionMap.get(row.location);

    if (!resolved) {
      toInsert.push({
        client_id: clientId,
        source_sheet_row_hash: row.rowHash,
        nation: row.nation,
        location: row.location,
        funnel: row.funnel,
        media_type: row.mediaType,
        asset_name: row.assetName,
        dropbox_url: row.dropboxUrl,
        notes: row.notes,
        resolved_event_id: null,
        resolved_event_code: null,
        status: "error",
        error_message: "no_venue_mapping",
      });
      errorDetails.push({
        assetName: row.assetName,
        location: row.location,
        reason: "no_venue_mapping",
      });
    } else {
      const eventId = eventCodeToId.get(resolved.eventCode) ?? null;
      toInsert.push({
        client_id: clientId,
        source_sheet_row_hash: row.rowHash,
        nation: row.nation,
        location: row.location,
        funnel: row.funnel,
        media_type: row.mediaType,
        asset_name: row.assetName,
        dropbox_url: row.dropboxUrl,
        notes: row.notes,
        resolved_event_id: eventId,
        resolved_event_code: resolved.eventCode,
        status: "matched",
        error_message: null,
      });
    }
  }

  await insertQueueRows(toInsert);
  await touchLastScrapedAt(clientId);

  const matched = toInsert.filter((r) => r.status === "matched").length;
  const errors = toInsert.filter((r) => r.status === "error").length;

  console.error("[asset-queue/scrape] complete", {
    clientId,
    scraped,
    new: newCount,
    matched,
    errors,
  });

  return NextResponse.json({ scraped, new: newCount, matched, errors, errorDetails });
}
