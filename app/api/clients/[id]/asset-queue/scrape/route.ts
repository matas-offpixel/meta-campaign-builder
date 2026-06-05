/**
 * POST /api/clients/[id]/asset-queue/scrape
 *
 * Reads the client's configured Google Sheet, parses rows, deduplicates against
 * the existing queue, resolves venues to events, and inserts new queue rows.
 *
 * Returns:
 *   { scraped, new: newCount, matched, errors, errorDetails }
 *
 * Credentials: Google service account via env vars — NEVER logged, NEVER returned.
 * maxDuration = 60 (Vercel Serverless)
 */

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";
import { getAssetSheetConfig, touchLastScrapedAt } from "@/lib/db/asset-sheet-config";
import { listVenueMappings } from "@/lib/db/venue-mappings";
import { getExistingHashes, insertQueueRows, type NewQueueRow } from "@/lib/db/asset-queue";
import { parseSheetRows, filterNewRows } from "@/lib/clients/asset-queue/sheet-parse";
import { buildVenueResolutionMap } from "@/lib/clients/asset-queue/venue-resolve";
import type { VenueMapping } from "@/lib/clients/asset-queue/venue-resolve";

export const maxDuration = 60;

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

  // ── Google Sheets auth ────────────────────────────────────────────────────
  const serviceAccountEmail = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!serviceAccountEmail || !privateKey) {
    console.error("[asset-queue/scrape] Missing Google service account env vars");
    return NextResponse.json(
      { error: "Google Sheets integration is not configured on the server." },
      { status: 500 },
    );
  }

  let rawRows: unknown[][];
  try {
    const auth = new google.auth.JWT({
      email: serviceAccountEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google_sheet_id,
      range: config.sheet_range,
    });
    rawRows = (res.data.values ?? []) as unknown[][];
  } catch (err) {
    // Do not leak sheet ID or credentials in error messages
    console.error("[asset-queue/scrape] Google Sheets fetch failed", {
      clientId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "Failed to read the Google Sheet. Check that the service account has access." },
      { status: 502 },
    );
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
