import { NextResponse, type NextRequest } from "next/server";

import * as XLSX from "xlsx";

import { extractOpponentName } from "@/lib/db/event-opponent-extraction";
import {
  parseWorkbook,
  type ParsedTab,
} from "@/lib/dashboard/master-allocations-parser";
import {
  ensureChannel,
  upsertTierChannelAllocation,
  upsertTierChannelSale,
} from "@/lib/db/tier-channels";
import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/4thefans-allocation-import
 *
 * Multipart upload: `file=<MASTER Allocations.xlsx>`. Optional
 * `client_id` field overrides the default 4thefans client id.
 *
 * Idempotent — every write is an UPSERT keyed on the natural triple
 * (event_id, tier_name, channel_id). Re-running with the same xlsx
 * keeps the same row count; running with newer numbers overwrites
 * the running total.
 *
 * Brighton's sold half is intentionally skipped — the xlsx column
 * "CP Sold" doesn't cleanly map to either SeeTickets or CP, and the
 * operator agreed (May 2026 import design call) to enter Brighton
 * sales manually after the import. All other tabs import both
 * allocations + sold values per matching channel column.
 *
 * Auth model: service-role only. The route is gated on the cookie-
 * bound user being signed in AND owning the supplied client. The
 * SUPABASE_ANON_KEY-bound check is handled by `createClient` (cookie
 * session) before we use service role for the actual writes.
 */

const FOURTHEFANS_CLIENT_ID = "37906506-56b7-4d58-ab62-1b042e2b561a";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UnmatchedRow {
  tab: string;
  opponent: string;
  tier: string;
  reason: string;
}

interface ImportSummary {
  ok: true;
  client_id: string;
  channels_resolved: number;
  channels_created: number;
  events_processed: number;
  tabs_processed: number;
  allocations_written: number;
  sales_written: number;
  unmatched: UnmatchedRow[];
  channel_set: string[];
}

export async function POST(req: NextRequest) {
  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "Service-role unavailable",
      },
      { status: 500 },
    );
  }

  // Cookie-auth gate: only signed-in users can drive the import. We
  // still do the writes as service role so the RLS policies on the
  // new tables can stay strict.
  const cookieClient = await (await import("@/lib/supabase/server")).createClient();
  const {
    data: { user },
  } = await cookieClient.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorised" },
      { status: 401 },
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const clientIdRaw = formData.get("client_id");
  const clientId =
    typeof clientIdRaw === "string" && clientIdRaw.length > 0
      ? clientIdRaw
      : FOURTHEFANS_CLIENT_ID;
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, error: "Missing 'file' upload" },
      { status: 400 },
    );
  }

  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .select("id, user_id")
    .eq("id", clientId)
    .maybeSingle();
  if (clientErr || !client) {
    return NextResponse.json(
      { ok: false, error: "Unknown client_id" },
      { status: 404 },
    );
  }
  if ((client as { user_id?: string | null }).user_id !== user.id) {
    return NextResponse.json(
      { ok: false, error: "Client not owned by signed-in user" },
      { status: 403 },
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    workbook = XLSX.read(buffer, { type: "buffer" });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? `xlsx parse failed: ${err.message}`
            : "xlsx parse failed",
      },
      { status: 400 },
    );
  }

  const parsedTabs = parseWorkbook(workbook);
  const allChannels = new Set<string>();
  for (const tab of parsedTabs) {
    for (const channel of tab.channelsSeen) {
      if (channel) allChannels.add(channel);
    }
  }

  // 1) Ensure every channel exists for the client. Display label
  // mirrors the channel name; is_automatic is determined by the
  // hardcoded set below — the migration's seed already inserts the
  // canonical 4thefans set, so this loop is a defensive backstop for
  // any tab-specific channel name we didn't pre-seed.
  const AUTOMATIC_CHANNELS = new Set(["4TF", "Eventbrite"]);
  let channelsCreated = 0;
  const channelByName = new Map<string, string>();
  for (const channelName of allChannels) {
    const channel = await ensureChannel(supabase, {
      clientId,
      channelName,
      displayLabel: channelName,
      isAutomatic: AUTOMATIC_CHANNELS.has(channelName),
    });
    if (!channel) continue;
    channelByName.set(channelName, channel.id);
    if (
      // Heuristic: channel created during this run is the one whose
      // created_at is within ~5 seconds of now.
      Date.now() - new Date(channel.created_at).getTime() < 5_000
    ) {
      channelsCreated += 1;
    }
  }

  // 2) Load every event for the client once, build a lookup that we
  // can hit per (venueKeyword, opponent) without re-querying.
  const { data: events } = await supabase
    .from("events")
    .select("id, name, venue_name, venue_city, event_code, user_id")
    .eq("client_id", clientId);
  const ownedEvents = (events ?? []).filter(
    (row) => (row as { user_id?: string | null }).user_id === user.id,
  ) as Array<{
    id: string;
    name: string | null;
    venue_name: string | null;
    venue_city: string | null;
    event_code: string | null;
  }>;

  function resolveEventId(
    venueKeyword: string,
    opponent: string,
  ): { id: string; eventName: string | null } | null {
    const keyword = venueKeyword.toLowerCase();
    const candidates = ownedEvents.filter((row) => {
      const venueName = (row.venue_name ?? "").toLowerCase();
      const venueCity = (row.venue_city ?? "").toLowerCase();
      const eventCode = (row.event_code ?? "").toLowerCase();
      return (
        venueName.includes(keyword) ||
        venueCity.includes(keyword) ||
        eventCode.includes(keyword.replace(/\s+/g, ""))
      );
    });
    if (candidates.length === 0) return null;
    for (const row of candidates) {
      const rowOpp = (extractOpponentName(row.name) ?? "").toLowerCase();
      if (rowOpp && rowOpp === opponent.toLowerCase()) {
        return { id: row.id, eventName: row.name };
      }
    }
    return null;
  }

  // 3) Walk each tab's parsed rows and write allocations + sales.
  let allocationsWritten = 0;
  let salesWritten = 0;
  const unmatched: UnmatchedRow[] = [];
  const eventIdsTouched = new Set<string>();

  for (const tab of parsedTabs) {
    await processTab(tab);
  }

  async function processTab(tab: ParsedTab): Promise<void> {
    for (const row of tab.rows) {
      const event = resolveEventId(tab.venueKeyword, row.opponent);
      if (!event) {
        unmatched.push({
          tab: tab.tabName,
          opponent: row.opponent,
          tier: row.tierName,
          reason: "no event matched venue + opponent",
        });
        continue;
      }
      eventIdsTouched.add(event.id);

      for (const [channelName, allocationCount] of Object.entries(
        row.allocationsByChannel,
      )) {
        const channelId = channelByName.get(channelName);
        if (!channelId) {
          unmatched.push({
            tab: tab.tabName,
            opponent: row.opponent,
            tier: row.tierName,
            reason: `unknown channel ${channelName}`,
          });
          continue;
        }
        try {
          await upsertTierChannelAllocation(supabase, {
            eventId: event.id,
            tierName: row.tierName,
            channelId,
            allocationCount,
            notes: `Imported from MASTER Allocations.xlsx tab '${tab.tabName}' row ${row.rowIndex + 1}`,
          });
          allocationsWritten += 1;
        } catch (err) {
          unmatched.push({
            tab: tab.tabName,
            opponent: row.opponent,
            tier: row.tierName,
            reason: `allocation upsert failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }

      for (const [channelName, ticketsSold] of Object.entries(
        row.soldByChannel,
      )) {
        const channelId = channelByName.get(channelName);
        if (!channelId) continue;
        // Skip automatic channels — tier_channel_sales for 4TF is
        // populated by the rollup-sync, not the xlsx import. Importing
        // would create a stale snapshot that fights the live data.
        if (AUTOMATIC_CHANNELS.has(channelName)) continue;
        try {
          await upsertTierChannelSale(supabase, {
            eventId: event.id,
            tierName: row.tierName,
            channelId,
            ticketsSold,
            revenueOverridden: false,
            tierPrice: row.price,
            notes: `Imported from MASTER Allocations.xlsx tab '${tab.tabName}' row ${row.rowIndex + 1}`,
          });
          salesWritten += 1;
        } catch (err) {
          unmatched.push({
            tab: tab.tabName,
            opponent: row.opponent,
            tier: row.tierName,
            reason: `sale upsert failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      }
    }
  }

  const summary: ImportSummary = {
    ok: true,
    client_id: clientId,
    channels_resolved: channelByName.size,
    channels_created: channelsCreated,
    events_processed: eventIdsTouched.size,
    tabs_processed: parsedTabs.length,
    allocations_written: allocationsWritten,
    sales_written: salesWritten,
    unmatched,
    channel_set: Array.from(channelByName.keys()).sort(),
  };
  return NextResponse.json(summary);
}
