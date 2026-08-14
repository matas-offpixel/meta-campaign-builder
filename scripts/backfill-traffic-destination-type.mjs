// scripts/backfill-traffic-destination-type.mjs
//
// One-off backfill for Traffic (and registration) ad sets launched before
// destination_type=WEBSITE was set explicitly on create. Meta's newer Ads
// Manager Edit UI defaults the destination radio to "Facebook event" when
// destination_type is absent AND the associated Page has upcoming events —
// delivery still works via link_data.link, but an operator opening Edit
// sees a broken-looking config and risks saving it (which would nuke the
// website destination). Reproducer: Modern Funktion — Traffic
// (campaign 120251191631740755).
//
// What it does:
//   1. Load published campaign_drafts whose settings.objective is
//      "traffic" (or "registration").
//   2. Collect metaCampaignId from draft_json.metaCampaignId and/or
//      launchSummary.campaignId / launchSummary.campaigns[].id.
//   3. GET /{campaignId}/adsets?fields=id,name,destination_type
//      (paginated) for each Meta campaign.
//   4. POST /{adSetId} with destination_type=WEBSITE for any ad set whose
//      current destination_type is missing or FACEBOOK_EVENT.
//
// Dry-run by default. Pass --live to write. Rate-limits writes to 1/sec.
//
// Usage:
//   node --env-file=.env.local scripts/backfill-traffic-destination-type.mjs
//   node --env-file=.env.local scripts/backfill-traffic-destination-type.mjs --live
//   node --env-file=.env.local scripts/backfill-traffic-destination-type.mjs --live --campaign-ids=120251191631740755
//   node --env-file=.env.local scripts/backfill-traffic-destination-type.mjs --objectives=traffic,registration

import { createClient } from "@supabase/supabase-js";

const META_API_BASE = "https://graph.facebook.com/v21.0";
const LIVE = process.argv.includes("--live");
const CAMPAIGN_IDS_ARG = process.argv.find((a) => a.startsWith("--campaign-ids="));
const OBJECTIVES_ARG = process.argv.find((a) => a.startsWith("--objectives="));
const TARGET_CAMPAIGN_IDS = CAMPAIGN_IDS_ARG
  ? CAMPAIGN_IDS_ARG.slice("--campaign-ids=".length).split(",").map((s) => s.trim()).filter(Boolean)
  : null;
const TARGET_OBJECTIVES = new Set(
  (OBJECTIVES_ARG
    ? OBJECTIVES_ARG.slice("--objectives=".length).split(",")
    : ["traffic", "registration"]
  )
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

const WRITE_INTERVAL_MS = 1000;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const envToken = process.env.META_ACCESS_TOKEN;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}
if (!envToken) {
  throw new Error("Missing META_ACCESS_TOKEN");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function log(...args) {
  console.log(`[backfill-traffic-destination-type]`, ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function metaGet(path, params = {}) {
  const url = new URL(`${META_API_BASE}${path}`);
  url.searchParams.set("access_token", envToken);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new Error(`GET ${path} failed: ${e.message ?? res.status} (code=${e.code})`);
  }
  return json;
}

async function metaPost(path, body) {
  const url = new URL(`${META_API_BASE}${path}`);
  url.searchParams.set("access_token", envToken);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    throw new Error(`POST ${path} failed: ${e.message ?? res.status} (code=${e.code})`);
  }
  return json;
}

function extractMetaCampaignIds(draftJson) {
  const ids = new Set();
  if (!draftJson || typeof draftJson !== "object") return ids;
  if (typeof draftJson.metaCampaignId === "string" && /^\d+$/.test(draftJson.metaCampaignId)) {
    ids.add(draftJson.metaCampaignId);
  }
  const summary = draftJson.launchSummary;
  if (summary && typeof summary === "object") {
    if (typeof summary.campaignId === "string" && /^\d+$/.test(summary.campaignId)) {
      ids.add(summary.campaignId);
    }
    if (Array.isArray(summary.campaigns)) {
      for (const c of summary.campaigns) {
        if (c && typeof c.id === "string" && /^\d+$/.test(c.id)) ids.add(c.id);
      }
    }
  }
  return ids;
}

async function collectTargetsFromDrafts() {
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id, name, status, draft_json")
    .eq("status", "published");
  if (error) throw new Error(`Supabase query failed: ${error.message}`);

  const byCampaignId = new Map(); // metaCampaignId → { draftIds, draftNames, objective }
  for (const row of data ?? []) {
    const draft = row.draft_json;
    const objective = draft?.settings?.objective;
    if (!TARGET_OBJECTIVES.has(objective)) continue;
    const ids = extractMetaCampaignIds(draft);
    for (const id of ids) {
      const existing = byCampaignId.get(id) ?? {
        draftIds: [],
        draftNames: [],
        objective,
      };
      existing.draftIds.push(row.id);
      existing.draftNames.push(row.name ?? row.id);
      byCampaignId.set(id, existing);
    }
  }
  return byCampaignId;
}

async function fetchCampaignAdSets(campaignId) {
  const adSets = [];
  let after = undefined;
  do {
    const params = {
      fields: "id,name,destination_type,optimization_goal,status",
      limit: 100,
    };
    if (after) params.after = after;
    const json = await metaGet(`/${campaignId}/adsets`, params);
    for (const row of json.data ?? []) adSets.push(row);
    after = json.paging?.cursors?.after;
    if (!(json.paging?.next)) after = undefined;
  } while (after);
  return adSets;
}

function needsWebsiteDestination(adSet) {
  const current = adSet.destination_type;
  return !current || current === "FACEBOOK_EVENT";
}

async function main() {
  log(`mode=${LIVE ? "LIVE" : "dry-run"} objectives=${[...TARGET_OBJECTIVES].join(",")}`);

  let targets;
  if (TARGET_CAMPAIGN_IDS) {
    log(`explicit --campaign-ids: ${TARGET_CAMPAIGN_IDS.join(", ")}`);
    targets = new Map(
      TARGET_CAMPAIGN_IDS.map((id) => [id, { draftIds: [], draftNames: ["(explicit)"], objective: "traffic" }]),
    );
  } else {
    targets = await collectTargetsFromDrafts();
    log(`discovered ${targets.size} Meta campaign(s) from published drafts`);
  }

  if (targets.size === 0) {
    log("nothing to do");
    return;
  }

  let scanned = 0;
  let alreadyOk = 0;
  let toPatch = 0;
  let patched = 0;
  let failed = 0;

  for (const [campaignId, meta] of targets) {
    log(`\n── campaign ${campaignId} (${meta.objective}) drafts=[${meta.draftNames.join("; ")}]`);
    let adSets;
    try {
      adSets = await fetchCampaignAdSets(campaignId);
    } catch (err) {
      log(`  FAILED to list ad sets: ${err instanceof Error ? err.message : String(err)}`);
      failed += 1;
      continue;
    }
    log(`  ${adSets.length} ad set(s)`);
    scanned += adSets.length;

    for (const adSet of adSets) {
      if (!needsWebsiteDestination(adSet)) {
        alreadyOk += 1;
        log(`  ok  ${adSet.id} "${adSet.name}" destination_type=${adSet.destination_type}`);
        continue;
      }
      toPatch += 1;
      log(
        `  ${LIVE ? "PATCH" : "would-PATCH"} ${adSet.id} "${adSet.name}"` +
          ` destination_type=${adSet.destination_type ?? "(absent)"} → WEBSITE`,
      );
      if (!LIVE) continue;
      try {
        await metaPost(`/${adSet.id}`, { destination_type: "WEBSITE" });
        patched += 1;
      } catch (err) {
        failed += 1;
        log(`    FAILED: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(WRITE_INTERVAL_MS);
    }
  }

  log(
    `\nDone. scanned=${scanned} alreadyOk=${alreadyOk} toPatch=${toPatch}` +
      ` patched=${patched} failed=${failed} mode=${LIVE ? "LIVE" : "dry-run"}`,
  );
  if (!LIVE && toPatch > 0) {
    log("Re-run with --live to apply destination_type=WEBSITE.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
