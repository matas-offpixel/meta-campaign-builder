// scripts/backfill-launched-ad-sets.mjs
//
// One honest backfill for launched_ad_sets (migration 175).
// Walks campaign_drafts.launchSummary.adSetLaunchResults and writes a
// row for each created metaAdSetId whose suggestion is still on the
// draft. The descriptor is whatever the draft holds now — marked
// descriptor_source = 'backfill_from_launch_summary' so Phase 1 can
// weight these below launch-time snapshots.
//
// Missing suggestions are reported, not guessed.
// A meta_adset_id claimed by more than one draft is reported, not
// written — copies inherited launchSummary and last-write-wins would
// stamp the copy's descriptor as fact.
// Existing launched_ad_sets rows are never overwritten.
//
// Dry-run by default. Prints the write count and the first ten rows.
// Pass --apply only after Matas has read the dry-run.
//
// Usage:
//   node --env-file=.env.local --experimental-strip-types scripts/backfill-launched-ad-sets.mjs
//   node --env-file=.env.local --experimental-strip-types scripts/backfill-launched-ad-sets.mjs --apply
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Requires migration 175 on the target database.

import { createClient } from "@supabase/supabase-js";

import { migrateDraft } from "../lib/autosave.ts";
import { planLaunchedAdSetBackfill } from "../lib/launched-ad-sets/backfill.ts";

const APPLY = process.argv.includes("--apply");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — run with --env-file=.env.local",
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function loadPaged(table, columns) {
  const rows = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + page - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < page) break;
  }
  return rows;
}

async function loadExistingIds() {
  try {
    const rows = await loadPaged("launched_ad_sets", "meta_adset_id");
    return new Set(rows.map((row) => row.meta_adset_id).filter(Boolean));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing =
      /launched_ad_sets/i.test(message) ||
      /PGRST205/.test(message) ||
      /42P01/.test(message);
    if (!missing) throw err;
    if (APPLY) {
      throw new Error(
        "launched_ad_sets does not exist — apply migration 175 before --apply",
      );
    }
    console.log("! migration 175 not applied — dry run only\n");
    return new Set();
  }
}

async function main() {
  const [draftRows, existingIds] = await Promise.all([
    loadPaged("campaign_drafts", "id, user_id, event_id, status, created_at, name, draft_json"),
    loadExistingIds(),
  ]);

  const drafts = [];
  for (const row of draftRows) {
    if (!row.draft_json || typeof row.draft_json !== "object") continue;
    try {
      drafts.push({
        id: row.id,
        user_id: row.user_id,
        event_id: row.event_id ?? null,
        status: row.status ?? null,
        created_at: row.created_at ?? null,
        name: row.name ?? null,
        draft_json: migrateDraft(row.draft_json),
      });
    } catch (err) {
      console.error(`skip draft ${row.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  const eventIds = [
    ...new Set(drafts.map((row) => row.draft_json.settings?.eventId || row.event_id).filter(Boolean)),
  ];
  const eventsById = new Map();
  if (eventIds.length > 0) {
    for (let i = 0; i < eventIds.length; i += 200) {
      const chunk = eventIds.slice(i, i + 200);
      const { data, error } = await supabase
        .from("events")
        .select("id, client_id, presale_at, general_sale_at, sold_out_at")
        .in("id", chunk);
      if (error) throw new Error(`events read failed: ${error.message}`);
      for (const event of data ?? []) {
        eventsById.set(event.id, {
          clientId: event.client_id ?? null,
          presaleAt: event.presale_at ?? null,
          generalSaleAt: event.general_sale_at ?? null,
          soldOutAt: event.sold_out_at ?? null,
        });
      }
    }
  }

  const plan = planLaunchedAdSetBackfill(drafts, eventsById, new Date(), existingIds);

  console.log(`drafts scanned:            ${drafts.length}`);
  console.log(`existing launched rows:    ${existingIds.size}`);
  console.log(`would write:               ${plan.writes.length}`);
  console.log(`missing suggestion:        ${plan.missingSuggestion.length}`);
  console.log(`claimed by multiple drafts: ${plan.multiClaim.length}`);
  console.log(`distinct ad sets in play:  ${plan.distinctAdSets}`);
  console.log(
    "launched_at / phase_at_launch use the draft's updatedAt ?? createdAt — phase as of last save, not launch. Rows are marked backfill_from_launch_summary.",
  );
  console.log("");
  console.log("First ten writes:");
  for (const row of plan.writes.slice(0, 10)) {
    console.log(
      JSON.stringify({
        meta_adset_id: row.meta_adset_id,
        draft_id: row.draft_id,
        suggestion_id: row.suggestion_id,
        source_type: row.source_type,
        source_name: row.source_name,
        event_id: row.event_id,
        descriptor_source: row.descriptor_source,
      }),
    );
  }
  console.log("");
  if (plan.missingSuggestion.length > 0) {
    console.log("Missing suggestions (not guessed):");
    for (const miss of plan.missingSuggestion.slice(0, 20)) {
      console.log(
        `  draft=${miss.draftId} suggestion=${miss.suggestionId} meta_adset_id=${miss.metaAdSetId}`,
      );
    }
    if (plan.missingSuggestion.length > 20) {
      console.log(`  … ${plan.missingSuggestion.length - 20} more`);
    }
    console.log("");
  }

  if (plan.multiClaim.length > 0) {
    console.log("Claimed by multiple drafts (not guessed):");
    for (const claim of plan.multiClaim.slice(0, 20)) {
      console.log(`  meta_adset_id=${claim.metaAdSetId}`);
      for (const draft of claim.drafts) {
        console.log(
          `    draft=${draft.draftId} status=${draft.status ?? "?"} created_at=${draft.createdAt ?? "?"} copy=${draft.isCopy ? "yes" : "no"} name=${draft.name ?? "?"}`,
        );
      }
    }
    if (plan.multiClaim.length > 20) {
      console.log(`  … ${plan.multiClaim.length - 20} more ids`);
    }
    console.log("");
  }

  if (!APPLY) {
    console.log(
      `Dry run. Re-run with --apply to write ${plan.writes.length} unambiguous launched_ad_sets row(s).`,
    );
    return;
  }

  console.log("Applying unambiguous set only.");
  console.log(`would write:               ${plan.writes.length}`);
  console.log(`missing suggestion:        ${plan.missingSuggestion.length}`);
  console.log(`claimed by multiple drafts: ${plan.multiClaim.length}`);
  console.log(`distinct ad sets in play:  ${plan.distinctAdSets}`);
  console.log("");

  let written = 0;
  const failures = [];
  for (let start = 0; start < plan.writes.length; start += 200) {
    const chunk = plan.writes.slice(start, start + 200);
    const { error } = await supabase
      .from("launched_ad_sets")
      .upsert(chunk, { onConflict: "meta_adset_id" });
    if (error) {
      failures.push(error.message);
      continue;
    }
    written += chunk.length;
  }

  console.log(`Wrote ${written} launched_ad_sets row(s).`);
  for (const failure of failures) console.error(`  x ${failure}`);
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
