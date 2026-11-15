// scripts/backfill-launched-ads.mts
//
// One honest backfill for launched_ads (migration 184).
// Walks campaign_drafts.draft_json.launchSummary.creativesCreated[].ads[]
// and writes one row per metaAdId, descriptor_source =
// 'backfill_from_launch_summary'. Database reads only — never calls Meta.
//
// Not covered: multi-campaign attach ads beyond the first campaign (they
// were never written to launchSummary), bulk-attach ads (no draft).
// A meta_ad_id claimed by more than one draft is reported, not written.
// Existing launched_ads rows are never overwritten.
//
// Dry-run by default. Pass --apply only after Matas has read the dry-run.
//
// Usage:
//   npx tsx --env-file=.env.local scripts/backfill-launched-ads.mts
//   npx tsx --env-file=.env.local scripts/backfill-launched-ads.mts --apply
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// --apply requires migration 184 on the target database.

import { createClient } from "@supabase/supabase-js";

import { migrateDraft } from "../lib/autosave.ts";
import { planLaunchedAdBackfill, type AdBackfillDraftInput } from "../lib/launched-ads/backfill.ts";
import { registryAssetIds } from "../lib/launched-ads/record.ts";

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local");
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadPaged<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const rows: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    let query = supabase.from(table).select(columns);
    if (filter) query = filter(query);
    const { data, error } = await query.range(from, from + page - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if ((data ?? []).length < page) break;
  }
  return rows;
}

async function loadExistingIds(): Promise<Set<string>> {
  try {
    const rows = await loadPaged<{ meta_ad_id: string }>("launched_ads", "meta_ad_id");
    return new Set(rows.map((row) => row.meta_ad_id).filter(Boolean));
  } catch (err) {
    const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    if (!/launched_ads|PGRST205|42P01/i.test(message)) throw err;
    if (APPLY) throw new Error("launched_ads does not exist — apply migration 184 before --apply");
    console.log("! migration 184 not applied — dry run only\n");
    return new Set();
  }
}

async function inChunks<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) out.push(...(await load(ids.slice(i, i + 200))));
  return out;
}

async function main() {
  const [draftRows, existingIds] = await Promise.all([
    loadPaged<{ id: string; user_id: string; event_id: string | null; client_id: string | null; draft_json: unknown }>(
      "campaign_drafts",
      "id, user_id, event_id, client_id, draft_json",
      (q) => q.not("draft_json->launchSummary->creativesCreated", "is", null),
    ),
    loadExistingIds(),
  ]);

  const drafts: AdBackfillDraftInput[] = [];
  for (const row of draftRows) {
    if (!row.draft_json || typeof row.draft_json !== "object") continue;
    try {
      drafts.push({
        id: row.id,
        user_id: row.user_id,
        event_id: row.event_id ?? null,
        client_id: row.client_id ?? null,
        draft_json: migrateDraft(row.draft_json as never),
      });
    } catch (err) {
      console.error(`skip draft ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const eventIds = [...new Set(drafts.map((d) => d.draft_json.settings?.eventId || d.event_id).filter(Boolean))] as string[];
  const clientIdByEventId = new Map<string, string | null>();
  for (const event of await inChunks(eventIds, async (chunk) => {
    const { data, error } = await supabase.from("events").select("id, client_id").in("id", chunk);
    if (error) throw new Error(`events read failed: ${error.message}`);
    return (data ?? []) as { id: string; client_id: string | null }[];
  })) {
    clientIdByEventId.set(event.id, event.client_id ?? null);
  }

  const registryIds = [...new Set(drafts.flatMap((d) => (d.draft_json.creatives ?? []).flatMap((c) => registryAssetIds(c))))];
  const hashByRegistryId = new Map<string, string>();
  for (const asset of await inChunks(registryIds, async (chunk) => {
    const { data, error } = await supabase.from("creative_assets").select("id, content_hash").in("id", chunk);
    if (error) throw new Error(`creative_assets read failed: ${error.message}`);
    return (data ?? []) as { id: string; content_hash: string | null }[];
  })) {
    if (asset.content_hash) hashByRegistryId.set(asset.id, asset.content_hash);
  }

  const plan = planLaunchedAdBackfill(drafts, clientIdByEventId, hashByRegistryId, existingIds);

  console.log(`drafts scanned:             ${drafts.length}`);
  console.log(`drafts with launched ads:   ${plan.draftsWithAds}`);
  console.log(`distinct ads found:         ${plan.adsFound}`);
  console.log(`already in launched_ads:    ${plan.alreadyRecorded}`);
  console.log(`would write:                ${plan.writes.length}`);
  console.log(`  of which ad set unresolved: ${plan.unresolvedAdSet} (meta_adset_id null)`);
  console.log(`  creative gone from draft:   ${plan.missingCreative} (descriptor = name only)`);
  console.log(`claimed by multiple drafts: ${plan.multiClaim.length} (not written)`);
  console.log(`registered asset hashes:    ${hashByRegistryId.size} of ${registryIds.length} registry ids`);
  console.log(
    "launched_at uses the draft's updatedAt ?? createdAt. Rows are marked backfill_from_launch_summary. No Meta calls were made.",
  );
  console.log("");
  console.log("First ten writes:");
  for (const row of plan.writes.slice(0, 10)) {
    console.log(
      JSON.stringify({
        meta_ad_id: row.meta_ad_id,
        meta_adset_id: row.meta_adset_id,
        draft_id: row.draft_id,
        event_id: row.event_id,
        creative_name: row.creative_name,
        media_type: row.media_type,
        hashes: (row.asset_content_hashes as string[]).length,
      }),
    );
  }
  if (plan.multiClaim.length > 0) {
    console.log("\nClaimed by multiple drafts (not guessed):");
    for (const claim of plan.multiClaim.slice(0, 20)) {
      console.log(`  meta_ad_id=${claim.metaAdId} drafts=${claim.draftIds.join(",")}`);
    }
    if (plan.multiClaim.length > 20) console.log(`  … ${plan.multiClaim.length - 20} more ids`);
  }
  console.log("");

  if (!APPLY) {
    console.log(`Dry run. Re-run with --apply to write ${plan.writes.length} launched_ads row(s).`);
    return;
  }

  let written = 0;
  const failures: string[] = [];
  for (let start = 0; start < plan.writes.length; start += 200) {
    const chunk = plan.writes.slice(start, start + 200);
    const { error } = await supabase
      .from("launched_ads")
      .upsert(chunk, { onConflict: "meta_ad_id", ignoreDuplicates: true });
    if (error) {
      failures.push(error.message);
      continue;
    }
    written += chunk.length;
  }
  console.log(`Wrote ${written} launched_ads row(s).`);
  for (const failure of failures) console.error(`  x ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
