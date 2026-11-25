/**
 * Fixtures for the M4a tests: a P26-BDAY-shaped show of Puzzle's, with
 * Puzzle's own crowd footage, Enzo Siragusa's artist-owned clips (filed
 * under another client's Lab artist, so shareable material travelling), and
 * that other client's promoter footage, which must never be offered or
 * rendered here. Every id and figure is invented.
 */

import { FakeQuery, fakeDb } from "../../mcp/__tests__/fake-db.ts";
import { fixtureTrack } from "./fixture-track.ts";

type Row = Record<string, unknown>;

// The shared fake has no contains(); render packages filter recipes with it.
const proto = FakeQuery.prototype as unknown as { contains?: unknown; preds: ((r: Row) => boolean)[] };
if (!proto.contains) {
  (FakeQuery.prototype as unknown as { contains: (c: string, vs: unknown[]) => unknown }).contains = function (this: { preds: ((r: Row) => boolean)[] }, c: string, vs: unknown[]) {
    this.preds.push((r) => Array.isArray(r[c]) && vs.every((v) => (r[c] as unknown[]).includes(v)));
    return this;
  };
}

export const MATAS = "b3ee4e5c-0000-4000-8000-000000000001";
export const PUZZLE = "92f7334b-ef76-4095-88d6-f422ba1ff3f2";
export const ELECTRIC = "eeeeeeee-0000-4000-8000-00000000e1e1";
export const EVENT = "ev-p26-bday";
export const ENZO = "artist-enzo";
export const TRACK = "audio-enzo-1";

export const NOW = new Date("2026-11-25T12:00:00Z");
export const TODAY = "2026-11-25";

export function fixtureTables(opts: { puzzleClips?: number; enzoClips?: number; electricClips?: number; claim?: boolean; kit?: boolean; track?: boolean } = {}): Record<string, Row[]> {
  const puzzleClips = opts.puzzleClips ?? 11;
  const enzoClips = opts.enzoClips ?? 9;
  const electricClips = opts.electricClips ?? 3;
  const lineup = ["Enzo Siragusa", "Luke Dean", "Rossi.", "Seb Zito", "Archie Hamilton", "Josh Baker"];
  const artists = lineup.map((name, i) => ({ id: i === 0 ? ENZO : `artist-${i}`, name }));
  const clips: Row[] = [];
  const assets: Row[] = [];
  const add = (id: string, labArtist: string, owner: "artist" | "promoter", n: number) => {
    clips.push({ id, artist_id: labArtist, owner, clip_no: n, in_s: 1, out_s: 9, creative_asset_id: `asset-${id}`, render_asset_id: null, source_file_id: `drive-${id}`, triple_fit_source_id: null, crop_focus_x: 0.5, crop_focus_y: 0.4 });
    assets.push({ id: `asset-${id}`, filename: `${id}.mp4`, storage_path: `clips/${id}.mp4`, storage_bucket: "campaign-assets", duration_seconds: 10, drive_file_id: `drive-${id}` });
  };
  for (let i = 0; i < puzzleClips; i += 1) add(`puzzle-${i + 1}`, "lab-puzzle-enzo", "promoter", i + 1);
  for (let i = 0; i < enzoClips; i += 1) add(`enzo-${i + 1}`, "lab-electric-enzo", "artist", i + 1);
  for (let i = 0; i < electricClips; i += 1) add(`electric-${i + 1}`, "lab-electric-enzo", "promoter", 100 + i);
  return {
    events: [
      { id: EVENT, user_id: MATAS, event_code: "P26-BDAY", name: "Puzzle 4th Birthday", client_id: PUZZLE, status: "on_sale", event_date: "2026-12-27", presale_at: "2026-10-01", general_sale_at: "2026-10-08", venue_name: "Circuit & Engine Rooms", venue_city: "Southampton", drive_folder_id: "drive-event", announcement_at: null, meta_campaign_id: null, client: { name: "Puzzle" } },
    ],
    clients: [
      { id: PUZZLE, name: "Puzzle", status: "active", drive_folder_id: "drive-client" },
      { id: ELECTRIC, name: "Electric Brixton", status: "active", drive_folder_id: null },
    ],
    event_artists: lineup.map((_, i) => ({ id: `ea-${i}`, event_id: EVENT, artist_id: artists[i]!.id, billing_order: i, is_headliner: i < 2, source: "lab", user_id: MATAS })),
    artists,
    creative_lab_artists: [
      { id: "lab-puzzle-enzo", name: "Enzo Siragusa", client_id: PUZZLE, artist_id: ENZO },
      { id: "lab-electric-enzo", name: "Enzo Siragusa", client_id: ELECTRIC, artist_id: ENZO },
    ],
    creative_lab_clips: clips,
    creative_assets: assets,
    creative_lab_audio_files: opts.track === false ? [] : [
      { id: TRACK, event_id: EVENT, artist_id: ENZO, drive_file_name: "Enzo - Track.wav", spotify_title: "Track One", duration_s: 60, storage_path: "audio/enzo-track.wav", unusable_reason: null, drop_s: fixtureTrack().dropS, drop_source: "lab", rights_flag: null, beat_grid: null, beat_grid_at: null },
    ],
    ticket_warnings: opts.claim === false ? [] : [
      { id: "tw-1", event_id: EVENT, claim: "3rd release live", format: null, state: "live", approved_by: "Matas", approved_at: "2026-11-25T09:00:00Z", runs_from: null, runs_to: null },
    ],
    event_releases: [{ id: "rel-3", event_id: EVENT, state_at: "2026-11-25T09:00:00Z" }],
    creative_lab_render_packages: [],
    creative_lab_renders: [],
    artist_assets: [],
    mcp_actions: [],
  };
}

export function fixtureDb(opts: Parameters<typeof fixtureTables>[0] = {}) {
  return fakeDb(fixtureTables(opts));
}

export const fakeStartDeps = (kit = true) => ({
  kitReady: async () => kit,
  readLowPcm: async () => fixtureTrack().pcm,
});
