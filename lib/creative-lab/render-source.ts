/**
 * O68 (overlay templates issue 10): a clip larger than the output renders
 * from its stored 1080 render copy, and the original stays the master.
 * #1176 (migration 220) makes that copy at import and links it on
 * creative_lab_clips.render_asset_id, a creative_assets row; the original
 * stays on creative_asset_id for Drive and download. This reads it: a clip
 * with a render_asset_id renders from the copy; one without (the original is
 * small enough, or it predates the copy) renders from creative_asset_id.
 * The same rule as render-proxy.ts's renderAssetId, kept here so the draft
 * scripts and their tests don't load the proxy maker. Read only.
 */

export type RenderSource = { assetId: string; copy: boolean };

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** The creative_assets row a render reads: the clip's render copy when it has one, else the original. */
export function renderSourceAsset(clip: Readonly<{ render_asset_id?: unknown; creative_asset_id?: unknown }>): RenderSource {
  if (nonEmpty(clip.render_asset_id)) return { assetId: clip.render_asset_id, copy: true };
  if (nonEmpty(clip.creative_asset_id)) return { assetId: clip.creative_asset_id, copy: false };
  throw new Error("clip has no creative_asset_id");
}
