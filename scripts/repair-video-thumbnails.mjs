// scripts/repair-video-thumbnails.mjs
//
// One-off repair for task #128: every motion (video) ad creative whose
// stored thumbnail is Meta's own "still encoding" placeholder/spinner GIF
// (served from static.xx.fbcdn.net/rsrc.php/ — Facebook's UI-resource CDN,
// NEVER user content) instead of a real frame of the video. Root cause was
// `fetchVideoThumbnailWithRetry` only polling for 6s post-upload and
// accepting whatever non-empty URL Meta returned — see
// lib/meta/video-thumbnail-poll.ts's doc comment for the full story. That
// bug is fixed going forward; this script repairs ads that already shipped
// with the placeholder baked in as `video_data.image_hash`.
//
// isMetaPlaceholderThumbnailUrl below is a deliberate small inline copy of
// the detector in lib/meta/video-thumbnail-poll.ts (same pattern as
// scripts/backfill-key-moments.mjs mirroring lib/db/event-key-moments.ts) so
// this plain .mjs script doesn't need a TS loader to import it.
//
// What it does, per broken creative found:
//   1. Re-fetch GET /{videoId}?fields=picture — by now (the video was
//      uploaded at least hours/days ago) Meta should have the real frame.
//   2. Upload that URL as an ad image (POST /{adAccountId}/adimages) to get
//      a fresh image_hash.
//   3. GET the creative's current object_story_spec, splice in the new
//      image_hash (preserving every other field — title/message/cta/page_id/
//      instagram_user_id/etc.), and POST it back to /{creativeId}.
//   4. Best-effort: also patch the matching asset's thumbnailUrl/assetHash
//      in our own campaign_drafts.draft_json, so future re-reads of the
//      draft (duplicate, template, etc.) don't resurrect the placeholder.
//
// Dedupes by Meta creative id — if the same creative backs multiple ads
// (shared across ad sets), it's repaired exactly once.
//
// Safety: DRY RUN by default (reports what it would do, makes zero writes).
// Pass --live to actually call Meta + Supabase writes. Rate-limited to
// 1 creative/sec. Resumable via a local JSON checkpoint file — re-running
// after a crash / Ctrl-C skips creatives already marked "fixed".
//
// Usage:
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs                 # dry run, last 90 days
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --live          # actually repair
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --live --days=30
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --live --checkpoint=/tmp/my-checkpoint.json
//
// Requires env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// META_ACCESS_TOKEN (same system-token convention as the optimisation-tick /
// budget-pacing-check crons — see lib/meta/server-token.ts).

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const LIVE = args.includes("--live");
const daysArg = args.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Number(daysArg.slice("--days=".length)) : 90;
const checkpointArg = args.find((a) => a.startsWith("--checkpoint="));
const CHECKPOINT_PATH = checkpointArg
  ? resolve(process.cwd(), checkpointArg.slice("--checkpoint=".length))
  : resolve(__dirname, ".repair-video-thumbnails-checkpoint.json");

// ─── Env ──────────────────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const metaToken = process.env.META_ACCESS_TOKEN;
const API_VERSION = process.env.META_API_VERSION ?? "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Source .env.local first.");
}
if (!metaToken) {
  throw new Error("Missing META_ACCESS_TOKEN. Source .env.local first.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ─── Placeholder detection (mirrors lib/meta/video-thumbnail-poll.ts) ────────

const PLACEHOLDER_CDN_PATTERN = /^https?:\/\/(static|www)\.[a-z0-9.-]*fbcdn\.net\/rsrc\.php\//i;
const KNOWN_SPINNER_FILENAME_FRAGMENT = "AAqMW82PqGg";

function isMetaPlaceholderThumbnailUrl(url) {
  if (!url) return false;
  if (PLACEHOLDER_CDN_PATTERN.test(url)) return true;
  if (url.includes(KNOWN_SPINNER_FILENAME_FRAGMENT)) return true;
  return false;
}

// ─── Priority campaigns (user-reported affected) ─────────────────────────────
// Processed first when present in the candidate set; every other matching
// campaign from the last `--days` window is still repaired after these.

const PRIORITY_NAME_FRAGMENTS = [
  "eed newcastle v2",
  "ipc newcastle v3",
  "colyn wide",
  "nora en pure",
  "booka shade",
  "mall grab",
  "parable",
];

function priorityRank(draftName) {
  const name = (draftName ?? "").toLowerCase();
  const idx = PRIORITY_NAME_FRAGMENTS.findIndex((fragment) => name.includes(fragment));
  return idx === -1 ? PRIORITY_NAME_FRAGMENTS.length : idx;
}

// ─── Meta asset-priority (mirrors VIDEO_PRIORITY in lib/meta/creative.ts) ────
// Only the FIRST asset variation's assets are ever sent to Meta as the
// creative's video_data (pickPrimaryVideoAsset) — repairing any other
// variation's thumbnail wouldn't change what's actually live.

const VIDEO_PRIORITY = ["9:16", "4:5", "1:1"];

function pickPrimaryVideoAsset(creative) {
  const assets = creative.assetVariations?.[0]?.assets ?? [];
  for (const ratio of VIDEO_PRIORITY) {
    const asset = assets.find((a) => a.aspectRatio === ratio && a.videoId);
    if (asset) return asset;
  }
  return undefined;
}

// ─── Checkpoint ───────────────────────────────────────────────────────────────

async function loadCheckpoint() {
  try {
    const raw = await readFile(CHECKPOINT_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveCheckpoint(checkpoint) {
  await writeFile(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

// ─── Supabase: candidate drafts ───────────────────────────────────────────────

async function loadCandidateDrafts() {
  const sinceIso = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("campaign_drafts")
    .select("id, name, draft_json, updated_at")
    .eq("status", "published")
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Supabase query failed: ${error.message}`);
  }
  return data ?? [];
}

// ─── Collect broken creatives across candidate drafts (deduped by creative id) ─

function collectBrokenCreatives(rows) {
  const byCreativeId = new Map();

  for (const row of rows) {
    const draft = row.draft_json;
    const creatives = draft?.creatives ?? [];
    for (const creative of creatives) {
      if (creative.mediaType !== "video" || !creative.metaCreativeId) continue;
      const asset = pickPrimaryVideoAsset(creative);
      if (!asset?.videoId) continue;
      if (!isMetaPlaceholderThumbnailUrl(asset.thumbnailUrl)) continue;

      const creativeId = creative.metaCreativeId;
      const usedByAdSets =
        draft.launchSummary?.creativesCreated?.find((c) => c.metaCreativeId === creativeId)?.ads?.length ?? 0;

      if (!byCreativeId.has(creativeId)) {
        byCreativeId.set(creativeId, {
          creativeId,
          creativeName: creative.name,
          videoId: asset.videoId,
          placeholderUrl: asset.thumbnailUrl,
          draftId: draft.id,
          draftName: draft.settings?.campaignName ?? row.name ?? "(untitled)",
          adAccountId: draft.settings?.adAccountId,
          usedByAdSets,
          assetId: asset.id,
        });
      }
    }
  }

  const targets = [...byCreativeId.values()];
  targets.sort((a, b) => priorityRank(a.draftName) - priorityRank(b.draftName));
  return targets;
}

// ─── Meta calls ───────────────────────────────────────────────────────────────

function withActPrefix(adAccountId) {
  if (!adAccountId) return adAccountId;
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

async function fetchCurrentPicture(videoId) {
  const url = `${GRAPH_BASE}/${videoId}?fields=picture&access_token=${encodeURIComponent(metaToken)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`GET /${videoId}?fields=picture failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  return typeof json.picture === "string" ? json.picture : "";
}

async function uploadImageFromUrl(adAccountId, imageUrl) {
  const formData = new FormData();
  formData.append("access_token", metaToken);
  formData.append("url", imageUrl);

  const endpoint = `${GRAPH_BASE}/${withActPrefix(adAccountId)}/adimages`;
  const res = await fetch(endpoint, { method: "POST", body: formData });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`POST /${withActPrefix(adAccountId)}/adimages failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  const imageData = Object.values(json.images ?? {})[0];
  if (!imageData?.hash) {
    throw new Error("Meta returned an empty images response from /adimages");
  }
  return { hash: imageData.hash, url: imageData.url };
}

async function fetchCurrentObjectStorySpec(creativeId) {
  const url = `${GRAPH_BASE}/${creativeId}?fields=object_story_spec&access_token=${encodeURIComponent(metaToken)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`GET /${creativeId}?fields=object_story_spec failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  if (!json.object_story_spec?.video_data) {
    throw new Error(`/${creativeId} has no object_story_spec.video_data — not a video creative, or already migrated`);
  }
  return json.object_story_spec;
}

async function patchCreativeImageHash(creativeId, currentSpec, newImageHash) {
  const updatedSpec = {
    ...currentSpec,
    video_data: {
      ...currentSpec.video_data,
      image_hash: newImageHash,
      image_url: undefined, // never send both (code=100 subcode=1443051)
    },
  };
  // JSON.stringify drops `undefined` keys, matching how the app never sends
  // both image_hash + image_url in the first place (lib/meta/creative.ts).

  const url = `${GRAPH_BASE}/${creativeId}`;
  const body = new URLSearchParams({
    access_token: metaToken,
    object_story_spec: JSON.stringify(updatedSpec),
  });
  const res = await fetch(url, { method: "POST", body });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`POST /${creativeId} (object_story_spec update) failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json;
}

// ─── Supabase: best-effort local draft repair ────────────────────────────────

async function patchDraftAssetThumbnail(draftId, assetId, newThumbnailUrl, newHash) {
  const { data, error: readError } = await supabase
    .from("campaign_drafts")
    .select("draft_json")
    .eq("id", draftId)
    .maybeSingle();
  if (readError || !data) {
    console.warn(`  [draft-repair] could not re-read draft ${draftId}: ${readError?.message ?? "not found"} — skipping local repair`);
    return;
  }

  const draft = data.draft_json;
  let touched = false;
  for (const creative of draft.creatives ?? []) {
    for (const variation of creative.assetVariations ?? []) {
      for (const asset of variation.assets ?? []) {
        if (asset.id === assetId) {
          asset.thumbnailUrl = newThumbnailUrl;
          asset.assetHash = newHash;
          touched = true;
        }
      }
    }
  }
  if (!touched) {
    console.warn(`  [draft-repair] asset ${assetId} not found in re-read draft ${draftId} — skipping local repair`);
    return;
  }

  draft.updatedAt = new Date().toISOString();
  const { error: writeError } = await supabase
    .from("campaign_drafts")
    .update({ draft_json: draft, updated_at: draft.updatedAt })
    .eq("id", draftId);
  if (writeError) {
    console.warn(`  [draft-repair] failed to write repaired draft_json for ${draftId}: ${writeError.message}`);
  }
}

// ─── Repair one creative ──────────────────────────────────────────────────────

async function repairOne(target) {
  console.log(
    `\n→ "${target.draftName}" / creative "${target.creativeName}" (${target.creativeId}), ` +
      `videoId=${target.videoId}, ${target.usedByAdSets} ad(s), placeholder=${target.placeholderUrl}`,
  );

  const picture = await fetchCurrentPicture(target.videoId);
  if (!picture) {
    throw new Error("Meta still has no picture for this video — try again later");
  }
  if (isMetaPlaceholderThumbnailUrl(picture)) {
    throw new Error(`Meta STILL returns a placeholder (${picture}) — video may still be encoding, skip for now`);
  }
  console.log(`  real thumbnail found: ${picture}`);

  if (!LIVE) {
    console.log("  [dry run] would upload as image + patch creative — no writes made");
    return { status: "would_fix", picture };
  }

  if (!target.adAccountId) {
    throw new Error("draft.settings.adAccountId missing — cannot upload replacement image");
  }

  const { hash } = await uploadImageFromUrl(target.adAccountId, picture);
  console.log(`  uploaded as image_hash=${hash}`);

  const currentSpec = await fetchCurrentObjectStorySpec(target.creativeId);
  await patchCreativeImageHash(target.creativeId, currentSpec, hash);
  console.log(`  patched creative ${target.creativeId} → image_hash=${hash}`);

  await patchDraftAssetThumbnail(target.draftId, target.assetId, picture, hash);
  console.log(`  patched local draft_json for asset ${target.assetId}`);

  return { status: "fixed", picture, hash };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(
    `[repair-video-thumbnails] mode=${LIVE ? "LIVE" : "DRY RUN"} days=${DAYS} checkpoint=${CHECKPOINT_PATH}`,
  );

  const rows = await loadCandidateDrafts();
  console.log(`Loaded ${rows.length} published draft(s) from the last ${DAYS} days.`);

  const targets = collectBrokenCreatives(rows);
  console.log(`Found ${targets.length} broken video creative(s) (deduped by Meta creative id).`);
  if (targets.length === 0) {
    console.log("Nothing to repair. Exiting.");
    return;
  }

  const checkpoint = await loadCheckpoint();
  let fixed = 0;
  let alreadyFixed = 0;
  let failed = 0;
  let wouldFix = 0;

  for (const target of targets) {
    const prior = checkpoint[target.creativeId];
    if (prior?.status === "fixed") {
      alreadyFixed++;
      console.log(`\n→ "${target.draftName}" / creative "${target.creativeName}" — already fixed (checkpoint), skipping`);
      continue;
    }

    try {
      const result = await repairOne(target);
      checkpoint[target.creativeId] = {
        status: result.status,
        draftName: target.draftName,
        creativeName: target.creativeName,
        picture: result.picture,
        hash: result.hash,
        checkedAt: new Date().toISOString(),
      };
      if (result.status === "fixed") fixed++;
      if (result.status === "would_fix") wouldFix++;
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  FAILED: ${message}`);
      checkpoint[target.creativeId] = {
        status: "failed",
        draftName: target.draftName,
        creativeName: target.creativeName,
        error: message,
        checkedAt: new Date().toISOString(),
      };
    }

    await saveCheckpoint(checkpoint);
    await sleep(1000); // 1 creative/sec — rate-limit-friendly
  }

  console.log("\n─── Summary ───────────────────────────────────────────");
  console.log(`  fixed:         ${fixed}`);
  console.log(`  would fix:     ${wouldFix} (dry run — re-run with --live to apply)`);
  console.log(`  already fixed: ${alreadyFixed} (from checkpoint)`);
  console.log(`  failed:        ${failed}`);
  console.log(`Checkpoint written to ${CHECKPOINT_PATH}`);
}

main().catch((err) => {
  console.error("[repair-video-thumbnails] fatal error:", err);
  process.exitCode = 1;
});
