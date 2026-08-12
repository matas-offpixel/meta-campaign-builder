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
// isMetaPlaceholderThumbnailUrl and isMetaPlaceholderThumbnailImage below are
// deliberate small inline copies of the detectors in
// lib/meta/video-thumbnail-poll.ts (same pattern as
// scripts/backfill-key-moments.mjs mirroring lib/db/event-key-moments.ts) so
// this plain .mjs script doesn't need a TS loader to import it.
//
// task #128 follow-up (this revision) — DISCOVERY PIVOT: the first version
// of this script scanned campaign_drafts.draft_json for
// `creative.metaCreativeId` + `asset.thumbnailUrl` and found ZERO broken
// creatives, because `metaCreativeId` is never written back to the draft
// after launch (confirmed via SQL — draft faf11b6f / creative 6e168e8b has
// no metaCreativeId key even though the ad is live on Meta with a
// spinner-hash creative). draft_json is a point-in-time autosave snapshot;
// it was never designed to be re-synced with what Meta actually created.
//
// Fix: query Meta directly instead of trusting the draft snapshot.
// campaign_drafts is used ONLY to discover which metaCampaignId(s) exist for
// which adAccountId — everything about the actual live ad/creative/thumbnail
// state comes straight from the Graph API:
//   1. GET /{campaignId}/ads?fields=id,name,creative{id,object_story_spec}
//      (paginated) enumerates every ad + its creative's video_data in one
//      call per page — no draft_json involved.
//   2. If an ad's nested creative expansion came back empty (rare), fall
//      back to a direct GET /{creativeId}?fields=object_story_spec.
//   3. GET /{adAccountId}/adimages?hashes=["<hash>"]&fields=hash,url,width,height,name
//      resolves the image Meta is CURRENTLY serving for that image_hash —
//      not just its URL (see the DETECTION GAP FIX note below for why).
//   4. isMetaPlaceholderThumbnailImage flags that image as broken by
//      fingerprint (dimensions/format/size), falling back to a HEAD
//      content-length check when the metadata alone doesn't settle it.
// The canonical, unit-tested version of this pipeline lives in
// lib/meta/video-thumbnail-repair-scan.ts (see its doc comment for the same
// story) — this script's discovery functions below are a deliberate inline
// mirror, same convention as isMetaPlaceholderThumbnailUrl.
//
// What it does, per broken ad/creative found:
//   1. Re-fetch GET /{videoId}?fields=picture — by now (the video was
//      uploaded at least hours/days ago) Meta should have the real frame.
//   2. Upload that URL as an ad image (POST /{adAccountId}/adimages) to get
//      a fresh image_hash.
//   3. GET the creative's current object_story_spec, splice in the new
//      image_hash (preserving every other field — title/message/cta/page_id/
//      instagram_user_id/etc.), and POST it back to /{creativeId}.
//   4. Best-effort: also patch every draft asset that references the same
//      videoId in our own campaign_drafts.draft_json (matched by videoId,
//      NOT by asset.id/metaCreativeId — those aren't reliably present), so
//      future re-reads of the draft (duplicate, template, etc.) don't
//      resurrect the placeholder.
//
// Dedupes by Meta creative id — if the same creative backs multiple ads
// (shared across ad sets), it's repaired exactly once.
//
// task #128 follow-up (this revision) — OVER-SCAN GUARD: the spinner bug can
// only exist on ads created on/after BUG_INTRODUCED_AT (PR #748's merge
// date). Legacy campaigns (observed: 16 discovered on IPC/EED/Mall Grab
// draft targets, one with 835 ads) use the old `image_url` thumbnail path
// and can't be affected — scanning them anyway means rate-limit-sleeping
// through hundreds of ads for nothing. Two guards now run BEFORE any
// per-ad/per-hash Meta calls:
//   1. Every ad's `created_time` is checked against BUG_INTRODUCED_AT; ads
//      older than that are dropped, logged as "N/M ads too old to be
//      affected — skipping".
//   2. If a campaign still has more than MAX_ADS_PER_CAMPAIGN ads after that
//      filter, the campaign is skipped entirely with a warning — re-run with
//      `--campaign-ids=<id>,<id>` to explicitly opt in (this also skips
//      draft discovery entirely: the given campaign IDs are scanned
//      directly, ad-account resolved via GET /{campaignId}?fields=account_id).
// Also new: the discovery pass itself is now checkpointed per campaign (not
// just the repair pass) — a re-run skips campaigns already scanned unless
// `--force-rescan` is passed.
//
// task #128 follow-up (this revision) — DETECTION GAP FIX: a dry run against
// 7 explicitly-targeted, known-affected campaigns (338+ post-#748 ads) found
// ZERO broken creatives, even though "IPC Motion 1" (draft faf11b6f /
// creative 6e168e8b) demonstrably has a spinner-GIF asset baked in. Root
// cause: PR #748 uploads the spinner GIF via POST /adimages to mint an
// image_hash, and that hash resolves to an image in the AD ACCOUNT's own
// image library from then on — GET /{adAccountId}/adimages?hashes=[h]&fields=url
// returns an ad-account-scoped scontent*.fbcdn.net URL, NEVER the original
// static.xx.fbcdn.net/rsrc.php/AAqMW82PqGg.gif URL isMetaPlaceholderThumbnailUrl
// was built to catch. That classifier is still correct for its actual job
// (rejecting the LIVE pre-upload GET /{videoId}?fields=picture response,
// used below in repairOne) but structurally cannot fire on a resolved ad
// image. Fix: classify the RESOLVED IMAGE ITSELF, not its URL —
// isMetaPlaceholderThumbnailImage inspects width/height/name/gif-extension
// (requested via the expanded /adimages `fields=hash,url,width,height,name`)
// and, only when those don't already settle it, a HEAD request's
// content-length. The spinner survives the upload→hash→resolve roundtrip as
// a ~1 KB 16×16 GIF; real thumbnails are 15–50 KB JPGs at video aspect
// ratios. `--diagnose-hash=<hash> --ad-account=<id>` prints the resolved
// fingerprint for one hash so operators can sanity-check a known-broken
// creative against the classifier before trusting a full scan.
//
// Safety: DRY RUN by default (reports what it would do, makes zero writes).
// Pass --live to actually call Meta + Supabase writes. Rate-limited:
// 1 ad/sec during the discovery/fetch pass (per ad's creative resolution,
// and per unique image_hash resolved), 1 creative/sec during the repair
// pass. Resumable via a local JSON checkpoint file — re-running after a
// crash / Ctrl-C skips campaigns already scanned and creatives already
// marked "fixed".
//
// Usage:
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs                 # dry run, last 90 days
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --live          # actually repair
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --live --days=30
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --live --checkpoint=/tmp/my-checkpoint.json
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --campaign-ids=123,456 --live   # skip draft discovery, target campaigns directly
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --force-rescan     # ignore the discovery checkpoint, re-scan every campaign
//   node --env-file=.env.local scripts/repair-video-thumbnails.mjs --diagnose-hash=abc123 --ad-account=999888777   # print one hash's resolved fingerprint, no writes/discovery
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
const FORCE_RESCAN = args.includes("--force-rescan");
const daysArg = args.find((a) => a.startsWith("--days="));
const DAYS = daysArg ? Number(daysArg.slice("--days=".length)) : 90;
const checkpointArg = args.find((a) => a.startsWith("--checkpoint="));
const CHECKPOINT_PATH = checkpointArg
  ? resolve(process.cwd(), checkpointArg.slice("--checkpoint=".length))
  : resolve(__dirname, ".repair-video-thumbnails-checkpoint.json");
const campaignIdsArg = args.find((a) => a.startsWith("--campaign-ids="));
const TARGET_CAMPAIGN_IDS = campaignIdsArg
  ? campaignIdsArg
      .slice("--campaign-ids=".length)
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
  : null;
const diagnoseHashArg = args.find((a) => a.startsWith("--diagnose-hash="));
const DIAGNOSE_HASH = diagnoseHashArg ? diagnoseHashArg.slice("--diagnose-hash=".length).trim() : null;
const adAccountArg = args.find((a) => a.startsWith("--ad-account="));
const DIAGNOSE_AD_ACCOUNT = adAccountArg ? adAccountArg.slice("--ad-account=".length).trim() : null;

// ─── Over-scan guard constants ────────────────────────────────────────────────
//
// The spinner bug can only exist on ads created on/after PR #748's merge
// date — anything older used a different (image_url) thumbnail path and is
// out of scope for this repair. Mirrors lib/meta/video-thumbnail-repair-scan.ts's
// DEFAULT_BUG_INTRODUCED_AT / DEFAULT_MAX_ADS_PER_CAMPAIGN.

const BUG_INTRODUCED_AT = "2026-08-07T00:00:00+00:00";
const MAX_ADS_PER_CAMPAIGN = 200;

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
//
// Two DIFFERENT classifiers for two different stages of the same spinner's
// lifecycle — see the "DETECTION GAP FIX" doc comment above for why both are
// needed:
//   - isMetaPlaceholderThumbnailUrl: URL/host-based. Valid ONLY for the LIVE
//     pre-upload GET /{videoId}?fields=picture response (used in repairOne
//     below) — the spinner is still served from Meta's static UI CDN there.
//   - isMetaPlaceholderThumbnailImage: fingerprint-based (dimensions/format/
//     size). Used for the discovery pass's RESOLVED /adimages metadata,
//     where the URL has already been re-hosted and carries no signal.

const PLACEHOLDER_CDN_PATTERN = /^https?:\/\/(static|www)\.[a-z0-9.-]*fbcdn\.net\/rsrc\.php\//i;
const KNOWN_SPINNER_FILENAME_FRAGMENT = "AAqMW82PqGg";

function isMetaPlaceholderThumbnailUrl(url) {
  if (!url) return false;
  if (PLACEHOLDER_CDN_PATTERN.test(url)) return true;
  if (url.includes(KNOWN_SPINNER_FILENAME_FRAGMENT)) return true;
  return false;
}

const SPINNER_MAX_DIMENSION_PX = 32;
const SPINNER_MAX_CONTENT_LENGTH_BYTES = 5000;

/**
 * Classifies an already-uploaded ad image (resolved via /adimages, optionally
 * enriched with a HEAD-derived contentLengthBytes) as Meta's placeholder/
 * spinner rather than a real video thumbnail. Mirrors
 * lib/meta/video-thumbnail-poll.ts's isMetaPlaceholderThumbnailImage.
 */
function isMetaPlaceholderThumbnailImage(image) {
  if (
    typeof image.width === "number" &&
    typeof image.height === "number" &&
    image.width <= SPINNER_MAX_DIMENSION_PX &&
    image.height <= SPINNER_MAX_DIMENSION_PX
  ) {
    return true;
  }

  const name = image.name ?? "";
  const url = image.url ?? "";

  if (/\.gif(\?|$)/i.test(name) || /\.gif(\?|$)/i.test(url)) return true;
  if (name.includes(KNOWN_SPINNER_FILENAME_FRAGMENT) || url.includes(KNOWN_SPINNER_FILENAME_FRAGMENT)) return true;
  if (name.toLowerCase().includes("rsrc")) return true;

  if (typeof image.contentLengthBytes === "number" && image.contentLengthBytes < SPINNER_MAX_CONTENT_LENGTH_BYTES) {
    return true;
  }

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

// ─── Checkpoint ───────────────────────────────────────────────────────────────
//
// Two independent sections: `discovery` (per-campaign scan results — new in
// this revision, see FIX 3) and `repair` (per-creative repair outcomes,
// unchanged shape from the original script). Both survive a crash/Ctrl-C;
// re-running skips anything already recorded unless explicitly overridden
// (`--force-rescan` for discovery, checkpoint status "fixed" for repair).

async function loadCheckpoint() {
  try {
    const raw = await readFile(CHECKPOINT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return { discovery: parsed.discovery ?? {}, repair: parsed.repair ?? {} };
  } catch {
    return { discovery: {}, repair: {} };
  }
}

async function saveCheckpoint(checkpoint) {
  await writeFile(CHECKPOINT_PATH, JSON.stringify(checkpoint, null, 2));
}

function campaignKey(adAccountId, campaignId) {
  return `${adAccountId}:${campaignId}`;
}

// ─── Supabase: candidate drafts (used ONLY to discover metaCampaignId(s)) ────
//
// draft_json.launchSummary.metaCampaignId is the PRIMARY campaign for a
// launch; draft_json.launchSummary.campaignAttachResults[].campaignId
// (task #125 — multi-campaign bulk-attach) covers any additional campaigns
// the same draft attached ad sets to. All actual ad/creative/thumbnail state
// is read straight from Meta below — draft_json is never trusted for that.

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

// ─── Collect distinct (adAccountId, campaignId) targets to scan on Meta ──────

function collectCampaignTargets(rows) {
  const byKey = new Map();

  for (const row of rows) {
    const draft = row.draft_json;
    const adAccountId = draft?.settings?.adAccountId;
    const draftName = draft?.settings?.campaignName ?? row.name ?? "(untitled)";
    const launchSummary = draft?.launchSummary;
    if (!adAccountId || !launchSummary) continue;

    const campaignIds = new Set();
    if (launchSummary.metaCampaignId) campaignIds.add(launchSummary.metaCampaignId);
    for (const attach of launchSummary.campaignAttachResults ?? []) {
      if (attach?.campaignId) campaignIds.add(attach.campaignId);
    }

    for (const campaignId of campaignIds) {
      const key = `${adAccountId}:${campaignId}`;
      if (!byKey.has(key)) {
        byKey.set(key, { adAccountId, campaignId, draftId: row.id, draftName });
      }
    }
  }

  const targets = [...byKey.values()];
  targets.sort((a, b) => priorityRank(a.draftName) - priorityRank(b.draftName));
  return targets;
}

// ─── Meta calls ───────────────────────────────────────────────────────────────

function withActPrefix(adAccountId) {
  if (!adAccountId) return adAccountId;
  return adAccountId.startsWith("act_") ? adAccountId : `act_${adAccountId}`;
}

// ─── Discovery pass — mirrors lib/meta/video-thumbnail-repair-scan.ts ───────

async function fetchCampaignAds(campaignId) {
  const ads = [];
  let after;

  for (;;) {
    const url = new URL(`${GRAPH_BASE}/${campaignId}/ads`);
    url.searchParams.set("fields", "id,name,created_time,creative{id,object_story_spec}");
    url.searchParams.set("limit", "100");
    url.searchParams.set("access_token", metaToken);
    if (after) url.searchParams.set("after", after);

    const res = await fetch(url.toString());
    const json = await res.json();
    if (!res.ok || json.error) {
      throw new Error(`GET /${campaignId}/ads failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
    }
    ads.push(...(json.data ?? []));

    const nextAfter = json.paging?.cursors?.after;
    if (!json.paging?.next || !nextAfter || nextAfter === after) break;
    after = nextAfter;
  }

  return ads;
}

/**
 * Drops ads created strictly before `bugIntroducedAt` — mirrors
 * lib/meta/video-thumbnail-repair-scan.ts's filterAdsByCreatedTime. Ads with
 * a missing/unparseable created_time are conservatively KEPT.
 */
function filterAdsByCreatedTime(ads, bugIntroducedAt = BUG_INTRODUCED_AT) {
  const cutoff = new Date(bugIntroducedAt).getTime();
  const kept = [];
  let skippedCount = 0;

  for (const ad of ads) {
    const createdAt = ad.created_time ? new Date(ad.created_time).getTime() : NaN;
    if (Number.isFinite(createdAt) && createdAt < cutoff) {
      skippedCount++;
      continue;
    }
    kept.push(ad);
  }

  return { kept, skippedCount };
}

/** GET /{campaignId}?fields=account_id,name — used by --campaign-ids targeted mode, which skips draft discovery entirely. */
async function fetchCampaignAccountId(campaignId) {
  const url = `${GRAPH_BASE}/${campaignId}?fields=account_id,name&access_token=${encodeURIComponent(metaToken)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`GET /${campaignId}?fields=account_id,name failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  if (!json.account_id) {
    throw new Error(`/${campaignId} response had no account_id`);
  }
  return { adAccountId: json.account_id, campaignName: json.name };
}

async function fetchCreativeObjectStorySpecForAd(creativeId) {
  const url = `${GRAPH_BASE}/${creativeId}?fields=object_story_spec&access_token=${encodeURIComponent(metaToken)}`;
  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`GET /${creativeId}?fields=object_story_spec failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json.object_story_spec;
}

/**
 * GET /{adAccountId}/adimages?hashes=["<hash>"]&fields=hash,url,width,height,name
 * — resolves the full image metadata Meta currently has for a single
 * image_hash. Mirrors lib/meta/video-thumbnail-repair-scan.ts's
 * resolveImageHashMetadata.
 */
async function resolveImageHashMetadata(adAccountId, hash) {
  const url = new URL(`${GRAPH_BASE}/${withActPrefix(adAccountId)}/adimages`);
  url.searchParams.set("hashes", JSON.stringify([hash]));
  url.searchParams.set("fields", "hash,url,width,height,name");
  url.searchParams.set("access_token", metaToken);

  const res = await fetch(url.toString());
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(
      `GET /${withActPrefix(adAccountId)}/adimages?hashes=["${hash}"] failed: ${json.error?.message ?? `HTTP ${res.status}`}`,
    );
  }
  const record = json.data?.find((d) => d.hash === hash) ?? json.data?.[0];
  if (!record) return undefined;
  return { url: record.url, width: record.width, height: record.height, name: record.name };
}

/**
 * HEAD the resolved image URL for its on-disk size (content-length header) —
 * a fallback signal for when width/height/name/gif-extension checks alone
 * don't settle the classification. Returns undefined on any failure.
 */
async function fetchContentLength(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    if (!res.ok) return undefined;
    const header = res.headers?.get?.("content-length");
    if (!header) return undefined;
    const parsed = Number(header);
    return Number.isFinite(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractVideoCreativeInfo(ad, spec) {
  if (!ad.creative?.id) return null;
  const videoData = spec?.video_data;
  if (!videoData?.video_id || !videoData?.image_hash) return null;
  return {
    adId: ad.id,
    adName: ad.name,
    creativeId: ad.creative.id,
    videoId: videoData.video_id,
    imageHash: videoData.image_hash,
  };
}

/**
 * Scans one Meta campaign for ads whose live video creative is currently
 * serving a placeholder/spinner thumbnail. Rate-limited: 1 ad/sec while
 * resolving each ad's creative info, 1/sec per UNIQUE image_hash resolved.
 *
 * Over-scan guard (FIX 1 + FIX 2): ads older than BUG_INTRODUCED_AT are
 * dropped BEFORE any per-ad/per-hash calls; if more than
 * MAX_ADS_PER_CAMPAIGN ads remain, the campaign is skipped entirely
 * (`sizeCapExceeded: true`, zero further Meta calls) unless
 * `bypassSizeCap` is set (the --campaign-ids explicit opt-in).
 */
async function scanCampaignForBrokenVideoAds(campaignTarget) {
  const { campaignId, adAccountId, draftId, draftName, bypassSizeCap } = campaignTarget;
  const allAds = await fetchCampaignAds(campaignId);
  const { kept: ads, skippedCount: skippedOldAdCount } = filterAdsByCreatedTime(allAds);
  console.log(
    `  campaign ${campaignId} ("${draftName}"): ${allAds.length} ad(s) — ` +
      `${skippedOldAdCount}/${allAds.length} too old to be affected (before ${BUG_INTRODUCED_AT}) — skipping`,
  );

  if (!bypassSizeCap && ads.length > MAX_ADS_PER_CAMPAIGN) {
    console.warn(
      `  campaign ${campaignId} has ${ads.length} ad(s) after the date filter (> ${MAX_ADS_PER_CAMPAIGN} cap) — ` +
        `SKIPPING. Re-run with --campaign-ids=${campaignId} to explicitly opt in.`,
    );
    return {
      broken: [],
      totalAdCount: allAds.length,
      skippedOldAdCount,
      scannedAdCount: ads.length,
      sizeCapExceeded: true,
    };
  }

  const infos = [];
  for (const ad of ads) {
    await sleep(1000); // 1 ad/sec — rate-limit-friendly
    try {
      let spec = ad.creative?.object_story_spec;
      if (ad.creative?.id && !spec?.video_data) {
        spec = await fetchCreativeObjectStorySpecForAd(ad.creative.id);
      }
      const info = extractVideoCreativeInfo(ad, spec);
      if (info) infos.push(info);
    } catch (err) {
      console.warn(`    ad ${ad.id}: failed to resolve creative — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const uniqueHashes = [...new Set(infos.map((i) => i.imageHash))];
  const hashToFingerprint = new Map();
  for (const hash of uniqueHashes) {
    await sleep(1000); // 1 hash/sec — rate-limit-friendly
    try {
      const metadata = await resolveImageHashMetadata(adAccountId, hash);
      if (!metadata) continue;

      // Only pay for the extra CDN round-trip (+ its own 1/sec rate limit)
      // when width/height/name/gif checks didn't already settle it — most
      // real thumbnails land here.
      let fingerprint = metadata;
      if (!isMetaPlaceholderThumbnailImage(metadata) && metadata.url) {
        await sleep(1000);
        const contentLengthBytes = await fetchContentLength(metadata.url);
        fingerprint = { ...metadata, contentLengthBytes };
      }
      hashToFingerprint.set(hash, fingerprint);
    } catch (err) {
      console.warn(`    image_hash ${hash}: failed to resolve metadata — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const broken = [];
  for (const info of infos) {
    const fingerprint = hashToFingerprint.get(info.imageHash);
    if (fingerprint && isMetaPlaceholderThumbnailImage(fingerprint)) {
      broken.push({ ...info, placeholderUrl: fingerprint.url ?? "", fingerprint, campaignId, adAccountId, draftId, draftName });
    }
  }
  return { broken, totalAdCount: allAds.length, skippedOldAdCount, scannedAdCount: ads.length, sizeCapExceeded: false };
}

// ─── Collect broken creatives across every candidate campaign (deduped by creative id) ─
//
// FIX 3: the discovery pass is now checkpointed per campaign
// (checkpoint.discovery[adAccountId:campaignId]) — a campaign already
// scanned (status "scanned") is skipped on re-run unless --force-rescan.
// A campaign previously skipped for being too large (status
// "skipped_too_large") is always re-attempted, since a subsequent run might
// target it explicitly via --campaign-ids (bypassSizeCap) or a different cap.

async function collectBrokenCreatives(campaignTargets, checkpoint) {
  const byCreativeId = new Map();

  for (const target of campaignTargets) {
    const key = campaignKey(target.adAccountId, target.campaignId);
    const prior = checkpoint.discovery[key];

    if (prior?.status === "scanned" && !FORCE_RESCAN) {
      console.log(`  campaign ${target.campaignId} ("${target.draftName}"): using cached discovery result (${prior.brokenTargets.length} broken) — pass --force-rescan to re-scan`);
      for (const b of prior.brokenTargets) {
        if (!byCreativeId.has(b.creativeId)) byCreativeId.set(b.creativeId, b);
      }
      continue;
    }

    const result = await scanCampaignForBrokenVideoAds(target);
    if (result.sizeCapExceeded) {
      checkpoint.discovery[key] = {
        status: "skipped_too_large",
        campaignId: target.campaignId,
        adAccountId: target.adAccountId,
        draftName: target.draftName,
        totalAdCount: result.totalAdCount,
        skippedOldAdCount: result.skippedOldAdCount,
        scannedAdCount: result.scannedAdCount,
        scannedAt: new Date().toISOString(),
      };
    } else {
      checkpoint.discovery[key] = {
        status: "scanned",
        campaignId: target.campaignId,
        adAccountId: target.adAccountId,
        draftName: target.draftName,
        totalAdCount: result.totalAdCount,
        skippedOldAdCount: result.skippedOldAdCount,
        scannedAdCount: result.scannedAdCount,
        brokenTargets: result.broken,
        scannedAt: new Date().toISOString(),
      };
      for (const b of result.broken) {
        if (!byCreativeId.has(b.creativeId)) byCreativeId.set(b.creativeId, b);
      }
    }
    await saveCheckpoint(checkpoint);
  }

  const targets = [...byCreativeId.values()];
  targets.sort((a, b) => priorityRank(a.draftName) - priorityRank(b.draftName));
  return targets;
}

// ─── Meta calls (repair pass) ─────────────────────────────────────────────────

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
//
// Matches by `asset.videoId` (NOT `asset.id`/`metaCreativeId` — those aren't
// reliably present post-launch, see the discovery-pivot doc comment at the
// top of this file) across every candidate draft loaded for this run. A
// video asset can be duplicated across drafts (templates, "duplicate
// campaign", multi-campaign attach reusing the same creative) — all of them
// get patched, not just the one draft whose campaign happened to surface the
// broken ad on Meta.

function findRowIdsReferencingVideoId(rows, videoId) {
  const ids = [];
  for (const row of rows) {
    const creatives = row.draft_json?.creatives ?? [];
    const hasMatch = creatives.some((creative) =>
      (creative.assetVariations ?? []).some((variation) =>
        (variation.assets ?? []).some((asset) => asset.videoId === videoId),
      ),
    );
    if (hasMatch) ids.push(row.id);
  }
  return ids;
}

async function patchDraftAssetThumbnailsByVideoId(rows, videoId, newThumbnailUrl, newHash) {
  const candidateIds = findRowIdsReferencingVideoId(rows, videoId);
  if (candidateIds.length === 0) {
    console.warn(`  [draft-repair] no draft assets found referencing videoId=${videoId} — skipping local repair`);
    return;
  }

  let patchedDrafts = 0;
  let patchedAssets = 0;

  for (const draftId of candidateIds) {
    // Re-read immediately before writing (rather than trusting the possibly
    // stale in-memory copy from the initial candidate load) to avoid
    // clobbering unrelated edits made to the draft mid-run.
    const { data, error: readError } = await supabase
      .from("campaign_drafts")
      .select("draft_json")
      .eq("id", draftId)
      .maybeSingle();
    if (readError || !data) {
      console.warn(`  [draft-repair] could not re-read draft ${draftId}: ${readError?.message ?? "not found"} — skipping`);
      continue;
    }

    const draft = data.draft_json;
    let touchedHere = 0;
    for (const creative of draft.creatives ?? []) {
      for (const variation of creative.assetVariations ?? []) {
        for (const asset of variation.assets ?? []) {
          if (asset.videoId === videoId) {
            asset.thumbnailUrl = newThumbnailUrl;
            asset.assetHash = newHash;
            touchedHere++;
          }
        }
      }
    }
    if (touchedHere === 0) continue;

    draft.updatedAt = new Date().toISOString();
    const { error: writeError } = await supabase
      .from("campaign_drafts")
      .update({ draft_json: draft, updated_at: draft.updatedAt })
      .eq("id", draftId);
    if (writeError) {
      console.warn(`  [draft-repair] failed to write repaired draft_json for ${draftId}: ${writeError.message}`);
      continue;
    }
    patchedDrafts++;
    patchedAssets += touchedHere;
  }

  console.log(`  [draft-repair] patched ${patchedAssets} asset(s) across ${patchedDrafts} draft(s) referencing videoId=${videoId}`);
}

// ─── Repair one creative ──────────────────────────────────────────────────────

async function repairOne(target, rows) {
  console.log(
    `\n→ "${target.draftName}" / ad "${target.adName ?? target.adId}" / creative ${target.creativeId}, ` +
      `campaign=${target.campaignId}, videoId=${target.videoId}, placeholder=${target.placeholderUrl}`,
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
    throw new Error("adAccountId missing for this campaign target — cannot upload replacement image");
  }

  const { hash } = await uploadImageFromUrl(target.adAccountId, picture);
  console.log(`  uploaded as image_hash=${hash}`);

  const currentSpec = await fetchCurrentObjectStorySpec(target.creativeId);
  await patchCreativeImageHash(target.creativeId, currentSpec, hash);
  console.log(`  patched creative ${target.creativeId} → image_hash=${hash}`);

  await patchDraftAssetThumbnailsByVideoId(rows, target.videoId, picture, hash);

  return { status: "fixed", picture, hash };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Campaign target resolution ──────────────────────────────────────────────

/**
 * --campaign-ids mode: skips draft discovery entirely, resolving each given
 * campaign ID's ad account directly from Meta. `bypassSizeCap: true` — this
 * is the operator's explicit opt-in past the size cap (FIX 2).
 */
async function resolveExplicitCampaignTargets(campaignIds) {
  const targets = [];
  for (const campaignId of campaignIds) {
    const { adAccountId, campaignName } = await fetchCampaignAccountId(campaignId);
    targets.push({
      adAccountId,
      campaignId,
      draftId: undefined,
      draftName: campaignName ?? `(campaign ${campaignId})`,
      bypassSizeCap: true,
    });
  }
  return targets;
}

/**
 * `--diagnose-hash=<hash> --ad-account=<id>` — prints the resolved
 * image_hash fingerprint (metadata + HEAD content-length) and whether the
 * new classifier flags it, with zero discovery/repair/writes. Purely a
 * sanity-check tool for operators confirming a known-broken creative's hash
 * (e.g. IPC Motion 1) lands under isMetaPlaceholderThumbnailImage before
 * trusting a full campaign scan.
 */
async function runDiagnoseHash(hash, adAccountId) {
  console.log(`[diagnose-hash] resolving metadata for hash=${hash} adAccount=${adAccountId}...`);
  const metadata = await resolveImageHashMetadata(adAccountId, hash);
  if (!metadata) {
    console.log(`[diagnose-hash] Meta returned no image for this hash — nothing to classify.`);
    return;
  }
  console.log(`[diagnose-hash] resolved metadata:`, JSON.stringify(metadata, null, 2));

  const flaggedByMetadataAlone = isMetaPlaceholderThumbnailImage(metadata);
  console.log(`[diagnose-hash] flagged by width/height/name/gif checks alone: ${flaggedByMetadataAlone}`);

  let fingerprint = metadata;
  if (!flaggedByMetadataAlone && metadata.url) {
    console.log(`[diagnose-hash] not conclusive from metadata — HEADing ${metadata.url} for content-length...`);
    const contentLengthBytes = await fetchContentLength(metadata.url);
    fingerprint = { ...metadata, contentLengthBytes };
    console.log(`[diagnose-hash] content-length: ${contentLengthBytes ?? "(unavailable)"}`);
  }

  const isPlaceholder = isMetaPlaceholderThumbnailImage(fingerprint);
  console.log(
    `\n[diagnose-hash] RESULT: ${isPlaceholder ? "BROKEN (placeholder/spinner)" : "fine (real thumbnail)"}\n` +
      `  full fingerprint: ${JSON.stringify(fingerprint, null, 2)}`,
  );
}

async function main() {
  if (DIAGNOSE_HASH) {
    if (!DIAGNOSE_AD_ACCOUNT) {
      throw new Error("--diagnose-hash requires --ad-account=<id>");
    }
    await runDiagnoseHash(DIAGNOSE_HASH, DIAGNOSE_AD_ACCOUNT);
    return;
  }

  console.log(
    `[repair-video-thumbnails] mode=${LIVE ? "LIVE" : "DRY RUN"} days=${DAYS} checkpoint=${CHECKPOINT_PATH} ` +
      `bugIntroducedAt=${BUG_INTRODUCED_AT} maxAdsPerCampaign=${MAX_ADS_PER_CAMPAIGN} forceRescan=${FORCE_RESCAN}`,
  );
  console.log(
    `Only ads created on/after ${BUG_INTRODUCED_AT} (PR #748) can have the spinner-thumbnail bug — ` +
      `anything older is skipped as out of scope for this repair.`,
  );

  // Draft rows are always loaded — even in --campaign-ids mode — because the
  // repair pass's best-effort local draft patching (patchDraftAssetThumbnailsByVideoId)
  // still needs them. Only CAMPAIGN SELECTION skips draft discovery when
  // --campaign-ids is given (per FIX 2).
  const rows = await loadCandidateDrafts();
  console.log(`Loaded ${rows.length} published draft(s) from the last ${DAYS} days (for best-effort local repair matching).`);

  let campaignTargets;
  if (TARGET_CAMPAIGN_IDS) {
    console.log(`\n--campaign-ids given (${TARGET_CAMPAIGN_IDS.join(", ")}) — skipping draft-based campaign discovery entirely.`);
    campaignTargets = await resolveExplicitCampaignTargets(TARGET_CAMPAIGN_IDS);
  } else {
    campaignTargets = collectCampaignTargets(rows);
    console.log(`Discovered ${campaignTargets.length} distinct Meta campaign(s) to scan.`);
  }
  if (campaignTargets.length === 0) {
    console.log("No campaigns to scan. Exiting.");
    return;
  }

  const checkpoint = await loadCheckpoint();

  console.log("\n─── Discovery pass (querying Meta directly) ───────────");
  const targets = await collectBrokenCreatives(campaignTargets, checkpoint);
  console.log(`\nFound ${targets.length} broken video ad(s) (deduped by Meta creative id).`);
  if (targets.length === 0) {
    console.log("Nothing to repair. Exiting.");
    return;
  }

  let fixed = 0;
  let alreadyFixed = 0;
  let failed = 0;
  let wouldFix = 0;

  console.log("\n─── Repair pass ────────────────────────────────────────");
  for (const target of targets) {
    const prior = checkpoint.repair[target.creativeId];
    if (prior?.status === "fixed") {
      alreadyFixed++;
      console.log(`\n→ "${target.draftName}" / ad "${target.adName ?? target.adId}" — already fixed (checkpoint), skipping`);
      continue;
    }

    try {
      const result = await repairOne(target, rows);
      checkpoint.repair[target.creativeId] = {
        status: result.status,
        draftName: target.draftName,
        adName: target.adName,
        adId: target.adId,
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
      checkpoint.repair[target.creativeId] = {
        status: "failed",
        draftName: target.draftName,
        adName: target.adName,
        adId: target.adId,
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
