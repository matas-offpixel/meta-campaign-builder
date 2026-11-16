/**
 * The Lab's Snippet tab (docs/design-record/2026-11-16-creative-testing.html,
 * CT2–CT5, CT10; TT5's flag).
 *
 * GET ?artist={libraryArtistId}: the act's picker. Opening an act makes its
 *   02 Source / Audio / {artist} folder on first need, reads any new audio
 *   file in it (download, check, Storage copy, drop and waveform), reads
 *   Spotify's top tracks (cached a day), and lists the event's 9:16 statics.
 * POST { action }:
 *   edit       a file's supplier, match, drop, window or length; clearing a
 *              rights flag is Matas's only.
 *   preview    CT5's cut for the file's window, and the static beside it.
 *   makeTest   CT10's "Make Test 1": a snippet per picked track on the static.
 *   approve    approves a done snippet render (it then files to Drive).
 *   retryDrive / retryRender
 *
 * Operator-only (the /api gate, #1276), and only the event's owner. Nothing
 * here calls Meta, and audio is never read from a link.
 */

import { NextResponse, type NextRequest } from "next/server";

import { MATAS_USER_IDS } from "@/lib/auth/operator-allowlist";
import { saveAudioEdit, type AudioEdit } from "@/lib/creative-tests/audio-edits";
import { loadAudioRows, scanArtistAudio, type AudioFileRow } from "@/lib/creative-tests/audio-intake";
import { makeTest1 } from "@/lib/creative-tests/make-test";
import { AUDIO_BUCKET } from "@/lib/creative-tests/audio-intake";
import { fileWindow, makePreview } from "@/lib/creative-tests/snippet-render";
import { cutDeps, intakeDeps, signedUrl, staticCopyUrl } from "@/lib/creative-tests/snippet-server";
import { PREVIEW_FAILED, type TopTrack } from "@/lib/creative-tests/snippet";
import { buildSnippetView } from "@/lib/creative-tests/snippet-view";
import { readTopTracks } from "@/lib/creative-tests/spotify-top";
import { listEventStatics } from "@/lib/creative-tests/statics";
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
  const event = res.data as { id: string; client_id: string; name: string; event_code: string | null; event_date: string | null; status: string | null; drive_folder_id: string | null; drive_folder_linked: boolean | null; drive_cancel_marked_at: string | null };
  const clientRes = await db.from("clients").select("id, name, status, drive_folder_id").eq("id", event.client_id).maybeSingle();
  if (clientRes.error) return { ok: false as const, error: NextResponse.json({ error: clientRes.error.message }, { status: 500 }) };
  const client = clientRes.data as { id: string; name: string; status: string | null; drive_folder_id: string | null } | null;
  if (!client) return { ok: false as const, error: NextResponse.json({ error: "This event has no client." }, { status: 400 }) };
  return { ok: true as const, db, user, event, client };
}

async function lineup(db: Service, eventId: string): Promise<{ id: string; name: string; spotifyId: string | null }[]> {
  const res = await db.from("event_artists").select("artist_id, billing_order, source").eq("event_id", eventId).eq("source", "lab").order("billing_order", { ascending: true });
  if (res.error) throw new Error(`event_artists: ${res.error.message}`);
  const ids = ((res.data ?? []) as { artist_id: string }[]).map((r) => r.artist_id);
  if (!ids.length) return [];
  const artists = await db.from("artists").select("id, name, spotify_id").in("id", ids);
  if (artists.error) throw new Error(`artists: ${artists.error.message}`);
  const byId = new Map(((artists.data ?? []) as { id: string; name: string; spotify_id: string | null }[]).map((a) => [a.id, a]));
  return ids.map((id) => byId.get(id)).filter((a): a is { id: string; name: string; spotify_id: string | null } => Boolean(a?.name)).map((a) => ({ id: a.id, name: a.name, spotifyId: a.spotify_id }));
}

/** First names for "{who}" and "Drop set by {first name}" (never the email). */
async function firstNames(db: Service, ids: (string | null)[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const id of [...new Set(ids.filter((x): x is string => Boolean(x)))]) {
    const res = await db.auth.admin.getUserById(id);
    const name = res.data.user ? displayName(res.data.user) : null;
    if (name) out.set(id, name);
  }
  return out;
}

async function testOne(db: Service, eventId: string) {
  const test = await db.from("creative_tests").select("id, n, state").eq("event_id", eventId).eq("n", 1).maybeSingle();
  if (test.error) throw new Error(`creative_tests: ${test.error.message}`);
  const row = test.data as { id: string; n: number; state: string } | null;
  const labels = new Map<string, string>();
  if (row) {
    const variants = await db.from("creative_test_variants").select("label, snippet_render_id").eq("test_id", row.id);
    if (variants.error) throw new Error(`creative_test_variants: ${variants.error.message}`);
    for (const v of (variants.data ?? []) as { label: string; snippet_render_id: string | null }[]) if (v.snippet_render_id) labels.set(v.snippet_render_id, v.label);
  }
  return { test: row, labels };
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
    let failed: { name: string; error: string }[] = [];
    if (act && drive) {
      const scan = await scanArtistAudio(db, intakeDeps(db, drive), { event: event as never, client: client as never, artist: { libraryArtistId: act.id, name: act.name }, userId: user.id });
      failed = scan.failed;
    }
    const files = await loadAudioRows(db, event.id, null);
    const top = act ? await readTopTracks(db, { artistId: act.id, spotifyArtistId: act.spotifyId, userId: user.id }) : null;
    const statics = drive ? await listEventStatics(db, drive, event.id) : [];
    const renders = await db.from("creative_lab_snippet_renders").select("id, audio_file_id, status, file_name, approved_at, drive_status, test_id, error").eq("event_id", event.id).eq("purpose", "final").order("created_at", { ascending: true }).range(0, 199);
    if (renders.error) throw new Error(`creative_lab_snippet_renders: ${renders.error.message}`);
    const { test, labels } = await testOne(db, event.id);
    const names = await firstNames(db, files.flatMap((f) => [f.supplier_set_by, f.drop_set_by]));
    const view = buildSnippetView({
      eventId: event.id,
      eventCode: event.event_code,
      clientName: client.name,
      acts: acts.map(({ id, name }) => ({ id, name })),
      actId: act?.id ?? null,
      tracks: top && top.ok ? (top.tracks as TopTrack[]) : null,
      files,
      names,
      statics,
      renders: (renders.data ?? []) as never,
      testN: test?.n ?? null,
      testState: test?.state ?? null,
      variantLabels: labels,
    });
    return NextResponse.json({ ok: true, view, driveConfigured: Boolean(drive), failed });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Snippet read failed" }, { status: 500 });
  }
}

type Body = {
  action?: string;
  fileId?: string;
  edit?: AudioEdit;
  fileIds?: string[];
  static?: { driveFileId?: string; fileName?: string };
  renderId?: string;
};

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
      case "edit": {
        if (!body.fileId || !body.edit) return NextResponse.json({ error: "Missing fileId or edit." }, { status: 400 });
        // TT5: the file can't be picked again until Matas clears the flag.
        if (body.edit.kind === "clear_flag" && !MATAS_USER_IDS.includes(user.id)) return NextResponse.json({ error: "Only Matas can clear this flag." }, { status: 403 });
        const saved = await saveAudioEdit(db, { fileId: body.fileId, userId: user.id, edit: body.edit });
        if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
        return NextResponse.json({ ok: true });
      }
      case "preview": {
        if (!body.fileId) return NextResponse.json({ error: "Missing fileId." }, { status: 400 });
        const read = await db.from("creative_lab_audio_files").select("*").eq("id", body.fileId).eq("event_id", event.id).eq("user_id", user.id).maybeSingle();
        if (read.error) throw new Error(read.error.message);
        const file = read.data as AudioFileRow | null;
        if (!file?.storage_path || file.drop_s == null) return NextResponse.json({ error: PREVIEW_FAILED }, { status: 409 });
        try {
          const path = await makePreview(file, fileWindow(file), cutDeps(db));
          const audioUrl = await signedUrl(db, AUDIO_BUCKET, path);
          const { drive } = driveFromEnv();
          const imageUrl = drive && body.static?.driveFileId ? await staticCopyUrl(db, drive, { eventId: event.id, driveFileId: body.static.driveFileId, fileName: body.static.fileName }) : null;
          return NextResponse.json({ ok: true, audioUrl, imageUrl });
        } catch {
          return NextResponse.json({ error: PREVIEW_FAILED }, { status: 502 });
        }
      }
      case "makeTest": {
        if (!body.static?.driveFileId || !body.static.fileName) return NextResponse.json({ error: "Pick a static." }, { status: 400 });
        const acts = await lineup(db, event.id);
        const files = await loadAudioRows(db, event.id, null);
        const tracksByArtist = new Map<string, TopTrack[]>();
        for (const act of acts) {
          const top = await readTopTracks(db, { artistId: act.id, spotifyArtistId: null, userId: user.id });
          if (top.ok) tracksByArtist.set(act.id, top.tracks);
        }
        const made = await makeTest1(db, { eventId: event.id, userId: user.id, fileIds: body.fileIds ?? [], static: { driveFileId: body.static.driveFileId, fileName: body.static.fileName } }, {
          event,
          artistNames: new Map(acts.map((a) => [a.id, a.name])),
          allFiles: files,
          tracksByArtist,
        });
        if (!made.ok) return NextResponse.json({ error: made.error }, { status: made.status });
        return NextResponse.json({ ok: true, testId: made.testId, renderIds: made.renderIds });
      }
      case "approve":
      case "retryDrive":
      case "retryRender": {
        if (!body.renderId) return NextResponse.json({ error: "Missing renderId." }, { status: 400 });
        const patch =
          body.action === "approve"
            ? { approved_by: user.id, approved_at: new Date().toISOString() }
            : body.action === "retryDrive"
              ? { drive_status: null, drive_error: null }
              : { status: "queued", error: null };
        let query = db.from("creative_lab_snippet_renders").update(patch).eq("id", body.renderId).eq("event_id", event.id).eq("user_id", user.id);
        if (body.action === "approve") query = query.eq("status", "done");
        if (body.action === "retryDrive") query = query.eq("drive_status", "failed");
        if (body.action === "retryRender") query = query.eq("status", "failed");
        const res = await query.select("id");
        if (res.error) throw new Error(res.error.message);
        if (!((res.data ?? []) as unknown[]).length) return NextResponse.json({ error: "Nothing to change on that render." }, { status: 409 });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Snippet action failed" }, { status: 500 });
  }
}
