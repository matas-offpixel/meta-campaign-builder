/**
 * Approve a Creative Lab round, then launch its ready ads paused.
 *
 * Nothing here imports the Meta routes. The route handler passes
 * handleUploadAsset and metaLaunchPost in. createPaused is set only by
 * buildLabLaunchBody. A retry skips ads that already launched; it does
 * not run by itself.
 */

import { buildLabDraft, buildLabLaunchBody, type LabDraftAd, type LabDraftTarget } from "./lab-draft.ts";
import { LAB_LAUNCHES_OFF, labLaunchesEnabled } from "./killswitch.ts";
import type { ServiceRoleDb } from "./load.ts";
import { assertArtistCleared, type LabArtist } from "./rounds.ts";
import { assignCaptionStyleTag, isCaptionStyle, type CaptionStyle } from "./tags.ts";

export class LabLaunchError extends Error {
  readonly code: "not_found" | "not_approved" | "no_target" | "rights";

  constructor(code: LabLaunchError["code"], message: string) {
    super(message);
    this.name = "LabLaunchError";
    this.code = code;
  }
}

type Row = Record<string, unknown>;

async function one(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row | null> {
  const res = await db.from(table).select("*").eq(column, value).maybeSingle();
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data as Row | null) ?? null;
}

async function many(db: ServiceRoleDb, table: string, column: string, value: string): Promise<Row[]> {
  const res = await db.from(table).select("*").eq(column, value);
  if (res.error) throw new Error(`${table}: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}

export type LabUploadRequest = {
  storagePath: string;
  storageBucket: "campaign-assets";
  type: "video";
  adAccountId: string;
  fileName: string;
  aspectRatio: "9:16";
  contentHash: string;
  byteSize: number;
};

export type LabUploadResult = { videoId: string; registryAssetId?: string | null };

export type LabLaunchResponse = {
  ok: boolean;
  status: number;
  launchRunId?: string;
  error?: string;
  creativesFailed?: { name: string; error: string }[];
};

export type LaunchRoundDeps = {
  db: ServiceRoleDb;
  userId: string;
  upload: (request: LabUploadRequest) => Promise<LabUploadResult>;
  launch: (body: ReturnType<typeof buildLabLaunchBody>) => Promise<LabLaunchResponse>;
  tag?: typeof assignCaptionStyleTag;
  now?: Date;
};

export type LaunchRoundResult = {
  roundId: string;
  status: string;
  launched: { roundAdId: string; adName: string; metaAdId: string }[];
  skipped: { roundAdId: string; adName: string; reason: string }[];
  errors: { roundAdId: string; adName: string; error: string }[];
};

const TARGET_COLUMNS = ["ad_account_id", "meta_campaign_id", "meta_adset_id", "page_id", "destination_url", "cta", "meta_campaign_objective", "meta_adset_name"] as const;

function text(row: Row, key: string): string {
  return String(row[key] ?? "").trim();
}

/** Draft → approved. Every round ad must be ready or render_failed. */
export async function approveRound(
  db: ServiceRoleDb,
  args: { roundId: string; userId: string; now?: Date },
): Promise<{ id: string; status: "approved" }> {
  const round = await one(db, "creative_lab_rounds", "id", args.roundId);
  if (!round || text(round, "user_id") !== args.userId) {
    throw new LabLaunchError("not_found", "No round with that id.");
  }
  if (text(round, "status") !== "draft") {
    throw new LabLaunchError("not_approved", "Only a draft round can be approved.");
  }
  const ads = await many(db, "creative_lab_round_ads", "round_id", args.roundId);
  if (!ads.length) throw new LabLaunchError("not_approved", "The round has no ads.");
  const pending = ads.filter((ad) => !["ready", "render_failed"].includes(text(ad, "launch_state")));
  if (pending.length) {
    throw new LabLaunchError("not_approved", "Renders are still pending.");
  }
  const now = (args.now ?? new Date()).toISOString();
  const updated = await db
    .from("creative_lab_rounds")
    .update({ status: "approved", approved_by: args.userId, approved_at: now })
    .eq("id", args.roundId)
    .eq("user_id", args.userId);
  if (updated.error) throw new Error(`creative_lab_rounds: ${updated.error.message}`);
  return { id: args.roundId, status: "approved" };
}

async function ownedRound(db: ServiceRoleDb, roundId: string, userId: string): Promise<Row> {
  const round = await one(db, "creative_lab_rounds", "id", roundId);
  if (!round || text(round, "user_id") !== userId) throw new LabLaunchError("not_found", "No round with that id.");
  return round;
}

function targetOf(round: Row, eventName: string, clientId: string | null): LabDraftTarget {
  const missing = TARGET_COLUMNS.filter((column) => !text(round, column));
  if (missing.length) throw new LabLaunchError("no_target", `The round has no ${missing.join(", ")}.`);
  return {
    roundId: text(round, "id"),
    eventId: text(round, "event_id"),
    clientId,
    campaignName: eventName || "Creative Lab",
    adAccountId: text(round, "ad_account_id"),
    campaignId: text(round, "meta_campaign_id"),
    campaignObjective: text(round, "meta_campaign_objective"),
    adSetId: text(round, "meta_adset_id"),
    adSetName: text(round, "meta_adset_name"),
    adSetStatus: text(round, "meta_adset_status") || "ACTIVE",
    destinationUrl: text(round, "destination_url"),
    cta: text(round, "cta"),
  };
}

/**
 * Launch every ready ad in an approved round, paused.
 * render_failed ads are listed and skipped. A launch_failed ad is tried
 * again. An ad that already has a launch row is not sent twice.
 * The round becomes launched only when at least one ad launched and none
 * of the ads we sent failed. Otherwise it stays approved.
 */
export async function launchApprovedRound(roundId: string, deps: LaunchRoundDeps): Promise<LaunchRoundResult> {
  const round = await ownedRound(deps.db, roundId, deps.userId);
  if (text(round, "status") !== "approved") {
    throw new LabLaunchError("not_approved", "The round is not approved.");
  }

  const event = await one(deps.db, "events", "id", text(round, "event_id"));
  if (!event) throw new LabLaunchError("not_found", "No event with that id.");
  const artistRow = await one(deps.db, "creative_lab_artists", "id", text(round, "artist_id"));
  const artist = artistRow as LabArtist | null;
  try {
    assertArtistCleared(artist, event?.client_id ? String(event.client_id) : null);
  } catch (err) {
    throw new LabLaunchError("rights", err instanceof Error ? err.message : String(err));
  }
  const target = targetOf(round, event?.name ? String(event.name) : "", event?.client_id ? String(event.client_id) : null);

  const [ads, captions, renders, assets, launches] = await Promise.all([
    many(deps.db, "creative_lab_round_ads", "round_id", roundId),
    many(deps.db, "creative_lab_captions", "event_id", text(round, "event_id")),
    many(deps.db, "creative_lab_renders", "user_id", deps.userId),
    many(deps.db, "creative_assets", "user_id", deps.userId),
    many(deps.db, "creative_lab_round_ad_launches", "user_id", deps.userId),
  ]);
  const captionOf = new Map(captions.map((row) => [text(row, "id"), row]));
  const renderOf = new Map(renders.map((row) => [text(row, "id"), row]));
  const assetOf = new Map(assets.map((row) => [text(row, "id"), row]));
  const already = new Set(launches.map((row) => text(row, "round_ad_id")));
  const artistPageId = text(artistRow ?? {}, "meta_page_id");
  const artistInstagramId = text(artistRow ?? {}, "instagram_actor_id");
  const promoterInstagramId = text(round, "instagram_actor_id") || null;

  const skipped: LaunchRoundResult["skipped"] = [];
  const errors: LaunchRoundResult["errors"] = [];
  const ready: { ad: Row; caption: Row; asset: Row; style: CaptionStyle; pageId: string; instagramActorId: string | null }[] = [];

  for (const ad of ads) {
    const state = text(ad, "launch_state");
    const adName = text(ad, "ad_name");
    if (state === "render_failed") {
      skipped.push({ roundAdId: text(ad, "id"), adName, reason: text(ad, "launch_error") || "render failed" });
      continue;
    }
    if (state === "launched" || already.has(text(ad, "id"))) continue;
    if (state !== "ready" && state !== "launch_failed") continue;
    const caption = captionOf.get(text(ad, "caption_id"));
    const render = renderOf.get(text(ad, "render_id"));
    const asset = render ? assetOf.get(text(render, "creative_asset_id")) : undefined;
    const style = caption ? text(caption, "style") : "";
    if (!caption || !isCaptionStyle(style) || !asset || !text(asset, "storage_path") || !text(asset, "content_hash")) {
      errors.push({ roundAdId: text(ad, "id"), adName, error: "the render file is missing" });
      await mark(deps.db, text(ad, "id"), "launch_failed", "the render file is missing");
      continue;
    }
    if (style === "artist_first_person") {
      if (!artistPageId) {
        errors.push({ roundAdId: text(ad, "id"), adName, error: "no artist page" });
        await mark(deps.db, text(ad, "id"), "launch_failed", "no artist page");
        continue;
      }
      if (!artistInstagramId) {
        errors.push({ roundAdId: text(ad, "id"), adName, error: "no artist Instagram account" });
        await mark(deps.db, text(ad, "id"), "launch_failed", "no artist Instagram account");
        continue;
      }
      ready.push({ ad, caption, asset, style, pageId: artistPageId, instagramActorId: artistInstagramId });
      continue;
    }
    ready.push({ ad, caption, asset, style, pageId: text(round, "page_id"), instagramActorId: promoterInstagramId });
  }

  const result: LaunchRoundResult = { roundId, status: "approved", launched: [], skipped, errors };
  if (!ready.length) return result;

  const uploaded = new Map<string, LabUploadResult>();
  const draftAds: LabDraftAd[] = [];
  const sent: typeof ready = [];
  for (const item of ready) {
    const hash = text(item.asset, "content_hash");
    const key = `${target.adAccountId}:${hash}`;
    let video = uploaded.get(key);
    if (!video) {
      try {
        video = await deps.upload({
          storagePath: text(item.asset, "storage_path"),
          storageBucket: "campaign-assets",
          type: "video",
          adAccountId: target.adAccountId,
          fileName: text(item.asset, "filename") || `${text(item.ad, "ad_name")}.mp4`,
          aspectRatio: "9:16",
          contentHash: hash,
          byteSize: Number(item.asset.byte_size) || 0,
        });
        uploaded.set(key, video);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ roundAdId: text(item.ad, "id"), adName: text(item.ad, "ad_name"), error: message });
        await mark(deps.db, text(item.ad, "id"), "launch_failed", message);
        continue;
      }
    }
    if (!video.videoId) {
      errors.push({ roundAdId: text(item.ad, "id"), adName: text(item.ad, "ad_name"), error: "Meta did not return a video id" });
      await mark(deps.db, text(item.ad, "id"), "launch_failed", "Meta did not return a video id");
      continue;
    }
    draftAds.push({
      id: text(item.ad, "id"),
      adName: text(item.ad, "ad_name"),
      primaryText: text(item.caption, "primary_text"),
      videoId: video.videoId,
      registryAssetId: video.registryAssetId || text(item.asset, "id"),
      pageId: item.pageId,
      instagramActorId: item.instagramActorId,
    });
    sent.push(item);
  }
  if (!draftAds.length) return result;

  const draft = buildLabDraft(target, draftAds, deps.now);
  const response = await deps.launch(buildLabLaunchBody(draft));
  if (!response.ok || !response.launchRunId) {
    const message = response.error || `launch returned ${response.status}`;
    for (const item of sent) {
      errors.push({ roundAdId: text(item.ad, "id"), adName: text(item.ad, "ad_name"), error: message });
      await mark(deps.db, text(item.ad, "id"), "launch_failed", message);
    }
    return result;
  }

  if (response.ok) {
    const saved = await deps.db
      .from("creative_lab_rounds")
      .update({ draft_id: roundId })
      .eq("id", roundId)
      .eq("user_id", deps.userId);
    if (saved.error) throw new Error(`creative_lab_rounds draft_id: ${saved.error.message}`);
  }

  const launchedRes = await deps.db.from("launched_ads").select("*").eq("launch_run_id", response.launchRunId);
  if (launchedRes.error) throw new Error(`launched_ads: ${launchedRes.error.message}`);
  const byName = new Map(((launchedRes.data ?? []) as Row[]).map((row) => [text(row, "ad_name"), row]));
  const tag = deps.tag ?? assignCaptionStyleTag;

  for (const item of sent) {
    const adName = text(item.ad, "ad_name");
    const live = byName.get(adName);
    if (!live || !text(live, "meta_ad_id")) {
      const failed = response.creativesFailed?.find((row) => row.name === adName);
      const message = failed?.error || "Meta did not return this ad";
      errors.push({ roundAdId: text(item.ad, "id"), adName, error: message });
      await mark(deps.db, text(item.ad, "id"), "launch_failed", message);
      continue;
    }
    const inserted = await deps.db
      .from("creative_lab_round_ad_launches")
      .insert({
        user_id: deps.userId,
        round_ad_id: text(item.ad, "id"),
        meta_ad_id: text(live, "meta_ad_id"),
        meta_adset_id: text(live, "meta_adset_id") || target.adSetId,
        meta_campaign_id: text(live, "meta_campaign_id") || target.campaignId,
        ad_account_id: text(live, "ad_account_id") || target.adAccountId,
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(`creative_lab_round_ad_launches: ${inserted.error.message}`);
    await tag(deps.db, {
      userId: deps.userId,
      eventId: target.eventId,
      metaAdId: text(live, "meta_ad_id"),
      creativeName: adName,
      style: item.style,
    });
    await mark(deps.db, text(item.ad, "id"), "launched", null);
    result.launched.push({ roundAdId: text(item.ad, "id"), adName, metaAdId: text(live, "meta_ad_id") });
  }

  if (result.launched.length > 0 && result.errors.length === 0) {
    const now = (deps.now ?? new Date()).toISOString();
    const updated = await deps.db
      .from("creative_lab_rounds")
      .update({ status: "launched", launched_at: now })
      .eq("id", roundId)
      .eq("user_id", deps.userId);
    if (updated.error) throw new Error(`creative_lab_rounds: ${updated.error.message}`);
    result.status = "launched";
  }
  return result;
}

/** Killswitch first. Unset, or anything other than "true", returns 503 and calls nothing. */
export async function postLabLaunch(
  roundId: string,
  userId: string | null,
  deps: Omit<LaunchRoundDeps, "userId">,
): Promise<{ status: number; body: { error?: string } & Partial<LaunchRoundResult> }> {
  if (!labLaunchesEnabled()) return { status: 503, body: { error: LAB_LAUNCHES_OFF } };
  if (!userId) return { status: 401, body: { error: "Unauthorised" } };
  try {
    const result = await launchApprovedRound(roundId, { ...deps, userId });
    return { status: 200, body: result };
  } catch (err) {
    if (err instanceof LabLaunchError) {
      return { status: err.code === "not_found" ? 404 : 409, body: { error: err.message } };
    }
    throw err;
  }
}

async function mark(db: ServiceRoleDb, roundAdId: string, state: "launched" | "launch_failed", error: string | null): Promise<void> {
  const updated = await db
    .from("creative_lab_round_ads")
    .update({ launch_state: state, launch_error: error })
    .eq("id", roundAdId);
  if (updated.error) throw new Error(`creative_lab_round_ads: ${updated.error.message}`);
}
