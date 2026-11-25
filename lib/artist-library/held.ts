/**
 * lib/artist-library/held.ts — the held list, for reference.
 *
 * A file is held when an ad ran it and no Lab clip, Lab render or source-map
 * entry says whose footage it is: it stays with the client (rights.ts
 * clientAdRights). Held already means "this client only", the safe default,
 * so nothing here is marked or proposed (Matas, 25 Nov): a file is marked
 * only when someone wants it shared, by adding it to the source map
 * (source-map.ts) by Drive id, as Enzo's UGC was.
 *
 * Pure.
 */
import type { PlannedAsset } from "./backfill.ts";

export interface HeldFile {
  artistId: string;
  artistName: string;
  /** The ad name, as the file reads in the view. */
  file: string;
  /** The creative it is: the ad name less a bulk-attach " — {ad set}" tail and copy suffixes (creativeName). */
  creative: string;
  kind: string;
  eventId: string | null;
  clientId: string | null;
  ads: number;
}

/**
 * The creative an ad name stands for: bulk-attach adds " — {ad set}" (or
 * " — attached:{id}") and Ads Manager " – Copy n"; both are cut, so one
 * creative is one line. "Arthi Artist Card Motion — Garage Audience 2" is
 * "Arthi Artist Card Motion".
 */
export function creativeName(adName: string): string {
  let out = adName.split(" — ")[0]!.trim();
  for (;;) {
    const next = out.replace(/\s*[–-]\s*Copy(?:\s+\d+)?$/i, "").trim();
    if (next === out) return out || adName.trim();
    out = next;
  }
}

/**
 * The plan's held files that nothing accounts for: ad rows held with no Lab
 * clip, Lab render or source file. One per show and ad name, as the view
 * groups them.
 */
export function heldNoSourceFiles(rows: readonly PlannedAsset[], artistName: string): HeldFile[] {
  const out = new Map<string, HeldFile>();
  for (const r of rows) {
    if (r.shareable || !r.meta_ad_id || r.lab_clip_id || r.lab_render_id || r.drive_file_id) continue;
    const file = (r.name ?? "").trim() || r.asset_key;
    const key = `${r.source_event_id ?? r.source_client_id ?? ""}\u0000${file}`;
    const have = out.get(key);
    if (have) have.ads += 1;
    else out.set(key, { artistId: r.artist_id, artistName, file, creative: creativeName(file), kind: r.kind, eventId: r.source_event_id, clientId: r.source_client_id, ads: 1 });
  }
  return [...out.values()];
}
