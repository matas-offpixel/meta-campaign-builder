/**
 * The Lab's Top tracks tab (docs/design-record/2026-11-18-creative-lab-top-tracks.html,
 * TK10; HK2, HK7).
 *
 * GET ?artist={libraryArtistId}: the act's tracks for the picker. The act's
 *   02 Source / Audio / {artist} folder is read as the Snippet tab reads it
 *   (CT2: new files checked and copied), Spotify's top tracks (cached a day,
 *   CT3), and each matched file's TK3 plan from the Lab's copy: every drop,
 *   the one used, the hook and the window. Then the event's reel rows.
 * POST { action }:
 *   make   TK10's "Make the reel": one render row, queued (migration 262).
 *   drop   the operator's drop marker on a file ("Drop set by {first name}").
 *   hook   the operator's hook marker, or { clear: true } ("Hook set by …").
 *
 * Operator-only (the /api gate, #1276), and only the event's owner. Nothing
 * here calls Meta, and audio is never read from a link.
 */

import { NextResponse, type NextRequest } from "next/server";

import { AUDIO_BUCKET, AUDIO_COLUMNS_262, scanArtistAudio, type AudioFileRow } from "@/lib/creative-tests/audio-intake";
import { intakeDeps, storageDeps } from "@/lib/creative-tests/snippet-server";
import { readTopTracks } from "@/lib/creative-tests/spotify-top";
import { renderStage } from "@/lib/drive/tree";
import { DEFAULT_OPTIONS, type ReelOptions } from "@/lib/creative-tests/top-tracks/reel";
import { TOP_TRACKS_TABLE, marksOf, planFile, queueReel, type PickedTrack } from "@/lib/creative-tests/top-tracks/server";
import { dropPickerLine, snapToDownbeat } from "@/lib/creative-tests/top-tracks/studio";
import { storedAnalysis } from "@/lib/creative-tests/top-tracks/server";
import type { TrackInput } from "@/lib/creative-tests/top-tracks/view";
import { driveFromEnv } from "@/lib/drive/client";
import { displayName } from "@/lib/onsale-refresh/line-states";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Service = ReturnType<typeof createServiceRoleClient>;

async function owned(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) };
  const db = createServiceRoleClient();
  const res = await db.from("events").select("id, user_id, client_id, name, event_code, event_date, status, drive_folder_id, drive_folder_linked, drive_cancel_marked_at").eq("id", eventId).eq("user_id", user.id).maybeSingle();
  if (res.error) return { ok: false as const, error: NextResponse.json({ error: res.error.message }, { status: 500 }) };
  if (!res.data) return { ok: false as const, error: NextResponse.json({ error: "No event with that id." }, { status: 404 }) };
  const event = res.data as { id: string; client_id: string; event_code: string | null; status: string | null };
  const clientRes = await db.from("clients").select("id, name, status, drive_folder_id").eq("id", event.client_id).maybeSingle();
  if (clientRes.error) return { ok: false as const, error: NextResponse.json({ error: clientRes.error.message }, { status: 500 }) };
  if (!clientRes.data) return { ok: false as const, error: NextResponse.json({ error: "This event has no client." }, { status: 400 }) };
  return { ok: true as const, db, user, event, client: clientRes.data as { id: string; name: string } };
}

async function lineup(db: Service, eventId: string): Promise<{ id: string; name: string; spotifyId: string | null }[]> {
  const res = await db.from("event_artists").select("artist_id, billing_order").eq("event_id", eventId).eq("source", "lab").order("billing_order", { ascending: true });
  if (res.error) throw new Error(`event_artists: ${res.error.message}`);
  const ids = ((res.data ?? []) as { artist_id: string }[]).map((r) => r.artist_id);
  if (!ids.length) return [];
  const artists = await db.from("artists").select("id, name, spotify_id").in("id", ids);
  if (artists.error) throw new Error(`artists: ${artists.error.message}`);
  const byId = new Map(((artists.data ?? []) as { id: string; name: string; spotify_id: string | null }[]).map((a) => [a.id, a]));
  return ids.flatMap((id) => {
    const a = byId.get(id);
    return a?.name ? [{ id: a.id, name: a.name, spotifyId: a.spotify_id }] : [];
  });
}

async function firstNames(db: Service, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of [...new Set(ids.filter((x): x is string => Boolean(x)))]) {
    const res = await db.auth.admin.getUserById(id);
    const name = res.data.user ? displayName(res.data.user) : null;
    if (name) out.set(id, name);
  }
  return out;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const { eventId } = await ctx.params;
  const scope = await owned(eventId);
  if (!scope.ok) return scope.error;
  const { db, user, event, client } = scope;
  try {
    const acts = await lineup(db, event.id);
    const act = acts.find((a) => a.id === req.nextUrl.searchParams.get("artist")) ?? acts[0] ?? null;
    const { drive } = driveFromEnv();
    if (act && drive) await scanArtistAudio(db, intakeDeps(db, drive), { event: event as never, client: client as never, artist: { libraryArtistId: act.id, name: act.name }, userId: user.id });
    const filesRes = act ? await db.from("creative_lab_audio_files").select(AUDIO_COLUMNS_262).eq("event_id", event.id).eq("artist_id", act.id).order("created_at", { ascending: true }).range(0, 999) : null;
    if (filesRes?.error) throw new Error(`creative_lab_audio_files: ${filesRes.error.message}`);
    const files = ((filesRes?.data ?? []) as unknown as AudioFileRow[]);
    const top = act ? await readTopTracks(db, { artistId: act.id, spotifyArtistId: act.spotifyId, userId: user.id }) : null;
    const ranks = new Map((top && top.ok ? top.tracks : []).map((t) => [t.id, t.rank]));
    const extra = await db.from("creative_lab_audio_files").select("id, drop_set_by, hook_set_by").in("id", files.map((f) => f.id));
    const setBy = new Map(((extra.data ?? []) as { id: string; drop_set_by: string | null; hook_set_by: string | null }[]).map((r) => [r.id, r]));
    const names = await firstNames(db, [...setBy.values()].flatMap((r) => [r.drop_set_by, r.hook_set_by]));
    const storage = storageDeps(db);
    const tracks: TrackInput[] = [];
    for (const f of files.filter((x: AudioFileRow) => x.match_state === "matched" && !x.unusable_reason && x.storage_path)) {
      const title = f.spotify_title ?? f.drive_file_name.replace(/\.[a-z0-9]{2,5}$/i, "");
      const by = setBy.get(f.id);
      const { plan, drops } = await planFile(f, storage.download, { title, marks: marksOf(f, names, { drop: by?.drop_set_by, hook: by?.hook_set_by }) });
      tracks.push({
        id: f.id,
        title,
        spotifyRank: f.spotify_track_id ? ranks.get(f.spotify_track_id) ?? null : null,
        durationS: Number(f.duration_s ?? 0),
        waveform: f.waveform ?? [],
        drops,
        dropLines: plan.drops.map(dropPickerLine),
        analysis: f.analysis_state === "running" ? "running" : f.analysis_state === "done" ? "done" : "failed",
        window: plan.ok ? plan.window : null,
        choice: plan.ok ? plan.choice : null,
        hook: plan.ok && plan.hook.kind !== "none" ? { kind: plan.hook.kind, hookS: plan.hook.hookS } : { kind: "none" },
        refusal: plan.ok ? null : plan.refusal,
      });
    }
    const renders = await db.from(TOP_TRACKS_TABLE).select("id, status, file_name, duration_s, storage_path, error, created_at").eq("event_id", event.id).order("created_at", { ascending: false }).range(0, 49);
    // Before migration 262 is applied the table is missing: the tab shows no reels rather than failing.
    const reelRows = (renders.error ? [] : (renders.data ?? [])) as { id: string; status: string; file_name: string | null; duration_s: number | null; storage_path: string | null }[];
    const latest = reelRows.find((r) => r.status === "done" && r.storage_path);
    const previewUrl = latest ? (await db.storage.from(AUDIO_BUCKET).createSignedUrl(String(latest.storage_path), 3600)).data?.signedUrl ?? null : null;
    const data = {
      eventCode: event.event_code,
      acts: acts.map(({ id, name }) => ({ id, name })),
      actId: act?.id ?? "",
      artist: act?.name ?? "",
      tracks,
      trackArtists: {} as Record<string, string[]>,
      renders: reelRows.map((r) => ({ id: r.id, fileName: r.file_name ?? "Top tracks reel", status: (r.status === "done" ? "ready" : r.status) as "queued" | "rendering" | "ready" | "failed", lengthS: r.duration_s != null ? Number(r.duration_s) : null })),
      previewUrl,
      end: { lockup: client.name, date: "", claim: null },
      kitCase: "upper" as const,
    };
    return NextResponse.json({ ok: true, data, driveConfigured: Boolean(drive) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Top tracks read failed" }, { status: 500 });
  }
}

type Body = { action?: string; artistId?: string; options?: Partial<ReelOptions>; picked?: string[]; tracks?: PickedTrack[]; background?: Record<string, unknown>; fileId?: string; s?: number; clear?: boolean };

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const { eventId } = await ctx.params;
  const scope = await owned(eventId);
  if (!scope.ok) return scope.error;
  const { db, user, event } = scope;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  try {
    switch (body.action) {
      case "make": {
        if (!body.artistId || !(body.tracks?.length || body.picked?.length)) return NextResponse.json({ error: "Missing artistId or tracks." }, { status: 400 });
        const options: ReelOptions = { ...DEFAULT_OPTIONS, ...(body.options ?? {}) };
        let picked = body.tracks ?? [];
        if (!picked.length && body.picked?.length) {
          // The tab sends file ids in the list's order; the titles and Spotify places come from the rows.
          const rows = await db.from("creative_lab_audio_files").select("id, spotify_track_id, spotify_title, drive_file_name").in("id", body.picked).eq("event_id", event.id);
          if (rows.error) throw new Error(rows.error.message);
          const art = await db.from("artists").select("id, spotify_id").eq("id", body.artistId).maybeSingle();
          const top = await readTopTracks(db, { artistId: body.artistId, spotifyArtistId: (art.data as { spotify_id: string | null } | null)?.spotify_id ?? null, userId: user.id });
          const ranks = new Map((top.ok ? top.tracks : []).map((t) => [t.id, t.rank]));
          const byId = new Map(((rows.data ?? []) as { id: string; spotify_track_id: string | null; spotify_title: string | null; drive_file_name: string }[]).map((r) => [r.id, r]));
          picked = body.picked.flatMap((id) => {
            const r = byId.get(id);
            return r ? [{ audioFileId: r.id, title: r.spotify_title ?? r.drive_file_name.replace(/\.[a-z0-9]{2,5}$/i, ""), artists: [], spotifyRank: r.spotify_track_id ? ranks.get(r.spotify_track_id) ?? null : null }] : [];
          });
        }
        const queued = await queueReel(db, { userId: user.id, eventId: event.id, artistId: body.artistId, options, tracks: picked, background: body.background ?? { kind: options.background }, stage: renderStage(event.status) });
        if (!queued.ok) return NextResponse.json({ error: queued.error }, { status: 400 });
        return NextResponse.json({ ok: true, renderId: queued.id });
      }
      case "drop":
      case "hook": {
        if (!body.fileId) return NextResponse.json({ error: "Missing fileId." }, { status: 400 });
        const now = new Date().toISOString();
        // TK14: a dragged marker snaps to the nearest downbeat of the file's stored grid.
        let at = Number(body.s);
        if (body.action === "drop") {
          const row = await db.from("creative_lab_audio_files").select("analysis, analysis_key, analysis_state").eq("id", body.fileId).eq("event_id", event.id).maybeSingle();
          const a = row.data ? storedAnalysis(row.data as never, null) : null;
          if (a && Number.isFinite(at)) at = snapToDownbeat(at, a.downbeats);
        }
        const patch =
          body.action === "drop"
            ? { drop_s: at, drop_source: "operator", drop_set_by: user.id, drop_set_at: now }
            : body.clear
              ? { hook_s: null, hook_source: "cleared", hook_set_by: user.id, hook_set_at: now }
              : { hook_s: Number(body.s), hook_source: "operator", hook_set_by: user.id, hook_set_at: now };
        if (body.action === "drop" || !body.clear) {
          if (!Number.isFinite(Number(body.s)) || Number(body.s) < 0) return NextResponse.json({ error: "Missing s." }, { status: 400 });
        }
        const up = await db.from("creative_lab_audio_files").update(patch).eq("id", body.fileId).eq("event_id", event.id);
        if (up.error) throw new Error(up.error.message);
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Top tracks failed" }, { status: 500 });
  }
}
