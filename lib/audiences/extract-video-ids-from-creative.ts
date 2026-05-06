/**
 * Collect Meta ad creative video_ids from the shapes Graph returns for video ads,
 * including dynamic creatives (asset_feed_spec), story specs, and platform blocks.
 */
export function extractVideoIdsFromCreative(
  creative: Record<string, unknown> | null | undefined,
): string[] {
  const ids = new Set<string>();
  if (!creative || typeof creative !== "object") return [];

  const root = creative.video_id;
  if (typeof root === "string" && root) ids.add(root);

  const oss = creative.object_story_spec as Record<string, unknown> | undefined;
  const vd = oss?.video_data as Record<string, unknown> | undefined;
  if (typeof vd?.video_id === "string" && vd.video_id) ids.add(vd.video_id);

  const afs = creative.asset_feed_spec as Record<string, unknown> | undefined;
  const videos = afs?.videos;
  if (Array.isArray(videos)) {
    for (const row of videos) {
      if (row && typeof row === "object") {
        const vid = (row as { video_id?: string }).video_id;
        if (typeof vid === "string" && vid) ids.add(vid);
      }
    }
  }

  const plat = creative.platform_customizations as Record<string, unknown> | undefined;
  if (plat && typeof plat === "object") {
    for (const key of Object.keys(plat)) {
      collectVideoIdsDeep(plat[key], ids);
    }
  }

  return Array.from(ids);
}

function collectVideoIdsDeep(node: unknown, ids: Set<string>): void {
  if (node == null) return;
  if (typeof node === "object" && !Array.isArray(node)) {
    const o = node as Record<string, unknown>;
    if (typeof o.video_id === "string" && o.video_id) ids.add(o.video_id);
    for (const k of Object.keys(o)) collectVideoIdsDeep(o[k], ids);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectVideoIdsDeep(item, ids);
  }
}
