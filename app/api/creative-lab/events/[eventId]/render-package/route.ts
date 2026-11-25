/**
 * The Lab's "Render a package" (RT1) and its Renders rows (RT2), M4a.
 *
 * GET: the picker (four cards, the montage live) and every package file on
 *   the event, newest package first. Reading the picker may read the
 *   picked track's beat grid once and cache it (migration 270), so the card
 *   can say where the drop lands.
 * POST { action }:
 *   copy      "Copy to Drive" on a file that rendered but isn't in Drive yet:
 *             filed again from its Storage copy; nothing renders.
 *   render    starts the montage package (no approval: Matas starts it
 *             himself, RT1); the render tick renders and files each file.
 *   retry     "Try again" on a file that didn't render.
 *   rerender  "Render as round {round+1}" on a file that failed a check: the
 *             same version and ratio, from the same picks, as its own package.
 *
 * Operator-only (the /api gate, #1276), and only the event's owner. Nothing
 * here calls Meta. One package at a time per event; none within 60 s of the
 * last for the same recipe (lib/render-templates/store.ts).
 */

import { NextResponse, type NextRequest } from "next/server";

import { londonToday } from "@/lib/drive/tree";
import { fileRowOf } from "@/lib/mcp/tools/render";
import { beatGrid } from "@/lib/render-templates/beats";
import { loadPackageState } from "@/lib/render-templates/load";
import { pickerHeader, pickedTrack, recipeCards } from "@/lib/render-templates/package-view";
import { renderRowView } from "@/lib/render-templates/report";
import { startDeps } from "@/lib/render-templates/server-deps";
import { requestPackage } from "@/lib/render-templates/start";
import { costGuard, retryFile, saveBeatGrid } from "@/lib/render-templates/store";
import { dropOffsetS } from "@/lib/render-templates/montage-plan";
import type { MontageVariant, Ratio } from "@/lib/render-templates/file-name";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

async function owned(eventId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: NextResponse.json({ error: "Unauthorised" }, { status: 401 }) };
  const db = createServiceRoleClient();
  const res = await db.from("events").select("id, user_id").eq("id", eventId).eq("user_id", user.id).maybeSingle();
  if (res.error) return { ok: false as const, error: NextResponse.json({ error: res.error.message }, { status: 500 }) };
  if (!res.data) return { ok: false as const, error: NextResponse.json({ error: "No event with that id." }, { status: 404 }) };
  return { ok: true as const, db, userId: user.id };
}

type Row = Record<string, unknown>;

export async function GET(_req: NextRequest, ctx: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const { eventId } = await ctx.params;
  const scope = await owned(eventId);
  if (!scope.ok) return scope.error;
  const now = new Date();
  const deps = startDeps(scope.db);
  try {
    let loaded = await loadPackageState(scope.db, eventId, deps, now, londonToday(now));
    if (!loaded) return NextResponse.json({ error: "No event with that id." }, { status: 404 });
    // The card's "drop at {s} s": the picked track's grid, read once.
    const track = pickedTrack(loaded.state);
    const row = track ? loaded.tracks.find((t) => t.id === track.id) : null;
    if (track && row && !row.beatGrid && row.storagePath && track.dropS != null) {
      try {
        const grid = beatGrid(await deps.readLowPcm(row.storagePath), track.dropS, { durationS: track.durationS ?? undefined });
        await saveBeatGrid(scope.db, track.id, grid, track.dropS, now);
        const at = dropOffsetS(grid, track.dropS);
        loaded = { ...loaded, state: { ...loaded.state, tracks: loaded.state.tracks.map((t) => (t.id === track.id ? { ...t, dropAtS: at } : t)) } };
      } catch {
        // The drop's place stays unsaid; the need is still ready.
      }
    }
    const packages = await scope.db.from("creative_lab_render_packages").select("id, status, created_at").eq("event_id", eventId).order("created_at", { ascending: false }).range(0, 49);
    const ids = ((packages.data ?? []) as Row[]).map((p) => String(p.id));
    const files = ids.length
      ? await scope.db.from("creative_lab_renders").select("id, package_id, file_name, status, round_no, recipe, rights_shareable, rights_held_reason, checks, drive_file_id, created_at").in("package_id", ids).range(0, 999)
      : { data: [] as Row[], error: null };
    const order = new Map(ids.map((id, i) => [id, i]));
    const rows = ((files.data ?? []) as Row[])
      .sort((a, b) => (order.get(String(a.package_id)) ?? 0) - (order.get(String(b.package_id)) ?? 0) || String(a.file_name).localeCompare(String(b.file_name)))
      .map((r) => renderRowView(fileRowOf(r), loaded!.facts.clientName));
    const running = ((packages.data ?? []) as Row[]).some((p) => p.status === "rendering");
    // MA1: while the cost guard holds, its line shows under Render and Render stays off.
    const guarded = await costGuard(scope.db, { eventId, eventCode: loaded.facts.code, recipe: "montage", now });
    return NextResponse.json({
      header: pickerHeader(loaded.state),
      cards: recipeCards(loaded.state, loaded.muted),
      running,
      guard: guarded && !guarded.ok ? guarded.lab : null,
      rows,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/creative_lab_render_packages|beat_grid|does not exist|schema cache/i.test(message)) return NextResponse.json({ error: "table_missing" }, { status: 503 });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ eventId: string }> }): Promise<NextResponse> {
  const { eventId } = await ctx.params;
  const scope = await owned(eventId);
  if (!scope.ok) return scope.error;
  const body = (await req.json().catch(() => ({}))) as { action?: string; renderId?: string };
  const now = new Date();
  const deps = startDeps(scope.db);
  if (body.action === "render") {
    const result = await requestPackage(scope.db, deps, { userId: scope.userId, eventId, recipes: ["montage"], source: "lab", approval: null, now, today: londonToday(now) });
    if (!result.ok) return NextResponse.json({ error: "lab" in result.refusal ? result.refusal.lab : result.refusal.text, refused: result.refusal.refused }, { status: 409 });
    return NextResponse.json({ ok: true, started: result.started, files: result.files });
  }
  if (body.action === "retry" && body.renderId) {
    const code = (await scope.db.from("events").select("event_code").eq("id", eventId).maybeSingle()).data?.event_code ?? "";
    const out = await retryFile(scope.db, { renderId: body.renderId, userId: scope.userId, eventCode: String(code) });
    return out.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: out.text }, { status: 409 });
  }
  if (body.action === "copy" && body.renderId) {
    const { driveFromEnv } = await import("@/lib/drive/client");
    const { copyToDriveAgain } = await import("@/lib/render-templates/worker");
    const { workerDeps } = await import("@/lib/render-templates/server-deps");
    const ok = await copyToDriveAgain(scope.db, workerDeps(scope.db, driveFromEnv().drive), { renderId: body.renderId, userId: scope.userId });
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "" }, { status: 409 });
  }
  if (body.action === "rerender" && body.renderId) {
    const r = await scope.db.from("creative_lab_renders").select("id, user_id, package_id, variant, aspect, round_no, status, checks").eq("id", body.renderId).maybeSingle();
    const row = r.data as Row | null;
    if (!row || String(row.user_id) !== scope.userId || row.status !== "done" || (row.checks as { passed?: boolean } | null)?.passed !== false) {
      return NextResponse.json({ error: "" }, { status: 409 });
    }
    const p = await scope.db.from("creative_lab_render_packages").select("picks").eq("id", String(row.package_id)).maybeSingle();
    const picks = (p.data as Row | null)?.picks as { clipIds?: string[]; trackId?: string } | undefined;
    const result = await requestPackage(scope.db, deps, {
      userId: scope.userId,
      eventId,
      recipes: ["montage"],
      picks: { clips: picks?.clipIds, track: picks?.trackId },
      source: "lab",
      approval: null,
      now,
      today: londonToday(now),
      only: [{ variant: String(row.variant) as MontageVariant, ratio: String(row.aspect) as Ratio }],
      round: Number(row.round_no ?? 1) + 1,
    });
    if (!result.ok) return NextResponse.json({ error: "lab" in result.refusal ? result.refusal.lab : result.refusal.text, refused: result.refusal.refused }, { status: 409 });
    return NextResponse.json({ ok: true, started: result.started, files: result.files });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
