// scripts/backfill-tiktok-thumbnails.mts
//
// Durable TikTok thumbnails for ads already in tiktok_active_creatives_snapshots.
// Same path as the snapshot cron (`cacheThumbnailsForAccounts`): Storage
// first, then `/file/video/ad/info/` (60 ids a call) or `/file/image/ad/info/`
// (100 ids a call) for misses, then download and upload to the
// `creative-thumbnails` bucket under `tiktok/`.
//
// Rows are each scoped event's latest snapshot window (newest window_until).
//
// Dry-run by default: lists Storage and reads TikTok info (GET only) to see
// which ids TikTok returns a cover for, and downloads and writes nothing.
// Spark rows (tiktok_item_id, no video_id or image id) are paged from
// GET /tt_video/list/ after the video and image pass. Item ids that list
// does not contain are read with GET /identity/video/info/. Each list page
// and each info call counts toward --max-calls. --apply downloads and uploads.
//
// Usage:
//   node --experimental-strip-types --env-file=.env.local \
//     scripts/backfill-tiktok-thumbnails.mts \
//     (--client <client_id> | --event-code <code>) [--max-calls N] [--apply]
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// TIKTOK_TOKEN_KEY. Counts only; never prints tokens or URLs.

import { createClient } from "@supabase/supabase-js";

import { cacheThumbnailsForAccounts } from "../lib/tiktok/thumbnail-cache-run.ts";
import { TIKTOK_THUMB_MAX_CALLS_PER_RUN } from "../lib/tiktok/thumbnail-cache.ts";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes("--apply");
const clientId = arg("--client");
const eventCode = arg("--event-code");
const maxCalls = Number(arg("--max-calls") ?? TIKTOK_THUMB_MAX_CALLS_PER_RUN);
if (!clientId === !eventCode || !Number.isFinite(maxCalls) || maxCalls < 0) {
  throw new Error("Usage: (--client <id> | --event-code <code>) [--max-calls N] [--apply]");
}

interface EventRow {
  id: string;
  event_code: string | null;
  tiktok_account_id: string | null;
  client: { tiktok_account_id: string | null } | Array<{ tiktok_account_id: string | null }> | null;
}

interface SnapshotRow {
  ad_id: string;
  video_id: string | null;
  image_ids: string[] | null;
  tiktok_item_id: string | null;
  identity_id: string | null;
  identity_type: string | null;
  window_since: string;
  window_until: string;
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let eventsQuery = db
    .from("events")
    .select("id, event_code, tiktok_account_id, client:clients ( tiktok_account_id )");
  eventsQuery = clientId
    ? eventsQuery.eq("client_id", clientId)
    : eventsQuery.eq("event_code", eventCode!);
  const { data: events, error } = await eventsQuery;
  if (error) throw new Error(`events read failed: ${error.message}`);

  const rowsByAccount = new Map<string, SnapshotRow[]>();
  const adsByEvent: Array<{ code: string; accountId: string | null; rows: SnapshotRow[] }> = [];
  for (const event of (events ?? []) as EventRow[]) {
    const client = Array.isArray(event.client) ? event.client[0] : event.client;
    const accountId = event.tiktok_account_id ?? client?.tiktok_account_id ?? null;
    const { data: latest } = await db
      .from("tiktok_active_creatives_snapshots")
      .select("window_since, window_until")
      .eq("event_id", event.id)
      .eq("kind", "ok")
      .order("window_until", { ascending: false })
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) continue;
    const { data: rows, error: rowsError } = await db
      .from("tiktok_active_creatives_snapshots")
      .select("ad_id, video_id, image_ids, tiktok_item_id, identity_id, identity_type, window_since, window_until")
      .eq("event_id", event.id)
      .eq("kind", "ok")
      .eq("window_since", latest.window_since)
      .eq("window_until", latest.window_until);
    if (rowsError) throw new Error(`snapshot read failed: ${rowsError.message}`);
    const ads = [...new Map(((rows ?? []) as SnapshotRow[]).map((r) => [r.ad_id, r])).values()];
    adsByEvent.push({ code: event.event_code ?? event.id, accountId, rows: ads });
    if (accountId) rowsByAccount.set(accountId, [...(rowsByAccount.get(accountId) ?? []), ...ads]);
  }

  const stats = await cacheThumbnailsForAccounts({
    supabase: db,
    rowsByAccount,
    dryRun: !APPLY,
    maxCalls,
  });

  console.log(APPLY ? "mode: apply" : "mode: dry run (TikTok info reads only; nothing downloaded or written)");
  console.log(
    `ids: calls=${stats.calls} cached=${stats.cached} ${APPLY ? "stored" : "would_store"}=${stats.stored} missing=${stats.missing} tiktok_spark_pages=${stats.sparkPages} tiktok_spark_identities_skipped=${stats.sparkIdentitiesSkipped}`,
  );
  for (const { code, accountId, rows } of adsByEvent) {
    const counts = new Map<string, number>();
    const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1);
    for (const row of rows) {
      const outcome = (kind: "video" | "image", id: string) =>
        stats.outcomes.get(`${accountId}:${kind}:${id}`);
      const found = row.video_id
        ? [outcome("video", row.video_id)]
        : (row.image_ids ?? []).map((id) => outcome("image", id));
      const best =
        found.find((o) => o?.kind === "cached") ??
        found.find((o) => o?.kind === "stored") ??
        found.find(Boolean);
      if (!row.video_id && !(row.image_ids?.length)) {
        const spark = row.tiktok_item_id
          ? stats.outcomes.get(`${accountId}:item:${row.tiktok_item_id}`)
          : undefined;
        if (!row.tiktok_item_id) bump("without: no ids");
        else if (!accountId) bump("without: no tiktok account");
        else if (spark?.kind === "cached") bump("durable already");
        else if (spark?.kind === "stored") bump(APPLY ? "durable now" : "would get durable");
        else if (spark?.reason === "spark_post_not_found") bump("spark: post not found");
        else if (spark?.reason === "spark_auth_expired") bump("spark: auth expired");
        else if (spark?.reason === "spark_identity_missing") bump("spark: identity missing");
        else bump(`without: ${spark?.reason ?? "unknown"}`);
      } else if (!accountId) {
        bump("without: no tiktok account");
      } else if (best?.kind === "cached") {
        bump("durable already");
      } else if (best?.kind === "stored") {
        bump(APPLY ? "durable now" : "would get durable");
      } else {
        bump(`without: ${best?.reason ?? "unknown"}`);
      }
    }
    console.log(`\n${code}: ${rows.length} ads`);
    for (const [k, n] of [...counts].sort()) console.log(`  ${k}: ${n}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
