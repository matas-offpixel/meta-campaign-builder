/**
 * Top tracks in the render tick (HK1, HK7): one queued reel at a time.
 * Each track's TK3 plan is read again from the Lab's copy of its file (the
 * operator's marks kept), cut, joined and checked; the reel is set by
 * build.ts, rendered silent on Remotion Lambda (TopTracks) and muxed. The
 * mp4 goes to Storage and the creative-asset registry; filing to Drive
 * follows approval, as the snippet's does.
 *
 * Held, with its line on the row, when:
 *   - the kit face isn't provided for the client (O51), or fails its check (O52);
 *   - a date end is asked for and the kit's lockup and date line aren't
 *     uploaded (KIT_PIECES_MISSING): `{client id}/pieces/pieces.json` in the
 *     kit-fonts bucket, the shape scripts/psd-kit.mts writes.
 *
 * Not read yet, and said so in the PR: the event's approved live claim
 * (rule 11's ladder). The tick renders the date end with lockup, name and
 * date only; the drafts script takes the claim by hand.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { AUDIO_BUCKET, AUDIO_COLUMNS, type AudioFileRow } from "../audio-intake.ts";
import { buildReel, type BuildTrack, type FaceGeo } from "./build.ts";
import { cutTrackSnippet } from "./ffmpeg.ts";
import { DEFAULT_OPTIONS, type ReelOptions } from "./reel.ts";
import { KIT_PIECES_MISSING, MAX_TOP_TRACKS_RENDERS_AT_ONCE, TOP_TRACKS_TABLE, marksOf, planFile, type PickedTrack } from "./server.ts";
import type { FontEntry } from "../../creative-lab/kit-font.ts";

type Db = Pick<SupabaseClient, "from">;

export const TOP_TRACKS_STUCK_MS = 20 * 60 * 1000;

export type TopTracksRow = {
  id: string;
  user_id: string;
  event_id: string;
  artist_id: string | null;
  options: Partial<ReelOptions>;
  tracks: PickedTrack[];
  background: { kind?: string; assetId?: string };
  stage: string | null;
  round_no: number;
  status: string;
  attempt: number;
};

export type TickDeps = {
  download: (bucket: string, storagePath: string) => Promise<Uint8Array>;
  upload: (bucket: string, storagePath: string, filePath: string, contentType: string) => Promise<void>;
  /** The client's kit face, fetched and name-checked for this render (O52); the file is removed after `run`. */
  withFace: <T>(clientId: string, run: (face: FontEntry) => Promise<T>) => Promise<T>;
  /** The kit's lockup and date line, or null when they aren't uploaded. */
  kitPieces: (clientId: string) => Promise<{ lockupPng: Buffer; datePng: Buffer; dateText: string; accentHex: string } | null>;
  /** The press shot's face (face-detect.ts), on the upright photo. */
  faceOf: (photo: Buffer) => Promise<FaceGeo>;
  uprightPhoto: (bytes: Uint8Array) => Promise<Buffer>;
  renderSilent: (props: unknown, durationS: number) => Promise<{ bytes: Uint8Array; renderMs: number }>;
  mux: (video: string, audio: string, output: string) => Promise<void>;
  register: (row: TopTracksRow, storagePath: string, filePath: string, fileName: string, durationS: number) => Promise<string | null>;
};

export function topTracksPath(renderId: string, attempt: number): string {
  return `videos/creative-lab/top-tracks/${renderId}${attempt > 1 ? `-a${attempt}` : ""}-9x16.mp4`;
}

export async function renderTopTracks(db: Db, row: TopTracksRow, deps: TickDeps): Promise<void> {
  const options: ReelOptions = { ...DEFAULT_OPTIONS, ...row.options };
  const ev = await db.from("events").select("id, client_id, event_code").eq("id", row.event_id).maybeSingle();
  if (ev.error || !ev.data) throw new Error(ev.error?.message ?? "the event is gone");
  const event = ev.data as { id: string; client_id: string; event_code: string | null };
  const artist = await db.from("artists").select("name").eq("id", String(row.artist_id)).maybeSingle();
  if (artist.error || !artist.data) throw new Error(artist.error?.message ?? "the artist is gone");
  const pieces = await deps.kitPieces(event.client_id);
  if (options.end === "date" && !pieces) throw new Error(KIT_PIECES_MISSING);
  const files = await db.from("creative_lab_audio_files").select(AUDIO_COLUMNS).in("id", row.tracks.map((t) => t.audioFileId));
  if (files.error) throw new Error(files.error.message);
  const byId = new Map(((files.data ?? []) as unknown as AudioFileRow[]).map((f) => [f.id, f]));
  const asset = row.background.assetId ? await db.from("creative_assets").select("storage_bucket, storage_path").eq("id", row.background.assetId).maybeSingle() : null;
  if (!asset?.data) throw new Error("Pick a press shot for the background.");
  const dir = await mkdtemp(path.join(tmpdir(), "tt-reel-"));
  try {
    const tracks: BuildTrack[] = [];
    for (const [i, t] of row.tracks.entries()) {
      const f = byId.get(t.audioFileId);
      if (!f || !f.storage_path) throw new Error(`${t.title}: the file is gone`);
      const { plan } = await planFile(f, deps.download, { title: t.title, marks: marksOf(f) });
      if (!plan.ok) throw new Error(plan.refusal);
      const source = path.join(dir, `track-${i}${path.extname(f.storage_path)}`);
      await writeFile(source, await deps.download(AUDIO_BUCKET, f.storage_path));
      const cutFile = path.join(dir, `cut-${i}.m4a`);
      await cutTrackSnippet(source, cutFile, { startS: plan.window.startS, lengthS: plan.window.lengthS });
      tracks.push({ key: f.id, title: t.title, artists: t.artists, spotifyRank: t.spotifyRank, window: plan.window, cutFile });
    }
    const a = asset.data as { storage_bucket: string; storage_path: string };
    const photo = await deps.uprightPhoto(await deps.download(a.storage_bucket, a.storage_path));
    const faceGeo = await deps.faceOf(photo);
    const built = await deps.withFace(event.client_id, (face) =>
      buildReel({
        eventCode: event.event_code,
        artist: String((artist.data as { name: string }).name),
        kitCaseMode: "upper",
        options,
        tracks,
        face,
        accentHex: pieces?.accentHex ?? "#FE3232",
        photo,
        faceGeo,
        lockupPng: pieces?.lockupPng ?? null,
        datePng: pieces?.datePng ?? null,
        dateText: pieces?.dateText ?? "",
        claim: null,
        stamp: null,
        stage: row.stage ?? "on-sale",
        roundNo: row.round_no,
        draft: false,
        workDir: dir,
      }),
    );
    if (!built.ok) throw new Error(built.refusal);
    const rendered = await deps.renderSilent(built.props, built.timeline.totalS);
    const silent = path.join(dir, "silent.mp4");
    const out = path.join(dir, built.name);
    await writeFile(silent, rendered.bytes);
    await deps.mux(silent, built.joinedAudio, out);
    const attempt = Number(row.attempt ?? 0) + 1;
    const storagePath = topTracksPath(row.id, attempt);
    await deps.upload(AUDIO_BUCKET, storagePath, out, "video/mp4");
    const assetId = await deps.register(row, storagePath, out, built.name, built.timeline.totalS);
    const done = await db
      .from(TOP_TRACKS_TABLE)
      .update({ status: "done", error: null, attempt, storage_path: storagePath, creative_asset_id: assetId, file_name: built.name, render_ms: rendered.renderMs, duration_s: built.timeline.totalS, lufs: built.loudness.lufs, true_peak_db: built.loudness.truePeakDb })
      .eq("id", row.id)
      .eq("status", "rendering");
    if (done.error) throw new Error(done.error.message);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export type TopTracksTickResult = { claimed: number; timedOut: number; failed: number; busy: boolean };

/** The tick's Top tracks part: time out the stuck, claim one queued reel, render it. */
export async function runTopTracksTick(db: Db, deps: TickDeps, opts: { now?: Date; archivedEventIds?: ReadonlySet<string> } = {}): Promise<TopTracksTickResult> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - TOP_TRACKS_STUCK_MS).toISOString();
  const rendering = await db.from(TOP_TRACKS_TABLE).select("id, updated_at").eq("status", "rendering");
  if (rendering.error) throw new Error(`${TOP_TRACKS_TABLE}: ${rendering.error.message}`);
  let timedOut = 0;
  for (const r of (rendering.data ?? []) as { id: string; updated_at: string }[]) {
    if (r.updated_at >= cutoff) continue;
    const res = await db.from(TOP_TRACKS_TABLE).update({ status: "failed", error: "timeout" }).eq("id", r.id).eq("status", "rendering");
    if (res.error) throw new Error(res.error.message);
    timedOut += 1;
  }
  if (((rendering.data ?? []) as unknown[]).length - timedOut >= MAX_TOP_TRACKS_RENDERS_AT_ONCE) return { claimed: 0, timedOut, failed: 0, busy: true };
  const queued = await db.from(TOP_TRACKS_TABLE).select("*").eq("status", "queued").order("created_at", { ascending: true }).range(0, 19);
  if (queued.error) throw new Error(queued.error.message);
  for (const row of (queued.data ?? []) as TopTracksRow[]) {
    if (opts.archivedEventIds?.has(row.event_id)) continue;
    const claim = await db.from(TOP_TRACKS_TABLE).update({ status: "rendering", error: null }).eq("id", row.id).eq("status", "queued").select("id");
    if (claim.error) throw new Error(claim.error.message);
    if (!((claim.data ?? []) as unknown[]).length) continue;
    try {
      await renderTopTracks(db, row, deps);
      return { claimed: 1, timedOut, failed: 0, busy: false };
    } catch (err) {
      const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      await db.from(TOP_TRACKS_TABLE).update({ status: "failed", error: message }).eq("id", row.id).eq("status", "rendering");
      return { claimed: 1, timedOut, failed: 1, busy: false };
    }
  }
  return { claimed: 0, timedOut, failed: 0, busy: false };
}
