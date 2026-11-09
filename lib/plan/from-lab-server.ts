/**
 * Lists this event's finished renders and adds one to the MML intake
 * from its Storage file (S17, HS12).
 */

import { upsertRegisteredAsset } from "../creatives/asset-registry.ts";
import type { Database } from "../db/database.types.ts";
import { attachIntakeAsset } from "./creative-intake-db.ts";
import { RENDER_NOT_ON_EVENT, RENDER_NOT_READY, finishedLabRenders } from "../drive/panel.ts";
import { labRenderHash, pairingName } from "./from-lab.ts";
import type { CampaignPlan } from "./types.ts";

type Db = Pick<import("@supabase/supabase-js").SupabaseClient<Database>, "from">;

export type LabSourceRow = {
  id: string;
  pairing: string;
  roundNo: number;
  durationSeconds: number | null;
  driveStatus: string | null;
  added: boolean;
};

export async function listLabSource(db: Db, plan: CampaignPlan): Promise<{ ok: true; eventName: string; rows: LabSourceRow[] } | { ok: false; error: string }> {
  const eventId = plan.intent.eventId;
  if (!eventId) return { ok: true, eventName: plan.name ?? "", rows: [] };
  const event = await db.from("events").select("name").eq("id", eventId).maybeSingle();
  if (event.error) return { ok: false, error: event.error.message };
  const clips = await db.from("creative_lab_clips").select("id, artist_id, clip_no, event_id").eq("event_id", eventId);
  if (clips.error) return { ok: false, error: clips.error.message };
  const clipIds = (clips.data ?? []).map((row) => row.id);
  if (clipIds.length === 0) return { ok: true, eventName: event.data?.name ?? plan.name ?? "", rows: [] };
  const renders = await db.from("creative_lab_renders").select("id, clip_id, caption_id, status, drive_status, creative_asset_id, created_at").in("clip_id", clipIds);
  if (renders.error) return { ok: false, error: renders.error.message };
  if ((renders.data ?? []).length === 0) return { ok: true, eventName: event.data?.name ?? plan.name ?? "", rows: [] };
  const captionIds = [...new Set((renders.data ?? []).map((row) => row.caption_id).filter((id): id is string => Boolean(id)))];
  const artistIds = [...new Set((clips.data ?? []).map((row) => row.artist_id).filter((id): id is string => Boolean(id)))];
  const captions = captionIds.length ? await db.from("creative_lab_captions").select("id, style").in("id", captionIds) : { data: [], error: null };
  if (captions.error) return { ok: false, error: captions.error.message };
  const artists = artistIds.length ? await db.from("creative_lab_artists").select("id, name").in("id", artistIds) : { data: [], error: null };
  if (artists.error) return { ok: false, error: artists.error.message };
  const ads = await db.from("creative_lab_round_ads").select("render_id, round_id").in("render_id", (renders.data ?? []).map((row) => row.id));
  if (ads.error) return { ok: false, error: ads.error.message };
  const roundIds = [...new Set((ads.data ?? []).map((row) => row.round_id))];
  const rounds = roundIds.length ? await db.from("creative_lab_rounds").select("id, round_no").in("id", roundIds) : { data: [], error: null };
  if (rounds.error) return { ok: false, error: rounds.error.message };
  const hashes = (renders.data ?? []).map((row) => labRenderHash(row.id));
  const assets = hashes.length
    ? await db.from("creative_assets").select("id, content_hash").eq("user_id", plan.userId).in("content_hash", hashes)
    : { data: [], error: null };
  if (assets.error) return { ok: false, error: assets.error.message };
  const assetIds = (assets.data ?? []).map((row) => row.id);
  const intake = assetIds.length
    ? await db.from("campaign_plan_intake_assets").select("asset_id").eq("plan_id", plan.id).in("asset_id", assetIds)
    : { data: [], error: null };
  if (intake.error) return { ok: false, error: intake.error.message };
  const addedHashes = new Set(
    (assets.data ?? [])
      .filter((row) => (intake.data ?? []).some((item) => item.asset_id === row.id))
      .map((row) => row.content_hash),
  );
  const clipOf = new Map((clips.data ?? []).map((row) => [row.id, row]));
  const artistOf = new Map((artists.data ?? []).map((row) => [row.id, row.name]));
  const captionOf = new Map((captions.data ?? []).map((row) => [row.id, row.style]));
  const roundOf = new Map((rounds.data ?? []).map((row) => [row.id, row.round_no]));
  const roundNo = new Map<string, number>();
  for (const ad of ads.data ?? []) {
    if (!ad.render_id || !ad.round_id) continue;
    const no = roundOf.get(ad.round_id) ?? 0;
    roundNo.set(ad.render_id, Math.max(roundNo.get(ad.render_id) ?? 0, no));
  }
  const ordered = finishedLabRenders(
    eventId,
    (renders.data ?? []).map((row) => ({
      id: row.id,
      eventId,
      status: row.status,
      driveStatus: row.drive_status,
      roundNo: roundNo.get(row.id) ?? 0,
      createdAt: row.created_at,
    })),
  );
  const byId = new Map((renders.data ?? []).map((row) => [row.id, row]));
  return {
    ok: true,
    eventName: event.data?.name ?? plan.name ?? "",
    rows: ordered.map((row) => {
      const render = byId.get(row.id)!;
      const clip = clipOf.get(render.clip_id);
      const artist = clip ? artistOf.get(clip.artist_id) ?? "" : "";
      return {
        id: row.id,
        pairing: pairingName(artist, clip?.clip_no ?? 0, captionOf.get(render.caption_id) ?? ""),
        roundNo: row.roundNo,
        durationSeconds: null,
        driveStatus: row.driveStatus,
        added: addedHashes.has(labRenderHash(row.id)),
      };
    }),
  };
}

export async function addLabRender(db: Db, plan: CampaignPlan, renderId: string): Promise<{ ok: true; added: boolean } | { ok: false; error: string }> {
  const eventId = plan.intent.eventId;
  const render = await db.from("creative_lab_renders").select("id, clip_id, status, creative_asset_id, user_id").eq("id", renderId).maybeSingle();
  if (render.error) return { ok: false, error: render.error.message };
  if (!render.data || render.data.status !== "done") return { ok: false, error: RENDER_NOT_ON_EVENT };
  const clip = await db.from("creative_lab_clips").select("id, event_id, artist_id, clip_no").eq("id", render.data.clip_id).maybeSingle();
  if (clip.error) return { ok: false, error: clip.error.message };
  if (!clip.data || clip.data.event_id !== eventId) return { ok: false, error: RENDER_NOT_ON_EVENT };
  const asset = render.data.creative_asset_id
    ? await db.from("creative_assets").select("id, storage_path, storage_bucket, byte_size, duration_seconds, thumbnail_url").eq("id", render.data.creative_asset_id).maybeSingle()
    : { data: null, error: null };
  if (asset.error) return { ok: false, error: asset.error.message };
  if (!asset.data?.storage_path) return { ok: false, error: RENDER_NOT_READY };
  const artist = await db.from("creative_lab_artists").select("name").eq("id", clip.data.artist_id).maybeSingle();
  const captionId = (await db.from("creative_lab_renders").select("caption_id").eq("id", renderId).maybeSingle()).data?.caption_id;
  const caption = captionId ? await db.from("creative_lab_captions").select("style").eq("id", captionId).maybeSingle() : { data: null };
  const filename = pairingName(artist.data?.name ?? "", clip.data.clip_no, caption.data?.style ?? "");
  const upserted = await upsertRegisteredAsset(db, {
    userId: plan.userId,
    identity: { contentHash: labRenderHash(renderId), byteSize: asset.data.byte_size || 1 },
    filename,
    mediaKind: "video",
    aspectRatio: "9:16",
    durationSeconds: asset.data.duration_seconds,
    storageBucket: asset.data.storage_bucket || "campaign-assets",
    storagePath: asset.data.storage_path,
    thumbnailUrl: asset.data.thumbnail_url,
  });
  if (!upserted.ok) return { ok: false, error: upserted.error };
  const attached = await attachIntakeAsset(db, {
    planId: plan.id,
    assetId: upserted.asset.id,
    userId: plan.userId,
    detectedBucket: "9:16",
    detectedWidth: 1080,
    detectedHeight: 1920,
    unreadableReason: null,
  });
  if (!attached.ok) return { ok: false, error: attached.error };
  return { ok: true, added: true };
}
